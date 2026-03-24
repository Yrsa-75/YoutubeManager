'use client'
import { useState } from 'react'
import { X, Plus, Filter, Trash2 } from 'lucide-react'

export interface AdvancedFilter {
  id: string
  field: string
  operator: string
  value: number
}

const FILTER_FIELDS = [
  { key: 'view_count', label: 'Vues', type: 'number' },
  { key: 'like_count', label: 'Likes', type: 'number' },
  { key: 'comment_count', label: 'Commentaires', type: 'number' },
  { key: 'average_view_duration', label: 'Duree moy. (sec)', type: 'number' },
  { key: 'average_view_percentage', label: '% regarde', type: 'number' },
  { key: 'estimated_minutes_watched', label: 'Temps regarde (min)', type: 'number' },
  { key: 'shares', label: 'Partages', type: 'number' },
  { key: 'subscribers_gained', label: 'Abonnes gagnes', type: 'number' },
  { key: 'subscribers_lost', label: 'Abonnes perdus', type: 'number' },
]

const OPERATORS = [
  { key: 'gt', label: '>' },
  { key: 'gte', label: '>=' },
  { key: 'lt', label: '<' },
  { key: 'lte', label: '<=' },
  { key: 'eq', label: '=' },
]

interface Props {
  filters: AdvancedFilter[]
  setFilters: (f: AdvancedFilter[]) => void
  onClose: () => void
}

export default function AdvancedFilters({ filters, setFilters, onClose }: Props) {
  const [localFilters, setLocalFilters] = useState<AdvancedFilter[]>(
    filters.length > 0 ? filters : []
  )

  function addFilter() {
    setLocalFilters([...localFilters, {
      id: Date.now().toString(),
      field: 'view_count',
      operator: 'gt',
      value: 0,
    }])
  }

  function updateFilter(id: string, updates: Partial<AdvancedFilter>) {
    setLocalFilters(localFilters.map(f => f.id === id ? { ...f, ...updates } : f))
  }

  function removeFilter(id: string) {
    setLocalFilters(localFilters.filter(f => f.id !== id))
  }

  function apply() {
    setFilters(localFilters.filter(f => f.value !== undefined))
    onClose()
  }

  function clear() {
    setLocalFilters([])
    setFilters([])
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-[520px] max-h-[80vh] rounded-2xl border overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--bg-border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--bg-border)' }}>
          <div className="flex items-center gap-2">
            <Filter size={14} style={{ color: 'var(--accent-red)' }} />
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Filtres avances</span>
            {localFilters.length > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(230,57,70,0.15)', color: 'var(--accent-red)' }}>{localFilters.length}</span>}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded border flex items-center justify-center" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}><X size={13} /></button>
        </div>
        <div className="p-5 space-y-2 overflow-y-auto flex-1">
          {localFilters.length === 0 ? (
            <div className="text-center py-8"><div className="text-2xl mb-2">🔍</div><p className="text-xs mb-1" style={{ color: 'var(--text-primary)' }}>Aucun filtre</p><p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Ajoutez des filtres pour affiner vos resultats.</p></div>
          ) : localFilters.map(filter => (
            <div key={filter.id} className="flex items-center gap-2 p-2.5 rounded-lg border" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
              <select value={filter.field} onChange={e => updateFilter(filter.id, { field: e.target.value })} className="flex-1 h-8 px-2 rounded-md border text-xs outline-none" style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }}>{FILTER_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
              <select value={filter.operator} onChange={e => updateFilter(filter.id, { operator: e.target.value })} className="w-16 h-8 px-2 rounded-md border text-xs font-mono text-center outline-none" style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }}>{OPERATORS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
              <input type="number" value={filter.value} onChange={e => updateFilter(filter.id, { value: parseFloat(e.target.value) || 0 })} className="w-24 h-8 px-2 rounded-md border text-xs font-mono outline-none" style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }} />
              <button onClick={() => removeFilter(filter.id)} className="w-8 h-8 rounded-md border flex items-center justify-center shrink-0 transition-all" style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}><Trash2 size={12} /></button>
            </div>
          ))}
          <button onClick={addFilter} className="w-full py-2.5 rounded-lg border border-dashed text-xs font-medium flex items-center justify-center gap-1.5 transition-all" style={{ borderColor: 'var(--bg-border)', color: 'var(--text-muted)', background: 'transparent' }}><Plus size={12} />Ajouter un filtre</button>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0" style={{ borderColor: 'var(--bg-border)' }}>
          <button onClick={clear} className="px-3 py-1.5 rounded-md text-xs font-medium transition-all" style={{ color: 'var(--text-muted)' }}>Tout effacer</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 rounded-md border text-xs font-medium transition-all" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}>Annuler</button>
            <button onClick={apply} className="px-4 py-1.5 rounded-md text-xs font-semibold transition-all" style={{ background: 'var(--accent-red)', color: 'white' }}>Appliquer ({localFilters.length})</button>
          </div>
        </div>
      </div>
    </div>
  )
}
