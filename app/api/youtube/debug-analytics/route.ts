import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'

export const maxDuration = 60

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken) return NextResponse.json({ error: 'No access token' }, { status: 401 })
    const token = session.accessToken

    // Info chaîne
    const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true', { headers: { Authorization: `Bearer ${token}` } })
    const chData = await chRes.json()
    if (!chRes.ok) return NextResponse.json({ step: 'get_channel', error: chData }, { status: 500 })
    const channel = chData.items?.[0]
    if (!channel) return NextResponse.json({ error: 'No channel' }, { status: 404 })
    const channelId = channel.id

    // Récupérer les IDs de vidéos (uploads playlist)
    const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads
    const plRes = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${uploadsId}&maxResults=3`, { headers: { Authorization: `Bearer ${token}` } })
    const plData = await plRes.json()
    const videoIds = (plData.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean)

    const today = new Date().toISOString().split('T')[0]
    const startDate30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    const startDate365 = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0]
    const startDateAll = '2013-01-01'

    async function testQuery(label, params) {
      const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
      try {
        const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
        const d = await r.json()
        return { label, status: r.status, ok: r.ok, params, response: r.ok ? { rowCount: d.rows?.length || 0, columnHeaders: d.columnHeaders, allRows: d.rows } : d }
      } catch (e) {
        return { label, status: 0, ok: false, params, error: e.message }
      }
    }

    const firstVideoId = videoIds[0]
    const tests = await Promise.all([
      // CONTOURNEMENT 1 : filter par video spécifique, pas de dimension, 30j
      testQuery('W1_filter_video_30j_all_metrics', {
        ids: 'channel==MINE',
        startDate: startDate30, endDate: today,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares',
        filters: `video==${firstVideoId}`,
      }),
      // CONTOURNEMENT 2 : filter par video, plage 365 jours
      testQuery('W2_filter_video_365j_all_metrics', {
        ids: 'channel==MINE',
        startDate: startDate365, endDate: today,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares',
        filters: `video==${firstVideoId}`,
      }),
      // CONTOURNEMENT 3 : filter par video, plage ALL TIME
      testQuery('W3_filter_video_alltime_all_metrics', {
        ids: 'channel==MINE',
        startDate: startDateAll, endDate: today,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares',
        filters: `video==${firstVideoId}`,
      }),
      // CONTOURNEMENT 4 : filter par video + revenue
      testQuery('W4_filter_video_alltime_with_revenue', {
        ids: 'channel==MINE',
        startDate: startDateAll, endDate: today,
        metrics: 'views,estimatedMinutesWatched,estimatedRevenue',
        filters: `video==${firstVideoId}`,
      }),
      // CONTROLE : confirmer que dimension=video échoue toujours
      testQuery('C1_dim_video_alltime', {
        ids: 'channel==MINE',
        startDate: startDateAll, endDate: today,
        dimensions: 'video',
        metrics: 'views',
      }),
      // CONTROLE : stats globales sans dim ni filter (devrait marcher)
      testQuery('C2_global_alltime', {
        ids: 'channel==MINE',
        startDate: startDateAll, endDate: today,
        metrics: 'views,estimatedMinutesWatched,subscribersGained,shares',
      }),
    ])

    return NextResponse.json({
      diagnostic: 'YouTube Analytics API V2 — tests de contournement filter=video',
      timestamp: new Date().toISOString(),
      channel: { id: channelId, title: channel.snippet?.title, subscriberCount: channel.statistics?.subscriberCount, videoCount: channel.statistics?.videoCount, viewCount: channel.statistics?.viewCount },
      videosTested: videoIds,
      firstVideoId,
      tests,
      summary: { passed: tests.filter(t => t.ok).map(t => t.label), failed: tests.filter(t => !t.ok).map(t => ({ label: t.label, status: t.status })) },
    })
  } catch (error) {
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 })
  }
}
