import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

async function fetchAnalyticsPaginated(
  token: string,
  idsParam: string,
  startDate: string,
  endDate: string,
  metrics: string
) {
  let allRows: any[][] = []
  let startIndex = 1
  const PAGE_SIZE = 200
  let lastError: { status: number; message: string } | null = null

  while (true) {
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
    url.searchParams.set('ids', idsParam)
    url.searchParams.set('startDate', startDate)
    url.searchParams.set('endDate', endDate)
    url.searchParams.set('dimensions', 'video')
    url.searchParams.set('metrics', metrics)
    url.searchParams.set('maxResults', String(PAGE_SIZE))
    url.searchParams.set('startIndex', String(startIndex))
    url.searchParams.set('sort', '-estimatedMinutesWatched')

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()

    if (!res.ok) {
      lastError = { status: res.status, message: data.error?.message || `HTTP ${res.status}` }
      return { rows: null, error: lastError }
    }
    if (!data.rows || data.rows.length === 0) break
    allRows.push(...data.rows)
    if (data.rows.length < PAGE_SIZE) break
    startIndex += PAGE_SIZE
  }

  return { rows: allRows, error: null }
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
      .select('youtube_id, published_at')
      .order('published_at', { ascending: true })

    if (fetchError) throw fetchError
    if (!videos || videos.length === 0) {
      return NextResponse.json({
        success: true,
        updated: 0,
        message: 'Aucune vidéo à synchroniser.',
      })
    }

    const oldestDate = videos[0]?.published_at
      ? new Date(videos[0].published_at).toISOString().split('T')[0]
      : '2005-01-01'
    const today = new Date().toISOString().split('T')[0]

    const metricsWithRevenue = 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares,estimatedRevenue'
    const metricsNoRevenue = 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares'

    // Try MINE with revenue first
    let attempt = await fetchAnalyticsPaginated(token, 'channel==MINE', oldestDate, today, metricsWithRevenue)
    let hasRevenue = true

    // If revenue scope missing, retry without revenue
    if (!attempt.rows && attempt.error &&
      (attempt.error.message.toLowerCase().includes('monetary') ||
        attempt.error.message.toLowerCase().includes('revenue'))) {
      attempt = await fetchAnalyticsPaginated(token, 'channel==MINE', oldestDate, today, metricsNoRevenue)
      hasRevenue = false
    }

    if (!attempt.rows) {
      const msg = attempt.error?.message || 'Unknown error'
      const friendly = attempt.error?.status === 403
        ? 'Analytics restreintes : le compte connecté n\'est pas propriétaire direct de la chaîne (statut gestionnaire limité par l\'API YouTube).'
        : msg
      return NextResponse.json({ error: friendly, detail: msg, status: attempt.error?.status }, { status: 500 })
    }

    const allRows = attempt.rows

    let totalUpdated = 0
    if (allRows.length > 0) {
      const updates = allRows.map((row: any[]) => {
        const base: any = {
          youtube_id: row[0],
          estimated_minutes_watched: row[1] || 0,
          average_view_duration: row[2] || 0,
          average_view_percentage: row[3] || 0,
          subscribers_gained: row[4] || 0,
          subscribers_lost: row[5] || 0,
          shares: row[6] || 0,
          analytics_synced_at: new Date().toISOString(),
        }
        if (hasRevenue) {
          base.estimated_revenue = row[7] || 0
        }
        return base
      })

      for (let i = 0; i < updates.length; i += 500) {
        const batch = updates.slice(i, i + 500)
        const { error: upsertError } = await supabase
          .from('videos')
          .upsert(batch, { onConflict: 'youtube_id', ignoreDuplicates: false })
        if (upsertError) throw upsertError
        totalUpdated += batch.length
      }
    }

    return NextResponse.json({
      success: true,
      updated: totalUpdated,
      total: videos.length,
      hasRevenue,
      message: `Analytics synchronisées pour ${totalUpdated} vidéos sur ${videos.length}${hasRevenue ? ' (avec revenus)' : ' (sans revenus — scope manquant)'}`,
    })
  } catch (error: any) {
    console.error('Analytics sync error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
