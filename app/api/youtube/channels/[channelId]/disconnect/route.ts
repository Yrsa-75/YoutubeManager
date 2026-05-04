import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/youtube/channels/[channelId]/disconnect
// Vide les tokens locaux pour l'user courant.
// Conserve toutes les données (videos, analytics, playlists, accès des autres users).
//
// IMPORTANT : on NE révoque PAS le refresh_token côté Google.
// Raison : Google partage souvent le même refresh_token entre le flow NextAuth
// (session de l'app) et le flow connect-channel (token dédié à la chaîne).
// Si on appelle oauth2.googleapis.com/revoke, on tue aussi la session NextAuth
// de l'utilisateur, qui se retrouve déconnecté avec une erreur "invalid credentials".
// Vider les tokens en base suffit : KAIROS ne peut plus les utiliser.
// L'utilisateur peut révoquer manuellement sur https://myaccount.google.com/permissions
// s'il veut couper l'autorisation côté Google.
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

    // 2. Vider les tokens locaux dans channels (uniquement ma ligne)
    await supabase
      .from('channels')
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
      })
      .eq('user_id', userId)
      .eq('channel_id', channelId)

    // 3. Si je suis owner, vider aussi channel_tokens (la table partagée).
    //    Si je suis operator, on n'y touche pas — c'est le owner qui en est propriétaire.
    if (access.role === 'owner') {
      await supabase
        .from('channel_tokens')
        .delete()
        .eq('channel_id', channelId)
    }

    return NextResponse.json({
      success: true,
      message: 'Chaîne déconnectée. Vos données sont conservées — vous pouvez reconnecter à tout moment.',
    })
  } catch (error: any) {
    console.error('[disconnect] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
