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

type AnalyticsResult = {
  videoId: string
  ok: boolean
  status?: number
  data?: { views: number; minutesWatched: number; avgDuration: number; avgPercentage: number; subsGained: number; subsLost: number; shares: number; revenue: number | null }
  error?: string
}

// Fetch analytics for ONE video using filter=video==ID (contourne la restriction dim=video)
async function fetchVideoAnalytics(
  token: string,
  channelIdsParam: string,
  videoId: string,
  startDate: string,
  endDate: string,
  tryRevenue: boolean
): Promise<AnalyticsResult> {
  const metricsWithRevenue = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares,estimatedRevenue'
  const metricsNoRevenue = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares'

  async function attempt(metrics: string): Promise<{ ok: boolean; row?: any[]; status?: number; errorMsg?: string }> {
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
    url.searchParams.set('ids', channelIdsParam)
    url.searchParams.set('startDate', startDate)
    url.searchParams.set('endDate', endDate)
    url.searchParams.set('metrics', metrics)
    url.searchParams.set('filters', `video==${videoId}`)
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    const d = await r.json()
    if (!r.ok) return { ok: false, status: r.status, errorMsg: d.error?.message || `HTTP ${r.status}` }
    return { ok: true, row: d.rows?.[0] }
  }

  try {
    const metrics = tryRevenue ? metricsWithRevenue : metricsNoRevenue
    let res = await attempt(metrics)

    // Si erreur spécifiquement sur revenue, retry sans
    if (!res.ok && tryRevenue && (res.errorMsg?.toLowerCase().includes('monetary') || res.errorMsg?.toLowerCase().includes('revenue'))) {
      res = await attempt(metricsNoRevenue)
      tryRevenue = false
    }

    if (!res.ok) {
      return { videoId, ok: false, status: res.status, error: res.errorMsg }
    }

    // Si pas de rows, la vidéo n'a pas de data mais la requête a réussi — renvoyer des zéros
    const row = res.row || [0, 0, 0, 0, 0, 0, 0, ...(tryRevenue ? [0] : [])]

    return {
      videoId,
      ok: true,
      data: {
        views: row[0] || 0,
        minutesWatched: row[1] || 0,
        avgDuration: row[2] || 0,
        avgPercentage: row[3] || 0,
        subsGained: row[4] || 0,
        subsLost: row[5] || 0,
        shares: row[6] || 0,
        revenue: tryRevenue ? (row[7] || 0) : null,
      },
    }
  } catch (e: any) {
    return { videoId, ok: false, error: e.message }
  }
}

// Process videos in parallel batches (max concurrency)
async function fetchAllAnalytics(
  token: string,
  channelIdsParam: string,
  videoIds: string[],
  startDate: string,
  endDate: string,
  initialTryRevenue: boolean,
  batchSize = 20
): Promise<{ results: AnalyticsResult[]; revenueAvailable: boolean }> {
  const results: AnalyticsResult[] = []
  let tryRevenue = initialTryRevenue

  for (let i = 0; i < videoIds.length; i += batchSize) {
    const batch = videoIds.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map((vid) => fetchVideoAnalytics(token, channelIdsParam, vid, startDate, endDate, tryRevenue))
    )
    results.push(...batchResults)

    // Si on a tenté avec revenue et que le premier résultat du premier batch dit "monetary not allowed",
    // on bascule en mode no-revenue pour les batches suivants
    if (i === 0 && tryRevenue) {
      const anyRevenueError = batchResults.some(r => !r.ok && r.error && (r.error.toLowerCase().includes('monetary') || r.error.toLowerCase().includes('revenue')))
      if (anyRevenueError) tryRevenue = false
    }
  }

  return { results, revenueAvailable: tryRevenue }
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
    videos: 0, analytics: 0, playlists: 0, associations: 0, channels: 0,
    errors: [], warnings: [], monetaryEnabled: true,
  }

  try {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken || !session?.userId) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 })
    }
    const sessionToken = session.accessToken
    const userId = session.userId
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // Sync main channel and remember its ID
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
          user_id: userId, channel_id: ch.id,
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

    // PHASE 4 : Récupérer les chaînes via channel_access (owner OU operator)
    const { data: accesses } = await supabase.from('channel_access')
      .select('channel_id, role, is_selected')
      .eq('user_id', userId).eq('is_selected', true)

    let selectedChannels: any[] = []

    if (accesses && accesses.length > 0) {
      // Nouveau chemin : chaînes via channel_access
      const accessibleIds = accesses.map((a: any) => a.channel_id)
      const { data: channelsData } = await supabase.from('channels')
        .select('channel_id, title, user_id, access_token, refresh_token, token_expires_at, owner_user_id')
        .in('channel_id', accessibleIds)

      // Dédupliquer par channel_id (garder ligne canonique où user_id === owner_user_id)
      const dedupedMap = new Map<string, any>()
      for (const ch of channelsData || []) {
        const existing = dedupedMap.get(ch.channel_id)
        if (!existing || (ch.owner_user_id && ch.owner_user_id === ch.user_id && (!existing.owner_user_id || existing.owner_user_id !== existing.user_id))) {
          dedupedMap.set(ch.channel_id, ch)
        }
      }
      selectedChannels = Array.from(dedupedMap.values()).map(ch => {
        const acc = accesses.find((a: any) => a.channel_id === ch.channel_id)
        return { ...ch, access_role: acc?.role || 'owner' }
      })
    } else {
      // Fallback legacy : ancien système user_id + is_selected
      const { data: legacyChannels } = await supabase.from('channels')
        .select('channel_id, title, user_id, access_token, refresh_token, token_expires_at')
        .eq('user_id', userId).eq('is_selected', true)
      selectedChannels = (legacyChannels || []).map((ch: any) => ({ ...ch, access_role: 'owner' }))
    }

    if (!selectedChannels || selectedChannels.length === 0) {
      results.errors.push('Aucune chaîne sélectionnée')
      return NextResponse.json(results)
    }

    results.channels = selectedChannels.length

    for (const channel of selectedChannels) {
      const chId = channel.channel_id
      const chName = channel.title || chId
      const isPrimary = chId === primaryChannelId
      const isOperator = channel.access_role === 'operator'

      // PHASE 4 (Fix 4b) : résolution intelligente du token
      // Stratégie : ne prendre le token propriétaire que s'il est UTILISABLE
      // Utilisable = expires_at dans le futur OU refresh_token valide pour renouveler
      let token: string = sessionToken
      let tokenSource: 'owner_delegated' | 'channel_stored' | 'session' = 'session'

      const { data: ownerToken } = await supabase.from('channel_tokens')
        .select('access_token, refresh_token, expires_at, owner_user_id')
        .eq('channel_id', chId)
        .maybeSingle()

      const nowSec = Math.floor(Date.now() / 1000)
      const ownerTokenStillValid = ownerToken?.access_token
        && ownerToken.expires_at
        && ownerToken.expires_at - nowSec > 300
      const ownerTokenCanRefresh = ownerToken?.refresh_token && ownerToken.refresh_token !== ''

      if (ownerTokenStillValid) {
        // Token propriétaire récent et encore valide : on l'utilise
        token = ownerToken!.access_token!
        tokenSource = 'owner_delegated'
      } else if (ownerTokenCanRefresh) {
        // Token propriétaire expiré MAIS refreshable : on renouvelle
        try {
          const refRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: process.env.GOOGLE_CLIENT_ID!,
              client_secret: process.env.GOOGLE_CLIENT_SECRET!,
              grant_type: 'refresh_token',
              refresh_token: ownerToken!.refresh_token!,
            }),
          })
          const refData = await refRes.json()
          if (refRes.ok && refData.access_token) {
            token = refData.access_token
            tokenSource = 'owner_delegated'
            await supabase.from('channel_tokens').update({
              access_token: refData.access_token,
              expires_at: nowSec + (refData.expires_in || 3600),
              last_refreshed_at: new Date().toISOString(),
            }).eq('channel_id', chId)
          } else {
            // Refresh échoué : fallback sur sessionToken (plus sûr qu'un token mort)
            token = sessionToken
          }
        } catch (e) {
          token = sessionToken
        }
      } else if (channel.access_token && (channel.token_expires_at ? channel.token_expires_at - nowSec > 300 : false)) {
        // Legacy : fallback sur ancien token de channels si encore valide
        token = channel.access_token
        tokenSource = 'channel_stored'
        if (channel.refresh_token) {
          token = await refreshChannelToken(channel, supabase)
        }
      }
      // Sinon : token = sessionToken par défaut (seule option sûre)
      // Si l'user est operator et qu'aucun token propriétaire n'est utilisable,
      // le sessionToken va échouer sur Analytics mais c'est géré gracieusement plus bas

      // STEP 1: Videos via playlistItems (1 unit/page)
      let videoIds: string[] = []
      try {
        const cr = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${chId}`, { headers: { Authorization: `Bearer ${token}` } })
        const cd = await cr.json()
        if (!cr.ok) throw new Error(cd.error?.message || 'Failed to get channel')
        const uplId = cd.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
        if (!uplId) throw new Error('No uploads playlist for ' + chName)

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
          videoIds = videoIds.concat((d.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean))
          npt = d.nextPageToken
        } while (npt)

        if (videoIds.length > 0) {
          const allVids: any[] = []
          for (let i = 0; i < videoIds.length; i += 50) {
            const b = videoIds.slice(i, i + 50)
            const u = new URL('https://www.googleapis.com/youtube/v3/videos')
            u.searchParams.set('part', 'snippet,contentDetails,statistics,status')
            u.searchParams.set('id', b.join(','))
            const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } })
            const d = await r.json()
            if (!r.ok) throw new Error(d.error?.message || 'Video details error')
            allVids.push(...(d.items || []))
          }
          const ins = allVids.map((v: any) => ({
            user_id: userId, channel_id: chId, youtube_id: v.id,
            title: v.snippet?.title, description: v.snippet?.description,
            thumbnail_url: v.snippet?.thumbnails?.medium?.url,
            published_at: v.snippet?.publishedAt,
            status: v.status?.privacyStatus,
            duration: v.contentDetails?.duration,
            tags: v.snippet?.tags || [], category_id: v.snippet?.categoryId,
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

      // STEP 2: Analytics — NOUVELLE STRATÉGIE: filter=video par vidéo, en parallèle
      try {
        if (videoIds.length > 0) {
          // Date range : de la plus ancienne vidéo à aujourd'hui
          const { data: oldestVideo } = await supabase.from('videos')
            .select('published_at')
            .eq('user_id', userId).eq('channel_id', chId)
            .order('published_at', { ascending: true })
            .limit(1).single()

          const oldest = oldestVideo?.published_at
            ? new Date(oldestVideo.published_at).toISOString().split('T')[0]
            : '2005-01-01'
          const today = new Date().toISOString().split('T')[0]

          // Stratégie des IDs: MINE si c'est la chaîne principale, sinon channel==ID
          const idsParam = isPrimary ? 'channel==MINE' : `channel==${chId}`

          const { results: analyticsResults, revenueAvailable } = await fetchAllAnalytics(
            token, idsParam, videoIds, oldest, today, true, 20
          )

          const successful = analyticsResults.filter(r => r.ok)
          const failed = analyticsResults.filter(r => !r.ok)

          // Si tous ont échoué, on considère que la chaîne est bloquée (genre Content ID / gestionnaire)
          if (successful.length === 0 && failed.length > 0) {
            const firstError = failed[0].error || 'Unknown'
            const status = failed[0].status
            let reason = 'Analytics non disponibles'
            if (status === 403 || firstError.toLowerCase().includes('forbidden')) {
              reason = 'Analytics restreintes — tu n\'es pas propriétaire direct de cette chaîne (statut gestionnaire limité)'
            } else if (status === 400) {
              reason = 'Requête refusée par YouTube Analytics'
            } else {
              reason = firstError
            }
            results.warnings.push({ channel: chName, reason, detail: firstError })
            results.errors.push(`Analytics (${chName}): ${firstError}`)
          } else {
            // Update chaque vidéo avec ses analytics
            const updates = successful.map(r => {
              const base: any = {
                user_id: userId, channel_id: chId, youtube_id: r.videoId,
                estimated_minutes_watched: r.data!.minutesWatched,
                average_view_duration: r.data!.avgDuration,
                average_view_percentage: r.data!.avgPercentage,
                subscribers_gained: r.data!.subsGained,
                subscribers_lost: r.data!.subsLost,
                shares: r.data!.shares,
                analytics_synced_at: new Date().toISOString(),
              }
              if (r.data!.revenue !== null) {
                base.estimated_revenue = r.data!.revenue
              }
              return base
            })

            for (let i = 0; i < updates.length; i += 500) {
              const { error } = await supabase.from('videos').upsert(updates.slice(i, i + 500), { onConflict: 'user_id,channel_id,youtube_id', ignoreDuplicates: false })
              if (error) throw error
            }
            results.analytics += updates.length

            // Si certaines ont échoué mais pas toutes, warning soft
            if (failed.length > 0) {
              results.warnings.push({
                channel: chName,
                reason: `${failed.length}/${analyticsResults.length} vidéos sans analytics`,
                detail: failed[0].error || '',
              })
            }

            // Si revenue indispo
            if (!revenueAvailable) {
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
            user_id: userId, channel_id: chId, playlist_id: p.id,
            title: p.snippet?.title, description: p.snippet?.description,
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
