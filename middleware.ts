import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { GATE_COOKIE, verifyGateToken } from '@/lib/gate/jwt'

// Chemins accessibles SANS passer le rideau :
//  - la page de login et ses routes
//  - NextAuth (connexion Google, réservée aux admins une fois entrés)
//  - les crons (protégés par CRON_SECRET, appelés par Vercel sans cookie)
const PUBLIC_PREFIXES = [
  '/login',
  '/api/gate/login',
  '/api/gate/logout',
  '/api/auth',
  '/api/youtube/analytics-batch',
  '/api/youtube/classify-shorts',
  '/api/youtube/sync-cron',
]

function isPublic(pathname: string): boolean {
  for (let i = 0; i < PUBLIC_PREFIXES.length; i++) {
    const p = PUBLIC_PREFIXES[i]
    if (pathname === p || pathname.startsWith(p + '/')) return true
  }
  return false
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (isPublic(pathname)) return NextResponse.next()

  const token = req.cookies.get(GATE_COOKIE)?.value
  const user = token ? await verifyGateToken(token) : null
  if (user) return NextResponse.next()

  // Appels API non authentifiés -> 401 propre
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  // Pages -> redirection vers le rideau, en mémorisant la destination
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = pathname && pathname !== '/' ? '?next=' + encodeURIComponent(pathname) : ''
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|kairos-logo.png|.*\\.(?:png|jpg|jpeg|svg|gif|ico|webp|css|js|map|woff|woff2|ttf)).*)',
  ],
}
