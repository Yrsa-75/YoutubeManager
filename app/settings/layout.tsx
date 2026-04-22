'use client'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

const TABS = [
  { id: 'channels', label: 'Chaînes', href: '/settings/channels' },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-5xl mx-auto p-6">
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-2 mb-6 text-sm hover:opacity-80 transition-opacity"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={16} />
          Retour au catalogue
        </button>

        <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
          Paramètres
        </h1>

        <div className="flex gap-2 mb-6 border-b" style={{ borderColor: 'var(--bg-border)' }}>
          {TABS.map(tab => {
            const isActive = pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className="px-4 py-3 text-sm font-medium transition-colors relative"
                style={{
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'var(--accent)' }} />
                )}
              </Link>
            )
          })}
        </div>

        {children}
      </div>
    </div>
  )
}
