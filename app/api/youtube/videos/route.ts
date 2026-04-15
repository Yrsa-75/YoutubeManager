import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.userId) {
      return NextResponse.json({ videos: [], total: 0, page: 1, limit: 50 })
    }
    const userId = session.userId

    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const sortBy = searchParams.get('sortBy') || 'published_at'
    const sortDir = searchParams.get('sortDir') || 'desc'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    let query = supabase
      .from('videos')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,youtube_id.ilike.%${search}%`)
    }
    if (status) query = query.eq('status', status)

    query = query.order(sortBy, { ascending: sortDir === 'asc' })
    query = query.range(offset, offset + limit - 1)

    const { data: videos, error, count } = await query

    if (error) {
      console.error('Videos fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Fetch playlist associations
    let videosWithPlaylists
    if (videos && videos.length > 0) {
      const youtubeIds = videos.map(v => v.youtube_id)

      const { data: associations } = await supabase
        .from('video_playlists')
        .select('youtube_id, playlist_id')
        .eq('user_id', userId)
        .in('youtube_id', youtubeIds)

      if (associations && associations.length > 0) {
        const playlistIds = [...new Set(associations.map(a => a.playlist_id))]
        const { data: playlists } = await supabase
          .from('playlists')
          .select('playlist_id, title')
          .in('playlist_id', playlistIds)

        const playlistMap = new Map((playlists || []).map(p => [p.playlist_id, p.title]))

        const videoPlaylistsMap = new Map<string, { playlist_id: string; title: string }[]>()
        for (const a of associations) {
          if (!videoPlaylistsMap.has(a.youtube_id)) videoPlaylistsMap.set(a.youtube_id, [])
          videoPlaylistsMap.get(a.youtube_id)!.push({
            playlist_id: a.playlist_id,
            title: playlistMap.get(a.playlist_id) || a.playlist_id,
          })
        }

        videosWithPlaylists = videos.map(v => ({
          ...v,
          playlists: videoPlaylistsMap.get(v.youtube_id) || [],
        }))
      } else {
        videosWithPlaylists = videos.map(v => ({ ...v, playlists: [] }))
      }
    } else {
      videosWithPlaylists = []
    }

    return NextResponse.json({
      videos: videosWithPlaylists,
      total: count || 0,
      page,
      limit,
    })
  } catch (error: any) {
    console.error('Videos API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
