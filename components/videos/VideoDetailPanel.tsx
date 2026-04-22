'use client'
import { useState } from 'react'
import { X, Sparkles, Copy, RotateCcw } from 'lucide-react'
import type { Video } from '@/types'
import { formatNumber, formatDate, formatDuration, formatViewDuration, formatPercentage, formatMinutes } from '@/lib/utils/format'
import { capShortsMetrics } from '@/lib/utils/shortsLoopCap'
import toast from 'react-hot-toast'

interface Props { video: Video; onClose: () => void }

const LANGUAGES = [
  { code: 'fr', label: 'FR', flag: '🇫🇷' },
  { code: 'en', label: 'EN', flag: '🇬🇧' },
  { code: 'es', label: 'ES', flag: '🇪🇸' },
  { code: 'de', label: 'DE', flag: '🇩🇪' },
]

export default function VideoDetailPanel({ video, onClose }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const [aiResult, setAiResult] = useState('')
  const [aiType, setAiType] = useState('')
  const [aiHint, setAiHint] = useState('')
  const [language, setLanguage] = useState('fr')

  async function generate(type: 'titles' | 'description') {
    setLoading(type)
    setAiResult('')
    setAiType(type)
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, videoTitle: video.title, videoDescription: video.description, keywords: (video.tags || []).join(', '), hint: aiHint, count: 3, language }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAiResult(data.result)
    } catch (e: any) {
      toast.error('Erreur IA : ' + e.message)
    } finally {
      setLoading(null)
    }
  }

  function copyResult() {
    navigator.clipboard.writeText(aiResult)
    toast.success('Copié !')
  }

  // Analytics data
  const hasAnalytics = video.average_view_duration || video.average_view_percentage || video.estimated_minutes_watched
  const durationMatch = video.duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  const totalDurationSec = durationMatch
    ? (parseInt(durationMatch[1] || '0') * 3600) + (parseInt(durationMatch[2] || '0') * 60) + parseInt(durationMatch[3] || '0')
    : 0
  const capped = capShortsMetrics(video.duration, video.average_view_duration, video.average_view_percentage)
  const avgViewSec = capped.avgViewDuration || 0
  const avgPct = capped.avgViewPercentage || 0
  const isLooped = capped.isLooped
  const pctColor = avgPct >= 50 ? '#22c55e' : avgPct >= 30 ? '#f97316' : '#ef4444'

  const retentionRadius = 28
  const retentionCircumference = 2 * Math.PI * retentionRadius
  const retentionOffset = retentionCircumference * (1 - avgPct / 100)

  const metricCards = [
    { label: 'Vues', value: formatNumber(video.view_count), color: 'var(--text-primary)' },
    { label: 'Likes', value: formatNumber(video.like_count) },
    { label: 'Commentaires', value: formatNumber(video.comment_count) },
    { label: 'Durée', value: formatDuration(video.duration) },
    ...(hasAnalytics ? [
      { label: 'Visionnage moy.', value: formatViewDuration(avgViewSec), sub: totalDurationSec > 0 ? `sur ${formatDuration(video.duration)}` : undefined },
      { label: 'Temps regardé', value: formatMinutes(video.estimated_minutes_watched) },
      { label: 'Partages', value: formatNumber(video.shares || 0) },
      { label: 'Abonnés +', value: '+' + formatNumber(video.subscribers_gained || 0), color: '#22c55e' },
      { label: 'Abonnés -', value: '-' + formatNumber(video.subscribers_lost || 0), color: '#ef4444' },
    ] : []),
  ]

  return (
    <aside className="w-[340px] min-w-[340px] border-l flex flex-col h-full overflow-hidden"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--bg-border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--bg-border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Détails</span>
        <button onClick={onClose} className="w-6 h-6 rounded flex items-center justify-center transition-all"
          style={{ color: 'var(--text-muted)' }}>
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Thumbnail + Title */}
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bg-border)' }}>
          {video.thumbnail_url && (
            <img src={video.thumbnail_url} alt="" className="w-full rounded-lg mb-3" referrerPolicy="no-referrer"
              style={{ aspectRatio: '16/9', objectFit: 'cover' }} />
          )}
          <h3 className="text-sm font-semibold leading-snug mb-1" style={{ color: 'var(--text-primary)' }}>{video.title}</h3>
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <span>{formatDate(video.published_at)}</span>
            <span>·</span>
            <span>{video.status}</span>
            <span>·</span>
            <a href={`https://youtube.com/watch?v=${video.youtube_id}`} target="_blank" rel="noreferrer"
              className="underline" style={{ color: 'var(--accent-red)' }}>YouTube</a>
          </div>
        </div>

        {/* Retention gauge */}
        {hasAnalytics && avgPct > 0 && (
          <div className="px-4 py-3 border-b flex items-center gap-4" style={{ borderColor: 'var(--bg-border)' }}>
            <svg width="70" height="70" viewBox="0 0 70 70">
              <circle cx="35" cy="35" r={retentionRadius} fill="none" stroke="var(--bg-border)" strokeWidth="5" />
              <circle cx="35" cy="35" r={retentionRadius} fill="none" stroke={pctColor} strokeWidth="5"
                strokeDasharray={retentionCircumference} strokeDashoffset={retentionOffset}
                strokeLinecap="round" transform="rotate(-90 35 35)" />
              <text x="35" y="33" textAnchor="middle" fontSize="13" fontWeight="bold" fill={pctColor}>{avgPct.toFixed(0)}%</text>
              <text x="35" y="44" textAnchor="middle" fontSize="8" fill="var(--text-muted)">rétention</text>
            </svg>
            <div className="flex-1">
              <div className="text-xs font-semibold mb-1 inline-flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                {formatViewDuration(avgViewSec)} / {formatDuration(video.duration)}
                {isLooped && (
                  <span
                    title={`Short avec boucles \u2014 valeurs brutes : ${formatViewDuration(capped.rawAvgViewDuration)} / ${capped.rawAvgViewPercentage?.toFixed(1)}%`}
                    className="text-[10px] cursor-help"
                    style={{ color: '#f59e0b' }}
                  >🔁</span>
                )}
              </div>
              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-border)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(avgPct, 100)}%`, background: pctColor }} />
              </div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Durée moyenne de visionnage</div>
            </div>
          </div>
        )}

        {/* Metric cards */}
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bg-border)' }}>
          <div className="grid grid-cols-3 gap-1.5">
            {metricCards.map((c, i) => (
              <div key={i} className="rounded-lg p-2.5 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
                <div className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</div>
                <div className="font-mono text-sm font-semibold" style={{ color: c.color || 'var(--text-primary)' }}>{c.value}</div>
                {c.sub && <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.sub}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Playlists */}
        {video.playlists && video.playlists.length > 0 && (
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bg-border)' }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Playlists</div>
            <div className="space-y-1">
              {video.playlists.map(p => (
                <div key={p.playlist_id} className="text-xs px-2.5 py-1.5 rounded-md border"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}>
                  {p.title}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Generation */}
        <div className="px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: '#a855f7' }}>
            <Sparkles size={11} />
            Génération IA
          </div>

          {/* Language selector */}
          <div className="flex gap-1 mb-3">
            {LANGUAGES.map(l => (
              <button key={l.code} onClick={() => setLanguage(l.code)}
                className="flex-1 py-1.5 rounded-md text-[11px] font-semibold transition-all border"
                style={{
                  background: language === l.code ? 'rgba(168,85,247,0.15)' : 'var(--bg-card)',
                  borderColor: language === l.code ? 'rgba(168,85,247,0.4)' : 'var(--bg-border)',
                  color: language === l.code ? '#a855f7' : 'var(--text-secondary)',
                }}>
                {l.flag} {l.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <button onClick={() => generate('titles')} disabled={!!loading}
              className="w-full py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
              style={{ background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.25)', color: '#a855f7' }}>
              {loading === 'titles' ? <><RotateCcw size={11} className="animate-spin" /> Génération...</> : <><Sparkles size={11} /> Générer 3 titres</>}
            </button>
            <button onClick={() => generate('description')} disabled={!!loading}
              className="w-full py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
              style={{ background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.25)', color: '#a855f7' }}>
              {loading === 'description' ? <><RotateCcw size={11} className="animate-spin" /> Génération...</> : <><Sparkles size={11} /> Générer une description</>}
            </button>
            <textarea value={aiHint} onChange={e => setAiHint(e.target.value)}
              placeholder="Indications supplémentaires (ton, style, mots-clés)..."
              rows={2}
              className="w-full rounded-lg border px-3 py-2 text-xs resize-none outline-none"
              style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)', fontFamily: 'inherit' }}
            />
          </div>
          {aiResult && (
            <div className="mt-3 rounded-lg border p-3 relative" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                {aiType === 'titles' ? 'Titres générés' : 'Description générée'}
              </div>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-primary)', fontFamily: 'inherit' }}>{aiResult}</pre>
              <button onClick={copyResult}
                className="absolute top-2 right-2 w-6 h-6 rounded flex items-center justify-center border transition-all"
                style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}>
                <Copy size={10} />
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
