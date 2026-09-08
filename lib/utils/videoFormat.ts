// ---------------------------------------------------------------------------
// FORMAT EFFECTIF D'UNE VIDEO (Short / Video classique / Short probable)
// ---------------------------------------------------------------------------
// La classification Shorts (is_short) est asynchrone : le cron classify-shorts
// remplit la colonne apres coup. Tant qu'une video n'est pas classee
// (is_short = NULL), on ne veut pas la ranger arbitrairement dans "Videos".
//
// Regle : une video non classee dont la duree est comprise entre 1 s et
// SHORT_MAX_SECONDS est un "Short probable" (les Shorts durent au plus 3 min).
// Elle est comptee cote Shorts dans les filtres et affichee avec un badge
// "Short ?" tant que la verification n'a pas confirme.
//
// Cette constante DOIT rester alignee avec la borne utilisee dans la fonction
// SQL preclassify_shorts (183 s = 3 min + marge d'arrondi YouTube).
// ---------------------------------------------------------------------------

export const SHORT_MAX_SECONDS = 183

export type EffectiveFormat = 'short' | 'video' | 'probable_short' | 'unknown'

type FormatSource = { is_short?: boolean | null; duration_seconds?: number | null }

export function getEffectiveFormat(v: FormatSource): EffectiveFormat {
  if (v.is_short === true) return 'short'
  if (v.is_short === false) return 'video'
  const d = v.duration_seconds
  if (typeof d === 'number' && d > 0 && d <= SHORT_MAX_SECONDS) return 'probable_short'
  return 'unknown'
}

// Libelle export / affichage texte
export function formatLabel(f: EffectiveFormat): string {
  switch (f) {
    case 'short': return 'Short'
    case 'video': return 'Vidéo'
    case 'probable_short': return 'Short (probable)'
    default: return 'À classifier'
  }
}

// Filtres PostgREST (syntaxe .or()) equivalents cote serveur.
//  - format=short : Shorts confirmes + Shorts probables
//  - format=video : Videos confirmees + non classees hors plage Short (durees
//    absentes, nulles ou > 3 min, normalement deja traitees par preclassify)
export const PG_FILTER_SHORT =
  `is_short.eq.true,and(is_short.is.null,duration_seconds.gt.0,duration_seconds.lte.${SHORT_MAX_SECONDS})`
export const PG_FILTER_VIDEO =
  `is_short.eq.false,and(is_short.is.null,or(duration_seconds.is.null,duration_seconds.lte.0,duration_seconds.gt.${SHORT_MAX_SECONDS}))`
