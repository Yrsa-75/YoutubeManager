'use client'
import { useState, useEffect } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import VideoTable from '@/components/videos/VideoTable'
import PendingTable from '@/components/pending/PendingTable'
import ColorRulesEditor from '@/components/color-rules/ColorRulesEditor'

export type TabType = 'uploaded' | 'pending' | 'rules'

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('uploaded')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchField, setSearchField] = useState('all')
  const [role, setRole] = useState<'superadmin' | 'user' | null>(null)
  const [email, setEmail] = useState<string>('')

  // L'accès est garanti par le middleware (rideau). On récupère juste
  // l'email et le rôle pour personnaliser l'interface.
  useEffect(() => {
    fetch('/api/gate/me')
      .then((r) => r.json())
      .then((d) => {
        if (d?.user) {
          setRole(d.user.role)
          setEmail(d.user.email || '')
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isAdmin={role === 'superadmin'}
        email={email}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar
          activeTab={activeTab}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchField={searchField}
          setSearchField={setSearchField}
        />
        <main className="flex-1 overflow-hidden">
          {activeTab === 'uploaded' && <VideoTable searchQuery={searchQuery} searchField={searchField} />}
          {activeTab === 'pending' && <PendingTable searchQuery={searchQuery} />}
          {activeTab === 'rules' && <ColorRulesEditor />}
        </main>
      </div>
    </div>
  )
}
