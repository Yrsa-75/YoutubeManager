import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

// POST /api/youtube/channels/add
// Ajoute une chaîne à KAIROS via son URL ou son handle.
//
// Body:
//   - url       : string (handle @xxx, URL complète, ou channel ID UCxxx)
//   - accessRole: 'owner' | 'viewer_limited'  (default: 'owner')
//                 'viewer_limited' = pour les utilisateurs qui sont Manager YouTube
//                 mais pas Owner. L'API Analytics sera skippée pour ces chaînes.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken || !session?.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { url, accessRole = 'owner' } = body
  if (!url) return NextResponse.json({ error: 'URL requise' }, { status: 400 })

  // Garde-fou : on n'accepte que ces deux rôles via cet endpoint
  if (accessRole !== 'owner' && accessRole !== 'viewer_limited') {
    return NextResponse.json({ error: 'accessRole invalide' }, { status: 400 })
  }

  const token = session.accessToken
  const userId = session.userId

  try {
    // Extract handle or channel ID from URL
    let channelId: string | null = null
    let handle: string | null = null

    const handleMatch = url.match(/@([\w.-]+)/)
    if (handleMatch) handle = handleMatch[1]

    const channelMatch = url.match(/\/channel\/([\w-]+)/)
    if (channelMatch) channelId = channelMatch[1]

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
      return NextResponse.json({ error: 'Chaîne introuvable' }, { status: 404 })
    }

    const ch = data.items[0]
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Check if already exists for this user
    const { data: existing } = await supabase
      .from('channels')
      .select('channel_id')
      .eq('user_id', userId)
      .eq('channel_id', ch.id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({
        error: 'Cette chaîne est déjà connectée',
        channel: { channel_id: ch.id, title: ch.snippet?.title },
      }, { status: 409 })
    }

    const isLimited = accessRole === 'viewer_limited'

    // Insert in channels — analytics_available reflète le mode d'ajout
    const { error: insertError } = await supabase.from('channels').insert({
      user_id: userId,
      channel_id: ch.id,
      title: ch.snippet?.title,
      thumbnail_url: ch.snippet?.thumbnails?.default?.url,
      subscriber_count: parseInt(ch.statistics?.subscriberCount || '0'),
      video_count: parseInt(ch.statistics?.videoCount || '0'),
      is_selected: true,
      synced_at: new Date().toISOString(),
      analytics_available: !isLimited,
      // owner_user_id reste NULL pour viewer_limited (l'user n'est pas le vrai propriétaire)
      owner_user_id: isLimited ? null : userId,
    })

    if (insertError) throw insertError

    // Créer l'entrée channel_access (sinon la chaîne n'apparaîtra pas via GET /api/youtube/channels)
    const { error: accessError } = await supabase.from('channel_access').upsert({
      channel_id: ch.id,
      user_id: userId,
      role: accessRole,
      is_selected: true,
      granted_by: null,
    }, { onConflict: 'channel_id,user_id' })

    if (accessError) throw accessError

    return NextResponse.json({
      success: true,
      channel: {
        channel_id: ch.id,
        title: ch.snippet?.title,
        thumbnail_url: ch.snippet?.thumbnails?.default?.url,
        video_count: parseInt(ch.statistics?.videoCount || '0'),
        analytics_available: !isLimited,
        access_role: accessRole,
      },
    })
  } catch (error: any) {
    console.error('[channels/add] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
