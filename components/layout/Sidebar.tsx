'use client'
import { Play, Clock, Palette, RefreshCw, LogOut, Sun, Moon, Settings } from 'lucide-react'
import type { TabType } from '@/types'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { useTheme } from '@/hooks/useTheme'
import ChannelSelector from '@/components/channels/ChannelSelector'

interface Props {
  activeTab: TabType
  setActiveTab: (t: TabType) => void
  isAdmin?: boolean
  email?: string
}

// Affichage relatif de la derniere synchro ("il y a 5 min").
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  return `il y a ${Math.floor(h / 24)} j`
}

export default function Sidebar({ activeTab, setActiveTab, isAdmin = false, email = '' }: Props) {
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const { theme, toggleTheme } = useTheme()

  async function loadSyncStatus() {
    try {
      const res = await fetch('/api/youtube/sync-status')
      const data = await res.json()
      setLastSync(data.last_synced_at || null)
    } catch {}
  }

  useEffect(() => {
    loadSyncStatus()
    const onDone = () => loadSyncStatus()
    window.addEventListener('youtube-sync-done', onDone)
    return () => window.removeEventListener('youtube-sync-done', onDone)
  }, [])

  async function handleLogout() {
    try {
      await fetch('/api/gate/logout', { method: 'POST' })
    } catch {}
    window.location.href = '/login'
  }

  // Rafraichir = passe metadonnees legere (sync-cron). L'analytics (CA, watchtime)
  // se complete en tache de fond via le cron analytics-batch. Plus de timeout.
  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/youtube/sync-cron', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Échec de la synchronisation')
      toast.success(data.videos > 0 ? `${data.videos} vidéos synchronisées` : 'À jour !')
      if (data.errors && data.errors.length > 0) {
        data.errors.forEach((e: string) =>
          toast(e, {
            duration: 7000,
            icon: '⚠️',
            style: { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid #f59e0b' },
          })
        )
      }
      window.dispatchEvent(new CustomEvent('youtube-sync-done'))
    } catch (e: any) {
      toast.error('Erreur sync : ' + e.message)
    } finally {
      setSyncing(false)
      loadSyncStatus()
    }
  }

  const navItems: { id: TabType | null; icon: any; label: string; section: string }[] = [
    { id: 'uploaded', icon: Play, label: 'Vidéos uploadées', section: 'Catalogue' },
    { id: 'pending', icon: Clock, label: 'À uploader', section: 'Catalogue' },
    { id: 'rules', icon: Palette, label: 'Filtres', section: 'Outils' },
  ]

  const sections = Array.from(new Set(navItems.map(i => i.section)))
  const initial = (email && email[0] ? email[0] : 'S').toUpperCase()

  return (
    <aside className="w-[220px] min-w-[220px] flex flex-col h-screen border-r" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--bg-border)' }}>
      {/* Logo SPICA Manager */}
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4 border-b" style={{ borderColor: 'var(--bg-border)' }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--accent-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 18, lineHeight: 1 }}>S</span>
        </div>
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 15, letterSpacing: '0.02em' }}>SPICA</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Manager</div>
        </div>
      </div>

      {/* Compte connecté */}
      <div className="mx-3 mt-3 p-2.5 rounded-xl border flex items-center gap-2" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #e63946, #ff6b6b)' }}>
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {email || 'Espace SPICA'}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{isAdmin ? 'Super-admin' : 'Utilisateur'}</div>
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
        {/* Theme toggle */}
        <button onClick={toggleTheme}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all"
          style={{ color: 'var(--text-secondary)' }}>
          {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
          {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
        </button>

        {/* Réglages + Rafraîchir : réservés aux super-admins */}
        {isAdmin && (
          <>
            <button
              onClick={() => { window.location.href = '/settings/channels' }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs hover:opacity-80 transition-opacity"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Settings size={12} />
              Paramètres
            </button>
            <button onClick={handleSync} disabled={syncing}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-all"
              style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}>
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Synchronisation…' : 'Rafraîchir'}
            </button>
            <div className="text-[10px] text-center" style={{ color: 'var(--text-muted)' }}>
              {syncing ? 'Mise à jour en cours…' : lastSync ? `À jour · ${formatRelative(lastSync)}` : 'Jamais synchronisé'}
            </div>
          </>
        )}

        <button onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs transition-all"
          style={{ color: 'var(--text-muted)' }}>
          <LogOut size={12} />
          Déconnexion
        </button>
        <ChannelSelector />
      </div>
    </aside>
  )
}
