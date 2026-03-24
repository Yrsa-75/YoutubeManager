import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

export async function POST() {
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

    // Step 1: Get all playlists for the channel
    let allPlaylists: any[] = []
    let pageToken: string | undefined

    do {
      const url = new URL('https://www.googleapis.com/youtube/v3/playlists')
      url.searchParams.set('part', 'snippet,contentDetails')
      url.searchParams.set('mine', 'true')
      url.searchParams.set('maxResults', '50')
      if (pageToken) url.searchParams.set('pageToken', pageToken)

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'Failed to get playlists')

      allPlaylists.push(...(data.items || []))
      pageToken = data.nextPageToken
    } while (pageToken)

    // Step 2: Upsert playlists to Supabase
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
      const { error } = await supabase
        .from('playlists')
        .upsert(playlistsToInsert, { onConflict: 'playlist_id' })
      if (error) throw error
    }

    // Step 3: For each playlist, get associated videos
    let totalAssociations = 0

    // Clear old associations to rebuild cleanly
    await supabase.from('video_playlists').delete().neq('youtube_id', '')

    for (const playlist of allPlaylists) {
      let playlistPageToken: string | undefined
      let position = 0

      do {
        const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
        url.searchParams.set('part', 'snippet')
        url.searchParams.set('playlistId', playlist.id)
        url.searchParams.set('maxResults', '50')
        if (playlistPageToken) url.searchParams.set('pageToken', playlistPageToken)

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        if (!res.ok) {
          console.error(`Error fetching playlist ${playlist.id}:`, data)
          break
        }

        const associations = (data.items || [])
          .map((item: any) => ({
            youtube_id: item.snippet?.resourceId?.videoId,
            playlist_id: playlist.id,
            position: position++,
          }))
          .filter((a: any) => a.youtube_id)

        if (associations.length > 0) {
          const { error } = await supabase
            .from('video_playlists')
            .upsert(associations, {
              onConflict: 'youtube_id,playlist_id',
            })
          if (error) {
            console.error('Association upsert error:', error)
          } else {
            totalAssociations += associations.length
          }
        }

        playlistPageToken = data.nextPageToken
      } while (playlistPageToken)
    }

    return NextResponse.json({
      success: true,
      playlists: playlistsToInsert.length,
      associations: totalAssociations,
      message: `${playlistsToInsert.length} playlists synchronis\u00e9es (${totalAssociations} associations vid\u00e9o-playlist)`,
    })
  } catch (error: any) {
    console.error('Playlists sync error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
