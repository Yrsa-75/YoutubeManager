import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// DELETE /api/youtube/channels/[channelId]
// Retire mon accès à la chaîne. Si je suis le dernier user à y avoir accès,
// nettoie en cascade toutes les données associées (videos, playlists, tokens, etc.).
// Si d'autres users ont encore accès, leurs données restent intactes.
//
// IMPORTANT : on NE révoque PAS le refresh_token côté Google.
// Raison : Google partage souvent le même refresh_token entre le flow NextAuth
// (session de l'app) et le flow connect-channel. Si on appelle
// oauth2.googleapis.com/revoke, on tue aussi la session NextAuth de l'utilisateur,
// qui se retrouve déconnecté avec une erreur "invalid credentials".
// Vider les tokens en base suffit : KAIROS ne peut plus les utiliser.
// L'utilisateur peut révoquer manuellement sur https://myaccount.google.com/permissions
// s'il veut couper l'autorisation côté Google.
export async function DELETE(req: NextRequest, { params }: { params: { channelId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const userId = session.userId
    const channelId = params.channelId

    // 1. Vérifier que l'user a accès à cette chaîne
    const { data: myAccess } = await supabase
      .from('channel_access')
      .select('role')
      .eq('user_id', userId)
      .eq('channel_id', channelId)
      .maybeSingle()

    if (!myAccess) {
      return NextResponse.json({ error: 'Aucun accès à cette chaîne' }, { status: 403 })
    }

    // 2. Tracker chaque opération de cleanup pour debug si quelque chose foire
    const cleanupResults: Record<string, { ok: boolean; error?: string }> = {}

    async function safeDelete(label: string, fn: () => Promise<{ error: any }>) {
      try {
        const { error } = await fn()
        cleanupResults[label] = { ok: !error, error: error?.message }
      } catch (e: any) {
        cleanupResults[label] = { ok: false, error: e.message }
      }
    }

    // 3. Toujours fait : retirer MON accès et MA ligne dans channels (avec mes tokens)
    await safeDelete('channel_access (mine)', () => supabase
      .from('channel_access')
      .delete()
      .eq('user_id', userId)
      .eq('channel_id', channelId))

    await safeDelete('channels (mine)', () => supabase
      .from('channels')
      .delete()
      .eq('user_id', userId)
      .eq('channel_id', channelId))

    // 4. Vérifier s'il reste d'autres users avec accès à cette chaîne
    const { count: remainingCount } = await supabase
      .from('channel_access')
      .select('*', { count: 'exact', head: true })
      .eq('channel_id', channelId)

    const hasOtherUsers = (remainingCount || 0) > 0

    // 5. Si je suis le dernier, on nettoie tout en cascade
    if (!hasOtherUsers) {
      await safeDelete('videos', () => supabase
        .from('videos')
        .delete()
        .eq('channel_id', channelId))

      await safeDelete('playlists', () => supabase
        .from('playlists')
        .delete()
        .eq('channel_id', channelId))

      await safeDelete('video_playlists', () => supabase
        .from('video_playlists')
        .delete()
        .eq('channel_id', channelId))

      await safeDelete('channel_invites', () => supabase
        .from('channel_invites')
        .delete()
        .eq('channel_id', channelId))

      await safeDelete('channel_tokens', () => supabase
        .from('channel_tokens')
        .delete()
        .eq('channel_id', channelId))

      // Cleanup résiduel sur channels (au cas où des entrées orphelines subsistent)
      await safeDelete('channels (residual)', () => supabase
        .from('channels')
        .delete()
        .eq('channel_id', channelId))
    }

    return NextResponse.json({
      success: true,
      message: hasOtherUsers
        ? `Votre accès a été retiré. ${remainingCount} autre(s) utilisateur(s) conservent leur accès et les données.`
        : 'Chaîne et toutes ses données supprimées définitivement.',
      hasOtherUsers,
      remainingUserCount: remainingCount || 0,
      cleanup: cleanupResults,
    })
  } catch (error: any) {
    console.error('[delete-channel] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
