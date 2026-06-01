import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const userId = searchParams.get('state')
  const error = searchParams.get('error')

  const baseUrl = (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '')
  const dashboardUrl = new URL('/dashboard', baseUrl)

  if (error || !code || !userId) {
    dashboardUrl.searchParams.set('channel_error', error || 'missing_code')
    return NextResponse.redirect(dashboardUrl)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    // 1. Echange du code d'autorisation contre les tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${baseUrl}/api/youtube/connect-channel/callback`,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json()

    if (!tokenRes.ok) {
      console.error('Token exchange error:', tokenData)
      dashboardUrl.searchParams.set('channel_error', 'token_exchange_failed')
      return NextResponse.redirect(dashboardUrl)
    }

    const accessToken: string = tokenData.access_token
    const refreshToken: string | undefined = tokenData.refresh_token
    const scopes: string | undefined = tokenData.scope
    const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600)

    // 2. Identifier la chaine autorisee. mine=true reflete le compte / la chaine de marque
    //    choisi pendant le flow OAuth (grace a prompt=select_account).
    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const channelData = await channelRes.json()

    if (!channelRes.ok || !channelData.items || channelData.items.length === 0) {
      console.error('Channel fetch error:', channelData)
      dashboardUrl.searchParams.set('channel_error', 'no_channel_found')
      return NextResponse.redirect(dashboardUrl)
    }

    const ch = channelData.items[0]
    const channelId: string = ch.id

    // 3. Metadonnees de la chaine (table channels) - une ligne par user.
    //    On conserve aussi le token ici comme fallback secondaire pour la synchro.
    const { error: upsertError } = await supabase.from('channels').upsert({
      user_id: userId,
      channel_id: channelId,
      title: ch.snippet?.title,
      thumbnail_url: ch.snippet?.thumbnails?.default?.url,
      subscriber_count: parseInt(ch.statistics?.subscriberCount || '0'),
      video_count: parseInt(ch.statistics?.videoCount || '0'),
      is_selected: true,
      owner_user_id: userId,
      analytics_available: true,
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      token_expires_at: expiresAt,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'user_id,channel_id', ignoreDuplicates: false })

    if (upsertError) {
      console.error('Channel upsert error:', upsertError)
      dashboardUrl.searchParams.set('channel_error', 'save_failed')
      return NextResponse.redirect(dashboardUrl)
    }

    // 4. *** LE FIX CLE ***
    //    Enregistrer le token DELEGUE dans channel_tokens : c'est LA table que la
    //    route de synchro (sync-all) lit en priorite pour l'Analytics. Sans cette
    //    ligne, la synchro retombait sur le token de session (mauvaise chaine -> 403).
    //    Si Google n'a exceptionnellement pas renvoye de refresh_token, on preserve
    //    celui deja stocke pour cette chaine.
    let refreshToStore: string | null = refreshToken ?? null
    if (!refreshToStore) {
      const { data: existingTok } = await supabase
        .from('channel_tokens')
        .select('refresh_token')
        .eq('channel_id', channelId)
        .maybeSingle()
      refreshToStore = existingTok?.refresh_token ?? null
    }

    const { error: tokenUpsertError } = await supabase.from('channel_tokens').upsert({
      channel_id: channelId,
      owner_user_id: userId,
      access_token: accessToken,
      refresh_token: refreshToStore,
      expires_at: expiresAt,
      scopes: scopes ?? null,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'channel_id', ignoreDuplicates: false })

    if (tokenUpsertError) {
      console.error('channel_tokens upsert error:', tokenUpsertError)
      dashboardUrl.searchParams.set('channel_error', 'token_save_failed')
      return NextResponse.redirect(dashboardUrl)
    }

    // 5. Garantir un acces 'owner' pour cet utilisateur. Sinon la synchro pourrait
    //    sauter l'Analytics (skip si viewer_limited) ou ne pas inclure la chaine.
    await supabase.from('channel_access').upsert({
      channel_id: channelId,
      user_id: userId,
      role: 'owner',
      is_selected: true,
      granted_at: new Date().toISOString(),
    }, { onConflict: 'channel_id,user_id', ignoreDuplicates: false })

    dashboardUrl.searchParams.set('channel_connected', ch.snippet?.title || channelId)
    return NextResponse.redirect(dashboardUrl)
  } catch (err: any) {
    console.error('Connect channel error:', err)
    dashboardUrl.searchParams.set('channel_error', err.message)
    return NextResponse.redirect(dashboardUrl)
  }
}
