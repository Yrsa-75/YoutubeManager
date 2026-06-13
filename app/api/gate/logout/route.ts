import { NextResponse } from 'next/server'
import { GATE_COOKIE } from '@/lib/gate/jwt'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(GATE_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}
