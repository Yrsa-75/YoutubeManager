'use client'
import { useEffect, useState } from 'react'
import { Plus, Trash2, Save, ToggleLeft, ToggleRight } from 'lucide-react'
import type { ColorRule, ColorCondition } from '@/types'
import toast from 'react-hot-toast'

const FIELD_OPTIONS = [
  { value: 'view_count', label: 'Vues totales' },
  { value: 'like_count', label: 'Likes' },
  { value: 'comment_count', label: 'Commentaires' },
  { value: 'days_since_upload', label: 'Jours depuis upload' },
  { value: 'average_view_duration', label: 'Visionnage moy. (sec)' },
  { value: 'average_view_percentage', label: '% regarde' },
  { value: 'estimated_minutes_watched', label: 'Temps regarde (min)' },
  { value: 'shares', label: 'Partages' },
  { value: 'subscribers_gained', label: 'Abonnes gagnes' },
  { value: 'subscribers_lost', label: 'Abonnes perdus' },
]

const OPERATOR_OPTIONS = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
]

export default function ColorRulesEditor() {
  const [rules, setRules] = useState<ColorRule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchRules() }, [])

  async function fetchRules() {
    try {
      const res = await fetch('/api/color-rules')
      const data = await res.json()
      setRules(data.rules || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function saveRule(rule: ColorRule) {
    try {
      const isNew = rule.id.startsWith('new-')
      if (isNew) {
        // Create: POST without the temporary id
        const { id, ...ruleData } = rule as any
        const res = await fetch('/api/color-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ruleData),
        })
        if (!res.ok) throw new Error('Erreur creation')
        const data = await res.json()
        // Replace temp id with real id from database
        setRules(r => r.map(x => x.id === rule.id ? data.rule : x))
      } else {
        // Update: PUT with id
        const res = await fetch('/api/color-rules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rule),
        })
        if (!res.ok) throw new Error('Erreur sauvegarde')
      }
      toast.success('Regle sauvegardee')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function deleteRule(id: string) {
    try {
      if (id.startsWith('new-')) {
        // Not saved yet, just remove locally
        setRules(r => r.filter(x => x.id !== id))
        return
      }
      await fetch('/api/color-rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setRules(r => r.filter(x => x.id !== id))
      toast.success('Regle supprimee')
    } catch (e: any) { toast.error(e.message) }
  }

  function addRule() {
    const newRule: ColorRule = {
      id: 'new-' + Date.now(),
      name: 'Nouvelle regle',
      color: '#f97316',
      conditions: [{ field: 'view_count', operator: 'gte', value: 1000 }],
      logic: 'AND',
      enabled: true,
      priority: rules.length,
    }
    setRules(r => [...r, newRule])
  }

  function updateRule(id: string, changes: Partial<ColorRule>) {
    setRules(r => r.map(x => x.id === id ? { ...x, ...changes } : x))
  }

  function updateCondition(ruleId: string, index: number, changes: Partial<ColorCondition>) {
    setRules(r => r.map(x => x.id === ruleId ? {
      ...x,
      conditions: x.conditions.map((c, i) => i === index ? { ...c, ...changes } : c)
    } : x))
  }

  function removeCondition(ruleId: string, index: number) {
    setRules(r => r.map(x => x.id === ruleId ? {
      ...x,
      conditions: x.conditions.filter((_, i) => i !== index)
    } : x))
  }

  if (loading) return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>Chargement...</div>

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Filtres et couleurs</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Definissez les conditions de coloration des videos dans le tableau</p>
          </div>
          <button onClick={addRule} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
            style={{ background: 'var(--accent-red)', color: 'white' }}>
            <Plus size={13} /> Nouvelle regle
          </button>
        </div>

        <div className="space-y-3">
          {rules.map(rule => (
            <div key={rule.id} className="rounded-xl border p-4"
              style={{ background: 'var(--bg-card)', borderColor: rule.enabled ? rule.color + '40' : 'var(--bg-border)' }}>

              {/* Header: color picker + name + logic + toggle */}
              <div className="flex items-center gap-3 mb-3">
                {/* Color picker */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={rule.color}
                    onChange={e => updateRule(rule.id, { color: e.target.value })}
                    className="w-8 h-8 rounded-lg cursor-pointer border-0 p-0"
                    style={{ background: 'none' }}
                  />
                  <input
                    type="text"
                    value={rule.color}
                    onChange={e => {
                      const v = e.target.value
                      if (/^#[0-9a-fA-F]{0,6}$/.test(v)) updateRule(rule.id, { color: v })
                    }}
                    className="w-20 text-xs font-mono rounded px-2 py-1 border outline-none uppercase"
                    style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: rule.color }}
                    placeholder="#FF0000"
                  />
                </div>

                <input value={rule.name} onChange={e => updateRule(rule.id, { name: e.target.value })}
                  className="flex-1 bg-transparent outline-none border-b text-sm font-semibold"
                  style={{ borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }} />

                <select value={rule.logic} onChange={e => updateRule(rule.id, { logic: e.target.value as 'AND' | 'OR' })}
                  className="text-xs rounded px-2 py-1 border outline-none cursor-pointer"
                  style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-secondary)', fontFamily: 'inherit' }}>
                  <option value="AND">Toutes (ET)</option>
                  <option value="OR">Au moins une (OU)</option>
                </select>

                <button onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
                  style={{ color: rule.enabled ? rule.color : 'var(--text-muted)' }}>
                  {rule.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>

              {/* Conditions */}
              <div className="space-y-2 mb-3">
                {rule.conditions.map((cond, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg border"
                    style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)' }}>
                    <select value={cond.field} onChange={e => updateCondition(rule.id, i, { field: e.target.value })}
                      className="text-xs rounded px-2 py-1 border outline-none flex-1 cursor-pointer"
                      style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-secondary)', fontFamily: 'inherit' }}>
                      {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <select value={cond.operator} onChange={e => updateCondition(rule.id, i, { operator: e.target.value as any })}
                      className="text-xs rounded px-2 py-1 border outline-none cursor-pointer w-16"
                      style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-secondary)', fontFamily: 'inherit' }}>
                      {OPERATOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <input type="number" value={Number(cond.value)}
                      onChange={e => updateCondition(rule.id, i, { value: Number(e.target.value) })}
                      className="w-24 text-xs rounded px-2 py-1 border outline-none text-center"
                      style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)', fontFamily: 'inherit' }} />
                    {rule.conditions.length > 1 && (
                      <button onClick={() => removeCondition(rule.id, i)}
                        className="w-7 h-7 rounded flex items-center justify-center shrink-0"
                        style={{ color: 'var(--text-muted)' }}>
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={() => updateRule(rule.id, { conditions: [...rule.conditions, { field: 'view_count', operator: 'gte', value: 0 }] })}
                  className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <Plus size={11} /> Ajouter une condition
                </button>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button onClick={() => deleteRule(rule.id)}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border transition-all"
                  style={{ borderColor: 'var(--bg-border)', color: '#ef4444' }}>
                  <Trash2 size={11} /> Supprimer
                </button>
                <button onClick={() => saveRule(rule)}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-semibold"
                  style={{ background: 'var(--accent-red)', color: 'white' }}>
                  <Save size={11} /> Sauvegarder
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 p-4 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Champs disponibles pour les conditions</div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{FIELD_OPTIONS.map(f => f.label).join(', ')}</p>
        </div>
      </div>
    </div>
  )
}
