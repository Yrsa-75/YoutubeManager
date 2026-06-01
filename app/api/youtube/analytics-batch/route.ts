import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ---------------------------------------------------------------------------
// SYNCHRO ANALYTICS PAR LOTS (reprenable, auto-reparatrice)
// ---------------------------------------------------------------------------
// Pourquoi : le rapport groupe dimensions=video de l'API YouTube plafonne le
// nombre de videos renvoyees (~155 videos ACTIVES par requete). Pour une grosse
// chaine (Family : des milliers de videos actives chaque mois) on ne peut donc
// PAS tout couvrir avec une requete groupee, meme en decoupant par periode.
//
// La seule methode exhaustive est "une requete par video" (filters=video==ID).
// 2500 requetes ne tiennent pas dans une seule invocation (timeout Vercel 5 min
// + quota YouTube par tranche de 100 s). On traite donc un LOT borne a chaque
// appel, en commencant par les videos les moins a jour, et un cron rappelle cet
// endpoint regulierement jusqu'a couverture complete, puis pour rafraichir.
//
// Robustesse : on ne met a jour analytics_synced_at que pour les videos REUSSIES.
// Si le quota coupe en cours de route, les videos non traitees gardent leur
// ancienne date -> elles repassent en priorite au tour suivant. Le systeme
// converge tout seul, quel que soit le quota disponible.
// ---------------------------------------------------------------------------

// Reglages (surchargeables via variables d'environnement, sans redeploiement)
const BATCH = parseInt(process.env.ANALYTICS_BATCH_SIZE || '200')      // videos max par appel
const CONCURRENCY = parseInt(process.env.ANALYTICS_CONCURRENCY || '8') // requetes en parallele
const DELAY_MS = parseInt(process.env.ANALYTICS_DELAY_MS || '800')     // pause entre paquets (anti-quota)
const STALE_HOURS = parseInt(process.env.ANALYTICS_STALE_HOURS || '12')// au-dela, une video est "a rafraichir"

type VideoAnalytics = {
  views: number; minutesWatched: number; avgDuration: number; avgPercentage: number
  subsGained: number; subsLost: number; shares: number; revenue: number | null
}
type AnalyticsResult = { videoId: string; ok: boolean; status?: number; error?: string; data?: VideoAnalytics }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// --- Analytics d'UNE video (filters=video==ID) -----------------------------
async function fetchVideoAnalytics(
  token: string, idsParam: string, videoId: string,
  startDate: string, endDate: string, tryRevenue: boolean
): Promise<AnalyticsResult> {
  const withRev = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares,estimatedRevenue'
  const noRev = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares'

  async function attempt(metrics: string) {
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
    url.searchParams.set('ids', idsParam)
    url.searchParams.set('startDate', startDate)
    url.searchParams.set('endDate', endDate)
    url.searchParams.set('metrics', metrics)
    url.searchParams.set('filters', `video==${videoId}`)
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    const d = await r.json()
    if (!r.ok) return { ok: false as const, status: r.status, errorMsg: d.error?.message || `HTTP ${r.status}` }
    return { ok: true as const, row: d.rows?.[0] as any[] | undefined }
  }

  try {
    let res = await attempt(tryRevenue ? withRev : noRev)
    if (!res.ok && tryRevenue && (res.errorMsg?.toLowerCase().includes('monetary') || res.errorMsg?.toLowerCase().includes('revenue'))) {
      res = await attempt(noRev)
      tryRevenue = false
    }
    if (!res.ok) return { videoId, ok: false, status: res.status, error: res.errorMsg }
    const row = res.row || [0, 0, 0, 0, 0, 0, 0, ...(tryRevenue ? [0] : [])]
    return {
      videoId, ok: true,
      data: {
        views: row[0] || 0, minutesWatched: row[1] || 0, avgDuration: row[2] || 0,
        avgPercentage: row[3] || 0, subsGained: row[4] || 0, subsLost: row[5] || 0,
        shares: row[6] || 0, revenue: tryRevenue ? (row[7] || 0) : null,
      },
    }
  } catch (e: any) {
    return { videoId, ok: false, error: e.message }
  }
}

// --- Traitement d'un lot : paquets paralleles + temporisation ---------------
async function fetchBatchThrottled(
  token: string, idsParam: string, videoIds: string[],
  startDate: string, endDate: string, initialTryRevenue: boolean
): Promise<{ results: AnalyticsResult[]; revenueAvailable: boolean }> {
  const results: AnalyticsResult[] = []
  let tryRevenue = initialTryRevenue
  for (let i = 0; i < videoIds.length; i += CONCURRENCY) {
    const chunk = videoIds.slice(i, i + CONCURRENCY)
    const r = await Promise.all(chunk.map((v) => fetchVideoAnalytics(token, idsParam, v, startDate, endDate, tryRevenue)))
    results.push(...r)
    // Detecte une fois si le scope monetaire est refuse -> on arrete d'essayer les revenus
    if (i === 0 && tryRevenue) {
      const revErr = r.some((x) => !x.ok && x.error && (x.error.toLowerCase().includes('monetary') || x.error.toLowerCase().includes('revenue')))
      if (revErr) tryRevenue = false
    }
    if (i + CONCURRENCY < videoIds.length && DELAY_MS > 0) await sleep(DELAY_MS)
  }
  return { results, revenueAvailable: tryRevenue }
}

// --- Jeton delegue valide pour une chaine (rafraichi si besoin) -------------
async function getDelegatedToken(ct: any, supabase: any): Promise<string | null> {
  const nowSec = Math.floor(Date.now() / 1000)
  if (ct.access_token && ct.expires_at && ct.expires_at - nowSec > 300) return ct.access_token
  if (!ct.refresh_token) return ct.access_token || null
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: ct.refresh_token,
      }),
    })
    const data = await res.json()
    if (res.ok && data.access_token) {
      await supabase.from('channel_tokens').update({
        access_token: data.access_token,
        expires_at: nowSec + (data.expires_in || 3600),
        last_refreshed_at: new Date().toISOString(),
      }).eq('channel_id', ct.channel_id)
      return data.access_token
    }
    return ct.access_token || null
  } catch {
    return ct.access_token || null
  }
}

async function run() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const today = new Date().toISOString().split('T')[0]
  const staleISO = new Date(Date.now() - STALE_HOURS * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z')

  const summary: any = { ok: true, batch: BATCH, processed: 0, channels: [] as any[] }
  let budget = BATCH

  // Chaines pour lesquelles on a un jeton delegue (proprietaire) -> analytics possibles
  const { data: tokens } = await supabase.from('channel_tokens')
    .select('channel_id, access_token, refresh_token, expires_at, owner_user_id')

  if (!tokens || tokens.length === 0) {
    summary.note = 'Aucune chaine avec jeton delegue (channel_tokens vide).'
    return summary
  }

  for (const ct of tokens) {
    if (budget <= 0) break
    const chId = ct.channel_id

    // Videos a (re)synchroniser : jamais faites, ou plus vieilles que le seuil.
    // On lit user_id pour le PRESERVER lors de l'upsert (mise a jour sans session).
    const { data: candidates } = await supabase.from('videos')
      .select('youtube_id, user_id')
      .eq('channel_id', chId)
      .gt('view_count', 0)
      .or(`analytics_synced_at.is.null,analytics_synced_at.lt.${staleISO}`)
      .order('analytics_synced_at', { ascending: true, nullsFirst: true })
      .limit(budget)

    if (!candidates || candidates.length === 0) {
      summary.channels.push({ channel_id: chId, a_jour: true })
      continue
    }

    const token = await getDelegatedToken(ct, supabase)
    if (!token) {
      summary.channels.push({ channel_id: chId, erreur: 'jeton indisponible' })
      continue
    }

    // Date de debut = plus ancienne video de la chaine (couvre la vie de chaque video)
    const { data: oldest } = await supabase.from('videos')
      .select('published_at').eq('channel_id', chId)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: true }).limit(1).maybeSingle()
    const startDate = oldest?.published_at ? new Date(oldest.published_at).toISOString().split('T')[0] : '2005-01-01'

    const userByVideo = new Map<string, string>()
    for (const c of candidates) if (c.user_id) userByVideo.set(c.youtube_id, c.user_id)
    const ids = candidates.map((c: any) => c.youtube_id)

    const { results, revenueAvailable } = await fetchBatchThrottled(token, 'channel==MINE', ids, startDate, today, true)
    const okResults = results.filter((r) => r.ok && r.data)
    const failed = results.filter((r) => !r.ok)

    if (okResults.length > 0) {
      const nowISO = new Date().toISOString()
      const updates = okResults.map((r) => {
        const base: any = {
          channel_id: chId,
          youtube_id: r.videoId,
          user_id: userByVideo.get(r.videoId) || ct.owner_user_id,
          estimated_minutes_watched: r.data!.minutesWatched,
          average_view_duration: r.data!.avgDuration,
          average_view_percentage: r.data!.avgPercentage,
          subscribers_gained: r.data!.subsGained,
          subscribers_lost: r.data!.subsLost,
          shares: r.data!.shares,
          analytics_synced_at: nowISO,
        }
        if (r.data!.revenue !== null) base.estimated_revenue = r.data!.revenue
        return base
      })
      for (let i = 0; i < updates.length; i += 500) {
        const { error } = await supabase.from('videos')
          .upsert(updates.slice(i, i + 500), { onConflict: 'channel_id,youtube_id', ignoreDuplicates: false })
        if (error) {
          summary.channels.push({ channel_id: chId, erreur_upsert: error.message })
          break
        }
      }
    }

    budget -= candidates.length
    summary.processed += okResults.length
    summary.channels.push({
      channel_id: chId,
      tentees: ids.length,
      reussies: okResults.length,
      echecs: failed.length,
      revenus: revenueAvailable,
      premier_echec: failed[0]?.error || null,
    })
  }

  return summary
}

// Le cron Vercel appelle l'endpoint en GET. On autorise aussi un user connecte
// (pour declencher manuellement depuis l'UI) OU le secret de cron.
async function authorize(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true
  const session = await getServerSession(authOptions)
  return !!session?.userId
}

export async function GET(request: Request) {
  if (!(await authorize(request))) return new NextResponse('Unauthorized', { status: 401 })
  try {
    const summary = await run()
    return NextResponse.json(summary)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
