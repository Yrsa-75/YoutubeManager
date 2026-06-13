import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { GATE_COOKIE, verifyGateToken, type GateUser } from '@/lib/gate/jwt'

// Identifiant interne de l'espace partagé SPICA.
// Toutes les données des 3 chaînes (SPICA LIFE, Family, Découverte & Evasion)
// sont rattachées à cet identifiant. Quiconque passe le rideau opère dessus.
export const WORKSPACE_USER_ID = '105821724098854691164'

// Lit le compte connecté via le rideau (cookie email/mot de passe), ou null
export async function getGateUser(): Promise<GateUser | null> {
  const token = cookies().get(GATE_COOKIE)?.value
  if (!token) return null
  return await verifyGateToken(token)
}

// Renvoie l'identifiant à utiliser pour lire/écrire les données :
//  - si on est passé par le rideau  -> l'espace SPICA partagé
//  - sinon, repli sur une vraie session Google (cas admin qui connecte YouTube)
export async function getWorkspaceUserId(): Promise<string | null> {
  const gate = await getGateUser()
  if (gate) return WORKSPACE_USER_ID
  const session = await getServerSession(authOptions)
  return ((session as any)?.userId as string) || null
}
