import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import { signGateToken, GATE_COOKIE, GATE_MAX_AGE, type GateRole } from '@/lib/gate/jwt'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!email || !password) {
      return NextResponse.json({ error: 'Email et mot de passe requis.' }, { status: 400 })
    }

    const { data: user } = await supabase
      .from('app_users')
      .select('id, email, password_hash, role, is_active')
      .eq('email', email)
      .maybeSingle()

    const ok = !!user && user.is_active === true && bcrypt.compareSync(password, user.password_hash)
    if (!ok || !user) {
      // Message volontairement générique (on ne révèle pas quel champ est faux)
      return NextResponse.json({ error: 'Identifiants invalides.' }, { status: 401 })
    }

    const role: GateRole = user.role === 'superadmin' ? 'superadmin' : 'user'
    const token = await signGateToken({ uid: user.id, email: user.email, role })

    await supabase
      .from('app_users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id)

    const res = NextResponse.json({ ok: true, role })
    res.cookies.set(GATE_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: GATE_MAX_AGE,
    })
    return res
  } catch {
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
