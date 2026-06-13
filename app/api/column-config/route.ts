import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getWorkspaceUserId } from '@/lib/gate/session'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const userId = await getWorkspaceUserId()
  if (!userId) return NextResponse.json({ columns: [] })

  const { searchParams } = new URL(req.url)
  const tableKey = searchParams.get('table') || 'uploaded'
  const { data, error } = await supabase
    .from('column_configs')
    .select('*')
    .eq('table_key', tableKey)
    .eq('user_id', userId)
    .order('position')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ columns: data || [] })
}

export async function PUT(req: NextRequest) {
  const userId = await getWorkspaceUserId()
  if (!userId) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const { tableKey, columns } = await req.json()
  const { error } = await supabase.from('column_configs').delete().eq('table_key', tableKey).eq('user_id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const toInsert = columns.map((col: any, i: number) => ({
    ...col, table_key: tableKey, position: i, user_id: userId
  }))
  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from('column_configs').insert(toInsert)
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
