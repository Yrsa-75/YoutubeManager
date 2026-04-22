import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

type AnalyticsResult = {
  videoId: string
  ok: boolean
  status?: number
  data?: { views: number; minutesWatched: number; avgDuration: number; avgPercentage: number; subsGained: number; subsLost: number; shares: number; revenue: number | null }
  error?: string
}

async function fetchVideoAnalytics(
  token: string,
  videoId: string,
  startDate: string,
  endDate: string,
  tryRevenue: boolean
): Promise<AnalyticsResult> {
  const metricsWithRevenue = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares,estimatedRevenue'
  const metricsNoRevenue = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares'

  async function attempt(metrics: string) {
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
    url.searchParams.set('ids', 'channel==MINE')
    url.searchParams.set('startDate', startDate)
    url.searchParams.set('endDate', endDate)
    url.searchParams.set('metrics', metrics)
    url.searchParams.set('filters', `video==${videoId}`)
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    const d = await r.json()
    if (!r.ok) return { ok: false, status: r.status, errorMsg: d.error?.message || `HTTP ${r.status}` }
    return { ok: true, row: d.rows?.[0] }
  }

  try {
    let res = await attempt(tryRevenue ? metricsWithRevenue : metricsNoRevenue)

    if (!res.ok && tryRevenue && (res.errorMsg?.toLowerCase().includes('monetary') || res.errorMsg?.toLowerCase().includes('revenue'))) {
      res = await attempt(metricsNoRevenue)
      tryRevenue = false
    }

    if (!res.ok) {
      return { videoId, ok: false, status: res.status, error: res.errorMsg }
    }

    const row = res.row || [0, 0, 0, 0, 0, 0, 0, ...(tryRevenue ? [0] : [])]
    return {
      videoId, ok: true,
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

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 })
    }
    const token = session.accessToken
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: videos, error: fetchError } = await supabase
      .from('videos')
      .select('youtube_id, published_at, user_id, channel_id')
      .order('published_at', { ascending: true })

    if (fetchError) throw fetchError
    if (!videos || videos.length === 0) {
      return NextResponse.json({ success: true, updated: 0, message: 'Aucune vidéo à synchroniser.' })
    }

    const oldestDate = videos[0]?.published_at
      ? new Date(videos[0].published_at).toISOString().split('T')[0]
      : '2005-01-01'
    const today = new Date().toISOString().split('T')[0]

    const videoIds = videos.map(v => v.youtube_id)
    const videoMeta = new Map(videos.map(v => [v.youtube_id, { user_id: v.user_id, channel_id: v.channel_id }]))
    const BATCH_SIZE = 20
    let tryRevenue = true
    const allResults: AnalyticsResult[] = []

    for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
      const batch = videoIds.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(
        batch.map(vid => fetchVideoAnalytics(token, vid, oldestDate, today, tryRevenue))
      )
      allResults.push(...batchResults)

      // Détection d'erreur revenue au premier batch
      if (i === 0 && tryRevenue) {
        const revenueErr = batchResults.some(r => !r.ok && r.error && (r.error.toLowerCase().includes('monetary') || r.error.toLowerCase().includes('revenue')))
        if (revenueErr) tryRevenue = false
      }
    }

    const successful = allResults.filter(r => r.ok)
    const failed = allResults.filter(r => !r.ok)

    if (successful.length === 0 && failed.length > 0) {
      const firstError = failed[0].error || 'Unknown'
      const status = failed[0].status
      const friendly = status === 403
        ? 'Analytics restreintes : le compte connecté n\'est pas propriétaire direct de la chaîne (statut gestionnaire limité par l\'API YouTube).'
        : firstError
      return NextResponse.json({ error: friendly, detail: firstError, status }, { status: 500 })
    }

    const updates = successful.map(r => {
      const meta = videoMeta.get(r.videoId) || { user_id: null, channel_id: null }
      const base: any = {
        user_id: meta.user_id,
        channel_id: meta.channel_id,
        youtube_id: r.videoId,
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

    let totalUpdated = 0
    for (let i = 0; i < updates.length; i += 500) {
      const batch = updates.slice(i, i + 500)
      const { error: upsertError } = await supabase
        .from('videos')
        .upsert(batch, { onConflict: 'channel_id,youtube_id', ignoreDuplicates: false })
      if (upsertError) throw upsertError
      totalUpdated += batch.length
    }

    return NextResponse.json({
      success: true,
      updated: totalUpdated,
      total: videos.length,
      failed: failed.length,
      hasRevenue: tryRevenue,
      message: `Analytics synchronisées pour ${totalUpdated}/${videos.length} vidéos${tryRevenue ? ' (avec revenus)' : ' (sans revenus)'}${failed.length > 0 ? ` — ${failed.length} en échec` : ''}`,
    })
  } catch (error: any) {
    console.error('Analytics sync error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
