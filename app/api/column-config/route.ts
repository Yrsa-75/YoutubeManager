import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tableKey = searchParams.get('table') || 'uploaded'
  const { data, error } = await supabase
    .from('column_configs')
    .select('*')
    .eq('table_key', tableKey)
    .order('position')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ columns: data || [] })
}

export async function PUT(req: NextRequest) {
  const { tableKey, columns } = await req.json()
  const { error } = await supabase.from('column_configs').delete().eq('table_key', tableKey)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const toInsert = columns.map((col: any, i: number) => ({
    ...col, table_key: tableKey, position: i
  }))
  const { data, err2 } = await supabase.from('column_configs').insert(toInsert).select() as any
  if (err2) return NextResponse.json({ error: err2.message }, { status: 500 })
  return NextResponse.json({ columns: data })
}
