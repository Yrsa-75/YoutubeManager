'use client'
import { Search } from 'lucide-react'
import type { TabType } from '@/types'

interface Props {
  activeTab: TabType
  searchQuery: string
  setSearchQuery: (q: string) => void
  searchField: string
  setSearchField: (f: string) => void
}

const TAB_TITLES: Record<TabType, string> = {
  uploaded: 'Vidéos mises en ligne',
  pending: 'Vidéos à mettre en ligne',
  rules: 'Règles de couleurs',
}

const SEARCH_FIELDS = [
  { key: 'all', label: 'Tout' },
  { key: 'title', label: 'Titre' },
  { key: 'description', label: 'Description' },
  { key: 'tags', label: 'Tags' },
]

const PLACEHOLDERS: Record<string, string> = {
  all: 'Titre, ID, description, tags...',
  title: 'Rechercher dans les titres...',
  description: 'Rechercher dans les descriptions...',
  tags: 'Rechercher dans les tags...',
}

export default function TopBar({ activeTab, searchQuery, setSearchQuery, searchField, setSearchField }: Props) {
  return (
    <header className="h-14 flex items-center px-5 gap-3 border-b shrink-0" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--bg-border)' }}>
      <h1 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
        {TAB_TITLES[activeTab]}
      </h1>
      {(activeTab === 'uploaded' || activeTab === 'pending') && (
        <>
          <div className="flex items-center gap-2 h-8 px-3 rounded-lg border w-72" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder={PLACEHOLDERS[searchField] || PLACEHOLDERS.all}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none text-xs"
              style={{ color: 'var(--text-primary)', fontFamily: 'inherit' }}
            />
          </div>
          {activeTab === 'uploaded' && (
            <div className="flex items-center h-8 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--bg-border)' }}>
              {SEARCH_FIELDS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setSearchField(f.key)}
                  className="h-full px-2.5 text-[11px] font-medium transition-all"
                  style={{
                    background: searchField === f.key ? 'rgba(230,57,70,0.12)' : 'var(--bg-card)',
                    color: searchField === f.key ? 'var(--accent-red)' : 'var(--text-muted)',
                  }}
                  title={`Rechercher par ${f.label.toLowerCase()}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="flex-1" />
    </header>
  )
}
