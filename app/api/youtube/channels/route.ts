import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET: list all channels the current user has access to (owner or operator)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.userId) return NextResponse.json({ channels: [] })

  const userId = session.userId

  // 1. Get channel_ids the user has access to (via channel_access)
  const { data: accesses } = await supabase
    .from('channel_access')
    .select('channel_id, role, is_selected, granted_by')
    .eq('user_id', userId)

  if (!accesses || accesses.length === 0) {
    // Fallback : legacy behavior (user's own channels only)
    const { data, error } = await supabase
      .from('channels')
      .select('*')
      .eq('user_id', userId)
      .order('title')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ channels: data || [] })
  }

  // 2. Fetch the actual channel records
  const channelIds = accesses.map(a => a.channel_id)
  const { data: channels, error } = await supabase
    .from('channels')
    .select('*')
    .in('channel_id', channelIds)
    .order('title')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 3. Enrich each channel with access metadata (role, is_selected from channel_access)
  const enriched = (channels || []).map(ch => {
    const acc = accesses.find(a => a.channel_id === ch.channel_id)
    return {
      ...ch,
      is_selected: acc?.is_selected ?? ch.is_selected,
      access_role: acc?.role || 'owner',
      granted_by: acc?.granted_by || null,
    }
  })

  return NextResponse.json({ channels: enriched })
}

// POST: sync user's channels from YouTube API (mine + managedByMe)
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken || !session?.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const res = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      { headers: { Authorization: `Bearer ${session.accessToken}` } }
    )
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || 'YouTube API error')

    const items = data.items || []
    for (const ch of items) {
      // Upsert dans channels
      await supabase.from('channels').upsert({
        user_id: session.userId,
        channel_id: ch.id,
        title: ch.snippet?.title,
        thumbnail_url: ch.snippet?.thumbnails?.default?.url,
        subscriber_count: parseInt(ch.statistics?.subscriberCount || '0'),
        video_count: parseInt(ch.statistics?.videoCount || '0'),
        is_selected: true,
        owner_user_id: session.userId,
        synced_at: new Date().toISOString(),
      }, { onConflict: 'user_id,channel_id' })

      // Assurer l'entrée channel_access role=owner
      await supabase.from('channel_access').upsert({
        channel_id: ch.id,
        user_id: session.userId,
        role: 'owner',
        is_selected: true,
        granted_by: null,
      }, { onConflict: 'channel_id,user_id' })
    }

    return NextResponse.json({ channels: items, count: items.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PUT: toggle is_selected (updates channel_access AND legacy channels for transition safety)
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { channelId, isSelected } = await req.json()
  const userId = session.userId

  // Nouveau : mettre à jour channel_access
  const { error: accessError } = await supabase
    .from('channel_access')
    .update({ is_selected: isSelected })
    .eq('user_id', userId)
    .eq('channel_id', channelId)

  // Legacy : continuer à mettre à jour channels.is_selected pour compat
  const { error: legacyError } = await supabase
    .from('channels')
    .update({ is_selected: isSelected })
    .eq('user_id', userId)
    .eq('channel_id', channelId)

  if (accessError && legacyError) {
    return NextResponse.json({ error: accessError.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
