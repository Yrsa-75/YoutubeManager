import { SignJWT, jwtVerify } from 'jose'

// Rôles possibles pour un compte de la plateforme
export type GateRole = 'superadmin' | 'user'
export type GateUser = { uid: string; email: string; role: GateRole }

// Nom du cookie qui porte la session "rideau" (indépendant de NextAuth/Google)
export const GATE_COOKIE = 'kairos_gate'
// Durée de validité de la session : 30 jours
export const GATE_MAX_AGE = 60 * 60 * 24 * 30

function secret(): Uint8Array {
  // On réutilise le secret NextAuth déjà présent sur Vercel (pas de nouvelle variable à créer)
  return new TextEncoder().encode(process.env.NEXTAUTH_SECRET || '')
}

// Crée un jeton signé pour un compte authentifié
export async function signGateToken(u: GateUser): Promise<string> {
  return await new SignJWT({ email: u.email, role: u.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(u.uid)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + GATE_MAX_AGE)
    .sign(secret())
}

// Vérifie un jeton ; renvoie l'utilisateur ou null si invalide/expiré
export async function verifyGateToken(token: string): Promise<GateUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    if (!payload.sub) return null
    const role: GateRole = payload.role === 'superadmin' ? 'superadmin' : 'user'
    const email = typeof payload.email === 'string' ? payload.email : ''
    return { uid: payload.sub, email, role }
  } catch {
    return null
  }
}
