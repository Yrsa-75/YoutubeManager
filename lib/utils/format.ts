import { formatDistanceToNow, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString('fr-FR')
}

export function formatDate(dateStr: string): string {
  try {
    const date = parseISO(dateStr)
    const diffDays = Math.abs(Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)
    // Au-dela de 7 jours (passe ou futur) : date reelle JJ/MM/AAAA.
    // En deca : format relatif ("il y a 3 jours", "dans 2 jours").
    if (diffDays > 7) {
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    }
    return formatDistanceToNow(date, { addSuffix: true, locale: fr })
  } catch {
    return dateStr
  }
}

export function formatDuration(iso8601: string): string {
  if (!iso8601) return '—'
  // Gère PT…H…M…S, le préfixe jours (P…DT…) et P0D (live sans durée -> tiret).
  const match = iso8601.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!match) return iso8601
  const days = parseInt(match[1] || '0', 10)
  const hours = parseInt(match[2] || '0', 10)
  const mins = parseInt(match[3] || '0', 10)
  const secs = parseInt(match[4] || '0', 10)
  const total = days * 86400 + hours * 3600 + mins * 60 + secs
  if (total === 0) return '—'
  const parts: string[] = []
  if (days) parts.push(days + 'j')
  if (hours) parts.push(hours + 'h')
  if (mins) parts.push(mins + 'm')
  if (secs) parts.push(secs + 's')
  return parts.join(' ')
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
