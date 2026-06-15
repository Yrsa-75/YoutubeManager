'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, KeyRound, Power, Copy, Shield, User as UserIcon, X, Loader2, RefreshCw, Lock } from 'lucide-react'

type Account = {
  id: string
  email: string
  role: 'superadmin' | 'user'
  is_active: boolean
  is_protected: boolean
  last_login_at: string | null
  created_at: string
}

function genPassword(): string {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 5; i++) s += c[Math.floor(Math.random() * c.length)]
  return 'Spica-' + s + '-' + Math.floor(10 + Math.random() * 89)
}

function formatDate(d: string | null): string {
  if (!d) return 'Jamais'
  try {
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

export default function ComptesPage() {
  const [users, setUsers] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [meEmail, setMeEmail] = useState('')

  // Ajout
  const [addOpen, setAddOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState(genPassword())
  const [newRole, setNewRole] = useState<'user' | 'superadmin'>('user')
  const [creating, setCreating] = useState(false)

  // Réinitialisation
  const [resetTarget, setResetTarget] = useState<Account | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetting, setResetting] = useState(false)

  // Dernier identifiant créé/réinitialisé (à transmettre)
  const [lastCred, setLastCred] = useState<{ email: string; password: string } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/users')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setUsers(data.users || [])
    } catch (e: any) {
      toast.error(e.message || 'Impossible de charger les comptes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    fetch('/api/gate/me')
      .then((r) => r.json())
      .then((d) => { if (d?.user?.email) setMeEmail(d.user.email) })
      .catch(() => {})
  }, [])

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Copié'),
      () => toast.error('Copie impossible')
    )
  }

  async function createAccount() {
    if (!newEmail.trim()) { toast.error('Renseigne un email.'); return }
    setCreating(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim(), password: newPassword, role: newRole }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      toast.success('Compte créé')
      setLastCred({ email: newEmail.trim().toLowerCase(), password: newPassword })
      setAddOpen(false)
      setNewEmail('')
      setNewPassword(genPassword())
      setNewRole('user')
      load()
    } catch (e: any) {
      toast.error(e.message || 'Création impossible')
    } finally {
      setCreating(false)
    }
  }

  async function doReset() {
    if (!resetTarget) return
    if (resetPassword.length < 6) { toast.error('Mot de passe trop court (6 min).'); return }
    setResetting(true)
    try {
      const res = await fetch('/api/admin/users/' + resetTarget.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      toast.success('Mot de passe réinitialisé')
      setLastCred({ email: resetTarget.email, password: resetPassword })
      setResetTarget(null)
      setResetPassword('')
    } catch (e: any) {
      toast.error(e.message || 'Réinitialisation impossible')
    } finally {
      setResetting(false)
    }
  }

  async function toggleActive(u: Account) {
    setBusyId(u.id)
    try {
      const res = await fetch('/api/admin/users/' + u.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !u.is_active }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      toast.success(u.is_active ? 'Compte désactivé' : 'Compte réactivé')
      load()
    } catch (e: any) {
      toast.error(e.message || 'Action impossible')
    } finally {
      setBusyId(null)
    }
  }

  const inputStyle = { background: 'var(--bg-primary)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }

  return (
    <div>
      {/* Bandeau dernier identifiant */}
      {lastCred && (
        <div className="mb-5 rounded-xl border p-4" style={{ background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.4)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                Identifiants à transmettre (affichés une seule fois)
              </div>
              <div className="text-sm font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                {lastCred.email} · <span style={{ color: 'var(--text-primary)' }}>{lastCred.password}</span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => copy(lastCred.email + ' / ' + lastCred.password)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border"
                style={{ borderColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}>
                <Copy size={12} /> Copier
              </button>
              <button onClick={() => setLastCred(null)}
                className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* En-tête */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Les comptes autorisés à accéder à la plateforme.
        </p>
        <button onClick={() => { setAddOpen(true); setNewPassword(genPassword()) }}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-white text-sm font-semibold hover:opacity-90 transition-opacity"
          style={{ background: 'var(--accent-red)' }}>
          <Plus size={15} /> Ajouter un compte
        </button>
      </div>

      {/* Formulaire d'ajout */}
      {addOpen && (
        <div className="mb-5 rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Nouveau compte</span>
            <button onClick={() => setAddOpen(false)} style={{ color: 'var(--text-muted)' }}><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Email</label>
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" placeholder="prenom.nom@…"
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Mot de passe</label>
              <div className="flex gap-2">
                <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="text"
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none font-mono" style={inputStyle} />
                <button onClick={() => setNewPassword(genPassword())} title="Générer"
                  className="px-2.5 rounded-lg border" style={{ borderColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}>
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <div className="flex gap-2">
              <button onClick={() => setNewRole('user')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border"
                style={{ background: newRole === 'user' ? 'var(--accent-red)' : 'transparent', color: newRole === 'user' ? '#fff' : 'var(--text-secondary)', borderColor: 'var(--bg-border)' }}>
                <UserIcon size={12} /> Utilisateur
              </button>
              <button onClick={() => setNewRole('superadmin')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border"
                style={{ background: newRole === 'superadmin' ? 'var(--accent-red)' : 'transparent', color: newRole === 'superadmin' ? '#fff' : 'var(--text-secondary)', borderColor: 'var(--bg-border)' }}>
                <Shield size={12} /> Super-admin
              </button>
            </div>
            <button onClick={createAccount} disabled={creating}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60"
              style={{ background: 'var(--accent-red)' }}>
              {creating ? <Loader2 size={14} className="animate-spin" /> : null}
              Créer le compte
            </button>
          </div>
        </div>
      )}

      {/* Tableau */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--bg-border)' }}>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin" size={22} style={{ color: 'var(--text-muted)' }} />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>Aucun compte.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th className="text-left font-medium px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>Email</th>
                <th className="text-left font-medium px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>Rôle</th>
                <th className="text-left font-medium px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>Statut</th>
                <th className="text-left font-medium px-4 py-2.5 hidden md:table-cell" style={{ color: 'var(--text-muted)' }}>Dernière connexion</th>
                <th className="text-right font-medium px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t" style={{ borderColor: 'var(--bg-border)' }}>
                  <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                    <span className="inline-flex items-center gap-1.5">
                      {u.email}
                      {u.is_protected && <Lock size={12} style={{ color: 'var(--text-muted)' }} />}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium"
                      style={u.role === 'superadmin'
                        ? { background: 'rgba(230,57,70,0.12)', color: 'var(--accent-red)' }
                        : { background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                      {u.role === 'superadmin' ? <Shield size={11} /> : <UserIcon size={11} />}
                      {u.role === 'superadmin' ? 'Super-admin' : 'Utilisateur'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs" style={{ color: u.is_active ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                      {u.is_active ? '● Actif' : '○ Désactivé'}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(u.last_login_at)}</td>
                  <td className="px-4 py-3">
                    {(u.is_protected && u.email !== meEmail) ? (
                      <div className="flex items-center justify-end">
                        <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <Lock size={12} /> Compte protégé
                        </span>
                      </div>
                    ) : (
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => { setResetTarget(u); setResetPassword(genPassword()) }}
                        title="Réinitialiser le mot de passe"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border hover:opacity-80"
                        style={{ borderColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}>
                        <KeyRound size={13} /> Mot de passe
                      </button>
                      <button onClick={() => toggleActive(u)} disabled={busyId === u.id}
                        title={u.is_active ? 'Désactiver' : 'Réactiver'}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border hover:opacity-80 disabled:opacity-50"
                        style={{ borderColor: u.is_active ? 'rgba(230,57,70,0.4)' : 'var(--bg-border)', color: u.is_active ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
                        {busyId === u.id ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                        {u.is_active ? 'Désactiver' : 'Réactiver'}
                      </button>
                    </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modale réinitialisation */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setResetTarget(null)}>
          <div className="w-full max-w-md rounded-2xl border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Réinitialiser le mot de passe</span>
              <button onClick={() => setResetTarget(null)} style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{resetTarget.email}</p>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Nouveau mot de passe</label>
            <div className="flex gap-2 mb-4">
              <input value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} type="text"
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none font-mono" style={inputStyle} />
              <button onClick={() => setResetPassword(genPassword())} title="Générer"
                className="px-2.5 rounded-lg border" style={{ borderColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}>
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setResetTarget(null)}
                className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}>
                Annuler
              </button>
              <button onClick={doReset} disabled={resetting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                style={{ background: 'var(--accent-red)' }}>
                {resetting ? <Loader2 size={14} className="animate-spin" /> : null}
                Réinitialiser
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
