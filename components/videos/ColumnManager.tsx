'use client'
import { X, GripVertical } from 'lucide-react'
import { useState, useRef } from 'react'

interface Column { key: string; label: string; enabled: boolean; width?: number }

interface Props {
  columns: Column[];
  setColumns: (c: Column[]) => void;
  onClose: () => void
}

export default function ColumnManager({ columns, setColumns, onClose }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const dragNode = useRef<HTMLDivElement | null>(null)

  function toggle(key: string) {
    setColumns(columns.map(c => c.key === key ? { ...c, enabled: !c.enabled } : c))
  }

  function handleDragStart(e: React.DragEvent, index: number) {
    setDragIndex(index)
    dragNode.current = e.target as HTMLDivElement
    e.dataTransfer.effectAllowed = 'move'
    // Make the drag image slightly transparent
    setTimeout(() => {
      if (dragNode.current) dragNode.current.style.opacity = '0.4'
    }, 0)
  }

  function handleDragEnd() {
    if (dragNode.current) dragNode.current.style.opacity = '1'
    setDragIndex(null)
    setOverIndex(null)
    dragNode.current = null
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragIndex === null || dragIndex === index) return
    setOverIndex(index)
  }

  function handleDrop(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    const newColumns = [...columns]
    const [moved] = newColumns.splice(dragIndex, 1)
    newColumns.splice(index, 0, moved)
    setColumns(newColumns)
    setDragIndex(null)
    setOverIndex(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-[460px] max-h-[80vh] rounded-2xl border overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--bg-border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--bg-border)' }}>
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Gestion des colonnes</span>
          <button onClick={onClose} className="w-7 h-7 rounded border flex items-center justify-center"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}>
            <X size={13} />
          </button>
        </div>
        <div className="p-5 space-y-1.5 overflow-y-auto">
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            Glissez pour réorganiser. Activez ou désactivez les colonnes.
          </p>
          {columns.map((col, index) => (
            <div
              key={col.key}
              draggable
              onDragStart={e => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={e => handleDragOver(e, index)}
              onDrop={e => handleDrop(e, index)}
              className="flex items-center gap-2 px-2 py-2.5 rounded-lg border transition-all"
              style={{
                background: overIndex === index && dragIndex !== null ? 'var(--bg-hover)' : 'var(--bg-card)',
                borderColor: overIndex === index && dragIndex !== null ? 'var(--accent-red)' : 'var(--bg-border)',
                borderTopWidth: overIndex === index && dragIndex !== null && dragIndex > index ? '2px' : '1px',
                borderBottomWidth: overIndex === index && dragIndex !== null && dragIndex < index ? '2px' : '1px',
                borderTopColor: overIndex === index && dragIndex !== null && dragIndex > index ? 'var(--accent-red)' : undefined,
                borderBottomColor: overIndex === index && dragIndex !== null && dragIndex < index ? 'var(--accent-red)' : undefined,
                cursor: 'grab',
              }}>
              <GripVertical size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{col.label}</span>
              <button
                onClick={e => { e.stopPropagation(); toggle(col.key) }}
                className="w-9 h-5 rounded-full border relative transition-all shrink-0"
                style={{
                  background: col.enabled ? 'var(--accent-red)' : 'var(--bg-hover)',
                  borderColor: col.enabled ? 'var(--accent-red)' : 'var(--bg-border)'
                }}>
                <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                  style={{ left: col.enabled ? '17px' : '1px', opacity: 0.9 }} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
