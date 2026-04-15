import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.userId) return NextResponse.json({ columns: [] })

  const { searchParams } = new URL(req.url)
  const tableKey = searchParams.get('table') || 'uploaded'
  const { data, error } = await supabase
    .from('column_configs')
    .select('*')
    .eq('table_key', tableKey)
    .eq('user_id', session.userId)
    .order('position')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ columns: data || [] })
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { tableKey, columns } = await req.json()
  const { error } = await supabase.from('column_configs').delete().eq('table_key', tableKey).eq('user_id', session.userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const toInsert = columns.map((col: any, i: number) => ({
    ...col, table_key: tableKey, position: i, user_id: session.userId
  }))
  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from('column_configs').insert(toInsert)
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
