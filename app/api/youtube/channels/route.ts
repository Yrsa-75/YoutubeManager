import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET: list user's channels
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.userId) return NextResponse.json({ channels: [] })

  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .eq('user_id', session.userId)
    .order('title')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ channels: data || [] })
}

// POST: sync channels from YouTube API (mine + managedByMe)
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken || !session?.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const token = session.accessToken
  const userId = session.userId

  try {
    const allChannels: any[] = []

    // Fetch user's own channel
    const mineRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const mineData = await mineRes.json()
    if (mineRes.ok && mineData.items) {
      allChannels.push(...mineData.items)
    }

    // Fetch managed channels (Brand Accounts)
    const managedRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&managedByMe=true&maxResults=50',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const managedData = await managedRes.json()
    if (managedRes.ok && managedData.items) {
      // Avoid duplicates
      const existingIds = new Set(allChannels.map((c: any) => c.id))
      for (const ch of managedData.items) {
        if (!existingIds.has(ch.id)) allChannels.push(ch)
      }
    }

    if (allChannels.length === 0) {
      return NextResponse.json({ channels: [], message: 'Aucune chaîne trouvée' })
    }

    // Get existing channel selections to preserve them
    const { data: existing } = await supabase
      .from('channels')
      .select('channel_id, is_selected')
      .eq('user_id', userId)
    const selectionMap = new Map((existing || []).map(c => [c.channel_id, c.is_selected]))

    // Upsert channels
    const channelsToInsert = allChannels.map((ch: any) => ({
      user_id: userId,
      channel_id: ch.id,
      title: ch.snippet?.title,
      thumbnail_url: ch.snippet?.thumbnails?.default?.url,
      subscriber_count: parseInt(ch.statistics?.subscriberCount || '0'),
      video_count: parseInt(ch.statistics?.videoCount || '0'),
      is_selected: selectionMap.has(ch.id) ? selectionMap.get(ch.id) : true,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await supabase
      .from('channels')
      .upsert(channelsToInsert, { onConflict: 'user_id,channel_id', ignoreDuplicates: false })

    if (error) throw error

    // Return updated list
    const { data: updated } = await supabase
      .from('channels')
      .select('*')
      .eq('user_id', userId)
      .order('title')

    return NextResponse.json({ channels: updated || [], synced: channelsToInsert.length })
  } catch (error: any) {
    console.error('Channel sync error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PUT: toggle channel selection
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { channelId, isSelected } = await req.json()
  const { error } = await supabase
    .from('channels')
    .update({ is_selected: isSelected })
    .eq('user_id', session.userId)
    .eq('channel_id', channelId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
