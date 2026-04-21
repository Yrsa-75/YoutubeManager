import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { createClient } from '@supabase/supabase-js'

async function refreshAccessToken(token: any) {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      }),
    })
    const data = await response.json()
    if (!response.ok) throw data
    const refreshed = {
      ...token,
      accessToken: data.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      refreshToken: data.refresh_token ?? token.refreshToken,
    }
    // Update token in Supabase
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      await supabase.from('oauth_tokens').upsert({
        user_id: token.sub,
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken,
        expires_at: refreshed.expiresAt,
        updated_at: new Date().toISOString(),
      })
    } catch (e) {
      console.error('Failed to update refreshed token:', e)
    }
    return refreshed
  } catch (error) {
    console.error('Token refresh failed:', error)
    return { ...token, error: 'RefreshAccessTokenError' }
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/youtube.readonly',
            'https://www.googleapis.com/auth/yt-analytics.readonly',
            'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
          ].join(' '),
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.expiresAt = account.expires_at
        // Store token in Supabase
        try {
          const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          )
          await supabase.from('oauth_tokens').upsert({
            user_id: token.sub,
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            expires_at: account.expires_at,
            updated_at: new Date().toISOString(),
          })
        } catch (e) {
          console.error('Failed to store token:', e)
        }
        return token
      }
      // Token refresh: if expires in less than 5 minutes, refresh it
      if (token.expiresAt && (token.expiresAt as number) - Math.floor(Date.now() / 1000) < 300) {
        return refreshAccessToken(token)
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string
      session.userId = token.sub as string
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
}
