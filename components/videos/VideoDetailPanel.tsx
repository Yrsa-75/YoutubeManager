'use client'
import { useState } from 'react'
import { X, Sparkles, Copy, RotateCcw } from 'lucide-react'
import type { Video } from '@/types'
import { formatNumber, formatDate, formatDuration } from '@/lib/utils/format'
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
        body: JSON.stringify({
          type,
          videoTitle: video.title,
          videoDescription: video.description,
          keywords: (video.tags || []).join(', '),
          hint: aiHint,
          count: 5,
        }),
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

  const metrics = [
    { label: 'Vues totales', value: formatNumber(video.view_count) },
    { label: 'Likes', value: formatNumber(video.like_count) },
    { label: 'Commentaires', value: formatNumber(video.comment_count) },
    { label: 'Durée', value: formatDuration(video.duration) },
  ]

  return (
    <aside className="w-[360px] min-w-[360px] flex flex-col border-l overflow-y-auto animate-slide-in" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--bg-border)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--bg-border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Détails</span>
        <button onClick={onClose} className="w-7 h-7 rounded flex items-center justify-center border transition-all" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}>
          <X size={13} />
        </button>
      </div>

      {video.thumbnail_url && (
        <img src={video.thumbnail_url} alt={video.title} referrerPolicy="no-referrer" className="w-full" style={{ aspectRatio: '16/9', objectFit: 'cover' }} />
      )}

      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bg-border)' }}>
        <p className="text-xs font-semibold leading-snug mb-1" style={{ color: 'var(--text-primary)' }}>{video.title}</p>
        <p className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{video.youtube_id} · {formatDate(video.published_at)}</p>
      </div>

      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bg-border)' }}>
        <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Métriques</div>
        <div className="grid grid-cols-2 gap-2">
          {metrics.map(m => (
            <div key={m.label} className="rounded-lg p-2.5 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
              <div className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{m.label}</div>
              <div className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: '#a855f7' }}>
          <Sparkles size={11} /> Génération IA
        </div>

        <div className="flex flex-col gap-2">

          {/* Bouton titres */}
          <button
            onClick={() => generate('titles')}
            disabled={!!loading}
            className="w-full py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
            style={{ background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.25)', color: '#a855f7' }}>
            {loading === 'titles'
              ? <><RotateCcw size={11} className="animate-spin" /> Génération...</>
              : <><Sparkles size={11} /> Générer 5 titres</>}
          </button>

          {/* Bouton description */}
          <button
            onClick={() => generate('description')}
            disabled={!!loading}
            className="w-full py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
            style={{ background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.25)', color: '#a855f7' }}>
            {loading === 'description'
              ? <><RotateCcw size={11} className="animate-spin" /> Génération...</>
              : <><Sparkles size={11} /> Générer une description</>}
          </button>

          {/* Indication pour la description */}
          <textarea
            value={aiHint}
            onChange={e => setAiHint(e.target.value)}
            placeholder="Donner des indications pour la description..."
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
            <button onClick={copyResult} className="absolute top-2 right-2 w-6 h-6 rounded flex items-center justify-center border transition-all" style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}>
              <Copy size={10} />
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
