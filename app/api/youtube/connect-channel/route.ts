import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.userId) {
    return NextResponse.redirect(new URL('/dashboard', process.env.NEXTAUTH_URL || 'http://localhost:3000'))
  }

  const baseUrl = (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '')

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${baseUrl}/api/youtube/connect-channel/callback`,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
      'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
    ].join(' '),
    access_type: 'offline',
    // 'consent'        -> Google renvoie TOUJOURS un refresh_token (sinon l'acces meurt apres 1h
    //                     sans possibilite de renouvellement automatique).
    // 'select_account' -> l'utilisateur choisit explicitement le compte / la chaine de marque
    //                     qui POSSEDE la chaine a connecter (ex: selectionner Family et non D&E).
    //                     Indispensable quand un meme compte Google pilote plusieurs chaines :
    //                     le token produit sera rattache a la chaine selectionnee.
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state: session.userId,
  })

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
}
