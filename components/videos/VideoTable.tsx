'use client'
import { useEffect, useState, useMemo } from 'react'
import { ChevronUp, ChevronDown, Sparkles, ExternalLink, Settings2 } from 'lucide-react'
import type { Video, ColorRule } from '@/types'
import { formatNumber, formatDate, formatDuration } from '@/lib/utils/format'
import { applyColorRules } from '@/lib/utils/colorRules'
import VideoDetailPanel from './VideoDetailPanel'
import ColumnManager from './ColumnManager'

interface Props { searchQuery: string }

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  public: { label: 'Public', color: '#22c55e' },
  private: { label: 'Privé', color: '#6b7280' },
  unlisted: { label: 'Non répertorié', color: '#f97316' },
}

const COLOR_BG: Record<string, string> = {
  '#ef4444': 'rgba(239,68,68,0.06)',
  '#f97316': 'rgba(249,115,22,0.06)',
  '#22c55e': 'rgba(34,197,94,0.05)',
  '#3b82f6': 'rgba(59,130,246,0.05)',
  '#a855f7': 'rgba(168,85,247,0.05)',
}

const DEFAULT_COLUMNS = [
  { key: 'thumbnail_url', label: 'Miniature', enabled: true, width: 60 },
  { key: 'youtube_id', label: 'ID', enabled: true },
  { key: 'title', label: 'Titre', enabled: true },
  { key: 'status', label: 'Statut', enabled: true },
  { key: 'published_at', label: 'Upload', enabled: true },
  { key: 'view_count', label: 'Vues', enabled: true },
  { key: 'like_count', label: 'Likes', enabled: true },
  { key: 'comment_count', label: 'Commentaires', enabled: true },
  { key: 'duration', label: 'Durée', enabled: true },
  { key: 'tags', label: 'Tags', enabled: false },
]

type VideoWithColor = Video & { _color: string }

export default function VideoTable({ searchQuery }: Props) {
  const [videos, setVideos] = useState<Video[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('published_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [statusFilter, setStatusFilter] = useState('')
  const [colorFilter, setColorFilter] = useState('')
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null)
  const [colorRules, setColorRules] = useState<ColorRule[]>([])
  const [columns, setColumns] = useState(DEFAULT_COLUMNS)
  const [showColumnManager, setShowColumnManager] = useState(false)

  useEffect(() => {
    fetchVideos()
    fetchColorRules()
  }, [searchQuery, sortBy, sortDir, statusFilter])

  useEffect(() => {
    const handler = () => fetchVideos()
    window.addEventListener('youtube-sync-done', handler)
    return () => window.removeEventListener('youtube-sync-done', handler)
  }, [])

  async function fetchVideos() {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        search: searchQuery, sortBy, sortDir, status: statusFilter, limit: '200'
      })
      const res = await fetch('/api/youtube/videos?' + params)
      const data = await res.json()
      setVideos(data.videos || [])
      setTotal(data.total || 0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function fetchColorRules() {
    try {
      const res = await fetch('/api/color-rules')
      const data = await res.json()
      setColorRules(data.rules || [])
    } catch (e) { console.error(e) }
  }

  const videosWithColors = useMemo<VideoWithColor[]>(() =>
    videos.map(v => ({ ...v, _color: applyColorRules(v, colorRules) })),
    [videos, colorRules]
  )

  const filteredVideos = useMemo(() => {
    if (!colorFilter) return videosWithColors
    return videosWithColors.filter(v => v._color === colorFilter)
  }, [videosWithColors, colorFilter])

  function handleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const activeColumns = columns.filter(c => c.enabled)
  const colorRuleFilters = colorRules.filter(r => r.enabled).slice(0, 4)

  function renderCell(video: VideoWithColor, colKey: string) {
    switch (colKey) {
      case 'thumbnail_url':
        return video.thumbnail_url
          ? <img src={video.thumbnail_url} alt="" className="rounded" referrerPolicy="no-referrer" style={{ width: 48, height: 28, objectFit: 'cover' }} />
          : <div className="rounded flex items-center justify-center text-xs" style={{ width: 48, height: 28, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>YT</div>
      case 'youtube_id':
        return <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{video.youtube_id}</span>
      case 'title':
        return <span className="font-medium truncate block max-w-[240px]" style={{ color: 'var(--text-primary)' }}>{video.title}</span>
      case 'status': {
        const s = STATUS_LABELS[video.status] || { label: video.status, color: '#6b7280' }
        return <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: s.color + '20', color: s.color }}>{s.label}</span>
      }
      case 'published_at':
        return <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDate(video.published_at)}</span>
      case 'view_count':
        return <span className="font-mono text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{formatNumber(video.view_count)}</span>
      case 'like_count':
        return <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{formatNumber(video.like_count)}</span>
      case 'comment_count':
        return <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{formatNumber(video.comment_count)}</span>
      case 'duration':
        return <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDuration(video.duration)}</span>
      case 'tags':
        return <span className="text-[11px] truncate block max-w-[120px]" style={{ color: 'var(--text-muted)' }}>{(video.tags || []).slice(0, 3).join(', ')}</span>
      default:
        return <span>{String((video as Record<string, unknown>)[colKey] ?? '')}</span>
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filters */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b flex-wrap shrink-0" style={{ borderColor: 'var(--bg-border)', background: 'var(--bg-primary)' }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Filtres :</span>
        {(['', 'public', 'private', 'unlisted'] as const).map(s => (
          <button key={s || 'all'} onClick={() => setStatusFilter(s)}
            className="h-7 px-3 rounded-md text-xs font-medium border transition-all"
            style={{
              background: statusFilter === s ? 'rgba(230,57,70,0.12)' : 'var(--bg-card)',
              borderColor: statusFilter === s ? 'rgba(230,57,70,0.3)' : 'var(--bg-border)',
              color: statusFilter === s ? 'var(--accent-red)' : 'var(--text-secondary)'
            }}>
            {s === '' ? 'Tous' : s === 'public' ? 'Public' : s === 'private' ? 'Privé' : 'Non répertorié'}
          </button>
        ))}
        <div className="w-px h-4 mx-1" style={{ background: 'var(--bg-border)' }} />
        {colorRuleFilters.map(rule => (
          <button key={rule.id} onClick={() => setColorFilter(colorFilter === rule.color ? '' : rule.color)}
            className="h-7 px-3 rounded-md text-xs font-medium border transition-all flex items-center gap-1.5"
            style={{
              background: colorFilter === rule.color ? rule.color + '20' : 'var(--bg-card)',
              borderColor: colorFilter === rule.color ? rule.color + '60' : 'var(--bg-border)',
              color: colorFilter === rule.color ? rule.color : 'var(--text-secondary)'
            }}>
            <span className="w-2 h-2 rounded-full" style={{ background: rule.color }} />
            {rule.name}
          </button>
        ))}
        <button onClick={() => setShowColumnManager(true)}
          className="ml-auto h-7 px-3 rounded-md text-xs border flex items-center gap-1.5 transition-all"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}>
          <Settings2 size={11} /> Colonnes
        </button>
      </div>

      {/* Table + Panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>
              <div className="text-sm">Chargement des vidéos...</div>
            </div>
          ) : (
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-primary)' }}>
                <tr>
                  {activeColumns.map(col => (
                    <th key={col.key}
                      onClick={() => !['thumbnail_url', 'tags'].includes(col.key) && handleSort(col.key)}
                      className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider border-b select-none"
                      style={{ color: sortBy === col.key ? 'var(--accent-red)' : 'var(--text-muted)', borderColor: 'var(--bg-border)', fontSize: '10px', cursor: ['thumbnail_url', 'tags'].includes(col.key) ? 'default' : 'pointer', whiteSpace: 'nowrap', width: col.width }}>
                      <span className="flex items-center gap-1">
                        {col.label}
                        {!['thumbnail_url', 'tags'].includes(col.key) && sortBy === col.key && (
                          sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 border-b" style={{ borderColor: 'var(--bg-border)', width: 80, fontSize: '10px', color: 'var(--text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVideos.length === 0 ? (
                  <tr>
                    <td colSpan={activeColumns.length + 1} className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
                      {searchQuery ? 'Aucune vidéo ne correspond à votre recherche' : 'Aucune vidéo — cliquez sur "Synchroniser YouTube" pour commencer'}
                    </td>
                  </tr>
                ) : filteredVideos.map(video => {
                  const isSelected = selectedVideo?.youtube_id === video.youtube_id
                  const colorBg = video._color ? (COLOR_BG[video._color] || 'transparent') : 'transparent'
                  return (
                    <tr key={video.youtube_id}
                      onClick={() => setSelectedVideo(isSelected ? null : video)}
                      className="group cursor-pointer transition-colors"
                      style={{ background: isSelected ? 'var(--bg-hover)' : colorBg }}>
                      {activeColumns.map((col, colIndex) => (
                        <td key={col.key}
                          className="px-3 py-2 border-b"
                          style={{
                            borderColor: 'rgba(34,34,46,0.5)',
                            borderLeft: colIndex === 0 && video._color ? `3px solid ${video._color}` : colIndex === 0 ? '3px solid transparent' : undefined,
                            maxWidth: col.width || 200,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                          {renderCell(video, col.key)}
                        </td>
                      ))}
                      <td className="px-3 py-2 border-b" style={{ borderColor: 'rgba(34,34,46,0.5)' }}>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={e => { e.stopPropagation(); setSelectedVideo(video) }}
                            className="w-6 h-6 rounded flex items-center justify-center border transition-all"
                            style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}
                            title="Générer avec IA">
                            <Sparkles size={10} />
                          </button>
                          <a href={`https://youtube.com/watch?v=${video.youtube_id}`}
                            target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="w-6 h-6 rounded flex items-center justify-center border transition-all"
                            style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}
                            title="Ouvrir sur YouTube">
                            <ExternalLink size={10} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {selectedVideo && (
          <VideoDetailPanel video={selectedVideo} onClose={() => setSelectedVideo(null)} />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center px-5 py-1.5 border-t gap-4 shrink-0" style={{ borderColor: 'var(--bg-border)', background: 'var(--bg-secondary)' }}>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatNumber(total)} vidéos au total</span>
        {colorFilter && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{filteredVideos.length} filtrées par couleur</span>}
      </div>

      {showColumnManager && (
        <ColumnManager columns={columns} setColumns={setColumns} onClose={() => setShowColumnManager(false)} />
      )}
    </div>
  )
}
