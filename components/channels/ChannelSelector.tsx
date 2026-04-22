'use client'
import { useState, useEffect } from 'react'
import { Plus, X, Check, Crown, UserCheck } from 'lucide-react'
import toast from 'react-hot-toast'

interface Channel {
  channel_id: string
  title: string
  thumbnail_url: string
  video_count: number
  is_selected: boolean
  access_role?: 'owner' | 'operator' | 'viewer'
}

export default function ChannelSelector() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    fetch('/api/youtube/channels').then(r => r.json()).then(d => setChannels(d.channels || []))
  }, [])

  async function toggleChannel(channelId: string, isSelected: boolean) {
    await fetch('/api/youtube/channels', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, isSelected }),
    })
    setChannels(prev => prev.map(c => c.channel_id === channelId ? { ...c, is_selected: isSelected } : c))
    window.dispatchEvent(new Event('refresh-videos'))
  }

  async function addChannel() {
    if (!url.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/youtube/channels/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setChannels(prev => [...prev, { ...data.channel, is_selected: true }])
      setUrl('')
      setShowAdd(false)
      toast.success(data.channel.title + ' ajoutée !')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAdding(false)
    }
  }

  if (channels.length === 0 && !showAdd) {
    return (
      <div style={{ padding: '8px 0' }}>
        <button onClick={() => setShowAdd(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all"
          style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)' }}>
          <Plus size={14} /> Ajouter une chaîne
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--bg-border)' }}>
      <div className="flex items-center justify-between px-2 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Chaînes
        </span>
        <button onClick={() => setShowAdd(!showAdd)} className="p-1 rounded transition-all hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}>
          {showAdd ? <X size={12} /> : <Plus size={12} />}
        </button>
      </div>

      {channels.map(ch => (
        <button key={ch.channel_id} onClick={() => toggleChannel(ch.channel_id, !ch.is_selected)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all hover:opacity-80"
          style={{ opacity: ch.is_selected ? 1 : 0.4 }}>
          {ch.thumbnail_url ? (
            <img src={ch.thumbnail_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background: 'var(--bg-hover)' }} />
          )}
          <span className="truncate flex-1 text-left" style={{ color: 'var(--text-primary)' }}>{ch.title}</span>
              {ch.access_role === 'operator' && (
                <span title="Vous êtes opérateur sur cette chaîne" className="inline-flex items-center" style={{ color: '#3b82f6' }}>
                  <UserCheck size={11} />
                </span>
              )}
              {ch.access_role === 'owner' && (
                <span title="Vous êtes propriétaire de cette chaîne" className="inline-flex items-center" style={{ color: '#facc15' }}>
                  <Crown size={11} />
                </span>
              )}
          {ch.is_selected && <Check size={12} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />}
        </button>
      ))}

      {showAdd && (
        <div className="mt-2 px-2">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="youtube.com/@chaine"
            onKeyDown={e => e.key === 'Enter' && addChannel()}
            className="w-full px-2 py-1.5 rounded text-xs border outline-none"
            style={{ background: 'var(--bg-primary)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }} />
          <button onClick={addChannel} disabled={adding || !url.trim()}
            className="w-full mt-1 px-2 py-1.5 rounded text-xs font-medium transition-all"
            style={{ background: 'var(--accent-primary)', color: 'white', opacity: adding || !url.trim() ? 0.5 : 1 }}>
            {adding ? 'Recherche...' : 'Ajouter'}
          </button>
        </div>
      )}
    </div>
  )
}
