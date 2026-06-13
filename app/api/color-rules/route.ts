import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getWorkspaceUserId } from '@/lib/gate/session'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const userId = await getWorkspaceUserId()
  if (!userId) return NextResponse.json({ rules: [] })
  const { data, error } = await supabase
    .from('color_rules')
    .select('*')
    .eq('user_id', userId)
    .order('priority', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data || [] })
}

export async function POST(req: NextRequest) {
  const userId = await getWorkspaceUserId()
  if (!userId) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  const rule = await req.json()
  const { data, error } = await supabase.from('color_rules').insert({ ...rule, user_id: userId }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rule: data })
}

export async function PUT(req: NextRequest) {
  const userId = await getWorkspaceUserId()
  if (!userId) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  const { id, ...rule } = await req.json()
  const { data, error } = await supabase.from('color_rules').update(rule).eq('id', id).eq('user_id', userId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rule: data })
}

export async function DELETE(req: NextRequest) {
  const userId = await getWorkspaceUserId()
  if (!userId) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  const { id } = await req.json()
  const { error } = await supabase.from('color_rules').delete().eq('id', id).eq('user_id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
