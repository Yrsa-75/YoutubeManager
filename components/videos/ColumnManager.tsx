'use client'
import { X } from 'lucide-react'

interface Column { key: string; label: string; enabled: boolean; width?: number }
interface Props { columns: Column[]; setColumns: (c: Column[]) => void; onClose: () => void }

export default function ColumnManager({ columns, setColumns, onClose }: Props) {
  function toggle(key: string) {
    setColumns(columns.map(c => c.key === key ? { ...c, enabled: !c.enabled } : c))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-[460px] rounded-2xl border overflow-hidden" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--bg-border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--bg-border)' }}>
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Gestion des colonnes</span>
          <button onClick={onClose} className="w-7 h-7 rounded border flex items-center justify-center" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}><X size={13} /></button>
        </div>
        <div className="p-5 space-y-2">
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Activez ou désactivez les colonnes visibles dans le tableau.</p>
          {columns.map(col => (
            <div key={col.key} className="flex items-center justify-between px-3 py-2.5 rounded-lg border" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{col.label}</span>
              <button onClick={() => toggle(col.key)}
                className="w-9 h-5 rounded-full border relative transition-all"
                style={{ background: col.enabled ? 'var(--accent-red)' : 'var(--bg-hover)', borderColor: col.enabled ? 'var(--accent-red)' : 'var(--bg-border)' }}>
                <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: col.enabled ? '17px' : '1px', opacity: 0.9 }} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
