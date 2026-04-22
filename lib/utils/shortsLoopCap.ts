// Cap les métriques YouTube pour les Shorts qui bouclent
// YouTube compte chaque replay dans le watch time, ce qui donne des % > 100%

export function parseISO8601DurationToSeconds(iso8601: string | null | undefined): number | null {
  if (!iso8601) return null
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return null
  const h = parseInt(match[1] || '0')
  const m = parseInt(match[2] || '0')
  const s = parseInt(match[3] || '0')
  return h * 3600 + m * 60 + s
}

export type CappedMetrics = {
  avgViewDuration: number | null
  avgViewPercentage: number | null
  isLooped: boolean
  rawAvgViewDuration: number | null
  rawAvgViewPercentage: number | null
}

// Renvoie les métriques cappées + infos sur la boucle
export function capShortsMetrics(
  duration: string | null | undefined,
  avgViewDuration: number | null | undefined,
  avgViewPercentage: number | null | undefined
): CappedMetrics {
  const durationSec = parseISO8601DurationToSeconds(duration)
  const rawAvgViewDuration = avgViewDuration ?? null
  const rawAvgViewPercentage = avgViewPercentage ?? null

  // Si on n'a pas de durée, pas de cap possible
  if (!durationSec) {
    return {
      avgViewDuration: rawAvgViewDuration,
      avgViewPercentage: rawAvgViewPercentage,
      isLooped: false,
      rawAvgViewDuration,
      rawAvgViewPercentage,
    }
  }

  // Tolérance : 110% car certains visionnages honnêtes peuvent légèrement dépasser
  // (fin de vidéo + un peu de re-lecture involontaire, buffering, etc.)
  const THRESHOLD = 110
  const isLooped = (rawAvgViewPercentage ?? 0) > THRESHOLD

  return {
    avgViewDuration: isLooped ? durationSec : rawAvgViewDuration,
    avgViewPercentage: isLooped ? 100 : rawAvgViewPercentage,
    isLooped,
    rawAvgViewDuration,
    rawAvgViewPercentage,
  }
}
