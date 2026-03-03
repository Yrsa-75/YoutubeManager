import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const { data, error } = await supabase
    .from('color_rules')
    .select('*')
    .order('priority', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data || [] })
}

export async function POST(req: NextRequest) {
  const rule = await req.json()
  const { data, error } = await supabase.from('color_rules').insert(rule).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rule: data })
}

export async function PUT(req: NextRequest) {
  const { id, ...rule } = await req.json()
  const { data, error } = await supabase.from('color_rules').update(rule).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rule: data })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  const { error } = await supabase.from('color_rules').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
