import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET: détails d'une invitation (page publique /invite/[token])
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { data: invite, error } = await supabase
      .from('channel_invites')
      .select('*')
      .eq('invite_token', params.token)
      .maybeSingle()

    if (error) throw error
    if (!invite) return NextResponse.json({ error: 'Invitation introuvable' }, { status: 404 })

    if (invite.status !== 'pending') {
      return NextResponse.json({ invite, disallowed: `Invitation ${invite.status}` })
    }

    if (new Date(invite.expires_at) < new Date()) {
      await supabase.from('channel_invites').update({ status: 'expired' }).eq('id', invite.id)
      return NextResponse.json({ invite, disallowed: 'Invitation expirée' })
    }

    return NextResponse.json({ invite })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST: accepter l'invitation (l'user connecté doit être propriétaire de la chaîne, via son access_token)
// Action: crée channel_access pour l'operator invitant, stocke le token OAuth dans channel_tokens
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.userId || !session?.accessToken) {
      return NextResponse.json({ error: 'Connectez-vous d abord' }, { status: 401 })
    }

    // Récupérer l'invitation
    const { data: invite, error: invErr } = await supabase
      .from('channel_invites')
      .select('*')
      .eq('invite_token', params.token)
      .maybeSingle()

    if (invErr) throw invErr
    if (!invite) return NextResponse.json({ error: 'Invitation introuvable' }, { status: 404 })
    if (invite.status !== 'pending') {
      return NextResponse.json({ error: `Invitation ${invite.status}` }, { status: 400 })
    }
    if (new Date(invite.expires_at) < new Date()) {
      await supabase.from('channel_invites').update({ status: 'expired' }).eq('id', invite.id)
      return NextResponse.json({ error: 'Invitation expirée' }, { status: 400 })
    }

    // Vérifier via YouTube API que le user connecté est bien propriétaire de cette chaîne
    const ytRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=id,snippet,statistics&mine=true`,
      { headers: { Authorization: `Bearer ${session.accessToken}` } }
    )
    const ytData = await ytRes.json()
    if (!ytRes.ok) {
      return NextResponse.json({ error: 'Erreur YouTube API: ' + (ytData.error?.message || 'unknown') }, { status: 500 })
    }
    const ownedChannel = ytData.items?.find((c: any) => c.id === invite.channel_id)
    if (!ownedChannel) {
      return NextResponse.json({
        error: 'Vous n êtes pas propriétaire de cette chaîne. L accès nécessite une connexion avec le compte Google propriétaire de ' + (invite.channel_title || invite.channel_id)
      }, { status: 403 })
    }

    // Persister les infos chaîne
    await supabase.from('channels').upsert({
      user_id: session.userId,
      channel_id: ownedChannel.id,
      title: ownedChannel.snippet?.title,
      thumbnail_url: ownedChannel.snippet?.thumbnails?.default?.url,
      subscriber_count: parseInt(ownedChannel.statistics?.subscriberCount || '0'),
      video_count: parseInt(ownedChannel.statistics?.videoCount || '0'),
      is_selected: true,
      owner_user_id: session.userId,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'user_id,channel_id' })

    // Stocker le token du propriétaire pour usage futur par les opérateurs
    await supabase.from('channel_tokens').upsert({
      channel_id: ownedChannel.id,
      owner_user_id: session.userId,
      access_token: session.accessToken,
      // refresh_token et expires_at seront renseignés au prochain cycle NextAuth
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'channel_id' })

    // Créer l'accès propriétaire
    await supabase.from('channel_access').upsert({
      channel_id: ownedChannel.id,
      user_id: session.userId,
      role: 'owner',
      is_selected: true,
      granted_by: null,
    }, { onConflict: 'channel_id,user_id' })

    // Créer l'accès opérateur pour celui qui a invité
    await supabase.from('channel_access').upsert({
      channel_id: ownedChannel.id,
      user_id: invite.invited_by_user_id,
      role: invite.requested_role || 'operator',
      is_selected: true,
      granted_by: session.userId,
    }, { onConflict: 'channel_id,user_id' })

    // Marquer l'invitation comme acceptée
    await supabase.from('channel_invites').update({
      status: 'accepted',
      responded_at: new Date().toISOString(),
      accepted_by_user_id: session.userId,
    }).eq('id', invite.id)

    return NextResponse.json({
      success: true,
      message: `Accès accordé : ${invite.invited_by_name || 'un opérateur'} peut désormais voir les analytics de ${invite.channel_title}.`,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE: décliner l'invitation
export async function DELETE(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { data: invite } = await supabase
      .from('channel_invites')
      .select('id, status')
      .eq('invite_token', params.token)
      .maybeSingle()

    if (!invite) return NextResponse.json({ error: 'Invitation introuvable' }, { status: 404 })
    if (invite.status !== 'pending') return NextResponse.json({ error: 'Déjà traitée' }, { status: 400 })

    await supabase.from('channel_invites').update({
      status: 'declined',
      responded_at: new Date().toISOString(),
    }).eq('id', invite.id)

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
