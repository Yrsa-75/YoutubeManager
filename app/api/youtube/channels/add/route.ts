import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken || !session?.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'URL requise' }, { status: 400 })

  const token = session.accessToken
  const userId = session.userId

  try {
    // Extract handle or channel ID from URL
    let channelId: string | null = null
    let handle: string | null = null

    // Match @handle from URL or direct input
    const handleMatch = url.match(/@([\w.-]+)/)
    if (handleMatch) handle = handleMatch[1]

    // Match /channel/UCxxxx
    const channelMatch = url.match(/\/channel\/([\w-]+)/)
    if (channelMatch) channelId = channelMatch[1]

    // If just a handle without @
    if (!handle && !channelId && !url.includes('/')) handle = url.replace('@', '')

    if (!channelId && !handle) {
      return NextResponse.json({ error: 'URL ou handle invalide' }, { status: 400 })
    }

    // Resolve to channel info via YouTube API
    let apiUrl: string
    if (channelId) {
      apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}`
    } else {
      apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${handle}`
    }

    const res = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()

    if (!res.ok) throw new Error(data.error?.message || 'YouTube API error')
    if (!data.items || data.items.length === 0) {
      return NextResponse.json({ error: 'Cha\u00eene introuvable' }, { status: 404 })
    }

    const ch = data.items[0]
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Check if already exists
    const { data: existing } = await supabase
      .from('channels')
      .select('channel_id')
      .eq('user_id', userId)
      .eq('channel_id', ch.id)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Cette cha\u00eene est d\u00e9j\u00e0 connect\u00e9e', channel: { channel_id: ch.id, title: ch.snippet?.title } }, { status: 409 })
    }

    // Insert new channel (without its own token - will use session token for sync)
    const { error: insertError } = await supabase.from('channels').insert({
      user_id: userId,
      channel_id: ch.id,
      title: ch.snippet?.title,
      thumbnail_url: ch.snippet?.thumbnails?.default?.url,
      subscriber_count: parseInt(ch.statistics?.subscriberCount || '0'),
      video_count: parseInt(ch.statistics?.videoCount || '0'),
      is_selected: true,
      synced_at: new Date().toISOString(),
    })

    if (insertError) throw insertError

    return NextResponse.json({
      success: true,
      channel: {
        channel_id: ch.id,
        title: ch.snippet?.title,
        thumbnail_url: ch.snippet?.thumbnails?.default?.url,
        video_count: parseInt(ch.statistics?.videoCount || '0'),
      },
    })
  } catch (error: any) {
    console.error('Add channel error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
