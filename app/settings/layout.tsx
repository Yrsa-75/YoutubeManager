'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'

const TABS = [
  { id: 'channels', label: 'Chaînes', href: '/settings/channels' },
  { id: 'comptes', label: 'Comptes', href: '/settings/comptes' },
  { id: 'id-perso', label: 'ID Perso', href: '/settings/id-perso' },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  // Espace Paramètres réservé aux super-admins.
  // Un utilisateur simple qui tape l'URL directement est renvoyé au catalogue.
  useEffect(() => {
    fetch('/api/gate/me')
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.role === 'superadmin') {
          setAllowed(true)
        } else {
          setAllowed(false)
          router.replace('/dashboard')
        }
      })
      .catch(() => {
        setAllowed(false)
        router.replace('/dashboard')
      })
  }, [router])

  if (allowed !== true) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg-primary)' }}>
        <Loader2 className="animate-spin" size={28} style={{ color: 'var(--accent-red)' }} />
      </div>
    )
  }

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
                  color: isActive ? 'var(--accent-red)' : 'var(--text-secondary)',
                }}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'var(--accent-red)' }} />
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
