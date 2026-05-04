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

    // 2. Récupérer mon refresh token avant suppression, pour le révoquer côté Google
    const { data: channelRow } = await supabase
      .from('channels')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('channel_id', channelId)
      .maybeSingle()

    // 3. Révoquer le refresh token côté Google (best-effort — non bloquant)
    if (channelRow?.refresh_token) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: channelRow.refresh_token }),
        })
      } catch (e) {
        console.warn('[delete-channel] Google revoke failed:', e)
      }
    }

    // 4. Tracker chaque opération de cleanup pour debug si quelque chose foire
    const cleanupResults: Record<string, { ok: boolean; error?: string }> = {}

    async function safeDelete(label: string, fn: () => Promise<{ error: any }>) {
      try {
        const { error } = await fn()
        cleanupResults[label] = { ok: !error, error: error?.message }
      } catch (e: any) {
        cleanupResults[label] = { ok: false, error: e.message }
      }
    }

    // 5. Toujours fait : retirer MON accès et MA ligne dans channels
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

    // 6. Vérifier s'il reste d'autres users avec accès à cette chaîne
    const { count: remainingCount } = await supabase
      .from('channel_access')
      .select('*', { count: 'exact', head: true })
      .eq('channel_id', channelId)

    const hasOtherUsers = (remainingCount || 0) > 0

    // 7. Si je suis le dernier, on nettoie tout en cascade
    if (!hasOtherUsers) {
      // Révoquer aussi le token shared dans channel_tokens si présent
      const { data: ownerToken } = await supabase
        .from('channel_tokens')
        .select('refresh_token')
        .eq('channel_id', channelId)
        .maybeSingle()

      if (ownerToken?.refresh_token) {
        try {
          await fetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: ownerToken.refresh_token }),
          })
        } catch (e) {
          console.warn('[delete-channel] Google revoke (channel_tokens) failed:', e)
        }
      }

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
