import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

async function refreshChannelToken(channel: any, supabase: any) {
  if (!channel.refresh_token) return channel.access_token
  if (channel.token_expires_at && channel.token_expires_at - Math.floor(Date.now() / 1000) > 300) {
    return channel.access_token
  }
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: channel.refresh_token,
      }),
    })
    const data = await res.json()
    if (!res.ok) return channel.access_token
    await supabase.from('channels').update({
      access_token: data.access_token,
      token_expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      refresh_token: data.refresh_token || channel.refresh_token,
    }).eq('channel_id', channel.channel_id).eq('user_id', channel.user_id)
    return data.access_token
  } catch {
    return channel.access_token
  }
}

// Attempt analytics fetch with a given metrics set.
// Returns { rows, error } where error is a structured object we can surface.
async function fetchAnalytics(
  token: string,
  channelId: string,
  isPrimary: boolean,
  oldestDate: string,
  today: string,
  metrics: string
): Promise<{ rows: any[] | null; error: { type: string; status: number; message: string } | null }> {
  // Strategy: if it's the primary (session) channel, try MINE first (works for owners).
  // If not, or if MINE fails, fall back to channel==ID.
  const tryUrls: Array<{ label: string; url: URL }> = []

  if (isPrimary) {
    const u1 = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
    u1.searchParams.set('ids', 'channel==MINE')
    u1.searchParams.set('startDate', oldestDate)
    u1.searchParams.set('endDate', today)
    u1.searchParams.set('dimensions', 'video')
    u1.searchParams.set('metrics', metrics)
    u1.searchParams.set('maxResults', '500')
    u1.searchParams.set('sort', '-estimatedMinutesWatched')
    tryUrls.push({ label: 'MINE', url: u1 })
  }

  const u2 = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
  u2.searchParams.set('ids', `channel==${channelId}`)
  u2.searchParams.set('startDate', oldestDate)
  u2.searchParams.set('endDate', today)
  u2.searchParams.set('dimensions', 'video')
  u2.searchParams.set('metrics', metrics)
  u2.searchParams.set('maxResults', '500')
  u2.searchParams.set('sort', '-estimatedMinutesWatched')
  tryUrls.push({ label: 'ID', url: u2 })

  let lastError: { type: string; status: number; message: string } | null = null

  for (const { label, url } of tryUrls) {
    try {
      const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
      const d = await r.json()
      if (r.ok) {
        return { rows: d.rows || [], error: null }
      }
      const msg = d.error?.message || `HTTP ${r.status}`
      lastError = {
        type: r.status === 403 ? 'forbidden' : r.status === 400 ? 'bad_request' : 'api_error',
        status: r.status,
        message: `[${label}] ${msg}`,
      }
      // Si forbidden, on continue à essayer la stratégie suivante
    } catch (e: any) {
      lastError = { type: 'network', status: 0, message: `[${label}] ${e.message}` }
    }
  }

  return { rows: null, error: lastError }
}

export async function POST() {
  const results: {
    videos: number
    analytics: number
    playlists: number
    associations: number
    channels: number
    errors: string[]
    warnings: Array<{ channel: string; reason: string; detail: string }>
    monetaryEnabled: boolean
  } = {
    videos: 0,
    analytics: 0,
    playlists: 0,
    associations: 0,
    channels: 0,
    errors: [],
    warnings: [],
    monetaryEnabled: true,
  }

  try {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken || !session?.userId) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 })
    }
    const sessionToken = session.accessToken
    const userId = session.userId
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // Sync main channel from session (and remember its ID as "primary")
    let primaryChannelId: string | null = null
    try {
      const mineRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      })
      const mineData = await mineRes.json()
      if (mineRes.ok && mineData.items?.length > 0) {
        const ch = mineData.items[0]
        primaryChannelId = ch.id
        const { data: ex } = await supabase.from('channels').select('is_selected').eq('user_id', userId).eq('channel_id', ch.id).single()
        await supabase.from('channels').upsert({
          user_id: userId,
          channel_id: ch.id,
          title: ch.snippet?.title,
          thumbnail_url: ch.snippet?.thumbnails?.default?.url,
          subscriber_count: parseInt(ch.statistics?.subscriberCount || '0'),
          video_count: parseInt(ch.statistics?.videoCount || '0'),
          is_selected: ex?.is_selected ?? true,
          access_token: sessionToken,
          synced_at: new Date().toISOString(),
        }, { onConflict: 'user_id,channel_id', ignoreDuplicates: false })
      }
    } catch (e: any) {
      results.errors.push('Main channel: ' + e.message)
    }

    // Get selected channels with tokens
    const { data: selectedChannels } = await supabase.from('channels')
      .select('channel_id, title, user_id, access_token, refresh_token, token_expires_at')
      .eq('user_id', userId).eq('is_selected', true)

    if (!selectedChannels || selectedChannels.length === 0) {
      results.errors.push('Aucune chaîne sélectionnée')
      return NextResponse.json(results)
    }

    results.channels = selectedChannels.length

    for (const channel of selectedChannels) {
      const chId = channel.channel_id
      const chName = channel.title || chId
      const isPrimary = chId === primaryChannelId
      let token = channel.access_token || sessionToken
      if (channel.refresh_token) {
        token = await refreshChannelToken(channel, supabase)
      }

      // STEP 1: Videos
      try {
        const cr = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${chId}`, { headers: { Authorization: `Bearer ${token}` } })
        const cd = await cr.json()
        if (!cr.ok) throw new Error(cd.error?.message || 'Failed to get channel')
        const uplId = cd.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
        if (!uplId) throw new Error('No uploads playlist for ' + chName)

        let allIds: string[] = []
        let npt: string | undefined
        do {
          const u = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
          u.searchParams.set('part', 'contentDetails')
          u.searchParams.set('playlistId', uplId)
          u.searchParams.set('maxResults', '50')
          if (npt) u.searchParams.set('pageToken', npt)
          const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } })
          const d = await r.json()
          if (!r.ok) throw new Error(d.error?.message || 'Failed to list items')
          allIds = allIds.concat((d.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean))
          npt = d.nextPageToken
        } while (npt)

        if (allIds.length > 0) {
          const allVids: any[] = []
          for (let i = 0; i < allIds.length; i += 50) {
            const b = allIds.slice(i, i + 50)
            const u = new URL('https://www.googleapis.com/youtube/v3/videos')
            u.searchParams.set('part', 'snippet,contentDetails,statistics,status')
            u.searchParams.set('id', b.join(','))
            const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } })
            const d = await r.json()
            if (!r.ok) throw new Error(d.error?.message || 'Video details error')
            allVids.push(...(d.items || []))
          }
          const ins = allVids.map((v: any) => ({
            user_id: userId,
            channel_id: chId,
            youtube_id: v.id,
            title: v.snippet?.title,
            description: v.snippet?.description,
            thumbnail_url: v.snippet?.thumbnails?.medium?.url,
            published_at: v.snippet?.publishedAt,
            status: v.status?.privacyStatus,
            duration: v.contentDetails?.duration,
            tags: v.snippet?.tags || [],
            category_id: v.snippet?.categoryId,
            view_count: parseInt(v.statistics?.viewCount || '0'),
            like_count: parseInt(v.statistics?.likeCount || '0'),
            comment_count: parseInt(v.statistics?.commentCount || '0'),
            synced_at: new Date().toISOString(),
          }))
          for (let i = 0; i < ins.length; i += 500) {
            const { error } = await supabase.from('videos').upsert(ins.slice(i, i + 500), { onConflict: 'user_id,channel_id,youtube_id', ignoreDuplicates: false })
            if (error) throw error
          }
          results.videos += ins.length
        }
      } catch (e: any) {
        results.errors.push(`Videos (${chName}): ${e.message}`)
      }

      // STEP 2: Analytics (with monetary fallback)
      try {
        const { data: vids } = await supabase.from('videos').select('youtube_id, published_at')
          .eq('user_id', userId).eq('channel_id', chId).order('published_at', { ascending: true })

        if (vids && vids.length > 0) {
          const oldest = vids[0]?.published_at ? new Date(vids[0].published_at).toISOString().split('T')[0] : '2005-01-01'
          const today = new Date().toISOString().split('T')[0]

          const metricsWithRevenue = 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares,estimatedRevenue'
          const metricsNoRevenue = 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares'

          // Try with revenue first
          let { rows, error } = await fetchAnalytics(token, chId, isPrimary, oldest, today, metricsWithRevenue)
          let hasRevenue = true

          // If 403 specifically on revenue, retry without revenue metric
          if (!rows && error && (error.message.toLowerCase().includes('monetary') || error.message.toLowerCase().includes('revenue'))) {
            const retry = await fetchAnalytics(token, chId, isPrimary, oldest, today, metricsNoRevenue)
            rows = retry.rows
            error = retry.error
            hasRevenue = false
          }

          if (!rows && error) {
            // Structured error message for UI
            let reason = 'Erreur inconnue'
            if (error.type === 'forbidden') {
              reason = 'Analytics restreintes — tu n\'es pas propriétaire direct de cette chaîne (statut gestionnaire limité)'
            } else if (error.type === 'bad_request') {
              reason = 'Requête refusée par YouTube Analytics'
            } else {
              reason = error.message
            }
            results.warnings.push({ channel: chName, reason, detail: error.message })
            results.errors.push(`Analytics (${chName}): ${error.message}`)
          } else if (rows && rows.length > 0) {
            const ups = rows.map((row: any[]) => {
              const base: any = {
                user_id: userId,
                channel_id: chId,
                youtube_id: row[0],
                estimated_minutes_watched: row[1] || 0,
                average_view_duration: row[2] || 0,
                average_view_percentage: row[3] || 0,
                subscribers_gained: row[4] || 0,
                subscribers_lost: row[5] || 0,
                shares: row[6] || 0,
                analytics_synced_at: new Date().toISOString(),
              }
              if (hasRevenue) {
                base.estimated_revenue = row[7] || 0
              }
              return base
            })
            for (let i = 0; i < ups.length; i += 500) {
              const { error } = await supabase.from('videos').upsert(ups.slice(i, i + 500), { onConflict: 'user_id,channel_id,youtube_id', ignoreDuplicates: false })
              if (error) throw error
            }
            results.analytics += ups.length
            if (!hasRevenue) {
              results.monetaryEnabled = false
              results.warnings.push({
                channel: chName,
                reason: 'Revenus non disponibles pour cette chaîne',
                detail: 'Scope monétaire non autorisé ou propriété restreinte',
              })
            }
          }
        }
      } catch (e: any) {
        results.errors.push(`Analytics (${chName}): ${e.message}`)
      }

      // STEP 3: Playlists
      try {
        let allPl: any[] = []
        let npt2: string | undefined
        do {
          const u = new URL('https://www.googleapis.com/youtube/v3/playlists')
          u.searchParams.set('part', 'snippet,contentDetails')
          u.searchParams.set('channelId', chId)
          u.searchParams.set('maxResults', '50')
          if (npt2) u.searchParams.set('pageToken', npt2)
          const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } })
          const d = await r.json()
          if (!r.ok) throw new Error(d.error?.message || 'Playlists error')
          allPl = allPl.concat(d.items || [])
          npt2 = d.nextPageToken
        } while (npt2)

        if (allPl.length > 0) {
          const pli = allPl.map((p: any) => ({
            user_id: userId,
            channel_id: chId,
            playlist_id: p.id,
            title: p.snippet?.title,
            description: p.snippet?.description,
            thumbnail_url: p.snippet?.thumbnails?.medium?.url,
            video_count: p.contentDetails?.itemCount || 0,
            published_at: p.snippet?.publishedAt,
            synced_at: new Date().toISOString(),
          }))
          await supabase.from('playlists').upsert(pli, { onConflict: 'user_id,playlist_id', ignoreDuplicates: false })
          results.playlists += pli.length

          await supabase.from('video_playlists').delete().eq('user_id', userId).eq('channel_id', chId)
          const assocs: any[] = []
          for (const pl of allPl) {
            let pt: string | undefined
            let pos = 0
            do {
              const iu = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
              iu.searchParams.set('part', 'contentDetails')
              iu.searchParams.set('playlistId', pl.id)
              iu.searchParams.set('maxResults', '50')
              if (pt) iu.searchParams.set('pageToken', pt)
              const ir = await fetch(iu.toString(), { headers: { Authorization: `Bearer ${token}` } })
              const idata = await ir.json()
              if (!ir.ok) break
              for (const it of idata.items || []) {
                if (it.contentDetails?.videoId) {
                  assocs.push({ user_id: userId, channel_id: chId, youtube_id: it.contentDetails.videoId, playlist_id: pl.id, position: pos++ })
                }
              }
              pt = idata.nextPageToken
            } while (pt)
          }
          if (assocs.length > 0) {
            for (let i = 0; i < assocs.length; i += 500) {
              await supabase.from('video_playlists').upsert(assocs.slice(i, i + 500), { onConflict: 'user_id,youtube_id,playlist_id', ignoreDuplicates: false })
            }
            results.associations += assocs.length
          }
        }
      } catch (e: any) {
        results.errors.push(`Playlists (${chName}): ${e.message}`)
      }
    }

    await supabase.from('sync_logs').insert({
      user_id: userId,
      videos_synced: results.videos,
      status: results.errors.length > 0 ? 'partial' : 'success',
      error_message: results.errors.length > 0 ? results.errors.join('; ') : null,
      synced_at: new Date().toISOString(),
    })

    return NextResponse.json(results)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
