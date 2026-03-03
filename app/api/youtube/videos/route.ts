import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const sortBy = searchParams.get('sortBy') || 'published_at'
    const sortDir = searchParams.get('sortDir') || 'desc'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    let query = supabase
      .from('videos')
      .select('*', { count: 'exact' })

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,youtube_id.ilike.%${search}%`)
    }
    if (status) query = query.eq('status', status)

    query = query
      .order(sortBy, { ascending: sortDir === 'asc' })
      .range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({ videos: data || [], total: count || 0, page, limit })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
