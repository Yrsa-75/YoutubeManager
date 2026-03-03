import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST() {
  try {
    const session = await getServerSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Get stored token
    const { data: tokenData } = await supabase
      .from('oauth_tokens')
      .select('access_token')
      .single()

    if (!tokenData?.access_token) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 })
    }

    const token = tokenData.access_token
    let allVideos: any[] = []
    let pageToken: string | undefined

    // Fetch all video IDs from the channel (paginated)
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
      
      // Fetch video details in batches of 50
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
    } while (pageToken && allVideos.length < 500) // Safety limit for initial sync

    // Upsert videos to Supabase
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

    // Update sync log
    await supabase.from('sync_logs').insert({
      videos_synced: videosToInsert.length,
      status: 'success',
      synced_at: new Date().toISOString(),
    })

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
