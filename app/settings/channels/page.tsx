'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Users, Crown, UserCheck, Trash2, X, Copy, Link as LinkIcon, Mail, Clock } from 'lucide-react'

type Channel = {
  channel_id: string
  title: string
  thumbnail_url?: string
  subscriber_count?: number
  video_count?: number
  access_role?: 'owner' | 'operator' | 'viewer'
  granted_by?: string | null
}

type Invite = {
  id: string
  invite_token: string
  channel_id: string
  channel_title: string | null
  invited_email: string
  invited_by_user_id: string
  requested_role: string
  status: string
  created_at: string
  expires_at: string
}

export default function ChannelsSettingsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [sentInvites, setSentInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)

  async function loadAll() {
    setLoading(true)
    try {
      const [chanRes, invRes] = await Promise.all([
        fetch('/api/youtube/channels').then(r => r.json()),
        fetch('/api/channels/invite?type=sent').then(r => r.json()),
      ])
      setChannels(chanRes.channels || [])
      setSentInvites((invRes.invites || []).filter((i: Invite) => i.status === 'pending'))
    } catch (e: any) {
      toast.error('Erreur chargement : ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Mes chaînes</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Gérer les chaînes auxquelles tu as accès et les invitations en attente.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          <Plus size={16} /> Ajouter une chaîne
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chargement...</div>
      ) : (
        <>
          {channels.length === 0 ? (
            <div className="text-center py-12 rounded-lg border-2 border-dashed" style={{ borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}>
              Aucune chaîne connectée. Clique sur « Ajouter une chaîne » pour commencer.
            </div>
          ) : (
            <div className="space-y-2">
              {channels.map(ch => (
                <ChannelRow key={ch.channel_id} channel={ch} onChange={loadAll} />
              ))}
            </div>
          )}

          {sentInvites.length > 0 && (
            <div className="mt-8">
              <h3 className="text-md font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                Invitations en attente ({sentInvites.length})
              </h3>
              <div className="space-y-2">
                {sentInvites.map(inv => <InviteRow key={inv.id} invite={inv} onChange={loadAll} />)}
              </div>
            </div>
          )}
        </>
      )}

      {showAddModal && <AddChannelModal onClose={() => { setShowAddModal(false); loadAll() }} />}
    </div>
  )
}

function ChannelRow({ channel, onChange }: { channel: Channel; onChange: () => void }) {
  const [showAccess, setShowAccess] = useState(false)
  return (
    <div className="border rounded-lg p-4 transition-colors" style={{ borderColor: 'var(--bg-border)', background: 'var(--bg-card)' }}>
      <div className="flex items-center gap-4">
        {channel.thumbnail_url ? (
          <img src={channel.thumbnail_url} alt={channel.title} className="w-12 h-12 rounded-full" />
        ) : (
          <div className="w-12 h-12 rounded-full" style={{ background: 'var(--bg-hover)' }} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{channel.title}</span>
            {channel.access_role === 'owner' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(250,204,21,0.15)', color: '#facc15' }}>
                <Crown size={12} /> Propriétaire
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>
                <UserCheck size={12} /> Opérateur
              </span>
            )}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {channel.subscriber_count ?? 0} abonnés · {channel.video_count ?? 0} vidéos
          </div>
        </div>
        {channel.access_role === 'owner' && (
          <button
            onClick={() => setShowAccess(v => !v)}
            className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
            style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
          >
            <Users size={14} className="inline mr-1" /> Gérer les accès
          </button>
        )}
      </div>
      {showAccess && <ChannelAccessManager channelId={channel.channel_id} onChange={onChange} />}
    </div>
  )
}

function ChannelAccessManager({ channelId, onChange }: { channelId: string; onChange: () => void }) {
  const [data, setData] = useState<{ accesses: any[]; pendingInvites: any[] } | null>(null)
  async function load() {
    const r = await fetch(`/api/channels/${channelId}/access`)
    const d = await r.json()
    if (r.ok) setData(d)
  }
  useEffect(() => { load() }, [channelId])

  async function revoke(userId: string) {
    if (!confirm('Révoquer cet accès ?')) return
    const r = await fetch(`/api/channels/${channelId}/access?userId=${userId}`, { method: 'DELETE' })
    if (r.ok) { toast.success('Accès révoqué'); load(); onChange() }
    else { const d = await r.json(); toast.error(d.error || 'Erreur') }
  }

  async function revokeInvite(inviteId: string) {
    if (!confirm('Révoquer cette invitation ?')) return
    const r = await fetch(`/api/channels/invites/${inviteId}`, { method: 'DELETE' })
    if (r.ok) { toast.success('Invitation révoquée'); load(); onChange() }
  }

  if (!data) return <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>Chargement...</div>
  return (
    <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--bg-border)' }}>
      <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Accès accordés :</div>
      {data.accesses.length === 0 ? (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucun</div>
      ) : (
        <div className="space-y-1">
          {data.accesses.map((a: any) => (
            <div key={a.user_id} className="flex items-center justify-between text-xs py-1">
              <span style={{ color: 'var(--text-primary)' }}>
                {a.role === 'owner' ? '👑' : '👤'} {a.user_id.substring(0, 12)}... <span style={{ color: 'var(--text-muted)' }}>({a.role})</span>
              </span>
              {a.role !== 'owner' && (
                <button onClick={() => revoke(a.user_id)} className="p-1 hover:opacity-80"><Trash2 size={12} /></button>
              )}
            </div>
          ))}
        </div>
      )}
      {data.pendingInvites.length > 0 && (
        <>
          <div className="text-xs font-semibold mt-3 mb-2" style={{ color: 'var(--text-secondary)' }}>Invitations en attente :</div>
          <div className="space-y-1">
            {data.pendingInvites.map((i: any) => (
              <div key={i.id} className="flex items-center justify-between text-xs py-1">
                <span style={{ color: 'var(--text-muted)' }}>⏳ {i.invited_email}</span>
                <button onClick={() => revokeInvite(i.id)} className="p-1 hover:opacity-80"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function InviteRow({ invite, onChange }: { invite: Invite; onChange: () => void }) {
  const [copied, setCopied] = useState(false)
  const inviteUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/invite/${invite.invite_token}`

  async function copyLink() {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    toast.success('Lien copié !')
    setTimeout(() => setCopied(false), 2000)
  }

  async function revoke() {
    if (!confirm('Révoquer cette invitation ?')) return
    const r = await fetch(`/api/channels/invites/${invite.id}`, { method: 'DELETE' })
    if (r.ok) { toast.success('Invitation révoquée'); onChange() }
  }

  return (
    <div className="border rounded-lg p-3 flex items-center gap-3" style={{ borderColor: 'var(--bg-border)', background: 'var(--bg-card)' }}>
      <Clock size={16} style={{ color: '#f59e0b' }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
          <Mail size={12} className="inline mr-1" /> {invite.invited_email}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Pour <strong>{invite.channel_title || invite.channel_id}</strong> · créée le {new Date(invite.created_at).toLocaleDateString('fr-FR')}
        </div>
      </div>
      <button onClick={copyLink} className="px-3 py-1.5 rounded text-xs flex items-center gap-1" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
        {copied ? <><LinkIcon size={12} /> Copié</> : <><Copy size={12} /> Copier le lien</>}
      </button>
      <button onClick={revoke} className="p-2 hover:opacity-80" title="Révoquer">
        <Trash2 size={14} style={{ color: 'var(--text-muted)' }} />
      </button>
    </div>
  )
}

function AddChannelModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'choose' | 'owner' | 'delegate'>('choose')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-xl w-full max-w-lg p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Ajouter une chaîne</h3>
          <button onClick={onClose} className="p-1"><X size={18} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        {mode === 'choose' && (
          <div className="space-y-3">
            <button
              onClick={() => setMode('owner')}
              className="w-full text-left border rounded-lg p-4 hover:opacity-90 transition"
              style={{ borderColor: 'var(--bg-border)', background: 'var(--bg-hover)' }}
            >
              <div className="flex items-center gap-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                <Crown size={16} style={{ color: '#facc15' }} /> Je suis propriétaire
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Connecter une chaîne dont je suis propriétaire direct du compte Google.
              </div>
            </button>
            <button
              onClick={() => setMode('delegate')}
              className="w-full text-left border rounded-lg p-4 hover:opacity-90 transition"
              style={{ borderColor: 'var(--bg-border)', background: 'var(--bg-hover)' }}
            >
              <div className="flex items-center gap-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                <UserCheck size={16} style={{ color: '#3b82f6' }} /> Je suis gestionnaire
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Demander au propriétaire d autoriser mon accès aux analytics.
              </div>
            </button>
          </div>
        )}
        {mode === 'owner' && <OwnerConnectFlow onClose={onClose} onBack={() => setMode('choose')} />}
        {mode === 'delegate' && <DelegateInviteFlow onClose={onClose} onBack={() => setMode('choose')} />}
      </div>
    </div>
  )
}

function OwnerConnectFlow({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const [busy, setBusy] = useState(false)
  async function sync() {
    setBusy(true)
    try {
      const r = await fetch('/api/youtube/channels', { method: 'POST' })
      const d = await r.json()
      if (r.ok) { toast.success(`${d.count || 0} chaîne(s) importée(s)`); onClose() }
      else toast.error(d.error || 'Erreur')
    } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Cliquer sur « Importer » va récupérer toutes les chaînes Google auxquelles tu es connecté(e). Si tu veux ajouter une autre chaîne, reconnecte-toi d abord avec le compte Google qui la possède.
      </p>
      <div className="flex gap-2 mt-4">
        <button onClick={onBack} className="px-4 py-2 rounded text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>Retour</button>
        <button onClick={sync} disabled={busy} className="px-4 py-2 rounded text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
          {busy ? 'Import...' : 'Importer mes chaînes'}
        </button>
      </div>
    </div>
  )
}

function DelegateInviteFlow({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const [channelId, setChannelId] = useState('')
  const [channelTitle, setChannelTitle] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  async function submit() {
    if (!channelId || !ownerEmail) return toast.error('ID de la chaîne et email requis')
    setBusy(true)
    try {
      const r = await fetch('/api/channels/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, channelTitle, ownerEmail }),
      })
      const d = await r.json()
      if (r.ok) {
        const url = `${window.location.origin}/invite/${d.inviteToken}`
        setInviteUrl(url)
        toast.success(d.alreadyPending ? 'Invitation déjà existante' : 'Invitation créée')
      } else toast.error(d.error || 'Erreur')
    } finally { setBusy(false) }
  }

  if (inviteUrl) {
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Envoie ce lien au propriétaire. Il devra se connecter avec son compte Google (celui qui possède la chaîne) pour accepter.
        </p>
        <div className="p-3 rounded border text-xs break-all" style={{ background: 'var(--bg-hover)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }}>
          {inviteUrl}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success('Copié !') }}
            className="flex-1 px-4 py-2 rounded text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
          >
            <Copy size={14} className="inline mr-1" /> Copier
          </button>
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
            Terminer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Renseigne l ID YouTube de la chaîne (format UC...) et l email du propriétaire. Un lien sécurisé sera généré que tu pourras lui envoyer.
      </p>
      <div>
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>ID de la chaîne (commence par UC)</label>
        <input type="text" value={channelId} onChange={e => setChannelId(e.target.value.trim())} placeholder="UCxxxxxxxxxxxxxxxxxxxxxxxx"
          className="w-full mt-1 px-3 py-2 rounded border text-sm" style={{ background: 'var(--bg-primary)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }} />
      </div>
      <div>
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Nom de la chaîne (optionnel)</label>
        <input type="text" value={channelTitle} onChange={e => setChannelTitle(e.target.value)} placeholder="Ex: Découverte & Evasion"
          className="w-full mt-1 px-3 py-2 rounded border text-sm" style={{ background: 'var(--bg-primary)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }} />
      </div>
      <div>
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Email du propriétaire Google</label>
        <input type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value.trim())} placeholder="exemple@domaine.com"
          className="w-full mt-1 px-3 py-2 rounded border text-sm" style={{ background: 'var(--bg-primary)', borderColor: 'var(--bg-border)', color: 'var(--text-primary)' }} />
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={onBack} className="px-4 py-2 rounded text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>Retour</button>
        <button onClick={submit} disabled={busy} className="flex-1 px-4 py-2 rounded text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
          {busy ? 'Création...' : 'Créer le lien d invitation'}
        </button>
      </div>
    </div>
  )
}
