import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import { getSuperadmin } from '@/lib/gate/session'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getSuperadmin()
  if (!admin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const id = params.id

  // Compte propriétaire protégé : seul lui-même peut être modifié, jamais par un autre admin
  const { data: target } = await supabase
    .from('app_users')
    .select('id, is_protected')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })
  if (target.is_protected && admin.uid !== target.id) {
    return NextResponse.json({ error: 'Ce compte est protégé : il ne peut pas être modifié par un autre administrateur.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({} as any))
  const updates: any = { updated_at: new Date().toISOString() }

  // Réinitialisation du mot de passe
  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 6) {
      return NextResponse.json({ error: 'Mot de passe trop court (6 caractères minimum).' }, { status: 400 })
    }
    updates.password_hash = bcrypt.hashSync(body.password, 12)
  }

  // Activation / désactivation
  if (typeof body.is_active === 'boolean') {
    if (id === admin.uid && body.is_active === false) {
      return NextResponse.json({ error: 'Vous ne pouvez pas désactiver votre propre compte.' }, { status: 400 })
    }
    updates.is_active = body.is_active
  }

  // Changement de rôle
  if (body.role === 'user' || body.role === 'superadmin') {
    if (id === admin.uid && body.role !== 'superadmin') {
      return NextResponse.json({ error: 'Vous ne pouvez pas retirer votre propre rôle super-admin.' }, { status: 400 })
    }
    updates.role = body.role
  }

  const { data, error } = await supabase
    .from('app_users')
    .update(updates)
    .eq('id', id)
    .select('id, email, role, is_active, last_login_at, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ user: data })
}
