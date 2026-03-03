import { formatDistanceToNow, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString('fr-FR')
}

export function formatDate(dateStr: string): string {
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true, locale: fr })
  } catch {
    return dateStr
  }
}

export function formatDuration(iso8601: string): string {
  if (!iso8601) return '—'
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return iso8601
  const h = match[1] ? `${match[1]}h` : ''
  const m = match[2] ? `${match[2]}m` : ''
  const s = match[3] ? `${match[3]}s` : ''
  return [h, m, s].filter(Boolean).join(' ') || '0s'
}
