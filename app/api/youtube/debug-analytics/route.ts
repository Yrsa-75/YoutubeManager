import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'

export const maxDuration = 60

// Route de diagnostic : teste plusieurs variantes de requête YouTube Analytics
// et retourne un rapport détaillé pour comprendre ce qui fonctionne.
// GET /api/youtube/debug-analytics
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 })
    }
    const token = session.accessToken

    // Récupérer l'info de la chaîne principale
    const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const chData = await chRes.json()
    if (!chRes.ok) {
      return NextResponse.json({ step: 'get_channel', error: chData }, { status: 500 })
    }
    const channel = chData.items?.[0]
    if (!channel) {
      return NextResponse.json({ error: 'No channel found for this account' }, { status: 404 })
    }
    const channelId = channel.id

    // Plage de dates : 30 derniers jours (plus conservateur que depuis 2013)
    const today = new Date()
    const startDate30 = new Date(today.getTime() - 30 * 86400000).toISOString().split('T')[0]
    const startDate7 = new Date(today.getTime() - 7 * 86400000).toISOString().split('T')[0]
    const todayStr = today.toISOString().split('T')[0]

    async function testQuery(label: string, params: Record<string, string>) {
      const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
      try {
        const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
        const d = await r.json()
        return {
          label,
          status: r.status,
          ok: r.ok,
          params,
          response: r.ok
            ? { rowCount: d.rows?.length || 0, columnHeaders: d.columnHeaders, firstRow: d.rows?.[0] }
            : d,
        }
      } catch (e: any) {
        return { label, status: 0, ok: false, params, error: e.message }
      }
    }

    // Tests progressifs : on commence ultra simple et on ajoute de la complexité
    const tests = await Promise.all([
      // 1. Le test le plus simple possible : MINE + 7 jours + metric unique
      testQuery('T1_MINE_7j_views_only', {
        ids: 'channel==MINE',
        startDate: startDate7,
        endDate: todayStr,
        metrics: 'views',
      }),
      // 2. Avec dimension video
      testQuery('T2_MINE_7j_views_dim_video', {
        ids: 'channel==MINE',
        startDate: startDate7,
        endDate: todayStr,
        dimensions: 'video',
        metrics: 'views',
      }),
      // 3. Metric analytics classique
      testQuery('T3_MINE_7j_watchtime', {
        ids: 'channel==MINE',
        startDate: startDate7,
        endDate: todayStr,
        dimensions: 'video',
        metrics: 'estimatedMinutesWatched,views',
      }),
      // 4. Toutes les métriques sans revenue
      testQuery('T4_MINE_30j_all_metrics_no_revenue', {
        ids: 'channel==MINE',
        startDate: startDate30,
        endDate: todayStr,
        dimensions: 'video',
        metrics: 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares',
      }),
      // 5. Avec revenue
      testQuery('T5_MINE_30j_all_metrics_with_revenue', {
        ids: 'channel==MINE',
        startDate: startDate30,
        endDate: todayStr,
        dimensions: 'video',
        metrics: 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares,estimatedRevenue',
      }),
      // 6. Par ID explicite
      testQuery('T6_ID_30j_all_metrics', {
        ids: `channel==${channelId}`,
        startDate: startDate30,
        endDate: todayStr,
        dimensions: 'video',
        metrics: 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares',
      }),
      // 7. Plage large (comme dans sync-all actuel)
      testQuery('T7_MINE_large_range_all_metrics', {
        ids: 'channel==MINE',
        startDate: '2013-01-01',
        endDate: todayStr,
        dimensions: 'video',
        metrics: 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares',
        maxResults: '500',
        sort: '-estimatedMinutesWatched',
      }),
    ])

    return NextResponse.json({
      diagnostic: 'YouTube Analytics API — tests séquentiels',
      timestamp: new Date().toISOString(),
      channel: {
        id: channelId,
        title: channel.snippet?.title,
        subscriberCount: channel.statistics?.subscriberCount,
        videoCount: channel.statistics?.videoCount,
        viewCount: channel.statistics?.viewCount,
      },
      scopes_hint: 'Vérifier manuellement dans la session NextAuth',
      tests,
      summary: {
        passed: tests.filter(t => t.ok).map(t => t.label),
        failed: tests.filter(t => !t.ok).map(t => ({ label: t.label, status: t.status })),
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 })
  }
}
