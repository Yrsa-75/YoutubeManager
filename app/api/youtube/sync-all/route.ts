import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

// Plan Vercel Pro : fonctions jusqu'a 300s. Une synchro complete d'une grosse
// chaine (metadonnees + playlists + analytics) depasse les 60s par defaut.
export const maxDuration = 300

async function refreshChannelToken(channel: any, supabase: any) {
  if (!channel.refresh_token) return channel.access_token
  if (channel.token_expires_at && channel.token_expires_at - Math.floor(Date.now() / 1000) > 300) {
    return channel.access_token
  }
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: channel.refresh_token,
      }),
    })
    const data = await res.json()
    if (!res.ok) return channel.access_token
    await supabase.from('channels').update({
      access_token: data.access_token,
      token_expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      refresh_token: data.refresh_token || channel.refresh_token,
    }).eq('channel_id', channel.channel_id).eq('user_id', channel.user_id)
    return data.access_token
  } catch {
    return channel.access_token
  }
}

type AnalyticsResult = {
  videoId: string
  ok: boolean
  status?: number
  data?: { views: number; minutesWatched: number; avgDuration: number; avgPercentage: number; subsGained: number; subsLost: number; shares: number; revenue: number | null }
  error?: string
}

async function fetchVideoAnalytics(
  token: string,
  channelIdsParam: string,
  videoId: string,
  startDate: string,
  endDate: string,
  tryRevenue: boolean
): Promise<AnalyticsResult> {
  const metricsWithRevenue = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares,estimatedRevenue'
  const metricsNoRevenue = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares'

  async function attempt(metrics: string): Promise<{ ok: boolean; row?: any[]; status?: number; errorMsg?: string }> {
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
    url.searchParams.set('ids', channelIdsParam)
    url.searchParams.set('startDate', startDate)
    url.searchParams.set('endDate', endDate)
    url.searchParams.set('metrics', metrics)
    url.searchParams.set('currency', 'EUR')
    url.searchParams.set('filters', `video==${videoId}`)
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    const d = await r.json()
    if (!r.ok) return { ok: false, status: r.status, errorMsg: d.error?.message || `HTTP ${r.status}` }
    return { ok: true, row: d.rows?.[0] }
  }

  try {
    const metrics = tryRevenue ? metricsWithRevenue : metricsNoRevenue
    let res = await attempt(metrics)

    if (!res.ok && tryRevenue && (res.errorMsg?.toLowerCase().includes('monetary') || res.errorMsg?.toLowerCase().includes('revenue'))) {
      res = await attempt(metricsNoRevenue)
      tryRevenue = false
    }

    if (!res.ok) {
      return { videoId, ok: false, status: res.status, error: res.errorMsg }
    }

    const row = res.row || [0, 0, 0, 0, 0, 0, 0, ...(tryRevenue ? [0] : [])]

    return {
      videoId,
      ok: true,
      data: {
        views: row[0] || 0,
        minutesWatched: row[1] || 0,
        avgDuration: row[2] || 0,
        avgPercentage: row[3] || 0,
        subsGained: row[4] || 0,
        subsLost: row[5] || 0,
        shares: row[6] || 0,
        revenue: tryRevenue ? (row[7] || 0) : null,
      },
    }
  } catch (e: any) {
    return { videoId, ok: false, error: e.message }
  }
}

async function fetchAllAnalytics(
  token: string,
  channelIdsParam: string,
  videoIds: string[],
  startDate: string,
  endDate: string,
  initialTryRevenue: boolean,
  batchSize = 20
): Promise<{ results: AnalyticsResult[]; revenueAvailable: boolean }> {
  const results: AnalyticsResult[] = []
  let tryRevenue = initialTryRevenue

  for (let i = 0; i < videoIds.length; i += batchSize) {
    const batch = videoIds.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map((vid) => fetchVideoAnalytics(token, channelIdsParam, vid, startDate, endDate, tryRevenue))
    )
    results.push(...batchResults)

    if (i === 0 && tryRevenue) {
      const anyRevenueError = batchResults.some(r => !r.ok && r.error && (r.error.toLowerCase().includes('monetary') || r.error.toLowerCase().includes('revenue')))
      if (anyRevenueError) tryRevenue = false
    }
  }

  return { results, revenueAvailable: tryRevenue }
}

// ---------------------------------------------------------------------------
// BLOC B : requete GROUPEE (dimensions=video).
// Recupere l'analytics de TOUTES les videos d'une chaine en quelques requetes
// paginees (200 videos/page) au lieu d'une requete par video. Indispensable
// pour les grosses chaines (ex: Family ~2400 videos) sinon timeout Vercel 60s.
// Ne marche que si le token est proprietaire/gestionnaire de la chaine.
// ---------------------------------------------------------------------------
async function fetchChannelAnalyticsBulk(
  token: string,
  channelIdsParam: string,
  startDate: string,
  endDate: string,
  tryRevenue: boolean,
  totalVideos: number
): Promise<{ ok: boolean; status?: number; error?: string; rowsByVideo?: Map<string, any[]>; revenueByVideo?: Map<string, number>; revenueAvailable: boolean }> {
  const coreMetrics = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares'

  async function pageReport(metrics: string, sort: string, startIndex: number, sDate: string, eDate: string) {
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
    url.searchParams.set('ids', channelIdsParam)
    url.searchParams.set('startDate', sDate)
    url.searchParams.set('endDate', eDate)
    url.searchParams.set('metrics', metrics)
    url.searchParams.set('currency', 'EUR')
    url.searchParams.set('dimensions', 'video')
    url.searchParams.set('sort', sort)
    url.searchParams.set('maxResults', '200')
    url.searchParams.set('startIndex', String(startIndex))
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    const d = await r.json()
    if (!r.ok) return { ok: false as const, status: r.status, errorMsg: d.error?.message || `HTTP ${r.status}` }
    return { ok: true as const, rows: (d.rows || []) as any[] }
  }

  // Pagine un rapport complet (toutes les pages) sur une plage de dates donnee
  async function paginate(metrics: string, sort: string, sDate: string, eDate: string) {
    const all: any[] = []
    let startIndex = 1
    while (true) {
      const res = await pageReport(metrics, sort, startIndex, sDate, eDate)
      if (!res.ok) return { ok: false as const, status: res.status, errorMsg: res.errorMsg }
      all.push(...res.rows)
      if (res.rows.length < 200) break
      startIndex += 200
      if (startIndex > 20000) break // garde-fou anti-boucle
    }
    return { ok: true as const, rows: all }
  }

  // Decoupe [startDate, endDate] en fenetres de N mois (3 = trimestres).
  // Le rapport dimensions=video plafonne le nombre de videos renvoyees par requete
  // (~155 sur Family). En interrogeant trimestre par trimestre (~50 videos chacun,
  // bien sous le plafond), on recupere TOUT le catalogue, puis on agrege.
  function buildChunks(sDate: string, eDate: string, stepMonths: number): Array<[string, string]> {
    const ymd = (d: Date) => d.toISOString().slice(0, 10)
    const chunks: Array<[string, string]> = []
    let s = new Date(sDate + 'T00:00:00Z')
    const end = new Date(eDate + 'T00:00:00Z')
    let guard = 0
    while (s <= end && guard++ < 400) {
      const next = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + stepMonths, 1))
      let e = new Date(next.getTime() - 86400000) // veille du debut de la fenetre suivante
      if (e > end) e = end
      chunks.push([ymd(s), ymd(e)])
      s = next
    }
    return chunks
  }

  // PASSE 1 - metriques de base, TRIMESTRE PAR TRIMESTRE pour contourner le plafond
  // de l'API. On additionne les metriques cumulables (vues, temps regarde, abonnes,
  // partages) et on recalcule les MOYENNES (visionnage moyen, % regarde) en moyenne
  // ponderee par les vues -> resultat identique a une requete pleine periode, mais
  // sur TOUTES les videos du catalogue.
  // Taille de tranche ADAPTATIVE : on vise ~45 videos par tranche (sous le plafond
  // ~155, avec marge). Une chaine tres active (Family ~77 videos/mois) -> tranches
  // mensuelles ; une petite chaine -> tranches plus larges (moins de requetes).
  const spanMonths = Math.max(
    1,
    (new Date(endDate + 'T00:00:00Z').getUTCFullYear() - new Date(startDate + 'T00:00:00Z').getUTCFullYear()) * 12
      + (new Date(endDate + 'T00:00:00Z').getUTCMonth() - new Date(startDate + 'T00:00:00Z').getUTCMonth()) + 1
  )
  const perMonth = totalVideos / spanMonths
  const stepMonths = perMonth <= 0 ? 12 : Math.max(1, Math.min(12, Math.floor(45 / perMonth)))
  const chunks = buildChunks(startDate, endDate, stepMonths)
  console.log('[bulk] cadence=', perMonth.toFixed(1), 'videos/mois -> tranches de', stepMonths, 'mois (', chunks.length, 'tranches)')
  type Acc = { views: number; mw: number; sg: number; sl: number; sh: number; wDur: number; wPct: number }
  const acc = new Map<string, Acc>()
  let firstFailStatus: number | undefined
  let firstFailMsg: string | undefined
  let okChunks = 0
  for (const [s, e] of chunks) {
    const res = await paginate(coreMetrics, '-estimatedMinutesWatched', s, e)
    if (!res.ok) {
      if (acc.size === 0 && firstFailStatus === undefined) { firstFailStatus = res.status; firstFailMsg = res.errorMsg }
      console.error('[bulk] trimestre', s, '->', e, 'echec:', res.status, res.errorMsg)
      continue
    }
    okChunks++
    for (const row of res.rows) {
      const vid = row[0] as string
      const views = Number(row[1]) || 0
      const a = acc.get(vid) || { views: 0, mw: 0, sg: 0, sl: 0, sh: 0, wDur: 0, wPct: 0 }
      a.views += views
      a.mw += Number(row[2]) || 0
      a.wDur += (Number(row[3]) || 0) * views   // visionnage moyen, pondere par les vues
      a.wPct += (Number(row[4]) || 0) * views   // % regarde, pondere par les vues
      a.sg += Number(row[5]) || 0
      a.sl += Number(row[6]) || 0
      a.sh += Number(row[7]) || 0
      acc.set(vid, a)
    }
  }
  // Rien recupere ET une erreur rencontree -> on la remonte (permet le fallback
  // "une requete par video" pour les petites chaines en erreur 400).
  if (acc.size === 0 && firstFailStatus !== undefined) {
    console.error('[bulk] aucune donnee, echec global:', firstFailStatus, firstFailMsg)
    return { ok: false, status: firstFailStatus, error: firstFailMsg, revenueAvailable: false }
  }
  const rowsByVideo = new Map<string, any[]>()
  for (const [vid, a] of acc) {
    const avd = a.views > 0 ? a.wDur / a.views : 0
    const avp = a.views > 0 ? a.wPct / a.views : 0
    // format de ligne conserve : [video, views, mw, avd, avp, sg, sl, shares]
    rowsByVideo.set(vid, [vid, a.views, a.mw, avd, avp, a.sg, a.sl, a.sh])
  }
  console.log('[bulk] trimestres OK=', okChunks, '/', chunks.length, ' videos couvertes=', rowsByVideo.size)

  // PASSE 2 - revenus seuls (videos monetisees uniquement). Optionnelle : si le scope
  // monetaire n'est pas autorise, on continue sans revenus (le reste est deja recupere).
  const revenueByVideo = new Map<string, number>()
  let revenueAvailable = false
  if (tryRevenue) {
    const rev = await paginate('views,estimatedRevenue', '-estimatedRevenue', startDate, endDate)
    if (rev.ok) {
      revenueAvailable = true
      for (const row of rev.rows) revenueByVideo.set(row[0], Number(row[2]) || 0) // [video, views, estimatedRevenue]
    } else {
      console.error('[bulk] revenus indisponibles (on continue sans):', rev.status, rev.errorMsg)
    }
  }

  console.log('[bulk] OK: core=', rowsByVideo.size, 'videos, revenus=', revenueByVideo.size, 'videos')
  return { ok: true, rowsByVideo, revenueByVideo, revenueAvailable }
}

// Strategie unifiee : on tente d'abord la requete groupee (rapide). Si la chaine
// ne supporte pas dimensions=video (erreur 400, typiquement les tres petites chaines),
// on retombe sur l'ancienne methode "une requete par video". Toute autre erreur
// (403, etc.) est remontee telle quelle pour le reporting.
async function fetchAnalytics(
  token: string,
  channelIdsParam: string,
  videoIds: string[],
  startDate: string,
  endDate: string,
  tryRevenue: boolean
): Promise<{ results: AnalyticsResult[]; revenueAvailable: boolean }> {
  const bulk = await fetchChannelAnalyticsBulk(token, channelIdsParam, startDate, endDate, tryRevenue, videoIds.length)

  if (bulk.ok && bulk.rowsByVideo) {
    const revenue = bulk.revenueAvailable
    const revMap = bulk.revenueByVideo
    // On ne renvoie QUE les videos reellement couvertes par le rapport groupe
    // (le rapport plafonne a ~155 videos actives). Les autres ne sont PAS
    // marquees ici : la synchro par lots (cron /api/youtube/analytics-batch)
    // les traitera une par une. Sans ca, on estamperait analytics_synced_at avec
    // des zeros et le cron les considererait a tort comme deja a jour.
    const results: AnalyticsResult[] = []
    for (const vid of videoIds) {
      const row = bulk.rowsByVideo!.get(vid)
      if (!row) continue
      const rev = revenue ? (revMap?.get(vid) ?? 0) : null
      // core row = [video, views, mw, avd, avp, sg, sl, shares] ; revenus fusionnes a part
      results.push({ videoId: vid, ok: true, data: {
        views: row[1] || 0,
        minutesWatched: row[2] || 0,
        avgDuration: row[3] || 0,
        avgPercentage: row[4] || 0,
        subsGained: row[5] || 0,
        subsLost: row[6] || 0,
        shares: row[7] || 0,
        revenue: rev,
      } })
    }
    return { results, revenueAvailable: revenue }
  }

  // Echec groupe :
  //   - 400 sur PETITE chaine (<=300 videos) => fallback "une par video" (rapide, sans risque de timeout)
  //   - sinon (grosse chaine ou autre erreur) => on remonte l'erreur SANS fallback
  //     (un fallback par video sur une grosse chaine = timeout 60s garanti)
  if (bulk.status === 400 && videoIds.length <= 300) {
    console.error('[analytics] bulk 400 sur petite chaine -> fallback par video')
    return await fetchAllAnalytics(token, channelIdsParam, videoIds, startDate, endDate, tryRevenue, 20)
  }

  console.error('[analytics] echec groupe, pas de fallback (', videoIds.length, 'videos):', bulk.status, bulk.error)

  return {
    results: [{ videoId: videoIds[0], ok: false, status: bulk.status, error: bulk.error }],
    revenueAvailable: false,
  }
}

export async function POST() {
  const results: {
    videos: number
    analytics: number
    playlists: number
    associations: number
    channels: number
    channelsSkippedAnalytics: number
    errors: string[]
    warnings: Array<{ channel: string; reason: string; detail: string }>
    monetaryEnabled: boolean
  } = {
    videos: 0, analytics: 0, playlists: 0, associations: 0, channels: 0,
    channelsSkippedAnalytics: 0,
    errors: [], warnings: [], monetaryEnabled: true,
  }

  try {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken || !session?.userId) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 })
    }
    const sessionToken = session.accessToken
    const userId = session.userId
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // Sync main channel
    let primaryChannelId: string | null = null
    try {
      const mineRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      })
      const mineData = await mineRes.json()
      if (mineRes.ok && mineData.items?.length > 0) {
        const ch = mineData.items[0]
        primaryChannelId = ch.id
        const { data: ex } = await supabase.from('channels').select('is_selected').eq('user_id', userId).eq('channel_id', ch.id).single()
        await supabase.from('channels').upsert({
          user_id: userId, channel_id: ch.id,
          title: ch.snippet?.title,
          thumbnail_url: ch.snippet?.thumbnails?.default?.url,
          subscriber_count: parseInt(ch.statistics?.subscriberCount || '0'),
          video_count: parseInt(ch.statistics?.videoCount || '0'),
          is_selected: ex?.is_selected ?? true,
          access_token: sessionToken,
          synced_at: new Date().toISOString(),
          analytics_available: true,
        }, { onConflict: 'user_id,channel_id', ignoreDuplicates: false })
      }
    } catch (e: any) {
      results.errors.push('Main channel: ' + e.message)
    }

    // Récupérer les chaînes via channel_access (incluant le rôle)
    const { data: accesses } = await supabase.from('channel_access')
      .select('channel_id, role, is_selected')
      .eq('user_id', userId).eq('is_selected', true)

    let selectedChannels: any[] = []

    if (accesses && accesses.length > 0) {
      const accessibleIds = accesses.map((a: any) => a.channel_id)
      const { data: channelsData } = await supabase.from('channels')
        .select('channel_id, title, user_id, access_token, refresh_token, token_expires_at, owner_user_id, analytics_available')
        .in('channel_id', accessibleIds)

      const dedupedMap = new Map<string, any>()
      for (const ch of channelsData || []) {
        const existing = dedupedMap.get(ch.channel_id)
        if (!existing || (ch.owner_user_id && ch.owner_user_id === ch.user_id && (!existing.owner_user_id || existing.owner_user_id !== existing.user_id))) {
          dedupedMap.set(ch.channel_id, ch)
        }
      }
      selectedChannels = Array.from(dedupedMap.values()).map(ch => {
        const acc = accesses.find((a: any) => a.channel_id === ch.channel_id)
        return { ...ch, access_role: acc?.role || 'owner' }
      })
    } else {
      const { data: legacyChannels } = await supabase.from('channels')
        .select('channel_id, title, user_id, access_token, refresh_token, token_expires_at, analytics_available')
        .eq('user_id', userId).eq('is_selected', true)
      selectedChannels = (legacyChannels || []).map((ch: any) => ({ ...ch, access_role: 'owner' }))
    }

    if (!selectedChannels || selectedChannels.length === 0) {
      results.errors.push('Aucune chaîne sélectionnée')
      return NextResponse.json(results)
    }

    results.channels = selectedChannels.length

    for (const channel of selectedChannels) {
      const chId = channel.channel_id
      const chName = channel.title || chId
      const isPrimary = chId === primaryChannelId

      // Skip Analytics si l'user est en accès limité (viewer_limited) ou si la chaîne
      // est explicitement marquée non-analytics (ce flag n'est positionné qu'au moment
      // de l'ajout via le flow Manager limité, plus jamais en auto par le sync)
      const skipAnalytics = channel.access_role === 'viewer_limited' || channel.analytics_available === false

      // Résolution du token (logique inchangée)
      let token: string = sessionToken
      let tokenSource: 'owner_delegated' | 'channel_stored' | 'session' = 'session'

      const { data: ownerToken } = await supabase.from('channel_tokens')
        .select('access_token, refresh_token, expires_at, owner_user_id')
        .eq('channel_id', chId)
        .maybeSingle()

      const nowSec = Math.floor(Date.now() / 1000)
      const ownerTokenStillValid = ownerToken?.access_token
        && ownerToken.expires_at
        && ownerToken.expires_at - nowSec > 300
      const ownerTokenCanRefresh = ownerToken?.refresh_token && ownerToken.refresh_token !== ''

      if (ownerTokenStillValid) {
        token = ownerToken!.access_token!
        tokenSource = 'owner_delegated'
      } else if (ownerTokenCanRefresh) {
        try {
          const refRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: process.env.GOOGLE_CLIENT_ID!,
              client_secret: process.env.GOOGLE_CLIENT_SECRET!,
              grant_type: 'refresh_token',
              refresh_token: ownerToken!.refresh_token!,
            }),
          })
          const refData = await refRes.json()
          if (refRes.ok && refData.access_token) {
            token = refData.access_token
            tokenSource = 'owner_delegated'
            await supabase.from('channel_tokens').update({
              access_token: refData.access_token,
              expires_at: nowSec + (refData.expires_in || 3600),
              last_refreshed_at: new Date().toISOString(),
            }).eq('channel_id', chId)
          } else {
            token = sessionToken
          }
        } catch (e) {
          token = sessionToken
        }
      } else if (channel.access_token && (channel.token_expires_at ? channel.token_expires_at - nowSec > 300 : false)) {
        token = channel.access_token
        tokenSource = 'channel_stored'
        if (channel.refresh_token) {
          token = await refreshChannelToken(channel, supabase)
        }
      }

      // STEP 1: Videos via playlistItems (1 unit/page)
      let videoIds: string[] = []
      try {
        const cr = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${chId}`, { headers: { Authorization: `Bearer ${token}` } })
        const cd = await cr.json()
        if (!cr.ok) throw new Error(cd.error?.message || 'Failed to get channel')
        const uplId = cd.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
        if (!uplId) throw new Error('No uploads playlist for ' + chName)

        // Map videoId -> date d'AJOUT a la playlist d'uploads = vraie date d'upload.
        // (videos.snippet.publishedAt = date de PUBLICATION publique, qui peut etre
        // bien plus tardive quand le client programme la sortie. Les deux infos
        // sont distinctes et on stocke les deux : uploaded_at / published_at.)
        const uploadedAtMap = new Map<string, string>()
        let npt: string | undefined
        do {
          const u = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
          u.searchParams.set('part', 'contentDetails,snippet')
          u.searchParams.set('playlistId', uplId)
          u.searchParams.set('maxResults', '50')
          if (npt) u.searchParams.set('pageToken', npt)
          const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } })
          const d = await r.json()
          if (!r.ok) throw new Error(d.error?.message || 'Failed to list items')
          for (const it of (d.items || [])) {
            const vid = it.contentDetails?.videoId
            if (!vid) continue
            videoIds.push(vid)
            // snippet.publishedAt d'un playlistItem = date d'ajout a la playlist.
            // Pour la playlist d'uploads, c'est la date de mise en ligne du fichier.
            if (it.snippet?.publishedAt && !uploadedAtMap.has(vid)) {
              uploadedAtMap.set(vid, it.snippet.publishedAt)
            }
          }
          npt = d.nextPageToken
        } while (npt)

        // Dedup : la playlist d'uploads peut renvoyer des doublons (re-uploads,
        // chevauchement de pagination). Sans ca, l'upsert Postgres echoue avec
        // "ON CONFLICT DO UPDATE cannot affect row a second time". On deduplique
        // ici une bonne fois : ca protege l'ecriture des videos ET de l'analytics
        // (les deux derivent de cette liste).
        videoIds = Array.from(new Set(videoIds))

        if (videoIds.length > 0) {
          const allVids: any[] = []
          for (let i = 0; i < videoIds.length; i += 50) {
            const b = videoIds.slice(i, i + 50)
            const u = new URL('https://www.googleapis.com/youtube/v3/videos')
            u.searchParams.set('part', 'snippet,contentDetails,statistics,status')
            u.searchParams.set('id', b.join(','))
            const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } })
            const d = await r.json()
            if (!r.ok) throw new Error(d.error?.message || 'Video details error')
            allVids.push(...(d.items || []))
          }
          const ins = allVids.map((v: any) => ({
            user_id: userId, channel_id: chId, youtube_id: v.id,
            title: v.snippet?.title, description: v.snippet?.description,
            thumbnail_url: v.snippet?.thumbnails?.medium?.url,
            published_at: v.snippet?.publishedAt,
            // Vraie date d'upload (ajout a la playlist d'uploads). Peut differer de
            // published_at quand la publication a ete programmee plus tard.
            uploaded_at: uploadedAtMap.get(v.id) || null,
            // Date de mise en ligne programmée (uniquement pour les vidéos privées programmées).
            // status.publishAt est déjà inclus car on demande part=...,status sur videos.list
            scheduled_publish_at: v.status?.publishAt || null,
            status: v.status?.privacyStatus,
            duration: v.contentDetails?.duration,
            tags: v.snippet?.tags || [], category_id: v.snippet?.categoryId,
            view_count: parseInt(v.statistics?.viewCount || '0'),
            like_count: parseInt(v.statistics?.likeCount || '0'),
            comment_count: parseInt(v.statistics?.commentCount || '0'),
            synced_at: new Date().toISOString(),
          }))
          for (let i = 0; i < ins.length; i += 500) {
            const { error } = await supabase.from('videos').upsert(ins.slice(i, i + 500), { onConflict: 'channel_id,youtube_id', ignoreDuplicates: false })
            if (error) throw error
          }
          results.videos += ins.length
        }
      } catch (e: any) {
        results.errors.push(`Videos (${chName}): ${e.message}`)
      }

      // STEP 2: Analytics — sauf si chaîne en accès limité
      if (skipAnalytics) {
        results.channelsSkippedAnalytics++
        // Pas un warning d'erreur — c'est attendu pour viewer_limited
        results.warnings.push({
          channel: chName,
          reason: 'Analytics non synchronisées (accès limité)',
          detail: 'Cette chaîne est en mode Manager YouTube — l\'API Analytics est inaccessible. Vidéos et métadonnées synchronisées normalement.',
        })
      } else {
        try {
          if (videoIds.length > 0) {
            const { data: oldestVideo } = await supabase.from('videos')
              .select('published_at')
              .eq('user_id', userId).eq('channel_id', chId)
              .order('published_at', { ascending: true })
              .limit(1).single()

            const oldest = oldestVideo?.published_at
              ? new Date(oldestVideo.published_at).toISOString().split('T')[0]
              : '2005-01-01'
            const today = new Date().toISOString().split('T')[0]

            // Si on dispose d'un token DELEGUE propre a cette chaine (channel_tokens),
            // ce token est rattache a la chaine -> on interroge channel==MINE (robuste
            // quelle que soit la subtilite cote YouTube). Sinon, fallback channel==<id>.
            const idsParam = (isPrimary || tokenSource === 'owner_delegated') ? 'channel==MINE' : `channel==${chId}`

            const { results: analyticsResults, revenueAvailable } = await fetchAnalytics(
              token, idsParam, videoIds, oldest, today, true
            )

            const successful = analyticsResults.filter(r => r.ok)
            const failed = analyticsResults.filter(r => !r.ok)

            if (successful.length === 0 && failed.length > 0) {
              const firstError = failed[0].error || 'Unknown'
              const status = failed[0].status
              let reason = 'Analytics non disponibles'
              if (status === 403 || firstError.toLowerCase().includes('forbidden')) {
                // ⚠️ IMPORTANT : on ne marque PLUS la chaîne en analytics_available=false ici.
                //
                // Raison : une 403 peut venir de plusieurs causes qui ne sont PAS un manque
                // permanent d'accès analytics sur la chaîne :
                //   1. Le current user est operator/non-owner et n'a pas de channel_tokens délégué
                //      → on tombe sur le sessionToken qui n'a pas les droits Analytics sur cette chaîne
                //   2. Le token utilisé a expiré ou été révoqué côté Google
                //   3. Rate limit transitoire, problème réseau, etc.
                //
                // Marquer analytics_available=false impacte TOUS les users qui voient cette chaîne
                // (le flag n'est pas user-spécifique), y compris le vrai propriétaire qui a tous
                // les droits. Ça brisait l'affichage des analytics pour les owners légitimes.
                //
                // Le flag analytics_available=false n'est positionné qu'à un seul endroit :
                // dans /api/youtube/channels/add quand l'user choisit explicitement le flow
                // "Manager limité" (accessRole=viewer_limited). C'est le seul cas où on est SÛR
                // que l'API Analytics ne sera jamais accessible pour cette chaîne.
                reason = 'Analytics inaccessibles avec le token actuel (manque de droits ou token invalide)'
              } else if (status === 400) {
                reason = 'Requête refusée par YouTube Analytics'
              } else {
                reason = firstError
              }
              results.warnings.push({ channel: chName, reason, detail: firstError })
              results.errors.push(`Analytics (${chName}): ${firstError}`)
            } else {
              const updates = successful.map(r => {
                const base: any = {
                  user_id: userId, channel_id: chId, youtube_id: r.videoId,
                  estimated_minutes_watched: r.data!.minutesWatched,
                  average_view_duration: r.data!.avgDuration,
                  average_view_percentage: r.data!.avgPercentage,
                  subscribers_gained: r.data!.subsGained,
                  subscribers_lost: r.data!.subsLost,
                  shares: r.data!.shares,
                  analytics_synced_at: new Date().toISOString(),
                }
                if (r.data!.revenue !== null) {
                  base.estimated_revenue = r.data!.revenue
                }
                return base
              })

              for (let i = 0; i < updates.length; i += 500) {
                const { error } = await supabase.from('videos').upsert(updates.slice(i, i + 500), { onConflict: 'channel_id,youtube_id', ignoreDuplicates: false })
                if (error) throw error
              }
              results.analytics += updates.length

              if (failed.length > 0) {
                results.warnings.push({
                  channel: chName,
                  reason: `${failed.length}/${analyticsResults.length} vidéos sans analytics`,
                  detail: failed[0].error || '',
                })
              }

              if (!revenueAvailable) {
                results.monetaryEnabled = false
                results.warnings.push({
                  channel: chName,
                  reason: 'Revenus non disponibles pour cette chaîne',
                  detail: 'Scope monétaire non autorisé ou propriété restreinte',
                })
              }
            }
          }
        } catch (e: any) {
          results.errors.push(`Analytics (${chName}): ${e.message}`)
        }
      }

      // STEP 3: Playlists
      try {
        let allPl: any[] = []
        let npt2: string | undefined
        do {
          const u = new URL('https://www.googleapis.com/youtube/v3/playlists')
          u.searchParams.set('part', 'snippet,contentDetails')
          u.searchParams.set('channelId', chId)
          u.searchParams.set('maxResults', '50')
          if (npt2) u.searchParams.set('pageToken', npt2)
          const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } })
          const d = await r.json()
          if (!r.ok) throw new Error(d.error?.message || 'Playlists error')
          allPl = allPl.concat(d.items || [])
          npt2 = d.nextPageToken
        } while (npt2)

        if (allPl.length > 0) {
          const pli = allPl.map((p: any) => ({
            user_id: userId, channel_id: chId, playlist_id: p.id,
            title: p.snippet?.title, description: p.snippet?.description,
            thumbnail_url: p.snippet?.thumbnails?.medium?.url,
            video_count: p.contentDetails?.itemCount || 0,
            published_at: p.snippet?.publishedAt,
            synced_at: new Date().toISOString(),
          }))
          await supabase.from('playlists').upsert(pli, { onConflict: 'user_id,playlist_id', ignoreDuplicates: false })
          results.playlists += pli.length

          await supabase.from('video_playlists').delete().eq('user_id', userId).eq('channel_id', chId)
          const assocs: any[] = []
          for (const pl of allPl) {
            let pt: string | undefined
            let pos = 0
            do {
              const iu = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
              iu.searchParams.set('part', 'contentDetails')
              iu.searchParams.set('playlistId', pl.id)
              iu.searchParams.set('maxResults', '50')
              if (pt) iu.searchParams.set('pageToken', pt)
              const ir = await fetch(iu.toString(), { headers: { Authorization: `Bearer ${token}` } })
              const idata = await ir.json()
              if (!ir.ok) break
              for (const it of idata.items || []) {
                if (it.contentDetails?.videoId) {
                  assocs.push({ user_id: userId, channel_id: chId, youtube_id: it.contentDetails.videoId, playlist_id: pl.id, position: pos++ })
                }
              }
              pt = idata.nextPageToken
            } while (pt)
          }
          if (assocs.length > 0) {
            for (let i = 0; i < assocs.length; i += 500) {
              await supabase.from('video_playlists').upsert(assocs.slice(i, i + 500), { onConflict: 'user_id,youtube_id,playlist_id', ignoreDuplicates: false })
            }
            results.associations += assocs.length
          }
        }
      } catch (e: any) {
        results.errors.push(`Playlists (${chName}): ${e.message}`)
      }
    }

    await supabase.from('sync_logs').insert({
      user_id: userId,
      videos_synced: results.videos,
      status: results.errors.length > 0 ? 'partial' : 'success',
      error_message: results.errors.length > 0 ? results.errors.join('; ') : null,
      synced_at: new Date().toISOString(),
    })

    return NextResponse.json(results)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
