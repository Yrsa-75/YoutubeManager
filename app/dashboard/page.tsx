'use client'
import { useSession, signIn } from 'next-auth/react'
import { useState } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import VideoTable from '@/components/videos/VideoTable'
import PendingTable from '@/components/pending/PendingTable'
import ColorRulesEditor from '@/components/color-rules/ColorRulesEditor'
import { Loader2 } from 'lucide-react'

export type TabType = 'uploaded' | 'pending' | 'rules'

export default function Dashboard() {
  const { data: session, status } = useSession()
  const [activeTab, setActiveTab] = useState<TabType>('uploaded')
  const [searchQuery, setSearchQuery] = useState('')

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)' }}>
        <Loader2 className="animate-spin" style={{ color: 'var(--accent-red)' }} size={32} />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6" style={{ background: 'var(--bg-primary)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-red)' }}>
            <div className="w-0 h-0 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent border-l-[12px] border-l-white ml-1" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Youtube<span style={{ color: 'var(--accent-red)' }}>Manager</span>
          </h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Connectez votre compte YouTube pour continuer</p>
        <button
          onClick={() => signIn('google')}
          className="px-6 py-3 hover:opacity-90 text-white rounded-xl font-semibold text-sm transition-colors"
          style={{ background: 'var(--accent-red)' }}
        >
          Se connecter avec Google
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar
          activeTab={activeTab}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />
        <main className="flex-1 overflow-hidden">
          {activeTab === 'uploaded' && <VideoTable searchQuery={searchQuery} />}
          {activeTab === 'pending' && <PendingTable searchQuery={searchQuery} />}
          {activeTab === 'rules' && <ColorRulesEditor />}
        </main>
      </div>
    </div>
  )
}
