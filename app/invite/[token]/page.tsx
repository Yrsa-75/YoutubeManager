'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { signIn, useSession } from 'next-auth/react'
import toast from 'react-hot-toast'
import { Check, X, Crown, ArrowRight } from 'lucide-react'

export default function InviteAcceptPage() {
  const params = useParams()
  const router = useRouter()
  const { data: session, status } = useSession()
  const token = params?.token as string

  const [invite, setInvite] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function load() {
    try {
      const r = await fetch(`/api/invite/${token}`)
      const d = await r.json()
      if (!r.ok) setError(d.error || 'Invitation introuvable')
      else if (d.disallowed) setError(d.disallowed)
      else setInvite(d.invite)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (token) load() }, [token])

  async function accept() {
    if (!session) { signIn('google'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/invite/${token}`, { method: 'POST' })
      const d = await r.json()
      if (r.ok) setSuccess(d.message)
      else toast.error(d.error || 'Erreur')
    } finally { setBusy(false) }
  }

  async function decline() {
    if (!confirm('Décliner cette invitation ?')) return
    setBusy(true)
    try {
      const r = await fetch(`/api/invite/${token}`, { method: 'DELETE' })
      const d = await r.json()
      if (r.ok) { toast.success('Invitation déclinée'); router.push('/') }
      else toast.error(d.error || 'Erreur')
    } finally { setBusy(false) }
  }

  if (loading || status === 'loading') return <div className="min-h-screen flex items-center justify-center">Chargement...</div>

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-md w-full rounded-xl p-6 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
        <div className="flex items-center gap-2 mb-4">
          <img src="/kairos-logo.png" alt="KAIROS" className="w-8 h-8" />
          <span className="font-bold tracking-wider" style={{ color: 'var(--text-primary)' }}>KAIROS</span>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="p-4 rounded-lg text-center" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
              <Check size={32} className="mx-auto mb-2" style={{ color: '#22c55e' }} />
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{success}</p>
            </div>
            <button onClick={() => router.push('/dashboard')} className="w-full px-4 py-2 rounded text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
              Accéder à KAIROS <ArrowRight size={14} className="inline ml-1" />
            </button>
          </div>
        ) : error ? (
          <div className="p-4 rounded-lg text-center" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <X size={32} className="mx-auto mb-2" style={{ color: '#ef4444' }} />
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{error}</p>
          </div>
        ) : invite ? (
          <>
            <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Demande d accès à votre chaîne YouTube</h1>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              <strong>{invite.invited_by_name || 'Un utilisateur KAIROS'}</strong> souhaite pouvoir analyser les statistiques de votre chaîne <strong>{invite.channel_title || invite.channel_id}</strong> dans KAIROS.
            </p>
            <div className="rounded-lg p-3 text-xs mb-4" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
              <Crown size={12} className="inline mr-1" style={{ color: '#facc15' }} />
              Pour accepter, connectez-vous avec le compte Google qui possède cette chaîne (<strong>{invite.invited_email}</strong>).
              Votre token OAuth sera utilisé uniquement pour récupérer les Analytics. Vous pouvez révoquer cet accès à tout moment.
            </div>
            {!session ? (
              <button onClick={() => signIn('google')} className="w-full px-4 py-2 rounded text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
                Se connecter avec Google
              </button>
            ) : (
              <div className="space-y-2">
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Connecté en tant que {session.user?.email}</div>
                <div className="flex gap-2">
                  <button onClick={decline} disabled={busy} className="flex-1 px-4 py-2 rounded text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>Décliner</button>
                  <button onClick={accept} disabled={busy} className="flex-1 px-4 py-2 rounded text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
                    {busy ? 'Acceptation...' : 'Accepter'}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
