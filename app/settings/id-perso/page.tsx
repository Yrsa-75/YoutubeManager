'use client'
import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { Upload, FileSpreadsheet, Check, Loader2, AlertTriangle, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'

type Pair = { youtube_id: string; custom_id: string }
type Parsed = { fileName: string; totalRows: number; pairs: Pair[] }
type Preview = { matched: number; ignored: number }

// Entêtes acceptées (comparaison insensible à la casse et aux espaces).
const VIDEO_ID_HEADERS = ['video id', 'videoid', 'id video', 'id youtube', 'youtube id']
const CUSTOM_ID_HEADERS = ['custom id', 'customid', 'id perso', 'custom_id']

const norm = (s: string) => s.trim().toLowerCase()
const fr = (n: number) => n.toLocaleString('fr-FR')

function findKey(headers: string[], candidates: string[]): string | null {
  for (const h of headers) if (candidates.includes(norm(h))) return h
  return null
}

// Transforme les lignes brutes du fichier en paires { youtube_id, custom_id }.
function extractPairs(rows: any[]): { pairs: Pair[]; total: number; error?: string } {
  if (!rows || rows.length === 0) return { pairs: [], total: 0, error: 'Le fichier ne contient aucune ligne.' }
  const headers = Object.keys(rows[0] || {})
  const vidKey = findKey(headers, VIDEO_ID_HEADERS)
  const cidKey = findKey(headers, CUSTOM_ID_HEADERS)
  if (!vidKey || !cidKey) {
    return {
      pairs: [],
      total: rows.length,
      error: `Colonnes « Video ID » et « Custom ID » introuvables. Colonnes détectées dans le fichier : ${headers.join(', ') || 'aucune'}.`,
    }
  }
  const pairs: Pair[] = []
  for (const r of rows) {
    const yid = r[vidKey] != null ? String(r[vidKey]).trim() : ''
    const cid = r[cidKey] != null ? String(r[cidKey]).trim() : ''
    if (yid) pairs.push({ youtube_id: yid, custom_id: cid })
  }
  return { pairs, total: rows.length }
}

async function callImport(pairs: Pair[], dryRun: boolean) {
  const res = await fetch('/api/admin/import-custom-ids', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairs, dryRun }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Erreur serveur')
  return data as { dryRun: boolean; matched: number; ignored: number; updated: number }
}

export default function IdPersoPage() {
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<null | 'reading' | 'previewing' | 'importing'>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  function reset() {
    setParsed(null)
    setPreview(null)
    setError(null)
    setDone(null)
    setBusy(null)
  }

  async function runPreview(pairs: Pair[]) {
    setBusy('previewing')
    try {
      const r = await callImport(pairs, true)
      setPreview({ matched: r.matched, ignored: r.ignored })
    } catch (e: any) {
      setError(e.message || 'Impossible de calculer l\u2019aperçu.')
    } finally {
      setBusy(null)
    }
  }

  const handleRows = useCallback((rows: any[], fileName: string) => {
    const { pairs, total, error: err } = extractPairs(rows)
    if (err) {
      setError(err)
      setParsed({ fileName, totalRows: total, pairs: [] })
      return
    }
    setError(null)
    setDone(null)
    setParsed({ fileName, totalRows: total, pairs })
    runPreview(pairs)
  }, [])

  const onDrop = useCallback((accepted: File[]) => {
    const file = accepted[0]
    if (!file) return
    reset()
    setBusy('reading')
    try {
      if (file.name.toLowerCase().endsWith('.csv')) {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (result) => {
            setBusy(null)
            handleRows(result.data as any[], file.name)
          },
          error: () => {
            setBusy(null)
            setError('Lecture du CSV impossible.')
          },
        })
      } else {
        const reader = new FileReader()
        reader.onload = (e) => {
          try {
            const wb = XLSX.read(e.target?.result, { type: 'binary' })
            const ws = wb.Sheets[wb.SheetNames[0]]
            const data = XLSX.utils.sheet_to_json(ws)
            setBusy(null)
            handleRows(data as any[], file.name)
          } catch {
            setBusy(null)
            setError('Lecture du fichier Excel impossible.')
          }
        }
        reader.onerror = () => { setBusy(null); setError('Lecture du fichier impossible.') }
        reader.readAsBinaryString(file)
      }
    } catch {
      setBusy(null)
      setError('Lecture du fichier impossible.')
    }
  }, [handleRows])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
  })

  async function doImport() {
    if (!parsed || parsed.pairs.length === 0) return
    setBusy('importing')
    try {
      const r = await callImport(parsed.pairs, false)
      setDone(r.updated)
      toast.success(`${fr(r.updated)} vidéo${r.updated > 1 ? 's' : ''} mise${r.updated > 1 ? 's' : ''} à jour`)
    } catch (e: any) {
      toast.error('Erreur import : ' + (e.message || 'inconnue'))
    } finally {
      setBusy(null)
    }
  }

  const canImport = parsed && parsed.pairs.length > 0 && !error && busy === null && done === null

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Import ID Perso</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Dépose l&apos;export Excel Watch4. Les colonnes <b>Video ID</b> et <b>Custom ID</b> sont détectées automatiquement.
          L&apos;ID Perso est mis à jour par correspondance d&apos;ID YouTube ; les lignes hors base sont ignorées, et rien
          n&apos;est effacé pour les vidéos absentes du fichier.
        </p>
      </div>

      {/* Zone de dépôt (tant qu'aucun fichier lu) */}
      {!parsed && (
        <div
          {...getRootProps()}
          className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all"
          style={{
            borderColor: isDragActive ? 'var(--accent-red)' : 'var(--bg-border)',
            background: isDragActive ? 'rgba(230,57,70,0.05)' : 'transparent',
          }}
        >
          <input {...getInputProps()} />
          {busy === 'reading' ? (
            <Loader2 size={22} className="animate-spin" style={{ margin: '0 auto 10px', color: 'var(--accent-red)' }} />
          ) : (
            <Upload size={22} style={{ margin: '0 auto 10px', color: 'var(--text-muted)', opacity: 0.6 }} />
          )}
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            {busy === 'reading'
              ? 'Lecture du fichier…'
              : isDragActive
                ? 'Dépose le fichier ici'
                : 'Glisse ton fichier Excel Watch4, ou clique pour le sélectionner'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Formats acceptés : XLSX, XLS, CSV</p>
        </div>
      )}

      {/* Récapitulatif fichier + aperçu + action */}
      {parsed && (
        <div className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <FileSpreadsheet size={16} style={{ color: 'var(--text-muted)' }} />
            <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{parsed.fileName}</span>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>{fr(parsed.totalRows)} lignes lues</span>
          </div>

          {/* Erreur de colonnes / lecture */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg p-3 text-sm mb-3" style={{ background: 'rgba(230,57,70,0.08)', color: 'var(--accent-red)' }}>
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Aperçu en cours */}
          {busy === 'previewing' && (
            <div className="flex items-center gap-2 text-sm py-2" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={15} className="animate-spin" /> Calcul de l&apos;aperçu sur la base…
            </div>
          )}

          {/* Résultat de l'aperçu */}
          {preview && !error && done === null && (
            <div className="space-y-1.5 mb-4">
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#22c55e' }} />
                <b>{fr(preview.matched)}</b>&nbsp;vidéo{preview.matched > 1 ? 's' : ''} seront mises à jour
              </div>
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--text-muted)' }} />
                <b>{fr(preview.ignored)}</b>&nbsp;ligne{preview.ignored > 1 ? 's' : ''} ignorée{preview.ignored > 1 ? 's' : ''} (hors base ou erreurs)
              </div>
            </div>
          )}

          {/* Confirmation post-import */}
          {done !== null && (
            <div className="flex items-start gap-2 rounded-lg p-3 text-sm mb-4" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
              <Check size={16} className="shrink-0 mt-0.5" />
              <span>Import terminé : <b>{fr(done)}</b> vidéo{done > 1 ? 's' : ''} mise{done > 1 ? 's' : ''} à jour. L&apos;ID Perso apparaît dans le tableau du catalogue.</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button
              onClick={reset}
              className="text-sm px-3 py-1.5 rounded-lg border flex items-center gap-1.5"
              style={{ borderColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}
            >
              {done !== null ? (<><RotateCcw size={13} /> Importer un autre fichier</>) : 'Annuler'}
            </button>
            {done === null && (
              <button
                onClick={doImport}
                disabled={!canImport}
                className="text-sm px-4 py-1.5 rounded-lg font-semibold flex items-center gap-1.5"
                style={{ background: canImport ? 'var(--accent-red)' : 'var(--bg-border)', color: 'white', opacity: canImport ? 1 : 0.6, cursor: canImport ? 'pointer' : 'not-allowed' }}
              >
                {busy === 'importing' ? (<><Loader2 size={13} className="animate-spin" /> Import…</>) : (<><Check size={13} /> Importer</>)}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
