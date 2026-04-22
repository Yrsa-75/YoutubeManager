import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function DELETE(req: NextRequest, { params }: { params: { inviteId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const { data: invite } = await supabase
      .from('channel_invites')
      .select('id, invited_by_user_id, status')
      .eq('id', params.inviteId)
      .maybeSingle()

    if (!invite) return NextResponse.json({ error: 'Invitation introuvable' }, { status: 404 })
    if (invite.invited_by_user_id !== session.userId) {
      return NextResponse.json({ error: 'Vous ne pouvez révoquer que vos propres invitations' }, { status: 403 })
    }
    if (invite.status !== 'pending') {
      return NextResponse.json({ error: 'Invitation déjà traitée' }, { status: 400 })
    }

    await supabase.from('channel_invites').update({
      status: 'revoked',
      responded_at: new Date().toISOString(),
    }).eq('id', invite.id)

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
