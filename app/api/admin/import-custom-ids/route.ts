import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSuperadmin } from '@/lib/gate/session'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Pair = { youtube_id: string; custom_id: string }

// Garde-fou de taille : au-delà, l'écran (brique 3) découpera l'envoi en lots.
const MAX_PAIRS = 50000

// Import des ID Perso (custom_id) par correspondance d'ID YouTube.
// Réservé aux super-admins.
// Body attendu : { pairs: [{ youtube_id, custom_id }], dryRun?: boolean }
//   - dryRun = true (défaut prudent) : aperçu, aucune écriture, renvoie les compteurs.
//   - dryRun = false                 : applique la mise à jour (non destructif).
// Réponse : { dryRun, matched, ignored, updated }
export async function POST(req: NextRequest) {
  const admin = await getSuperadmin()
  if (!admin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const body = await req.json().catch(() => ({} as any))
  const rawPairs = Array.isArray(body?.pairs) ? body.pairs : null
  // Défaut prudent : tant qu'on ne demande pas explicitement l'écriture, on reste en aperçu.
  const dryRun = body?.dryRun !== false

  if (!rawPairs) {
    return NextResponse.json({ error: 'Champ « pairs » manquant ou invalide.' }, { status: 400 })
  }
  if (rawPairs.length === 0) {
    return NextResponse.json({ error: 'Aucune ligne à importer.' }, { status: 400 })
  }
  if (rawPairs.length > MAX_PAIRS) {
    return NextResponse.json(
      { error: `Trop de lignes (${rawPairs.length}). Maximum ${MAX_PAIRS} par envoi.` },
      { status: 413 }
    )
  }

  // Nettoyage : on ne garde que des paires exploitables (ID YouTube texte non vide).
  const pairs: Pair[] = []
  for (const p of rawPairs) {
    const yid = typeof p?.youtube_id === 'string' ? p.youtube_id.trim() : ''
    const cid = typeof p?.custom_id === 'string' ? p.custom_id.trim() : ''
    if (yid) pairs.push({ youtube_id: yid, custom_id: cid })
  }
  if (pairs.length === 0) {
    return NextResponse.json({ error: 'Aucun ID YouTube exploitable dans le fichier.' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('import_custom_ids', {
    pairs,
    do_commit: !dryRun,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // La fonction renvoie une ligne { matched, ignored, updated }.
  const row: any = Array.isArray(data) ? data[0] : data
  return NextResponse.json({
    dryRun,
    matched: Number(row?.matched ?? 0),
    ignored: Number(row?.ignored ?? 0),
    updated: Number(row?.updated ?? 0),
  })
}
