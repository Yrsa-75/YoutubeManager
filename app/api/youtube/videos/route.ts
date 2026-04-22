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
    const channelIds = searchParams.get('channelIds') || ''
    const sortBy = searchParams.get('sortBy') || 'published_at'
    const sortDir = searchParams.get('sortDir') || 'desc'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    // PHASE 2 : récupérer les channel_ids auxquels l'user a accès (via channel_access)
    const { data: accesses } = await supabase
      .from('channel_access')
      .select('channel_id, is_selected')
      .eq('user_id', userId)

    const hasAccessEntries = accesses && accesses.length > 0
    const accessibleChannelIds = hasAccessEntries ? accesses.map(a => a.channel_id) : []
    const selectedChannelIds = hasAccessEntries
      ? accesses.filter(a => a.is_selected).map(a => a.channel_id)
      : []

    let query = supabase
      .from('videos')
      .select('*', { count: 'exact' })

    // Filtre principal : si on a des entrées channel_access, on filtre par channel_id
    // Sinon fallback legacy sur user_id (pour compat pendant la transition)
    if (hasAccessEntries) {
      query = query.in('channel_id', accessibleChannelIds)
    } else {
      query = query.eq('user_id', userId)
    }

    // Filtrage optionnel par chaînes spécifiques (query param)
    if (channelIds) {
      const ids = channelIds.split(',').filter(Boolean)
      if (ids.length > 0) query = query.in('channel_id', ids)
    } else if (hasAccessEntries && selectedChannelIds.length > 0) {
      // Auto-filter sur chaînes sélectionnées dans channel_access
      query = query.in('channel_id', selectedChannelIds)
    } else if (!hasAccessEntries) {
      // Fallback legacy : anciennes chaînes is_selected=true
      const { data: selChannels } = await supabase
        .from('channels')
        .select('channel_id')
        .eq('user_id', userId)
        .eq('is_selected', true)
      if (selChannels && selChannels.length > 0) {
        query = query.in('channel_id', selChannels.map(c => c.channel_id))
      }
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,tags.cs.{${search}}`)
    }
    if (status) query = query.eq('status', status)

    query = query.order(sortBy, { ascending: sortDir === 'asc' })
    query = query.range(offset, offset + limit - 1)

    const { data: videos, error, count } = await query

    if (error) {
      console.error('Videos fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get channel info for these videos (sur toutes les chaînes accessibles)
    const channelFilter = hasAccessEntries ? accessibleChannelIds : []
    const channelsQuery = supabase.from('channels').select('channel_id, title, thumbnail_url')
    const { data: channels } = hasAccessEntries && channelFilter.length > 0
      ? await channelsQuery.in('channel_id', channelFilter)
      : await channelsQuery.eq('user_id', userId)
    const channelMap = new Map((channels || []).map(c => [c.channel_id, { title: c.title, thumbnail: c.thumbnail_url }]))

    // Fetch playlist associations
    let videosWithExtras: any[]
    if (videos && videos.length > 0) {
      const youtubeIds = videos.map(v => v.youtube_id)

      // video_playlists reste lié à user_id pour compat (associations personnelles par user)
      const { data: associations } = await supabase
        .from('video_playlists')
        .select('youtube_id, playlist_id')
        .in('youtube_id', youtubeIds)

      let videoPlaylistsMap = new Map<string, Array<{ playlist_id: string; title: string }>>()
      if (associations && associations.length > 0) {
        const playlistIds = [...new Set(associations.map(a => a.playlist_id))]
        const { data: playlists } = await supabase
          .from('playlists')
          .select('playlist_id, title')
          .in('playlist_id', playlistIds)
        const playlistMap = new Map((playlists || []).map(p => [p.playlist_id, p.title]))

        for (const a of associations) {
          if (!videoPlaylistsMap.has(a.youtube_id)) videoPlaylistsMap.set(a.youtube_id, [])
          videoPlaylistsMap.get(a.youtube_id)!.push({
            playlist_id: a.playlist_id,
            title: playlistMap.get(a.playlist_id) || 'Sans nom',
          })
        }
      }

      videosWithExtras = videos.map(v => ({
        ...v,
        channel_title: channelMap.get(v.channel_id)?.title || '',
        channel_thumbnail: channelMap.get(v.channel_id)?.thumbnail || '',
        playlists: videoPlaylistsMap.get(v.youtube_id) || [],
      }))
    } else {
      videosWithExtras = []
    }

    return NextResponse.json({
      videos: videosWithExtras,
      total: count || 0,
      page,
      limit,
    })
  } catch (error: any) {
    console.error('Videos API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
