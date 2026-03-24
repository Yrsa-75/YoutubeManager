import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 })
    }

    const token = session.accessToken

    // Step 1: Get the "uploads" playlist ID for the channel
    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const channelData = await channelRes.json()
    if (!channelRes.ok) throw new Error(channelData.error?.message || 'Failed to get channel')

    const uploadsPlaylistId =
      channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploadsPlaylistId) throw new Error('No uploads playlist found')

    // Step 2: Paginate playlistItems.list to get all video IDs (1 unit/page instead of 100)
    let allVideoIds: string[] = []
    let pageToken: string | undefined

    do {
      const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
      url.searchParams.set('part', 'snippet')
      url.searchParams.set('playlistId', uploadsPlaylistId)
      url.searchParams.set('maxResults', '50')
      if (pageToken) url.searchParams.set('pageToken', pageToken)

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'YouTube API error')

      const ids = data.items?.map(
        (item: any) => item.snippet?.resourceId?.videoId
      ).filter(Boolean) || []
      allVideoIds.push(...ids)

      pageToken = data.nextPageToken
    } while (pageToken && allVideoIds.length < 10000)

    // Step 3: Get video details in batches of 50
    let allVideos: any[] = []

    for (let i = 0; i < allVideoIds.length; i += 50) {
      const batch = allVideoIds.slice(i, i + 50)
      const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
      detailsUrl.searchParams.set(
        'part',
        'snippet,statistics,contentDetails,status'
      )
      detailsUrl.searchParams.set('id', batch.join(','))

      const detailsRes = await fetch(detailsUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })
      const detailsData = await detailsRes.json()
      if (!detailsRes.ok)
        throw new Error(detailsData.error?.message || 'Failed to get video details')
      allVideos.push(...(detailsData.items || []))
    }

    // Step 4: Upsert to Supabase
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

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
        const { error } = await supabase
          .from('videos')
          .upsert(batch, { onConflict: 'youtube_id' })
        if (error) throw error
      }
    }

    // Sync log
    await supabase.from('sync_logs').insert({
      videos_synced: videosToInsert.length,
      status: 'success',
      synced_at: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      synced: videosToInsert.length,
      message: `${videosToInsert.length} vid\u00e9os synchronis\u00e9es`,
    })
  } catch (error: any) {
    console.error('Sync error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
