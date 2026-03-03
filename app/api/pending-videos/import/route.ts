import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { videos } = await req.json()
    if (!Array.isArray(videos)) {
      return NextResponse.json({ error: 'Invalid data format' }, { status: 400 })
    }

    const toInsert = videos.map((v: any) => ({
      internal_id: v.ID || v.id || null,
      title: v.Titre || v.title || '',
      description: v.Description || v.description || '',
      keywords: v['Mots clés'] || v.keywords || '',
      category: v.Catégorie || v.category || '',
      language: v.Langue || v.language || '',
      extra_data: v,
      status: 'pending',
      created_at: new Date().toISOString(),
    }))

    const { data, error } = await supabase
      .from('pending_videos')
      .upsert(toInsert, { onConflict: 'internal_id' })
      .select()

    if (error) throw error

    return NextResponse.json({ success: true, imported: data?.length || 0 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || ''

  let query = supabase.from('pending_videos').select('*', { count: 'exact' })
  if (search) query = query.or(`title.ilike.%${search}%,internal_id.ilike.%${search}%`)
  if (status) query = query.eq('status', status)
  query = query.order('created_at', { ascending: false })

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ videos: data || [], total: count || 0 })
}

export async function PATCH(req: NextRequest) {
  const { id, status } = await req.json()
  const { error } = await supabase
    .from('pending_videos')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
