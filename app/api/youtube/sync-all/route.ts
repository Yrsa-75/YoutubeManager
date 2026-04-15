import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

export async function POST() {
  const results: { videos: number; analytics: number; playlists: number; associations: number; channels: number; errors: string[] } = {
    videos: 0, analytics: 0, playlists: 0, associations: 0, channels: 0, errors: [],
  }

  try {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken || !session?.userId) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 })
    }

    const token = session.accessToken
    const userId = session.userId
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // === SYNC CHANNELS LIST ===
    try {
      const allChannels: any[] = []
      const mineRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true',
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const mineData = await mineRes.json()
      if (mineRes.ok && mineData.items) allChannels.push(...mineData.items)

      const managedRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&managedByMe=true&maxResults=50',
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const managedData = await managedRes.json()
      if (managedRes.ok && managedData.items) {
        const ids = new Set(allChannels.map((c: any) => c.id))
        for (const ch of managedData.items) {
          if (!ids.has(ch.id)) allChannels.push(ch)
        }
      }

      const { data: existing } = await supabase
        .from('channels').select('channel_id, is_selected').eq('user_id', userId)
      const selMap = new Map((existing || []).map(c => [c.channel_id, c.is_selected]))

      if (allChannels.length > 0) {
        const toInsert = allChannels.map((ch: any) => ({
          user_id: userId,
          channel_id: ch.id,
          title: ch.snippet?.title,
          thumbnail_url: ch.snippet?.thumbnails?.default?.url,
          subscriber_count: parseInt(ch.statistics?.subscriberCount || '0'),
          video_count: parseInt(ch.statistics?.videoCount || '0'),
          is_selected: selMap.has(ch.id) ? selMap.get(ch.id) : true,
          synced_at: new Date().toISOString(),
        }))
        await supabase.from('channels').upsert(toInsert, { onConflict: 'user_id,channel_id', ignoreDuplicates: false })
        results.channels = toInsert.length
      }
    } catch (e: any) {
      results.errors.push('Channels: ' + e.message)
    }

    // Get selected channels
    const { data: selectedChannels } = await supabase
      .from('channels').select('channel_id, title').eq('user_id', userId).eq('is_selected', true)

    if (!selectedChannels || selectedChannels.length === 0) {
      results.errors.push('Aucune chaîne sélectionnée')
      return NextResponse.json(results)
    }

    // === FOR EACH SELECTED CHANNEL ===
    for (const channel of selectedChannels) {
      const chId = channel.channel_id
      const chName = channel.title || chId

      // STEP 1: Sync videos
      try {
        const channelRes = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${chId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const channelData = await channelRes.json()
        if (!channelRes.ok) throw new Error(channelData.error?.message || 'Failed to get channel')

        const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
        if (!uploadsPlaylistId) throw new Error('No uploads playlist for ' + chName)

        let allVideoIds: string[] = []
        let nextPageToken: string | undefined
        do {
          const plUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
          plUrl.searchParams.set('part', 'contentDetails')
          plUrl.searchParams.set('playlistId', uploadsPlaylistId)
          plUrl.searchParams.set('maxResults', '50')
          if (nextPageToken) plUrl.searchParams.set('pageToken', nextPageToken)
          const plRes = await fetch(plUrl.toString(), { headers: { Authorization: `Bearer ${token}` } })
          const plData = await plRes.json()
          if (!plRes.ok) throw new Error(plData.error?.message || 'Failed to list playlist items')
          const ids = (plData.items || []).map((item: any) => item.contentDetails?.videoId).filter(Boolean)
          allVideoIds = allVideoIds.concat(ids)
          nextPageToken = plData.nextPageToken
        } while (nextPageToken)

        if (allVideoIds.length > 0) {
          const allVideos: any[] = []
          for (let i = 0; i < allVideoIds.length; i += 50) {
            const batch = allVideoIds.slice(i, i + 50)
            const vUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
            vUrl.searchParams.set('part', 'snippet,contentDetails,statistics,status')
            vUrl.searchParams.set('id', batch.join(','))
            const vRes = await fetch(vUrl.toString(), { headers: { Authorization: `Bearer ${token}` } })
            const vData = await vRes.json()
            if (!vRes.ok) throw new Error(vData.error?.message || 'Failed to get video details')
            allVideos.push(...(vData.items || []))
          }

          const videosToInsert = allVideos.map((video: any) => ({
            user_id: userId, channel_id: chId, youtube_id: video.id,
            title: video.snippet?.title, description: video.snippet?.description,
            thumbnail_url: video.snippet?.thumbnails?.medium?.url,
            published_at: video.snippet?.publishedAt, status: video.status?.privacyStatus,
            duration: video.contentDetails?.duration, tags: video.snippet?.tags || [],
            category_id: video.snippet?.categoryId,
            view_count: parseInt(video.statistics?.viewCount || '0'),
            like_count: parseInt(video.statistics?.likeCount || '0'),
            comment_count: parseInt(video.statistics?.commentCount || '0'),
            synced_at: new Date().toISOString(),
          }))

          for (let i = 0; i < videosToInsert.length; i += 500) {
            const batch = videosToInsert.slice(i, i + 500)
            const { error } = await supabase.from('videos')
              .upsert(batch, { onConflict: 'user_id,channel_id,youtube_id', ignoreDuplicates: falselse })
            if (error) throw error
          }
          results.videos += videosToInsert.length
        }
      } catch (e: any) {
        console.error(`Video sync error [${chName}]:`, e)
        results.errors.push(`Vidéos (${chName}): ${e.message}`)
      }

      // STEP 2: Sync analytics
      try {
        const { data: videos } = await supabase.from('videos')
          .select('youtube_id, published_at').eq('user_id', userId).eq('channel_id', chId)
          .order('published_at', { ascending: true })

        if (videos && videos.length > 0) {
          const oldestDate = videos[0]?.published_at
            ? new Date(videos[0].published_at).toISOString().split('T')[0] : '2005-01-01'
          const today = new Date().toISOString().split('T')[0]

          const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
          url.searchParams.set('ids', `channel==${chId}`)
          url.searchParams.set('startDate', oldestDate)
          url.searchParams.set('endDate', today)
          url.searchParams.set('dimensions', 'video')
          url.searchParams.set('metrics', 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares')
          url.searchParams.set('maxResults', '500')
          url.searchParams.set('sort', '-estimatedMinutesWatched')

          const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error?.message || 'Analytics API error')

          if (data.rows && data.rows.length > 0) {
            const updates = data.rows.map((row: any[]) => ({
              user_id: userId, channel_id: chId, youtube_id: row[0],
              estimated_minutes_watched: row[1] || 0, average_view_duration: row[2] || 0,
              average_view_percentage: row[3] || 0, subscribers_gained: row[4] || 0,
              subscribers_lost: row[5] || 0, shares: row[6] || 0,
              analytics_synced_at: new Date().toISOString(),
            }))
            for (let i = 0; i < updates.length; i += 500) {
              const batch = updates.slice(i, i + 500)
              const { error } = await supabase.from('videos')
                .upsert(batch, { onConflict: 'user_id,channel_id,youtube_id', ignoreDuplicates: false })
              if (error) throw error
            }
            results.analytics += updates.length
          }
        }
      } catch (e: any) {
        console.error(`Analytics sync error [${chName}]:`, e)
        results.errors.push(`Analytics (${chName}): ${e.message}`)
      }

      // STEP 3: Sync playlists
      try {
        let allPlaylists: any[] = []
        let nextPageToken: string | undefined
        do {
          const plUrl = new URL('https://www.googleapis.com/youtube/v3/playlists')
          plUrl.searchParams.set('part', 'snippet,contentDetails')
          plUrl.searchParams.set('channelId', chId)
          plUrl.searchParams.set('maxResults', '50')
          if (nextPageToken) plUrl.searchParams.set('pageToken', nextPageToken)
          const plRes = await fetch(plUrl.toString(), { headers: { Authorization: `Bearer ${token}` } })
          const plData = await plRes.json()
          if (!plRes.ok) throw new Error(plData.error?.message || 'Failed to list playlists')
          allPlaylists = allPlaylists.concat(plData.items || [])
          nextPageToken = plData.nextPageToken
        } while (nextPageToken)

        if (allPlaylists.length > 0) {
          const playlistsToInsert = allPlaylists.map((pl: any) => ({
            user_id: userId, channel_id: chId, playlist_id: pl.id,
            title: pl.snippet?.title, description: pl.snippet?.description,
            thumbnail_url: pl.snippet?.thumbnails?.medium?.url,
            video_count: pl.contentDetails?.itemCount || 0,
            published_at: pl.snippet?.publishedAt, synced_at: new Date().toISOString(),
          }))
          const { error } = await supabase.from('playlists')
            .upsert(playlistsToInsert, { onConflict: 'user_id,playlist_id', ignoreDuplicates: false })
          if (error) throw error
          results.playlists += playlistsToInsert.length

          // Rebuild associations
          await supabase.from('video_playlists').delete().eq('user_id', userId).eq('channel_id', chId)
          const allAssociations: any[] = []
          for (const pl of allPlaylists) {
            let pageToken: string | undefined
            let position = 0
            do {
              const itemUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
              itemUrl.searchParams.set('part', 'contentDetails')
              itemUrl.searchParams.set('playlistId', pl.id)
              itemUrl.searchParams.set('maxResults', '50')
              if (pageToken) itemUrl.searchParams.set('pageToken', pageToken)
              const itemRes = await fetch(itemUrl.toString(), { headers: { Authorization: `Bearer ${token}` } })
              const itemData = await itemRes.json()
              if (!itemRes.ok) break
              for (const item of itemData.items || []) {
                const videoId = item.contentDetails?.videoId
                if (videoId) {
                  allAssociations.push({ user_id: userId, channel_id: chId, youtube_id: videoId, playlist_id: pl.id, position: position++ })
                }
              }
              pageToken = itemData.nextPageToken
            } while (pageToken)
          }
          if (allAssociations.length > 0) {
            for (let i = 0; i < allAssociations.length; i += 500) {
              const batch = allAssociations.slice(i, i + 500)
              await supabase.from('video_playlists')
                .upsert(batch, { onConflict: 'user_id,youtube_id,playlist_id', ignoreDuplicates: false })
            }
            results.associations += allAssociations.length
          }
        }
      } catch (e: any) {
        console.error(`Playlists sync error [${chName}]:`, e)
        results.errors.push(`Playlists (${chName}): ${e.message}`)
      }
    }

    // Log sync
    await supabase.from('sync_logs').insert({
      user_id: userId, videos_synced: results.videos,
      status: results.errors.length > 0 ? 'partial' : 'success',
      error_message: results.errors.length > 0 ? results.errors.join('; ') : null,
      synced_at: new Date().toISOString(),
    })

    return NextResponse.json(results)
  } catch (error: any) {
    console.error('Sync-all error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
