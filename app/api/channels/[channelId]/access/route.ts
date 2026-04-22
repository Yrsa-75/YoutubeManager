import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET: lister qui a accès à cette chaîne (owner seulement peut voir)
export async function GET(req: NextRequest, { params }: { params: { channelId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const channelId = params.channelId

    // Vérifier que l'user est owner de cette chaîne
    const { data: myAccess } = await supabase
      .from('channel_access')
      .select('role')
      .eq('channel_id', channelId)
      .eq('user_id', session.userId)
      .maybeSingle()

    if (!myAccess || myAccess.role !== 'owner') {
      return NextResponse.json({ error: 'Seul le propriétaire peut voir les accès' }, { status: 403 })
    }

    const { data: accesses, error } = await supabase
      .from('channel_access')
      .select('user_id, role, is_selected, granted_at, granted_by')
      .eq('channel_id', channelId)
      .order('role', { ascending: true })

    if (error) throw error

    // Aussi lister les invitations pending
    const { data: invites } = await supabase
      .from('channel_invites')
      .select('id, invited_email, invited_by_user_id, invited_by_name, requested_role, created_at, expires_at')
      .eq('channel_id', channelId)
      .eq('status', 'pending')

    return NextResponse.json({ accesses: accesses || [], pendingInvites: invites || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE: révoquer un accès (owner seulement, ne peut pas se retirer soi-même)
export async function DELETE(req: NextRequest, { params }: { params: { channelId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const targetUserId = searchParams.get('userId')
    if (!targetUserId) return NextResponse.json({ error: 'userId requis' }, { status: 400 })

    const channelId = params.channelId

    // Vérifier que l'user est owner
    const { data: myAccess } = await supabase
      .from('channel_access')
      .select('role')
      .eq('channel_id', channelId)
      .eq('user_id', session.userId)
      .maybeSingle()

    if (!myAccess || myAccess.role !== 'owner') {
      return NextResponse.json({ error: 'Seul le propriétaire peut révoquer un accès' }, { status: 403 })
    }

    if (targetUserId === session.userId) {
      return NextResponse.json({ error: 'Vous ne pouvez pas révoquer votre propre accès propriétaire' }, { status: 400 })
    }

    const { error } = await supabase
      .from('channel_access')
      .delete()
      .eq('channel_id', channelId)
      .eq('user_id', targetUserId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
