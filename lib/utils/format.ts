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
  if (!iso8601) return '\u2014'
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return iso8601
  const h = match[1] ? match[1] + 'h' : ''
  const m = match[2] ? match[2] + 'm' : ''
  const s = match[3] ? match[3] + 's' : ''
  return [h, m, s].filter(Boolean).join(' ') || '0s'
}

// Format seconds to mm:ss or hh:mm:ss
export function formatViewDuration(seconds: number | undefined | null): string {
  if (!seconds && seconds !== 0) return '\u2014'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
  return m + ':' + String(s).padStart(2, '0')
}

export function formatPercentage(val: number | undefined | null): string {
  if (!val && val !== 0) return '\u2014'
  return val.toFixed(1) + '%'
}

export function formatMinutes(minutes: number | undefined | null): string {
  if (!minutes && minutes !== 0) return '\u2014'
  if (minutes >= 1440) return (minutes / 1440).toFixed(1) + 'j'
  if (minutes >= 60) return (minutes / 60).toFixed(1) + 'h'
  return Math.round(minutes) + 'min'
}
