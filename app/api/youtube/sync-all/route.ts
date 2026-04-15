import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

export async function POST() {
  const results: { videos: number; analytics: number; playlists: number; associations: number; errors: string[] } = {
    videos: 0,
    analytics: 0,
    playlists: 0,
    associations: 0,
    errors: [],
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

    // ============================
    // STEP 1: Sync videos via playlistItems.list
    // ============================
    try {
      // Get the "uploads" playlist ID for the channel
      const channelRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const channelData = await channelRes.json()
      if (!channelRes.ok) throw new Error(channelData.error?.message || 'Failed to get channel')

      const uploadsPlaylistId =
        channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
      if (!uploadsPlaylistId) throw new Error('No uploads playlist found')

      // Fetch all video IDs from the uploads playlist
      let allVideoIds: string[] = []
      let nextPageToken: string | undefined

      do {
        const plUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
        plUrl.searchParams.set('part', 'contentDetails')
        plUrl.searchParams.set('playlistId', uploadsPlaylistId)
        plUrl.searchParams.set('maxResults', '50')
        if (nextPageToken) plUrl.searchParams.set('pageToken', nextPageToken)

        const plRes = await fetch(plUrl.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        })
        const plData = await plRes.json()
        if (!plRes.ok) throw new Error(plData.error?.message || 'Failed to list playlist items')

        const ids = (plData.items || []).map((item: any) => item.contentDetails?.videoId).filter(Boolean)
        allVideoIds = allVideoIds.concat(ids)
        nextPageToken = plData.nextPageToken
      } while (nextPageToken)

      if (allVideoIds.length === 0) {
        results.errors.push('Aucune vidéo trouvée sur cette chaîne')
      } else {
        // Fetch full video details in batches of 50
        const allVideos: any[] = []
        for (let i = 0; i < allVideoIds.length; i += 50) {
          const batch = allVideoIds.slice(i, i + 50)
          const vUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
          vUrl.searchParams.set('part', 'snippet,contentDetails,statistics,status')
          vUrl.searchParams.set('id', batch.join(','))

          const vRes = await fetch(vUrl.toString(), {
            headers: { Authorization: `Bearer ${token}` },
          })
          const vData = await vRes.json()
          if (!vRes.ok) throw new Error(vData.error?.message || 'Failed to get video details')
          allVideos.push(...(vData.items || []))
        }

        // Upsert videos into Supabase with user_id
        const videosToInsert = allVideos.map((video: any) => ({
          user_id: userId,
          youtube_id: video.id,
          title: video.snippet?.title,
          description: video.snippet?.description,
          thumbnail_url: video.snippet?.thumbnails?.medium?.url,
          published_at: video.snippet?.publishedAt,
          status: video.status?.privacyStatus,
          duration: video.contentDetails?.duration,
          tags: video.snippet?.tags || [],
          category_id: video.snippet?.categoryId,
          view_count: parseInt(video.statistics?.viewCount || '0'),
          like_count: parseInt(video.statistics?.likeCount || '0'),
          comment_count: parseInt(video.statistics?.commentCount || '0'),
          synced_at: new Date().toISOString(),
        }))

        for (let i = 0; i < videosToInsert.length; i += 500) {
          const batch = videosToInsert.slice(i, i + 500)
          const { error } = await supabase
            .from('videos')
            .upsert(batch, { onConflict: 'user_id,youtube_id', ignoreDuplicates: false })
          if (error) throw error
        }

        results.videos = videosToInsert.length
      }
    } catch (e: any) {
      console.error('Video sync error:', e)
      results.errors.push('Vidéos: ' + e.message)
    }

    // ============================
    // STEP 2: Sync analytics
    // ============================
    try {
      // Get all video IDs for this user from Supabase
      const { data: videos, error: fetchError } = await supabase
        .from('videos')
        .select('youtube_id, published_at')
        .eq('user_id', userId)
        .order('published_at', { ascending: true })

      if (fetchError) throw fetchError

      if (videos && videos.length > 0) {
        const oldestDate = videos[0]?.published_at
          ? new Date(videos[0].published_at).toISOString().split('T')[0]
          : '2005-01-01'
        const today = new Date().toISOString().split('T')[0]

        // YouTube Analytics API
        const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
        url.searchParams.set('ids', 'channel==MINE')
        url.searchParams.set('startDate', oldestDate)
        url.searchParams.set('endDate', today)
        url.searchParams.set('dimensions', 'video')
        url.searchParams.set('metrics', 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares')
        url.searchParams.set('maxResults', '500')
        url.searchParams.set('sort', '-estimatedMinutesWatched')

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()

        if (!res.ok) {
          console.error('Analytics API error:', data)
          throw new Error(data.error?.message || 'Analytics API error')
        }

        if (data.rows && data.rows.length > 0) {
          const updates = data.rows.map((row: any[]) => ({
            user_id: userId,
            youtube_id: row[0],
            estimated_minutes_watched: row[1] || 0,
            average_view_duration: row[2] || 0,
            average_view_percentage: row[3] || 0,
            subscribers_gained: row[4] || 0,
            subscribers_lost: row[5] || 0,
            shares: row[6] || 0,
            analytics_synced_at: new Date().toISOString(),
          }))

          for (let i = 0; i < updates.length; i += 500) {
            const batch = updates.slice(i, i + 500)
            const { error: upsertError } = await supabase
              .from('videos')
              .upsert(batch, { onConflict: 'user_id,youtube_id', ignoreDuplicates: false })

            if (upsertError) {
              console.error('Analytics upsert error:', upsertError)
              throw upsertError
            }
          }

          results.analytics = updates.length
        }
      }
    } catch (e: any) {
      console.error('Analytics sync error:', e)
      results.errors.push('Analytics: ' + e.message)
    }

    // ============================
    // STEP 3: Sync playlists
    // ============================
    try {
      let allPlaylists: any[] = []
      let nextPageToken: string | undefined

      do {
        const plUrl = new URL('https://www.googleapis.com/youtube/v3/playlists')
        plUrl.searchParams.set('part', 'snippet,contentDetails')
        plUrl.searchParams.set('mine', 'true')
        plUrl.searchParams.set('maxResults', '50')
        if (nextPageToken) plUrl.searchParams.set('pageToken', nextPageToken)

        const plRes = await fetch(plUrl.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        })
        const plData = await plRes.json()
        if (!plRes.ok) throw new Error(plData.error?.message || 'Failed to list playlists')

        allPlaylists = allPlaylists.concat(plData.items || [])
        nextPageToken = plData.nextPageToken
      } while (nextPageToken)

      if (allPlaylists.length > 0) {
        // Upsert playlists
        const playlistsToInsert = allPlaylists.map((pl: any) => ({
          user_id: userId,
          playlist_id: pl.id,
          title: pl.snippet?.title,
          description: pl.snippet?.description,
          thumbnail_url: pl.snippet?.thumbnails?.medium?.url,
          video_count: pl.contentDetails?.itemCount || 0,
          published_at: pl.snippet?.publishedAt,
          synced_at: new Date().toISOString(),
        }))

        const { error } = await supabase
          .from('playlists')
          .upsert(playlistsToInsert, { onConflict: 'user_id,playlist_id', ignoreDuplicates: false })
        if (error) throw error

        results.playlists = playlistsToInsert.length

        // Rebuild associations
        // First, clear old associations for this user
        await supabase.from('video_playlists').delete().eq('user_id', userId)

        const allAssociations: { user_id: string; youtube_id: string; playlist_id: string; position: number }[] = []

        for (const pl of allPlaylists) {
          let pageToken: string | undefined
          let position = 0

          do {
            const itemUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
            itemUrl.searchParams.set('part', 'contentDetails')
            itemUrl.searchParams.set('playlistId', pl.id)
            itemUrl.searchParams.set('maxResults', '50')
            if (pageToken) itemUrl.searchParams.set('pageToken', pageToken)

            const itemRes = await fetch(itemUrl.toString(), {
              headers: { Authorization: `Bearer ${token}` },
            })
            const itemData = await itemRes.json()
            if (!itemRes.ok) break

            for (const item of itemData.items || []) {
              const videoId = item.contentDetails?.videoId
              if (videoId) {
                allAssociations.push({
                  user_id: userId,
                  youtube_id: videoId,
                  playlist_id: pl.id,
                  position: position++,
                })
              }
            }

            pageToken = itemData.nextPageToken
          } while (pageToken)
        }

        if (allAssociations.length > 0) {
          for (let i = 0; i < allAssociations.length; i += 500) {
            const batch = allAssociations.slice(i, i + 500)
            const { error: assocError } = await supabase
              .from('video_playlists')
              .upsert(batch, { onConflict: 'user_id,youtube_id,playlist_id', ignoreDuplicates: false })
            if (assocError) {
              console.error('Association upsert error:', assocError)
            }
          }
          results.associations = allAssociations.length
        }
      }
    } catch (e: any) {
      console.error('Playlists sync error:', e)
      results.errors.push('Playlists: ' + e.message)
    }

    // Log sync
    await supabase.from('sync_logs').insert({
      user_id: userId,
      videos_synced: results.videos,
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
