import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST: créer une invitation pour qu'un propriétaire autorise l'user connecté
// Body: { channelId, channelTitle, ownerEmail, requestedRole? }
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const { channelId, channelTitle, ownerEmail, requestedRole } = await req.json()

    if (!channelId || !ownerEmail) {
      return NextResponse.json({ error: 'channelId et ownerEmail requis' }, { status: 400 })
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)
    if (!emailOk) return NextResponse.json({ error: 'Email invalide' }, { status: 400 })

    // Vérifier qu'il n'y a pas déjà une invitation pending pour cette combinaison
    const { data: existing } = await supabase
      .from('channel_invites')
      .select('id, invite_token')
      .eq('channel_id', channelId)
      .eq('invited_email', ownerEmail.toLowerCase())
      .eq('status', 'pending')
      .maybeSingle()

    if (existing) {
      return NextResponse.json({
        success: true,
        alreadyPending: true,
        inviteToken: existing.invite_token,
      })
    }

    // Vérifier que l'user n'a pas déjà accès (role=owner ou operator)
    const { data: existingAccess } = await supabase
      .from('channel_access')
      .select('role')
      .eq('channel_id', channelId)
      .eq('user_id', session.userId)
      .maybeSingle()

    if (existingAccess?.role === 'owner') {
      return NextResponse.json({ error: 'Vous êtes déjà propriétaire de cette chaîne' }, { status: 400 })
    }

    // Générer token unique
    const inviteToken = randomBytes(32).toString('base64url')

    const { data: invite, error } = await supabase
      .from('channel_invites')
      .insert({
        invite_token: inviteToken,
        channel_id: channelId,
        channel_title: channelTitle || null,
        invited_email: ownerEmail.toLowerCase(),
        invited_by_user_id: session.userId,
        invited_by_name: session.user?.name || session.user?.email || null,
        requested_role: requestedRole || 'operator',
        status: 'pending',
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({
      success: true,
      inviteToken,
      inviteUrl: `${process.env.NEXTAUTH_URL || ''}/invite/${inviteToken}`,
      invite,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// GET: lister les invitations de l'user connecté
// Query: ?type=sent (par moi) | received (emails envoyés à ma session)
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.userId) return NextResponse.json({ invites: [] })

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') || 'sent'

    let query = supabase.from('channel_invites').select('*').order('created_at', { ascending: false })

    if (type === 'sent') {
      query = query.eq('invited_by_user_id', session.userId)
    } else if (type === 'received' && session.user?.email) {
      query = query.eq('invited_email', session.user.email.toLowerCase()).eq('status', 'pending')
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ invites: data || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
