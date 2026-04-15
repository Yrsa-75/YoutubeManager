import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.userId) {
    return NextResponse.redirect(new URL('/dashboard', process.env.NEXTAUTH_URL!))
  }

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXTAUTH_URL}/api/youtube/connect-channel/callback`,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ].join(' '),
    access_type: 'offline',
    prompt: 'select_account consent',
    state: session.userId,
  })

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
}
