import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { createClient } from '@supabase/supabase-js'

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

    // Get all youtube_ids from Supabase
    const { data: videos, error: fetchError } = await supabase
      .from('videos')
      .select('youtube_id, published_at')
      .order('published_at', { ascending: true })

    if (fetchError) throw fetchError
    if (!videos || videos.length === 0) {
      return NextResponse.json({
        success: true,
        updated: 0,
        message: 'Aucune vid\u00e9o \u00e0 synchroniser. Lance d\'abord la sync YouTube.',
      })
    }

    const oldestDate = videos[0]?.published_at
      ? new Date(videos[0].published_at).toISOString().split('T')[0]
      : '2005-01-01'
    const today = new Date().toISOString().split('T')[0]

    // YouTube Analytics API: video dimension requires sort parameter
    // Note: impressions and CTR are not available via public Analytics API
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
    url.searchParams.set('ids', 'channel==MINE')
    url.searchParams.set('startDate', oldestDate)
    url.searchParams.set('endDate', today)
    url.searchParams.set('dimensions', 'video')
    url.searchParams.set('metrics', 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares')
    url.searchParams.set('maxResults', '500')
    url.searchParams.set('sort', '-estimatedMinutesWatched')

    const res = await fetch(url.toString(), {
      headers: { Authorization: \`Bearer \${token}\` },
    })
    const data = await res.json()

    if (!res.ok) {
      console.error('Analytics API error:', data)
      throw new Error(data.error?.message || 'Analytics API error')
    }

    let totalUpdated = 0

    if (data.rows && data.rows.length > 0) {
      const updates = data.rows.map((row: any[]) => ({
        youtube_id: row[0],
        estimated_minutes_watched: row[1] || 0,
        average_view_duration: row[2] || 0,
        average_view_percentage: row[3] || 0,
        subscribers_gained: row[4] || 0,
        subscribers_lost: row[5] || 0,
        shares: row[6] || 0,
        analytics_synced_at: new Date().toISOString(),
      }))

      for (let i = 0; i < updates.length; i += 500) {
        const batch = updates.slice(i, i + 500)
        const { error: upsertError } = await supabase
          .from('videos')
          .upsert(batch, { onConflict: 'youtube_id', ignoreDuplicates: false })

        if (upsertError) {
          console.error('Upsert error:', upsertError)
          throw upsertError
        }
        totalUpdated += batch.length
      }
    }

    return NextResponse.json({
      success: true,
      updated: totalUpdated,
      total: videos.length,
      message: \`Analytics synchronis\u00e9es pour \${totalUpdated} vid\u00e9os sur \${videos.length}\`,
    })
  } catch (error: any) {
    console.error('Analytics sync error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
