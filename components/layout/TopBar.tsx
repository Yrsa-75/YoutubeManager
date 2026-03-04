'use client'
import { Search, Download } from 'lucide-react'
import type { TabType } from '@/types'

interface Props {
  activeTab: TabType
  searchQuery: string
  setSearchQuery: (q: string) => void
}

const TAB_TITLES: Record<TabType, string> = {
  uploaded: 'Vidéos uploadées',
  pending: 'Vidéos à uploader',
  rules: 'Règles de couleurs',
}

export default function TopBar({ activeTab, searchQuery, setSearchQuery }: Props) {
  return (
    <header className="h-14 flex items-center px-5 gap-3 border-b shrink-0" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--bg-border)' }}>
      <h1 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
        {TAB_TITLES[activeTab]}
      </h1>
      {(activeTab === 'uploaded' || activeTab === 'pending') && (
        <>
          <div className="flex items-center gap-2 h-8 px-3 rounded-lg border w-64" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Titre, ID, description, tags..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none text-xs"
              style={{ color: 'var(--text-primary)', fontFamily: 'inherit' }}
            />
          </div>
        </>
      )}
      <div className="flex-1" />
    </header>
  )
}
