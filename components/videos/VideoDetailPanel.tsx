'use client'
import { useState } from 'react'
import { X, Sparkles, Copy, RotateCcw } from 'lucide-react'
import type { Video } from '@/types'
import { formatNumber, formatDate, formatDuration, formatViewDuration, formatPercentage, formatMinutes } from '@/lib/utils/format'
import toast from 'react-hot-toast'

interface Props { video: Video; onClose: () => void }

export default function VideoDetailPanel({ video, onClose }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const [aiResult, setAiResult] = useState('')
  const [aiType, setAiType] = useState('')
  const [aiHint, setAiHint] = useState('')

  async function generate(type: 'titles' | 'description') {
    setLoading(type)
    setAiResult('')
    setAiType(type)
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, videoTitle: video.title, videoDescription: video.description, keywords: (video.tags || []).join(', '), hint: aiHint, count: 5 }),
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
    toast.success('Copie !')
  }

  // Analytics data
  const hasAnalytics = video.average_view_duration || video.average_view_percentage || video.estimated_minutes_watched
  const durationMatch = video.duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  const totalDurationSec = durationMatch
    ? (parseInt(durationMatch[1] || '0') * 3600) + (parseInt(durationMatch[2] || '0') * 60) + parseInt(durationMatch[3] || '0')
    : 0
  const avgViewSec = video.average_view_duration || 0
  const avgPct = video.average_view_percentage || 0
  const pctColor = avgPct >= 50 ? '#22c55e' : avgPct >= 30 ? '#f97316' : '#ef4444'
  const gaugeRadius = 45
  const gaugeCircumference = 2 * Math.PI * gaugeRadius
  const gaugeOffset = gaugeCircumference - (avgPct / 100) * gaugeCircumference

  const basicMetrics = [
    { label: 'Vues totales', value: formatNumber(video.view_count) },
    { label: 'Likes', value: formatNumber(video.like_count) },
    { label: 'Commentaires', value: formatNumber(video.comment_count) },
    { label: 'Duree', value: formatDuration(video.duration) },
  ]

  const analyticsMetrics = [
    { label: 'Duree moy. visionnage', value: formatViewDuration(avgViewSec), sub: totalDurationSec > 0 ? `sur ${formatViewDuration(totalDurationSec)}` : undefined },
    { label: '% regarde', value: formatPercentage(avgPct), color: pctColor },
    { label: 'Temps total regarde', value: formatMinutes(video.estimated_minutes_watched) },
    { label: 'Partages', value: video.shares != null ? formatNumber(video.shares) : '\u2014' },
    { label: 'Abonnes gagnes', value: video.subscribers_gained != null ? '+' + formatNumber(video.subscribers_gained) : '\u2014', color: '#22c55e' },
    { label: 'Abonnes perdus', value: video.subscribers_lost != null ? '-' + formatNumber(video.subscribers_lost) : '\u2014', color: '#ef4444' },
  ]

  return (
    <aside className="w-[360px] min-w-[360px] flex flex-col border-l overflow-hidden animate-slide-in"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--bg-border)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--bg-border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Details</span>
        <button onClick={onClose} className="w-7 h-7 rounded flex items-center justify-center border transition-all shrink-0"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}>
          <X size={13} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Thumbnail */}
        {video.thumbnail_url && (
          <img src={video.thumbnail_url} alt={video.title} referrerPolicy="no-referrer"
            className="w-full" style={{ aspectRatio: '16/9', objectFit: 'cover' }} />
        )}

        {/* Title + ID */}
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bg-border)' }}>
          <p className="text-xs font-semibold leading-snug mb-1" style={{ color: 'var(--text-primary)' }}>{video.title}</p>
          <p className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{video.youtube_id} · {formatDate(video.published_at)}</p>
        </div>

        {/* Basic metrics */}
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bg-border)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Metriques</div>
          <div className="grid grid-cols-2 gap-2">
            {basicMetrics.map(m => (
              <div key={m.label} className="rounded-lg p-2.5 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
                <div className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{m.label}</div>
                <div className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Analytics section */}
        {hasAnalytics && (
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bg-border)' }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Analytics</div>

            {/* Retention gauge */}
            <div className="flex flex-col items-center mb-4">
              <div className="relative" style={{ width: 120, height: 120 }}>
                <svg width="120" height="120" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r={gaugeRadius} fill="none" stroke="var(--bg-border)" strokeWidth="8" />
                  <circle cx="60" cy="60" r={gaugeRadius} fill="none" stroke={pctColor} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={gaugeCircumference} strokeDashoffset={gaugeOffset}
                    transform="rotate(-90 60 60)" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-xl font-bold" style={{ color: pctColor }}>{avgPct.toFixed(1)}%</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>regarde</span>
                </div>
              </div>
            </div>

            {/* Duration bar */}
            {totalDurationSec > 0 && avgViewSec > 0 && (
              <div className="rounded-lg border p-3 mb-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
                <div className="flex justify-between text-[10px] mb-1.5">
                  <span style={{ color: 'var(--text-muted)' }}>0:00</span>
                  <span style={{ color: 'var(--text-muted)' }}>{formatViewDuration(totalDurationSec)}</span>
                </div>
                <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, (avgViewSec / totalDurationSec) * 100)}%`, background: `linear-gradient(90deg, ${pctColor}, ${pctColor}88)` }} />
                </div>
                <div className="mt-1.5">
                  <span className="text-[10px] font-medium" style={{ color: pctColor }}>Moy: {formatViewDuration(avgViewSec)}</span>
                </div>
              </div>
            )}

            {/* Analytics metric cards */}
            <div className="grid grid-cols-2 gap-2">
              {analyticsMetrics.map(c => (
                <div key={c.label} className="rounded-lg p-2.5 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
                  <div className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</div>
                  <div className="font-mono text-sm font-semibold" style={{ color: c.color || 'var(--text-primary)' }}>{c.value}</div>
                  {c.sub && <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.sub}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

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
            Generation IA
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={() => generate('titles')} disabled={!!loading}
              className="w-full py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
              style={{ background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.25)', color: '#a855f7' }}>
              {loading === 'titles' ? <><RotateCcw size={11} className="animate-spin" /> Generation...</> : <><Sparkles size={11} /> Generer 5 titres</>}
            </button>
            <button onClick={() => generate('description')} disabled={!!loading}
              className="w-full py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
              style={{ background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.25)', color: '#a855f7' }}>
              {loading === 'description' ? <><RotateCcw size={11} className="animate-spin" /> Generation...</> : <><Sparkles size={11} /> Generer une description</>}
            </button>
            <textarea value={aiHint} onChange={e => setAiHint(e.target.value)}
              placeholder="Donner des indications pour la description..."
              rows={2}
              className="w-full rounded-lg border px-3 py-2 text-xs resize-none outline-none"
              style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)', fontFamily: 'inherit' }}
            />
          </div>
          {aiResult && (
            <div className="mt-3 rounded-lg border p-3 relative" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                {aiType === 'titles' ? 'Titres generes' : 'Description generee'}
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
