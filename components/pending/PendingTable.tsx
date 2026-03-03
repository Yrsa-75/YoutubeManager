'use client'
import { useEffect, useState } from 'react'
import { Sparkles, Plus } from 'lucide-react'
import type { PendingVideo } from '@/types'
import ImportZone from './ImportZone'
import VideoDetailPanel from '../videos/VideoDetailPanel'
import toast from 'react-hot-toast'

interface Props { searchQuery: string }

const STATUS_OPTIONS = [
  { value: 'pending', label: 'En attente', color: '#6b7280' },
  { value: 'in_progress', label: 'En montage', color: '#f97316' },
  { value: 'ready', label: 'Prêt', color: '#3b82f6' },
  { value: 'validated', label: 'Validé', color: '#22c55e' },
]

export default function PendingTable({ searchQuery }: Props) {
  const [videos, setVideos] = useState<PendingVideo[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showAiPanel, setShowAiPanel] = useState<any>(null)

  useEffect(() => { fetchVideos() }, [searchQuery])

  async function fetchVideos() {
    setLoading(true)
    try {
      const res = await fetch('/api/pending-videos/import?search=' + encodeURIComponent(searchQuery))
      const data = await res.json()
      setVideos(data.videos || [])
      setTotal(data.total || 0)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function updateStatus(id: string, status: string) {
    try {
      await fetch('/api/pending-videos/import', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      setVideos(v => v.map(x => x.id === id ? { ...x, status: status as any } : x))
    } catch (e: any) { toast.error(e.message) }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ImportZone onImport={fetchVideos} />
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32" style={{ color: 'var(--text-muted)' }}>Chargement...</div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2" style={{ color: 'var(--text-muted)' }}>
            <Plus size={24} style={{ opacity: 0.3 }} />
            <p className="text-sm">Importez un fichier CSV pour commencer</p>
          </div>
        ) : (
          <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead className="sticky top-0" style={{ background: 'var(--bg-primary)', zIndex: 10 }}>
              <tr>
                {['ID', 'Titre', 'Description', 'Mots clés', 'Catégorie', 'Langue', 'Statut', 'Actions'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left border-b uppercase tracking-wider font-semibold" style={{ fontSize: 10, color: 'var(--text-muted)', borderColor: 'var(--bg-border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {videos.map(v => {
                const stOpt = STATUS_OPTIONS.find(s => s.value === v.status) || STATUS_OPTIONS[0]
                return (
                  <tr key={v.id} className="group transition-colors" style={{ borderBottom: '1px solid rgba(34,34,46,0.5)' }}>
                    <td className="px-3 py-2 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{v.internal_id || '—'}</td>
                    <td className="px-3 py-2 max-w-[200px]">
                      <span className="truncate block font-medium" style={{ color: 'var(--text-primary)' }}>{v.title}</span>
                    </td>
                    <td className="px-3 py-2 max-w-[180px]">
                      <span className="truncate block text-[11px]" style={{ color: 'var(--text-secondary)' }}>{v.description?.slice(0, 80)}...</span>
                    </td>
                    <td className="px-3 py-2 max-w-[120px]">
                      <span className="truncate block text-[11px]" style={{ color: 'var(--text-muted)' }}>{v.keywords}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium" style={{ background: '#3b82f620', color: '#3b82f6' }}>{v.category}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>{v.language}</span>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={v.status}
                        onChange={e => updateStatus(v.id, e.target.value)}
                        className="text-[11px] rounded px-2 py-1 border outline-none cursor-pointer"
                        style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: stOpt.color, fontFamily: 'inherit' }}>
                        {STATUS_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setShowAiPanel({ youtube_id: v.internal_id, title: v.title, description: v.description, tags: v.keywords?.split(','), view_count: 0, like_count: 0, comment_count: 0 })}
                          className="w-6 h-6 rounded flex items-center justify-center border transition-all"
                          style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}
                          title="Générer avec IA">
                          <Sparkles size={10} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center px-5 py-1.5 border-t shrink-0" style={{ borderColor: 'var(--bg-border)', background: 'var(--bg-secondary)' }}>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{total} vidéos en attente</span>
      </div>

      {showAiPanel && (
        <div className="fixed inset-0 z-50 flex items-end justify-end" style={{ pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'all', height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <VideoDetailPanel video={showAiPanel} onClose={() => setShowAiPanel(null)} />
          </div>
        </div>
      )}
    </div>
  )
}
