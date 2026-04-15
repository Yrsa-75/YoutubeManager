import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const userId = searchParams.get('state')
  const error = searchParams.get('error')

  const dashboardUrl = new URL('/dashboard', process.env.NEXTAUTH_URL || 'http://localhost:3000')

  if (error || !code || !userId) {
    dashboardUrl.searchParams.set('channel_error', error || 'missing_code')
    return NextResponse.redirect(dashboardUrl)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${process.env.NEXTAUTH_URL}/api/youtube/connect-channel/callback`,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json()

    if (!tokenRes.ok) {
      console.error('Token exchange error:', tokenData)
      dashboardUrl.searchParams.set('channel_error', 'token_exchange_failed')
      return NextResponse.redirect(dashboardUrl)
    }

    const accessToken = tokenData.access_token
    const refreshToken = tokenData.refresh_token
    const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in

    // Get the channel info for this Brand Account
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

    // Upsert channel with its own tokens
    const { error: upsertError } = await supabase.from('channels').upsert({
      user_id: userId,
      channel_id: ch.id,
      title: ch.snippet?.title,
      thumbnail_url: ch.snippet?.thumbnails?.default?.url,
      subscriber_count: parseInt(ch.statistics?.subscriberCount || '0'),
      video_count: parseInt(ch.statistics?.videoCount || '0'),
      is_selected: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: expiresAt,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'user_id,channel_id', ignoreDuplicates: false })

    if (upsertError) {
      console.error('Channel upsert error:', upsertError)
      dashboardUrl.searchParams.set('channel_error', 'save_failed')
      return NextResponse.redirect(dashboardUrl)
    }

    dashboardUrl.searchParams.set('channel_connected', ch.snippet?.title || ch.id)
    return NextResponse.redirect(dashboardUrl)
  } catch (err: any) {
    console.error('Connect channel error:', err)
    dashboardUrl.searchParams.set('channel_error', err.message)
    return NextResponse.redirect(dashboardUrl)
  }
}
