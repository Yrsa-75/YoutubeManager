import { NextResponse } from 'next/server'
import { getGateUser } from '@/lib/gate/session'

export const runtime = 'nodejs'

export async function GET() {
  const user = await getGateUser()
  if (!user) return NextResponse.json({ user: null })
  return NextResponse.json({ user: { email: user.email, role: user.role } })
}
