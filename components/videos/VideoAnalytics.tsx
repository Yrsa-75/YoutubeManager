'use client'
import type { Video } from '@/types'
import { formatNumber, formatViewDuration, formatPercentage, formatMinutes } from '@/lib/utils/format'

interface Props {
  video: Video
}

export default function VideoAnalytics({ video }: Props) {
  const hasAnalytics = video.average_view_duration || video.average_view_percentage || video.estimated_minutes_watched

  if (!hasAnalytics) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="text-2xl mb-2">📊</div>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Pas de donnees analytics</p>
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Cliquez sur "Synchroniser YouTube" pour recuperer les analytics.
        </p>
      </div>
    )
  }

  const durationMatch = video.duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  const totalDurationSec = durationMatch
    ? (parseInt(durationMatch[1] || '0') * 3600) + (parseInt(durationMatch[2] || '0') * 60) + parseInt(durationMatch[3] || '0')
    : 0

  const avgViewSec = video.average_view_duration || 0
  const avgPct = video.average_view_percentage || 0
  const pctColor = avgPct >= 50 ? '#22c55e' : avgPct >= 30 ? '#f97316' : '#ef4444'

  const cards = [
    { label: 'Duree moy. visionnage', value: formatViewDuration(avgViewSec), sub: totalDurationSec > 0 ? `sur ${formatViewDuration(totalDurationSec)}` : undefined },
    { label: '% regarde', value: formatPercentage(avgPct), color: pctColor },
    { label: 'Temps total regarde', value: formatMinutes(video.estimated_minutes_watched) },
    { label: 'Partages', value: video.shares != null ? formatNumber(video.shares) : '—' },
    { label: 'Abonnes gagnes', value: video.subscribers_gained != null ? '+' + formatNumber(video.subscribers_gained) : '—', color: '#22c55e' },
    { label: 'Abonnes perdus', value: video.subscribers_lost != null ? '-' + formatNumber(video.subscribers_lost) : '—', color: '#ef4444' },
  ]

  const gaugeRadius = 45
  const gaugeCircumference = 2 * Math.PI * gaugeRadius
  const gaugeOffset = gaugeCircumference - (avgPct / 100) * gaugeCircumference

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Retention moyenne</div>
        <div className="relative" style={{ width: 120, height: 120 }}>
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r={gaugeRadius} fill="none" stroke="var(--bg-border)" strokeWidth="8" />
            <circle cx="60" cy="60" r={gaugeRadius} fill="none" stroke={pctColor} strokeWidth="8" strokeLinecap="round" strokeDasharray={gaugeCircumference} strokeDashoffset={gaugeOffset} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-xl font-bold" style={{ color: pctColor }}>{avgPct.toFixed(1)}%</span>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>regarde</span>
          </div>
        </div>
      </div>
      {totalDurationSec > 0 && avgViewSec > 0 && (
        <div className="px-4">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Visionnage vs Duree</div>
          <div className="rounded-lg border p-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
            <div className="flex justify-between text-[10px] mb-1.5">
              <span style={{ color: 'var(--text-muted)' }}>0:00</span>
              <span style={{ color: 'var(--text-muted)' }}>{formatViewDuration(totalDurationSec)}</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (avgViewSec / totalDurationSec) * 100)}%`, background: `linear-gradient(90deg, ${pctColor}, ${pctColor}88)` }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] font-medium" style={{ color: pctColor }}>Moy: {formatViewDuration(avgViewSec)}</span>
            </div>
          </div>
        </div>
      )}
      <div className="px-4">
        <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Metriques detaillees</div>
        <div className="grid grid-cols-2 gap-2">
          {cards.map(c => (
            <div key={c.label} className="rounded-lg p-2.5 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
              <div className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</div>
              <div className="font-mono text-sm font-semibold" style={{ color: c.color || 'var(--text-primary)' }}>{c.value}</div>
              {c.sub && <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.sub}</div>}
            </div>
          ))}
        </div>
      </div>
      {video.playlists && video.playlists.length > 0 && (
        <div className="px-4 pb-2">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Playlists</div>
          <div className="space-y-1">
            {video.playlists.map(p => (
              <div key={p.playlist_id} className="text-xs px-2.5 py-1.5 rounded-md border" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}>
                {p.title}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
