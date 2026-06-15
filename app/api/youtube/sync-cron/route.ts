import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSuperadmin } from '@/lib/gate/session'

// Plan Vercel Pro : jusqu'à 300s. Une passe métadonnées des 3 chaînes tient large.
export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// Espace partagé SPICA + ses 3 chaînes (mêmes identifiants que l'affichage).
const WORKSPACE_USER_ID = '105821724098854691164'
const SPICA_CHANNEL_IDS = [
  'UCAJM0dH9j5xv6Uu94Mu5REQ', // SPICA LIFE
  'UCmiM-_mqrJpdZEi8TJgaP4w', // Family
  'UCUdSPXpNdmoWw0QDWzzsvyQ', // Découverte & Evasion
]

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Rafraîchit le token stocké d'une chaîne si besoin (logique identique à sync-all)
async function refreshChannelToken(channel: any): Promise<string | null> {
  if (channel.token_expires_at && channel.token_expires_at - Math.floor(Date.now() / 1000) > 300) {
    return channel.access_token || null
  }
  if (!channel.refresh_token) return channel.access_token || null
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
    if (!res.ok || !data.access_token) return channel.access_token || null
    await supabase.from('channels').update({
      access_token: data.access_token,
      token_expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      refresh_token: data.refresh_token || channel.refresh_token,
    }).eq('channel_id', channel.channel_id).eq('user_id', channel.user_id)
    return data.access_token
  } catch {
    return channel.access_token || null
  }
}

// Résout un token valide pour une chaîne : token délégué (channel_tokens) d'abord,
// puis token stocké de la chaîne. Pas de session ici (on est dans un cron).
async function resolveToken(chId: string, channelRow: any): Promise<string | null> {
  const nowSec = Math.floor(Date.now() / 1000)

  const { data: ownerToken } = await supabase.from('channel_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('channel_id', chId)
    .maybeSingle()

  if (ownerToken?.access_token && ownerToken.expires_at && ownerToken.expires_at - nowSec > 300) {
    return ownerToken.access_token
  }
  if (ownerToken?.refresh_token) {
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          grant_type: 'refresh_token',
          refresh_token: ownerToken.refresh_token,
        }),
      })
      const d = await r.json()
      if (r.ok && d.access_token) {
        await supabase.from('channel_tokens').update({
          access_token: d.access_token,
          expires_at: nowSec + (d.expires_in || 3600),
          last_refreshed_at: new Date().toISOString(),
        }).eq('channel_id', chId)
        return d.access_token
      }
    } catch { /* on tente le token stocké ci-dessous */ }
  }
  if (channelRow) return await refreshChannelToken(channelRow)
  return null
}

// Synchro MÉTADONNÉES d'une chaîne — copie fidèle de l'étape 1 de sync-all :
// liste des vidéos via la playlist d'uploads, puis détails, puis upsert.
// (L'analytics reste géré par le cron /api/youtube/analytics-batch toutes les 5 min.)
async function syncChannelMetadata(token: string, chId: string, results: any): Promise<void> {
  let videoIds: string[] = []
  const cr = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${chId}`, { headers: { Authorization: `Bearer ${token}` } })
  const cd = await cr.json()
  if (!cr.ok) throw new Error(cd.error?.message || 'Échec lecture chaîne')
  const uplId = cd.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uplId) throw new Error('Pas de playlist uploads pour ' + chId)

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
    if (!r.ok) throw new Error(d.error?.message || 'Échec liste playlist')
    for (const it of (d.items || [])) {
      const vid = it.contentDetails?.videoId
      if (!vid) continue
      videoIds.push(vid)
      if (it.snippet?.publishedAt && !uploadedAtMap.has(vid)) {
        uploadedAtMap.set(vid, it.snippet.publishedAt)
      }
    }
    npt = d.nextPageToken
  } while (npt)

  // Dédoublonnage (la playlist d'uploads peut renvoyer des doublons) — protège l'upsert
  videoIds = Array.from(new Set(videoIds))
  if (videoIds.length === 0) return

  const allVids: any[] = []
  for (let i = 0; i < videoIds.length; i += 50) {
    const b = videoIds.slice(i, i + 50)
    const u = new URL('https://www.googleapis.com/youtube/v3/videos')
    u.searchParams.set('part', 'snippet,contentDetails,statistics,status')
    u.searchParams.set('id', b.join(','))
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error?.message || 'Échec détails vidéos')
    allVids.push(...(d.items || []))
  }

  const ins = allVids.map((v: any) => ({
    user_id: WORKSPACE_USER_ID, channel_id: chId, youtube_id: v.id,
    title: v.snippet?.title, description: v.snippet?.description,
    thumbnail_url: v.snippet?.thumbnails?.medium?.url,
    published_at: v.snippet?.publishedAt,
    uploaded_at: uploadedAtMap.get(v.id) || null,
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

// Autorise soit le cron Vercel (Bearer CRON_SECRET), soit un super-admin connecté (déclenchement manuel)
async function authorize(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true
  const admin = await getSuperadmin()
  return !!admin
}

export async function GET(request: Request) {
  if (!(await authorize(request))) return new NextResponse('Unauthorized', { status: 401 })

  const results: { channels: number; videos: number; errors: string[] } = { channels: 0, videos: 0, errors: [] }

  try {
    const { data: rows } = await supabase.from('channels')
      .select('channel_id, title, user_id, access_token, refresh_token, token_expires_at')
      .eq('user_id', WORKSPACE_USER_ID)
      .in('channel_id', SPICA_CHANNEL_IDS)

    const byId = new Map<string, any>()
    for (const r of (rows || [])) byId.set(r.channel_id, r)

    for (let i = 0; i < SPICA_CHANNEL_IDS.length; i++) {
      const chId = SPICA_CHANNEL_IDS[i]
      const channelRow = byId.get(chId)
      try {
        const token = await resolveToken(chId, channelRow)
        if (!token) {
          results.errors.push(`${channelRow?.title || chId} : aucun jeton disponible (reconnexion Google nécessaire)`)
          continue
        }
        await syncChannelMetadata(token, chId, results)
        results.channels++
        await supabase.from('channels').update({ synced_at: new Date().toISOString() }).eq('channel_id', chId).eq('user_id', WORKSPACE_USER_ID)
      } catch (e: any) {
        results.errors.push(`${channelRow?.title || chId} : ${e.message}`)
      }
    }

    return NextResponse.json({ ok: true, ...results })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message, ...results }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
