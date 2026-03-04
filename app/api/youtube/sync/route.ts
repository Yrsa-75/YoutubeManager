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
    let allVideos: any[] = []
    let pageToken: string | undefined

    do {
      const url = new URL('https://www.googleapis.com/youtube/v3/search')
      url.searchParams.set('part', 'id')
      url.searchParams.set('forMine', 'true')
      url.searchParams.set('type', 'video')
      url.searchParams.set('maxResults', '50')
      if (pageToken) url.searchParams.set('pageToken', pageToken)

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'YouTube API error')

      const ids = data.items?.map((item: any) => item.id.videoId) || []

      if (ids.length > 0) {
        const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
        detailsUrl.searchParams.set('part', 'snippet,statistics,contentDetails,status')
        detailsUrl.searchParams.set('id', ids.join(','))

        const detailsRes = await fetch(detailsUrl.toString(), {
          headers: { Authorization: `Bearer ${token}` }
        })
        const detailsData = await detailsRes.json()
        allVideos.push(...(detailsData.items || []))
      }

      pageToken = data.nextPageToken
    } while (pageToken && allVideos.length < 500)

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
      const { error } = await supabase
        .from('videos')
        .upsert(videosToInsert, { onConflict: 'youtube_id' })
      if (error) throw error
    }

    return NextResponse.json({
      success: true,
      synced: videosToInsert.length,
      message: `${videosToInsert.length} vidéos synchronisées`
    })
  } catch (error: any) {
    console.error('Sync error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
