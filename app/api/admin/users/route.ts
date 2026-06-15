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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Liste tous les comptes (sans le hash du mot de passe)
export async function GET() {
  const admin = await getSuperadmin()
  if (!admin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const { data, error } = await supabase
    .from('app_users')
    .select('id, email, role, is_active, is_protected, last_login_at, created_at')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data || [] })
}

// Crée un nouveau compte
export async function POST(req: NextRequest) {
  const admin = await getSuperadmin()
  if (!admin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const body = await req.json().catch(() => ({} as any))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const role = body.role === 'superadmin' ? 'superadmin' : 'user'

  if (!email || !password) return NextResponse.json({ error: 'Email et mot de passe requis.' }, { status: 400 })
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Adresse email invalide.' }, { status: 400 })
  if (password.length < 6) return NextResponse.json({ error: 'Mot de passe trop court (6 caractères minimum).' }, { status: 400 })

  const { data: existing } = await supabase.from('app_users').select('id').eq('email', email).maybeSingle()
  if (existing) return NextResponse.json({ error: 'Un compte avec cet email existe déjà.' }, { status: 409 })

  const password_hash = bcrypt.hashSync(password, 12)
  const { data, error } = await supabase
    .from('app_users')
    .insert({ email, password_hash, role, created_by: admin.uid })
    .select('id, email, role, is_active, last_login_at, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ user: data })
}
