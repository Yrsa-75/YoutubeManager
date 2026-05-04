import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/youtube/channels/[channelId]/disconnect
// Révoque l'autorisation YouTube et vide les tokens locaux pour l'user courant.
// Conserve toutes les données (videos, analytics, playlists, accès des autres users).
export async function POST(req: NextRequest, { params }: { params: { channelId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const userId = session.userId
    const channelId = params.channelId

    // 1. Vérifier que l'user a bien accès à cette chaîne
    const { data: access } = await supabase
      .from('channel_access')
      .select('role')
      .eq('user_id', userId)
      .eq('channel_id', channelId)
      .maybeSingle()

    if (!access) {
      return NextResponse.json({ error: 'Aucun accès à cette chaîne' }, { status: 403 })
    }

    // 2. Récupérer le refresh token avant de le vider, pour le révoquer côté Google
    const { data: channelRow } = await supabase
      .from('channels')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('channel_id', channelId)
      .maybeSingle()

    const tokensRevoked: string[] = []

    // 3. Révoquer le refresh token côté Google (best-effort — non bloquant)
    if (channelRow?.refresh_token) {
      try {
        const r = await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: channelRow.refresh_token }),
        })
        if (r.ok) tokensRevoked.push('channels.refresh_token')
      } catch (e) {
        console.warn('[disconnect] Google revoke failed:', e)
      }
    }

    // 4. Vider les tokens locaux dans channels (uniquement ma ligne)
    await supabase
      .from('channels')
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
      })
      .eq('user_id', userId)
      .eq('channel_id', channelId)

    // 5. Si je suis owner, vider aussi channel_tokens (la table partagée).
    //    Si je suis operator, on n'y touche pas — c'est le owner qui en est propriétaire.
    if (access.role === 'owner') {
      const { data: ownerToken } = await supabase
        .from('channel_tokens')
        .select('refresh_token')
        .eq('channel_id', channelId)
        .maybeSingle()

      if (ownerToken?.refresh_token) {
        try {
          const r = await fetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: ownerToken.refresh_token }),
          })
          if (r.ok) tokensRevoked.push('channel_tokens.refresh_token')
        } catch (e) {
          console.warn('[disconnect] Google revoke (channel_tokens) failed:', e)
        }
      }

      await supabase
        .from('channel_tokens')
        .delete()
        .eq('channel_id', channelId)
    }

    return NextResponse.json({
      success: true,
      message: 'Chaîne déconnectée. Vos données sont conservées — vous pouvez reconnecter à tout moment.',
      tokensRevoked,
    })
  } catch (error: any) {
    console.error('[disconnect] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
