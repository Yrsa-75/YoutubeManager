'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Lock } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit() {
    setError(null)
    if (!email || !password) {
      setError('Renseigne ton email et ton mot de passe.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/gate/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        setError(data.error || 'Connexion impossible.')
        setLoading(false)
        return
      }
      const next = new URLSearchParams(window.location.search).get('next')
      router.push(next && next.startsWith('/') ? next : '/dashboard')
    } catch {
      setError('Connexion impossible. Réessaie.')
      setLoading(false)
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit()
  }

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-4"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div
        className="w-full max-w-[360px] rounded-2xl border p-7"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}
      >
        {/* En-tête */}
        <div className="flex flex-col items-center text-center mb-6">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
            style={{ background: 'var(--accent-red)' }}
          >
            <Lock size={22} color="#fff" />
          </div>
          <h1
            className="font-bold uppercase tracking-[0.15em]"
            style={{ color: 'var(--text-primary)', fontSize: 20 }}
          >
            KAIROS
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Accès réservé
          </p>
        </div>

        {/* Champs */}
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
          Email
        </label>
        <input
          type="email"
          autoFocus
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={onKey}
          placeholder="prenom.nom@spicaprod.fr"
          className="w-full mb-4 px-3 py-2.5 rounded-lg border text-sm outline-none"
          style={{ background: 'var(--bg-primary)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }}
        />

        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
          Mot de passe
        </label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={onKey}
          placeholder="••••••••"
          className="w-full mb-4 px-3 py-2.5 rounded-lg border text-sm outline-none"
          style={{ background: 'var(--bg-primary)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }}
        />

        {error && (
          <div
            className="mb-4 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(230,57,70,0.10)', color: 'var(--accent-red)' }}
          >
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-white font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: 'var(--accent-red)' }}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : null}
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>
      </div>

      <p className="text-[11px] mt-5" style={{ color: 'var(--text-muted)' }}>
        Espace privé SPICA — accès sur invitation uniquement
      </p>
    </div>
  )
}
