import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/gate/session'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Date de derniere synchro des metadonnees (la plus recente parmi les chaines
// du workspace). Alimente l'indicateur de fraicheur de la barre laterale.
export async function GET() {
  const userId = await getWorkspaceUserId()
  if (!userId) return NextResponse.json({ last_synced_at: null })

  const { data, error } = await supabase
    .from('channels')
    .select('synced_at')
    .eq('user_id', userId)
    .not('synced_at', 'is', null)
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ last_synced_at: null })
  return NextResponse.json({ last_synced_at: data?.synced_at || null })
}
