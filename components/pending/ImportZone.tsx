'use client'
import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { Upload, Check } from 'lucide-react'
import toast from 'react-hot-toast'

interface Props { onImport: () => void }

export default function ImportZone({ onImport }: Props) {
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<{ headers: string[]; rows: any[]; raw: any[] } | null>(null)

  const onDrop = useCallback((accepted: File[]) => {
    const file = accepted[0]
    if (!file) return

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          const rows = result.data as any[]
          const headers = result.meta.fields || []
          setPreview({ headers, rows: rows.slice(0, 3), raw: rows })
        }
      })
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws)
        const headers = Object.keys((data[0] as any) || {})
        setPreview({ headers, rows: (data as any[]).slice(0, 3), raw: data as any[] })
      }
      reader.readAsBinaryString(file)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'text/csv': ['.csv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'] }
  })

  async function confirmImport() {
    if (!preview) return
    setImporting(true)
    try {
      const res = await fetch('/api/pending-videos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos: preview.raw }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`${data.imported} vidéos importées !`)
      setPreview(null)
      onImport()
    } catch (e: any) {
      toast.error('Erreur import : ' + e.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="px-5 pt-4 pb-2 border-b shrink-0" style={{ borderColor: 'var(--bg-border)' }}>
      {!preview ? (
        <div {...getRootProps()} className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all"
          style={{ borderColor: isDragActive ? 'var(--accent-red)' : 'var(--bg-border)', background: isDragActive ? 'rgba(230,57,70,0.05)' : 'transparent' }}>
          <input {...getInputProps()} />
          <Upload size={20} style={{ margin: '0 auto 8px', color: 'var(--text-muted)', opacity: 0.5 }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            {isDragActive ? 'Déposez votre fichier ici' : 'Glissez un CSV ou Excel, ou cliquez pour sélectionner'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Colonnes détectées automatiquement · CSV, XLS, XLSX</p>
        </div>
      ) : (
        <div className="rounded-xl border p-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--bg-border)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Aperçu — {preview.raw.length} lignes détectées
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPreview(null)} className="text-xs px-3 py-1 rounded border" style={{ borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}>Annuler</button>
              <button onClick={confirmImport} disabled={importing}
                className="text-xs px-3 py-1 rounded flex items-center gap-1 font-semibold"
                style={{ background: 'var(--accent-red)', color: 'white' }}>
                <Check size={11} /> {importing ? 'Import...' : 'Confirmer'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr>{preview.headers.map(h => <th key={h} className="px-2 py-1 text-left font-semibold" style={{ color: 'var(--text-muted)', fontSize: 10 }}>{h}</th>)}</tr></thead>
              <tbody>{preview.rows.map((row, i) => (
                <tr key={i}>{preview.headers.map(h => <td key={h} className="px-2 py-1 max-w-[150px] truncate" style={{ color: 'var(--text-secondary)' }}>{String(row[h] || '')}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
