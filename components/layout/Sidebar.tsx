'use client'
import { signOut, useSession } from 'next-auth/react'
import { Play, Clock, Palette, RefreshCw, LogOut, BarChart2 } from 'lucide-react'
import type { TabType } from '@/types'
import { useState } from 'react'
import toast from 'react-hot-toast'

interface Props {
  activeTab: TabType
  setActiveTab: (t: TabType) => void
}

export default function Sidebar({ activeTab, setActiveTab }: Props) {
  const { data: session } = useSession()
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncStatus('Vidéos...')
    try {
      const res = await fetch('/api/youtube/sync-all', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const parts = []
      if (data.videos > 0) parts.push(data.videos + ' vidéos')
      if (data.analytics > 0) parts.push(data.analytics + ' analytics')
      if (data.playlists > 0) parts.push(data.playlists + ' playlists')
      toast.success(parts.join(', ') || 'Synchronisé !')
      if (data.errors && data.errors.length > 0) {
        data.errors.forEach((e: string) => toast.error(e, { duration: 5000 }))
      }
      setSyncStatus('Terminé')
      window.dispatchEvent(new CustomEvent('youtube-sync-done'))
    } catch (e: any) {
      toast.error('Erreur sync : ' + e.message)
      setSyncStatus(null)
    } finally {
      setSyncing(false)
    }
  }

  const navItems: { id: TabType | null; icon: any; label: string; section: string }[] = [
    { id: 'uploaded', icon: Play, label: 'Vidéos uploadées', section: 'Catalogue' },
    { id: 'pending', icon: Clock, label: 'À uploader', section: 'Catalogue' },
    { id: 'rules', icon: Palette, label: 'Règles couleurs', section: 'Outils' },
    { id: null, icon: BarChart2, label: 'Analytics (bientôt)', section: 'Outils' },
  ]

  const sections = Array.from(new Set(navItems.map(i => i.section)))

  return (
    <aside className="w-[220px] min-w-[220px] flex flex-col h-screen border-r" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--bg-border)' }}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-b" style={{ borderColor: 'var(--bg-border)' }}>
        <div className="w-8 h-6 rounded-md flex items-center justify-center" style={{ background: 'var(--accent-red)' }}>
          <div className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[9px] border-l-white ml-0.5" />
        </div>
        <span className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Youtube<span style={{ color: 'var(--accent-red)' }}>Manager</span>
        </span>
      </div>

      {/* Channel */}
      <div className="mx-3 mt-3 p-2.5 rounded-xl border flex items-center gap-2" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #e63946, #ff6b6b)' }}>
          {session?.user?.name?.[0]?.toUpperCase() || 'Y'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {session?.user?.name || 'Ma chaîne'}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>YouTube</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 mt-2">
        {sections.map(section => (
          <div key={section} className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider px-1 mb-1" style={{ color: 'var(--text-muted)' }}>{section}</div>
            {navItems.filter(i => i.section === section).map(item => {
              const Icon = item.icon
              const isActive = item.id && activeTab === item.id
              const isDisabled = !item.id
              return (
                <button key={item.label} disabled={isDisabled} onClick={() => item.id && setActiveTab(item.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left mb-0.5 text-xs font-medium transition-all relative"
                  style={{ background: isActive ? 'var(--accent-red-dim, rgba(230,57,70,0.12))' : 'transparent', color: isActive ? 'var(--accent-red)' : isDisabled ? 'var(--text-muted)' : 'var(--text-secondary)', cursor: isDisabled ? 'default' : 'pointer' }}>
                  {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-3/5 rounded-r" style={{ background: 'var(--accent-red)' }} />}
                  <Icon size={14} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--bg-border)' }}>
        <button onClick={handleSync} disabled={syncing}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-all"
          style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          {syncing ? (syncStatus || 'Synchronisation...') : syncStatus === 'Terminé' ? 'Synchronisé ✓' : 'Synchroniser YouTube'}
        </button>
        <button onClick={() => signOut()}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs transition-all"
          style={{ color: 'var(--text-muted)' }}>
          <LogOut size={12} />
          Déconnexion
        </button>
      </div>
    </aside>
  )
}
