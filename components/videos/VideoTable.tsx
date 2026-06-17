'use client'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { ChevronUp, ChevronDown, Sparkles, ExternalLink, Settings2, Download, Filter, Lock, Film } from 'lucide-react'
import type { Video, ColorRule } from '@/types'
import { formatNumber, formatDate, formatDuration, formatViewDuration, formatPercentage, formatMinutes } from '@/lib/utils/format'
import { capShortsMetrics } from '@/lib/utils/shortsLoopCap'
import { applyColorRules, applyAllColorRules } from '@/lib/utils/colorRules'
import VideoDetailPanel from './VideoDetailPanel'
import ColumnManager from './ColumnManager'
import AdvancedFilters, { type AdvancedFilter } from './AdvancedFilters'
import toast from 'react-hot-toast'

interface Props {
  searchQuery: string
  searchField: string
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  public: { label: 'Publique', color: '#22c55e' },
  private: { label: 'Privée', color: '#6b7280' },
  unlisted: { label: 'Non répertoriée', color: '#f97316' },
}

const COLOR_BG: Record<string, string> = {
  '#ef4444': 'rgba(239,68,68,0.06)',
  '#f97316': 'rgba(249,115,22,0.06)',
  '#22c55e': 'rgba(34,197,94,0.05)',
  '#3b82f6': 'rgba(59,130,246,0.05)',
  '#a855f7': 'rgba(168,85,247,0.05)',
}

// Libellés alignés sur le vocabulaire YouTube Studio (FR)
const DEFAULT_COLUMNS = [
  { key: 'thumbnail_url', label: 'Miniature', enabled: true, width: 60 },
  { key: 'youtube_id', label: 'ID', enabled: true },
  { key: 'title', label: 'Titre', enabled: true },
  { key: 'format', label: 'Format', enabled: true },
  { key: 'status', label: 'Visibilité', enabled: true },
  { key: 'uploaded_at', label: 'Mise en ligne', enabled: true },
  { key: 'publication', label: 'Date de publication', enabled: true },
  { key: 'view_count', label: 'Vues', enabled: true },
  { key: 'like_count', label: "J'aime", enabled: true },
  { key: 'comment_count', label: 'Commentaires', enabled: true },
  { key: 'duration', label: 'Durée', enabled: true },
  { key: 'average_view_duration', label: 'Durée moy. de visionnage', enabled: false },
  { key: 'average_view_percentage', label: 'Pourcentage moyen visionné', enabled: false },
  { key: 'estimated_minutes_watched', label: 'Durée de visionnage (min)', enabled: false },
  { key: 'shares', label: 'Partages', enabled: false },
  { key: 'subscribers_gained', label: 'Abonnés gagnés', enabled: false },
  { key: 'subscribers_lost', label: 'Abonnés perdus', enabled: false },
  { key: 'estimated_revenue', label: 'Revenus estimés', enabled: false },
  { key: 'playlists', label: 'Playlists', enabled: false },
  { key: 'tags', label: 'Tags', enabled: false },
]

// --- Miniature avec chaîne de secours -------------------------------------
// YouTube ne sert pas toujours la miniature stockée (vidéos privées notamment).
// On essaie : URL stockée -> hqdefault -> mqdefault -> default -> placeholder.
function VideoThumb({ video }: { video: Video }) {
  const candidates = useMemo(() => {
    const id = video.youtube_id
    const list = [
      video.thumbnail_url,
      `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      `https://i.ytimg.com/vi/${id}/default.jpg`,
    ].filter(Boolean) as string[]
    return Array.from(new Set(list))
  }, [video.youtube_id, video.thumbnail_url])
  const [idx, setIdx] = useState(0)
  useEffect(() => { setIdx(0) }, [video.youtube_id])

  if (idx >= candidates.length) {
    // Placeholder final : cadenas pour les vidéos privées, pellicule sinon
    return (
      <div className="rounded flex items-center justify-center" title={video.status === 'private' ? 'Vidéo privée — miniature non fournie par YouTube' : 'Miniature indisponible'}
        style={{ width: 48, height: 28, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
        {video.status === 'private' ? <Lock size={11} /> : <Film size={11} />}
      </div>
    )
  }
  return (
    <img src={candidates[idx]} alt="" className="rounded" referrerPolicy="no-referrer" loading="lazy"
      onError={() => setIdx(i => i + 1)}
      style={{ width: 48, height: 28, objectFit: 'cover' }} />
  )
}

// Champs qui dépendent de l'API YouTube Analytics (pas accessibles en mode Manager limité)
const ANALYTICS_FIELDS = new Set([
  'average_view_duration',
  'average_view_percentage',
  'estimated_minutes_watched',
  'shares',
  'subscribers_gained',
  'subscribers_lost',
  'estimated_revenue',
])

const LIMITED_TOOLTIP = "Données indisponibles — chaîne en accès limité (Manager YouTube). Demandez le rôle Propriétaire pour débloquer les analytics."

type VideoWithColor = Video & {
  _colors: string[]
  _isAnalyticsLimited?: boolean
  _channelTitle?: string
}

export default function VideoTable({ searchQuery, searchField }: Props) {
  const [videos, setVideos] = useState<Video[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('published_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [statusFilter, setStatusFilter] = useState('')
  const [formatFilter, setFormatFilter] = useState('') // '' | 'video' | 'short'
  const [colorFilter, setColorFilter] = useState('')
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null)
  const [colorRules, setColorRules] = useState<ColorRule[]>([])
  const [columns, setColumns] = useState(DEFAULT_COLUMNS)
  const [showColumnManager, setShowColumnManager] = useState(false)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilter[]>([])
  const [exporting, setExporting] = useState(false)
  const [columnsLoaded, setColumnsLoaded] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(500)
  const didMountRef = useRef(false)
  // Map channel_id -> { analytics_available, title, access_role }
  const [channelsMap, setChannelsMap] = useState<Map<string, { analytics_available: boolean; title: string; access_role?: string }>>(new Map())

  // --- Mode "filtre global" ---
  // Quand un filtre couleur ou avancé est actif, on charge TOUTES les vidéos (toutes les pages)
  // pour filtrer sur l'ensemble du catalogue, et plus seulement sur la page affichée.
  const [allVideos, setAllVideos] = useState<Video[] | null>(null)
  const [allLoading, setAllLoading] = useState(false)
  const allVideosKeyRef = useRef('')
  const [refreshNonce, setRefreshNonce] = useState(0)
  const filterMode = !!colorFilter || advancedFilters.length > 0
  // Signature des filtres serveur : si elle change, le cache "toutes les vidéos" est invalidé.
  const serverFilterKey = [searchQuery, searchField, sortBy, sortDir, statusFilter, formatFilter].join('|')

  // Load persisted column config on mount
  useEffect(() => {
    loadColumnConfig()
    loadChannelsMeta()
  }, [])

  useEffect(() => {
    const h = () => { fetchVideos(); allVideosKeyRef.current = ''; setRefreshNonce(n => n + 1) }
    window.addEventListener('refresh-videos', h)
    return () => window.removeEventListener('refresh-videos', h)
  }, [])

  // Règles de couleur : chargées une fois (indépendantes des filtres/pagination)
  useEffect(() => { fetchColorRules() }, [])

  // Changement de page → recharger cette page (uniquement hors mode filtre global :
  // en mode filtre, tout est déjà en mémoire, on change seulement la tranche affichée)
  useEffect(() => { if (!filterMode) fetchVideos() }, [page])

  // Changement de tri / filtre / recherche / taille de page → revenir page 1
  // (ou recharger directement si on est déjà page 1). Ignoré au tout premier rendu
  // car l'effet ci-dessus a déjà chargé la page 1.
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return }
    if (page !== 1) setPage(1)
    else fetchVideos()
  }, [searchQuery, searchField, sortBy, sortDir, statusFilter, formatFilter, pageSize])

  // Entrée/sortie du mode filtre global → revenir page 1 (évite une page hors limites)
  useEffect(() => { setPage(1) }, [filterMode])

  // En mode filtre global : charger TOUTES les vidéos (toutes les pages) du filtre serveur courant.
  // Mise en cache via allVideosKeyRef : on ne recharge que si les filtres serveur/tri changent,
  // ou après une synchro/refresh (refreshNonce). Toggler un filtre couleur ne recharge rien.
  useEffect(() => {
    if (!filterMode) return
    if (allVideos && allVideosKeyRef.current === serverFilterKey) return
    let cancelled = false
    setAllLoading(true)
    fetchAllVideos()
      .then(all => { if (!cancelled) { setAllVideos(all); allVideosKeyRef.current = serverFilterKey } })
      .catch(e => { if (!cancelled) console.error(e) })
      .finally(() => { if (!cancelled) setAllLoading(false) })
    return () => { cancelled = true }
  }, [filterMode, serverFilterKey, refreshNonce])

  useEffect(() => {
    const handler = () => {
      fetchVideos()
      loadChannelsMeta()
      allVideosKeyRef.current = ''
      setRefreshNonce(n => n + 1)
    }
    window.addEventListener('youtube-sync-done', handler)
    return () => window.removeEventListener('youtube-sync-done', handler)
  }, [])

  // Save column config when it changes (after initial load)
  useEffect(() => {
    if (columnsLoaded) {
      saveColumnConfig(columns)
    }
  }, [columns, columnsLoaded])

  async function loadColumnConfig() {
    try {
      const res = await fetch('/api/column-config?table=uploaded')
      const data = await res.json()
      if (data.columns && data.columns.length > 0) {
        // Merge persisted config with defaults (in case new columns were added)
        // Migration : l'ancienne colonne 'published_at' (libellée "Upload") devient
        // 'uploaded_at' (vraie date de mise en ligne), en conservant sa position.
        const normalized = data.columns.map((c: any) => c.key === 'published_at' ? { ...c, key: 'uploaded_at' } : c)
        const persistedMap = new Map(normalized.map((c: any) => [c.key, c]))
        const merged = [...normalized.map((c: any) => {
          const def = DEFAULT_COLUMNS.find(d => d.key === c.key)
          return { key: c.key, label: def?.label || c.label || c.key, enabled: c.enabled, width: c.width || def?.width }
        })]
        // Add any new columns not in persisted config (à leur position par défaut)
        DEFAULT_COLUMNS.forEach((def, defIdx) => {
          if (!persistedMap.has(def.key)) {
            merged.splice(Math.min(defIdx, merged.length), 0, def)
          }
        })
        setColumns(merged)
      }
    } catch (e) {
      console.error('Failed to load column config:', e)
    } finally {
      setColumnsLoaded(true)
    }
  }

  async function loadChannelsMeta() {
    try {
      const res = await fetch('/api/youtube/channels')
      const data = await res.json()
      const m = new Map<string, { analytics_available: boolean; title: string; access_role?: string }>()
      for (const ch of data.channels || []) {
        m.set(ch.channel_id, {
          // Si analytics_available est explicitement false (viewer_limited), on marque comme limited
          // Sinon (true, undefined, null) on considère que les analytics sont accessibles
          analytics_available: ch.analytics_available !== false,
          title: ch.title || '',
          access_role: ch.access_role,
        })
      }
      setChannelsMap(m)
    } catch (e) {
      console.error('Failed to load channels meta:', e)
    }
  }

  const saveColumnConfig = useCallback(async (cols: typeof columns) => {
    try {
      await fetch('/api/column-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableKey: 'uploaded',
          columns: cols.map((c, i) => ({ key: c.key, label: c.label, enabled: c.enabled, position: i, width: c.width })),
        }),
      })
    } catch (e) {
      console.error('Failed to save column config:', e)
    }
  }, [])

  async function fetchVideos() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ search: searchQuery, searchField, sortBy, sortDir, status: statusFilter, format: formatFilter, page: String(page), limit: String(pageSize) })
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
    } catch (e) {
      console.error(e)
    }
  }

  // Récupère TOUTES les vidéos du filtre serveur courant (toutes les pages) pour l'export global.
  async function fetchAllVideos(): Promise<Video[]> {
    const all: Video[] = []
    const EXPORT_LIMIT = 2000
    let p = 1
    while (p <= 100) {
      const params = new URLSearchParams({ search: searchQuery, searchField, sortBy, sortDir, status: statusFilter, format: formatFilter, page: String(p), limit: String(EXPORT_LIMIT) })
      const res = await fetch('/api/youtube/videos?' + params)
      const data = await res.json()
      const batch: Video[] = data.videos || []
      all.push(...batch)
      if (batch.length < EXPORT_LIMIT || all.length >= (data.total || 0)) break
      p++
    }
    return all
  }

  async function handleExport() {
    setExporting(true)
    try {
      const XLSX = await import('xlsx')
      // Export GLOBAL : toutes les pages du filtre courant, puis mêmes couleurs + filtres client que l'affichage.
      const allRaw = await fetchAllVideos()
      const exportSource = applyClientFilters(allRaw.map(augmentVideo))
      const exportData = exportSource.map(v => {
        const limited = v._isAnalyticsLimited
        return {
          'ID YouTube': v.youtube_id,
          'Chaîne': v._channelTitle || '',
          'Titre': v.title,
          'Format': v.is_short === true ? 'Short' : v.is_short === false ? 'Vidéo' : 'À classifier',
          'Visibilité': STATUS_LABELS[v.status]?.label || v.status,
          'Mise en ligne': (v.uploaded_at || v.published_at) ? new Date(v.uploaded_at || v.published_at).toLocaleDateString('fr-FR') : '',
          'Date de publication': v.scheduled_publish_at
            ? 'Programmée : ' + new Date(v.scheduled_publish_at).toLocaleString('fr-FR')
            : (v.published_at ? new Date(v.published_at).toLocaleDateString('fr-FR') : ''),
          'Vues': v.view_count,
          "J'aime": v.like_count,
          'Commentaires': v.comment_count,
          'Durée': formatDuration(v.duration),
          'Durée moy. de visionnage': limited ? 'N/A (accès limité)' : (v.average_view_duration ? formatViewDuration(v.average_view_duration) : ''),
          'Pourcentage moyen visionné': limited ? 'N/A (accès limité)' : (v.average_view_percentage ? v.average_view_percentage.toFixed(1) + '%' : ''),
          'Durée de visionnage (min)': limited ? 'N/A' : (v.estimated_minutes_watched || 0),
          'Partages': limited ? 'N/A' : (v.shares || 0),
          'Abonnés gagnés': limited ? 'N/A' : (v.subscribers_gained || 0),
          'Abonnés perdus': limited ? 'N/A' : (v.subscribers_lost || 0),
          'Revenus estimés (€)': limited ? 'N/A' : (v.estimated_revenue || 0),
          'Playlists': (v.playlists || []).map(p => p.title).join(', '),
          'Tags': (v.tags || []).join(', '),
          'Description': v.description || '',
          'URL': 'https://youtube.com/watch?v=' + v.youtube_id,
          'Catégorie couleur': v._colors.length > 0 ? v._colors.map(c => colorRules.find(r => r.color === c)?.name || c).join(', ') : '',
        }
      })
      const ws = XLSX.utils.json_to_sheet(exportData)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Vidéos')
      const cols = Object.keys(exportData[0] || {}).map(key => ({
        wch: Math.max(key.length, ...exportData.slice(0, 50).map(r => String((r as any)[key] || '').length))
      }))
      ws['!cols'] = cols
      const date = new Date().toISOString().split('T')[0]
      XLSX.writeFile(wb, 'YoutubeManager-export-' + date + '.xlsx')
      toast.success(exportSource.length + ' vidéos exportées !')
    } catch (e) {
      toast.error('Erreur export')
      console.error(e)
    } finally {
      setExporting(false)
    }
  }

  // Augmente une vidéo brute avec ses couleurs + infos de chaîne (réutilisé par l'affichage ET l'export)
  const augmentVideo = useCallback((v: Video): VideoWithColor => {
    const color = applyColorRules(v, colorRules)
    let colors: string[] = []
    try { colors = applyAllColorRules(v, colorRules) } catch { colors = color ? [color] : [] }
    if (!Array.isArray(colors)) colors = color ? [color] : []
    const chMeta = channelsMap.get((v as any).channel_id)
    const isLimited = chMeta ? !chMeta.analytics_available : false
    return {
      ...v,
      _color: color,
      _colors: colors,
      _isAnalyticsLimited: isLimited,
      _channelTitle: chMeta?.title || (v as any).channel_title || '',
    } as VideoWithColor
  }, [colorRules, channelsMap])

  // Applique le filtre couleur + les filtres avancés (réutilisé par l'affichage ET l'export)
  const applyClientFilters = useCallback((list: VideoWithColor[]): VideoWithColor[] => {
    let result = list
    if (colorFilter) {
      result = result.filter(v => (v._colors || []).includes(colorFilter))
    }
    for (const filter of advancedFilters) {
      result = result.filter(v => {
        // Si la vidéo est en accès limité ET le filtre porte sur un champ analytics, on l'exclut
        if (v._isAnalyticsLimited && ANALYTICS_FIELDS.has(filter.field)) return false
        const val = (v as any)[filter.field]
        if (val == null) return false
        const numVal = Number(val)
        switch (filter.operator) {
          case 'gt': return numVal > filter.value
          case 'gte': return numVal >= filter.value
          case 'lt': return numVal < filter.value
          case 'lte': return numVal <= filter.value
          case 'eq': return numVal === filter.value
          default: return true
        }
      })
    }
    return result
  }, [colorFilter, advancedFilters])

  // Source des vidéos : en mode filtre global, tout le catalogue ; sinon, la page serveur courante.
  const sourceVideos = filterMode ? (allVideos || []) : videos

  const videosWithColors = useMemo<VideoWithColor[]>(
    () => sourceVideos.map(augmentVideo),
    [sourceVideos, augmentVideo]
  )

  // Filtres couleur + avancés appliqués sur la source (= toutes les pages en mode filtre)
  const filteredAll = useMemo(
    () => applyClientFilters(videosWithColors),
    [videosWithColors, applyClientFilters]
  )

  // Total effectif : nombre de résultats filtrés (mode filtre) ou total serveur (mode normal)
  const effectiveTotal = filterMode ? filteredAll.length : total

  // Liste affichée : en mode filtre on pagine le résultat filtré côté client ;
  // en mode normal, la page serveur est déjà la bonne tranche.
  const filteredVideos = filterMode
    ? filteredAll.slice((page - 1) * pageSize, page * pageSize)
    : filteredAll

  function handleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const activeColumns = columns.filter(c => c.enabled)

  // Pagination (calculs d'affichage)
  const totalPages = Math.max(1, Math.ceil(effectiveTotal / pageSize))
  const fromN = effectiveTotal === 0 ? 0 : (page - 1) * pageSize + 1
  const toN = Math.min(page * pageSize, effectiveTotal)
  const colorRuleFilters = colorRules.filter(r => r.enabled).slice(0, 4)
  const nonSortable = ['thumbnail_url', 'tags', 'playlists']

  // Cellule générique pour les fields analytics indisponibles (mode Manager limité)
  function limitedAnalyticsCell() {
    return (
      <span
        className="font-mono text-xs cursor-help inline-flex items-center gap-1"
        style={{ color: 'var(--text-muted)' }}
        title={LIMITED_TOOLTIP}
      >
        —
        <span className="text-[10px] opacity-60">🔒</span>
      </span>
    )
  }

  // Analytics pas encore récupérées par le cron (analytics_synced_at vide) → "loading…"
  function loadingAnalyticsCell() {
    return (
      <span
        className="font-mono text-xs italic"
        style={{ color: 'var(--text-muted)' }}
        title="Analytics en cours de récupération — actualisez dans quelques minutes."
      >
        loading…
      </span>
    )
  }

  function renderCell(video: VideoWithColor, colKey: string) {
    // Court-circuit : si la vidéo est en accès limité ET la colonne est analytics, afficher tiret avec tooltip
    if (video._isAnalyticsLimited && ANALYTICS_FIELDS.has(colKey)) {
      return limitedAnalyticsCell()
    }

    // Pas encore synchronisé par le cron → "loading…" pour les colonnes watchtime/engagement.
    // (On EXCLUT les revenus : ils ont une autre source et peuvent déjà être renseignés.)
    if (!video.analytics_synced_at && ANALYTICS_FIELDS.has(colKey) && colKey !== 'estimated_revenue') {
      return loadingAnalyticsCell()
    }

    switch (colKey) {
      case 'thumbnail_url':
        return <VideoThumb video={video} />
      case 'youtube_id':
        return <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{video.youtube_id}</span>
      case 'title':
        return <span className="font-medium truncate block max-w-[240px]" style={{ color: 'var(--text-primary)' }}>{video.title}</span>
      case 'status': {
        const s = STATUS_LABELS[video.status] || { label: video.status, color: '#6b7280' }
        return <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: s.color + '20', color: s.color }}>{s.label}</span>
      }
      case 'uploaded_at':
        // Vraie date de mise en ligne. Fallback sur published_at tant que la
        // resynchronisation n'a pas rempli uploaded_at pour les anciennes lignes.
        return <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDate(video.uploaded_at || video.published_at)}</span>
      case 'format': {
        if (video.is_short === true) {
          return <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: 'rgba(230,57,70,0.15)', color: 'var(--accent-red)' }}>Short</span>
        }
        if (video.is_short === false) {
          return <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>Vidéo</span>
        }
        return <span className="text-[11px] cursor-help" style={{ color: 'var(--text-muted)' }} title="Classification en cours — vérifiée automatiquement (vidéos privées : à leur publication)">…</span>
      }
      case 'publication': {
        // Colonne intelligente :
        //  - vidéo programmée (scheduled_publish_at présent) → date de sortie prévue + badge ⏱
        //  - sinon → date de publication réelle (published_at)
        const scheduled = video.scheduled_publish_at
        if (scheduled) {
          let tooltip = 'Mise en ligne programmée'
          try {
            tooltip = 'Mise en ligne programmée le ' + new Date(scheduled).toLocaleString('fr-FR', {
              day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })
          } catch {}
          return (
            <span
              className="text-xs inline-flex items-center gap-1 cursor-help"
              style={{ color: '#f59e0b' }}
              title={tooltip}
            >
              {formatDate(scheduled)}
              <span className="text-[10px]">⏱</span>
            </span>
          )
        }
        return <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDate(video.published_at)}</span>
      }
      case 'view_count':
        return <span className="font-mono text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{formatNumber(video.view_count)}</span>
      case 'like_count':
        return <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{formatNumber(video.like_count)}</span>
      case 'comment_count':
        return <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{formatNumber(video.comment_count)}</span>
      case 'duration':
        return <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDuration(video.duration)}</span>
      case 'average_view_duration': {
        const capped = capShortsMetrics(video.duration, video.average_view_duration, video.average_view_percentage)
        return (
          <span className="font-mono text-xs inline-flex items-center gap-1" style={{ color: capped.avgViewDuration ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {formatViewDuration(capped.avgViewDuration)}
            {capped.isLooped && (
              <span
                title={`Short avec boucles \u2014 valeur brute : ${formatViewDuration(capped.rawAvgViewDuration)}`}
                className="text-[10px] cursor-help"
                style={{ color: '#f59e0b' }}
              >🔁</span>
            )}
          </span>
        )
      }
      case 'average_view_percentage': {
        const cappedPct = capShortsMetrics(video.duration, video.average_view_duration, video.average_view_percentage)
        const pct = cappedPct.avgViewPercentage
        const color = pct ? (pct >= 50 ? '#22c55e' : pct >= 30 ? '#f97316' : '#ef4444') : 'var(--text-muted)'
        return (
          <span className="font-mono text-xs font-medium inline-flex items-center gap-1" style={{ color }}>
            {formatPercentage(pct)}
            {cappedPct.isLooped && (
              <span
                title={`Short avec boucles \u2014 valeur brute : ${cappedPct.rawAvgViewPercentage?.toFixed(1)}%`}
                className="text-[10px] cursor-help"
                style={{ color: '#f59e0b' }}
              >🔁</span>
            )}
          </span>
        )
      }
      case 'estimated_minutes_watched':
        return <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{formatMinutes(video.estimated_minutes_watched)}</span>
      case 'shares':
        return <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{video.shares != null ? formatNumber(video.shares) : '\u2014'}</span>
      case 'subscribers_gained':
        return <span className="font-mono text-xs" style={{ color: video.subscribers_gained ? '#22c55e' : 'var(--text-muted)' }}>{video.subscribers_gained != null ? ('+' + formatNumber(video.subscribers_gained)) : '\u2014'}</span>
      case 'subscribers_lost':
        return <span className="font-mono text-xs" style={{ color: video.subscribers_lost ? '#ef4444' : 'var(--text-muted)' }}>{video.subscribers_lost != null ? ('-' + formatNumber(video.subscribers_lost)) : '\u2014'}</span>
      case 'estimated_revenue':
        return <span className="font-mono text-xs" style={{ color: video.estimated_revenue ? '#22c55e' : 'var(--text-muted)' }}>{video.estimated_revenue != null && video.estimated_revenue > 0 ? (video.estimated_revenue.toFixed(2) + ' €') : '\u2014'}</span>
      case 'playlists':
        return <span className="text-[11px] truncate block max-w-[120px]" style={{ color: 'var(--text-muted)' }}>{(video.playlists || []).map(p => p.title).join(', ') || '\u2014'}</span>
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
            {s === '' ? 'Toutes' : s === 'public' ? 'Publiques' : s === 'private' ? 'Privées' : 'Non répertoriées'}
          </button>
        ))}

        <div className="w-px h-4 mx-1" style={{ background: 'var(--bg-border)' }} />

        {([['', 'Tous formats'], ['video', 'Vidéos'], ['short', 'Shorts']] as const).map(([val, lbl]) => (
          <button key={val || 'allf'} onClick={() => setFormatFilter(val)}
            className="h-7 px-3 rounded-md text-xs font-medium border transition-all"
            style={{
              background: formatFilter === val ? 'rgba(230,57,70,0.12)' : 'var(--bg-card)',
              borderColor: formatFilter === val ? 'rgba(230,57,70,0.3)' : 'var(--bg-border)',
              color: formatFilter === val ? 'var(--accent-red)' : 'var(--text-secondary)'
            }}>
            {lbl}
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



        <div className="ml-auto flex items-center gap-2">
          <button onClick={handleExport} disabled={exporting || total === 0}
            className="h-7 px-3 rounded-md text-xs font-medium border flex items-center gap-1.5 transition-all"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: exporting ? 'var(--text-muted)' : '#22c55e', opacity: total === 0 ? 0.4 : 1 }}>
            <Download size={11} />
            {exporting ? 'Export...' : 'Exporter XLSX'}
          </button>
          <button onClick={() => setShowColumnManager(true)}
            className="h-7 px-3 rounded-md text-xs border flex items-center gap-1.5 transition-all"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}>
            <Settings2 size={11} />
            Colonnes
          </button>
        </div>
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
                      onClick={() => !nonSortable.includes(col.key) && handleSort(col.key)}
                      className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider border-b select-none"
                      style={{
                        color: sortBy === col.key ? 'var(--accent-red)' : 'var(--text-muted)',
                        borderColor: 'var(--bg-border)',
                        fontSize: '10px',
                        cursor: nonSortable.includes(col.key) ? 'default' : 'pointer',
                        whiteSpace: 'nowrap',
                        width: col.width
                      }}>
                      <span className="flex items-center gap-1">
                        {col.label}
                        {!nonSortable.includes(col.key) && sortBy === col.key && (
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
                      {filterMode && allLoading
                        ? 'Recherche sur toutes les pages\u2026'
                        : (searchQuery || colorFilter || advancedFilters.length > 0
                          ? 'Aucune vidéo ne correspond aux filtres'
                          : 'Aucune vidéo \u2014 cliquez sur "Synchroniser YouTube" pour commencer')}
                    </td>
                  </tr>
                ) : filteredVideos.map(video => {
                  const isSelected = selectedVideo?.youtube_id === video.youtube_id
                  const colorBg = (video._colors || []).length > 0 ? (COLOR_BG[video._colors[0]] || 'transparent') : 'transparent'
                  return (
                    <tr key={video.youtube_id}
                      onClick={() => setSelectedVideo(isSelected ? null : video)}
                      className="group cursor-pointer transition-colors"
                      style={{ background: isSelected ? 'var(--bg-hover)' : 'transparent' }}>
                      {activeColumns.map((col, colIndex) => (
                        <td key={col.key} className="px-3 py-2 border-b"
                          style={{
                            borderColor: 'rgba(34,34,46,0.5)',
                            borderLeft: colIndex === 0 && (video._colors || []).length === 1 ? `3px solid ${video._colors[0]}` : colIndex === 0 ? '3px solid transparent' : undefined,
                            position: colIndex === 0 && (video._colors || []).length > 1 ? 'relative' : undefined,
                            maxWidth: col.width || 200,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                          {colIndex === 0 && (video._colors || []).length > 1 && (
                            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, display: 'flex', flexDirection: 'column' }}>
                              {(video._colors || []).map((c: string, ci: number) => (
                                <div key={ci} style={{ flex: 1, background: c }} />
                              ))}
                            </div>
                          )}
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
                          <a href={`https://youtube.com/watch?v=${video.youtube_id}`} target="_blank" rel="noreferrer"
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
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {effectiveTotal === 0 ? '0 vidéo' : `${formatNumber(fromN)}–${formatNumber(toN)} sur ${formatNumber(effectiveTotal)}`}
        </span>
        {filterMode && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {allLoading ? 'Recherche sur toutes les pages\u2026' : `${formatNumber(effectiveTotal)} résultat${effectiveTotal > 1 ? 's' : ''} (toutes pages)`}
          </span>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Par page</label>
          <select
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value))}
            className="text-[11px] rounded px-1.5 py-0.5 outline-none"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', color: 'var(--text-secondary)' }}
          >
            <option value={500}>500</option>
            <option value={1000}>1000</option>
            <option value={2000}>2000</option>
          </select>

          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || loading || allLoading}
            className="text-[11px] px-2 py-0.5 rounded border transition-all"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-secondary)', opacity: (page <= 1 || loading || allLoading) ? 0.4 : 1, cursor: (page <= 1 || loading || allLoading) ? 'default' : 'pointer' }}
          >‹ Précédent</button>

          <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>Page {page} / {totalPages}</span>

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading || allLoading}
            className="text-[11px] px-2 py-0.5 rounded border transition-all"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-secondary)', opacity: (page >= totalPages || loading || allLoading) ? 0.4 : 1, cursor: (page >= totalPages || loading || allLoading) ? 'default' : 'pointer' }}
          >Suivant ›</button>
        </div>
      </div>

      {showColumnManager && (
        <ColumnManager columns={columns} setColumns={setColumns} onClose={() => setShowColumnManager(false)} />
      )}

      {showAdvancedFilters && (
        <AdvancedFilters filters={advancedFilters} setFilters={setAdvancedFilters} onClose={() => setShowAdvancedFilters(false)} />
      )}
    </div>
  )
}
