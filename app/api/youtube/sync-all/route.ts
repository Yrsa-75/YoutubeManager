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
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 })
    }

    const token = session.accessToken
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // ============================
    // STEP 1: Sync videos via playlistItems.list
    // ============================
    try {
      const channelRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const channelData = await channelRes.json()
      if (!channelRes.ok) throw new Error(channelData.error?.message || 'Failed to get channel')

      const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
      if (!uploadsPlaylistId) throw new Error('No uploads playlist found')

      let allVideoIds: string[] = []
      let pageToken: string | undefined

      do {
        const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
        url.searchParams.set('part', 'snippet')
        url.searchParams.set('playlistId', uploadsPlaylistId)
        url.searchParams.set('maxResults', '50')
        if (pageToken) url.searchParams.set('pageToken', pageToken)

        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'YouTube API error')

        const ids = data.items?.map((item: any) => item.snippet?.resourceId?.videoId).filter(Boolean) || []
        allVideoIds.push(...ids)
        pageToken = data.nextPageToken
      } while (pageToken && allVideoIds.length < 10000)

      let allVideos: any[] = []
      for (let i = 0; i < allVideoIds.length; i += 50) {
        const batch = allVideoIds.slice(i, i + 50)
        const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
        detailsUrl.searchParams.set('part', 'snippet,statistics,contentDetails,status')
        detailsUrl.searchParams.set('id', batch.join(','))

        const detailsRes = await fetch(detailsUrl.toString(), { headers: { Authorization: `Bearer ${token}` } })
        const detailsData = await detailsRes.json()
        if (!detailsRes.ok) throw new Error(detailsData.error?.message || 'Failed to get video details')
        allVideos.push(...(detailsData.items || []))
      }

      const videosToInsert = allVideos.map((video: any) => ({
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

      if (videosToInsert.length > 0) {
        for (let i = 0; i < videosToInsert.length; i += 500) {
          const batch = videosToInsert.slice(i, i + 500)
          const { error } = await supabase.from('videos').upsert(batch, { onConflict: 'youtube_id' })
          if (error) throw error
        }
      }
      results.videos = videosToInsert.length

      await supabase.from('sync_logs').insert({
        videos_synced: videosToInsert.length,
        status: 'success',
        synced_at: new Date().toISOString(),
      })
    } catch (e: any) {
      results.errors.push('Videos: ' + e.message)
    }

    // ============================
    // STEP 2: Sync analytics
    // ============================
    try {
      const { data: videos } = await supabase
        .from('videos')
        .select('youtube_id, published_at')
        .order('published_at', { ascending: true })

      if (videos && videos.length > 0) {
        const oldestDate = videos[0]?.published_at
          ? new Date(videos[0].published_at).toISOString().split('T')[0]
          : '2005-01-01'
        const today = new Date().toISOString().split('T')[0]

        let allRows: any[][] = []
        let startIndex = 1
        const PAGE_SIZE = 200

        while (true) {
          const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
          url.searchParams.set('ids', 'channel==MINE')
          url.searchParams.set('startDate', oldestDate)
          url.searchParams.set('endDate', today)
          url.searchParams.set('dimensions', 'video')
          url.searchParams.set('metrics', 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares')
          url.searchParams.set('maxResults', String(PAGE_SIZE))
          url.searchParams.set('startIndex', String(startIndex))
          url.searchParams.set('sort', '-estimatedMinutesWatched')

          const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error?.message || 'Analytics API error')

          if (!data.rows || data.rows.length === 0) break
          allRows.push(...data.rows)
          if (data.rows.length < PAGE_SIZE) break
          startIndex += PAGE_SIZE
        }

        if (allRows.length > 0) {
          const updates = allRows.map((row: any[]) => ({
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
            const { error } = await supabase.from('videos').upsert(batch, { onConflict: 'youtube_id', ignoreDuplicates: false })
            if (error) throw error
          }
          results.analytics = updates.length
        }
      }
    } catch (e: any) {
      results.errors.push('Analytics: ' + e.message)
    }

    // ============================
    // STEP 3: Sync playlists
    // ============================
    try {
      let allPlaylists: any[] = []
      let pageToken: string | undefined

      do {
        const url = new URL('https://www.googleapis.com/youtube/v3/playlists')
        url.searchParams.set('part', 'snippet,contentDetails')
        url.searchParams.set('mine', 'true')
        url.searchParams.set('maxResults', '50')
        if (pageToken) url.searchParams.set('pageToken', pageToken)

        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'Failed to get playlists')
        allPlaylists.push(...(data.items || []))
        pageToken = data.nextPageToken
      } while (pageToken)

      const playlistsToInsert = allPlaylists.map((pl: any) => ({
        playlist_id: pl.id,
        title: pl.snippet?.title,
        description: pl.snippet?.description,
        thumbnail_url: pl.snippet?.thumbnails?.medium?.url,
        video_count: pl.contentDetails?.itemCount || 0,
        published_at: pl.snippet?.publishedAt,
        synced_at: new Date().toISOString(),
      }))

      if (playlistsToInsert.length > 0) {
        const { error } = await supabase.from('playlists').upsert(playlistsToInsert, { onConflict: 'playlist_id' })
        if (error) throw error
      }
      results.playlists = playlistsToInsert.length

      // Rebuild associations
      await supabase.from('video_playlists').delete().neq('youtube_id', '')

      for (const playlist of allPlaylists) {
        let plPageToken: string | undefined
        let position = 0
        do {
          const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
          url.searchParams.set('part', 'snippet')
          url.searchParams.set('playlistId', playlist.id)
          url.searchParams.set('maxResults', '50')
          if (plPageToken) url.searchParams.set('pageToken', plPageToken)

          const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
          const data = await res.json()
          if (!res.ok) break

          const associations = (data.items || [])
            .map((item: any) => ({ youtube_id: item.snippet?.resourceId?.videoId, playlist_id: playlist.id, position: position++ }))
            .filter((a: any) => a.youtube_id)

          if (associations.length > 0) {
            const { error } = await supabase.from('video_playlists').upsert(associations, { onConflict: 'youtube_id,playlist_id' })
            if (!error) results.associations += associations.length
          }
          plPageToken = data.nextPageToken
        } while (plPageToken)
      }
    } catch (e: any) {
      results.errors.push('Playlists: ' + e.message)
    }

    const parts = []
    if (results.videos > 0) parts.push(`${results.videos} vidéos`)
    if (results.analytics > 0) parts.push(`${results.analytics} analytics`)
    if (results.playlists > 0) parts.push(`${results.playlists} playlists`)

    return NextResponse.json({
      success: results.errors.length === 0,
      ...results,
      message: parts.length > 0 ? `Synchronisé : ${parts.join(', ')}` : 'Rien à synchroniser',
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
