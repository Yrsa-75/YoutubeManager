import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'
import { getGateUser } from '@/lib/gate/session'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ---------------------------------------------------------------------------
// CLASSIFICATION SHORTS / VIDEOS CLASSIQUES (reprenable, auto-reparatrice)
// ---------------------------------------------------------------------------
// L'API YouTube ne fournit AUCUN champ "isShort". Strategie en 2 temps :
//
//  1. Pre-classification SQL par la duree (zero requete reseau) :
//     un Short dure au max 3 min (60 s avant le 15/10/2024). Tout ce qui
//     depasse est marque is_short = FALSE immediatement.
//
//  2. Verification URL pour le reste : https://www.youtube.com/shorts/{id}
//     repond 200 si la video est un Short, et redirige (303) vers /watch
//     sinon. C'est la seule methode fiable (une video courte ET horizontale
//     n'est PAS un Short). Fonctionne pour les videos publiques et non
//     repertoriees, sans authentification.
//
// Les videos PRIVEES ne peuvent pas etre verifiees par URL : elles restent
// is_short = NULL et seront classees automatiquement a leur publication.
// Comme pour analytics-batch : on traite un lot borne par appel, le cron
// rappelle l'endpoint jusqu'a couverture complete.
// ---------------------------------------------------------------------------

const BATCH = parseInt(process.env.SHORTS_BATCH_SIZE || '300')        // verifs URL max par appel
const CONCURRENCY = parseInt(process.env.SHORTS_CONCURRENCY || '10')  // requetes en parallele
const DELAY_MS = parseInt(process.env.SHORTS_DELAY_MS || '300')       // pause entre paquets

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Verifie via l'URL /shorts/ si une video est un Short.
// Renvoie true / false, ou null si indeterminable (erreur reseau, 404, 429...)
// `samples` (optionnel) recoit une description des reponses indecises, pour le
// diagnostic dans les logs (ex : YouTube renvoie 429 ou une page de consentement).
async function checkIsShort(videoId: string, samples?: string[]): Promise<boolean | null> {
  function note(msg: string) {
    if (samples && samples.length < 5) samples.push(`${videoId}: ${msg}`)
  }
  async function probe(method: 'HEAD' | 'GET') {
    const r = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method,
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    })
    if (r.status === 200) return true                      // page Shorts servie => Short
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location') || ''
      if (loc.includes('/watch')) return false             // redirige vers le player classique
      note(`${method} ${r.status} -> ${loc.slice(0, 80)}`)  // redirection inattendue (consent, etc.)
      return null
    }
    note(`${method} ${r.status}`)                           // 404 / 405 / 429 / autre
    return null
  }
  try {
    const head = await probe('HEAD')
    if (head !== null) return head
    return await probe('GET')                              // HEAD parfois mal géré : 2e chance en GET
  } catch (e: any) {
    note(`exception ${e?.message || e}`)
    return null
  }
}

// Renvoie le mode d'authentification reconnu, ou null si acces refuse :
//  - 'cron'       : appel Vercel avec le secret CRON_SECRET
//  - 'superadmin' : compte super-admin passe par le rideau (declenchement manuel
//                   depuis le navigateur, utile pour lire le resultat en JSON)
//  - 'google'     : session Google admin (historique)
async function authMode(request: NextRequest): Promise<'cron' | 'superadmin' | 'google' | null> {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return 'cron'
  const gate = await getGateUser()
  if (gate && gate.role === 'superadmin') return 'superadmin'
  const session = await getServerSession(authOptions)
  return session?.userId ? 'google' : null
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const mode = await authMode(request)
  if (!mode) {
    console.warn('[classify-shorts] acces refuse (ni secret cron, ni super-admin, ni session Google)')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  console.log(`[classify-shorts] demarrage (auth=${mode}, batch=${BATCH}, concurrency=${CONCURRENCY})`)

  try {
    // ETAPE 1 — Pre-classification SQL par la duree (couvre les videos
    // fraichement synchronisees sans consommer de verifs URL).
    const { data: preclassified, error: rpcError } = await supabase.rpc('preclassify_shorts')
    if (rpcError) console.error('[classify-shorts] preclassify_shorts error:', rpcError.message)
    else console.log(`[classify-shorts] preclassify_shorts: ${preclassified ?? 0} video(s) classee(s) par la duree`)

    // ETAPE 2 — Verification URL des candidates restantes.
    // Privees exclues (URL inaccessible) : elles seront classees une fois publiees.
    const { data: candidates, error } = await supabase
      .from('videos')
      .select('youtube_id')
      .is('is_short', null)
      .neq('status', 'private')
      .order('published_at', { ascending: false })
      .limit(BATCH)

    if (error) throw error

    let shorts = 0, classic = 0, undecided = 0
    const undecidedSamples: string[] = []
    const ids = (candidates || []).map(c => c.youtube_id)
    console.log(`[classify-shorts] ${ids.length} candidate(s) a verifier par URL`)

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const chunk = ids.slice(i, i + CONCURRENCY)
      const results = await Promise.all(chunk.map(async (id) => ({ id, isShort: await checkIsShort(id, undecidedSamples) })))

      const shortIds = results.filter(r => r.isShort === true).map(r => r.id)
      const classicIds = results.filter(r => r.isShort === false).map(r => r.id)
      undecided += results.filter(r => r.isShort === null).length

      if (shortIds.length > 0) {
        const { error: e1 } = await supabase.from('videos').update({ is_short: true }).in('youtube_id', shortIds)
        if (!e1) shorts += shortIds.length
      }
      if (classicIds.length > 0) {
        const { error: e2 } = await supabase.from('videos').update({ is_short: false }).in('youtube_id', classicIds)
        if (!e2) classic += classicIds.length
      }

      if (i + CONCURRENCY < ids.length && DELAY_MS > 0) await sleep(DELAY_MS)
      if (Date.now() - startedAt > (maxDuration - 20) * 1000) break // marge avant timeout
    }

    // Restant a traiter (pour le monitoring dans les logs Vercel)
    const { count: remaining } = await supabase
      .from('videos')
      .select('youtube_id', { count: 'exact', head: true })
      .is('is_short', null)
      .neq('status', 'private')

    const summary = {
      auth: mode,
      preclassified: typeof preclassified === 'number' ? preclassified : (rpcError ? null : 0),
      preclassifyError: rpcError ? rpcError.message : null,
      processed: ids.length,
      shorts,
      classic,
      undecided,
      undecidedSamples,
      remaining: remaining || 0,
      durationMs: Date.now() - startedAt,
    }
    console.log('[classify-shorts] termine', JSON.stringify(summary))
    return NextResponse.json(summary)
  } catch (e: any) {
    console.error('[classify-shorts] erreur:', e?.message || e)
    return NextResponse.json({ error: e.message, auth: mode, durationMs: Date.now() - startedAt }, { status: 500 })
  }
}
