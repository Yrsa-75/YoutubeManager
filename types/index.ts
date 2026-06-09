export interface Video {
  id: string
  youtube_id: string
  title: string
  description: string
  thumbnail_url: string
  published_at: string
  // Vraie date d'upload (ajout à la playlist d'uploads YouTube).
  // Peut différer de published_at quand la publication a été programmée plus tard.
  uploaded_at?: string | null
  // Short YouTube ? TRUE = Short, FALSE = vidéo classique, NULL = pas encore classifié
  is_short?: boolean | null
  // Date de mise en ligne programmée (YouTube status.publishAt).
  // Renseignée uniquement pour les vidéos programmées (privées avec date de sortie). NULL sinon.
  scheduled_publish_at?: string | null
  status: 'public' | 'private' | 'unlisted'
  duration: string
  tags: string[]
  category_id: string
  view_count: number
  like_count: number
  comment_count: number
  synced_at: string
  color_rule?: string
  // Analytics fields
  estimated_minutes_watched?: number
  average_view_duration?: number
  average_view_percentage?: number
  subscribers_gained?: number
  subscribers_lost?: number
  shares?: number
  estimated_revenue?: number
  analytics_synced_at?: string
  // Playlists (joined from video_playlists)
  playlists?: { playlist_id: string; title: string }[]
}

export interface PendingVideo {
  id: string
  internal_id: string
  title: string
  description: string
  keywords: string
  category: string
  language: string
  status: 'pending' | 'in_progress' | 'ready' | 'validated'
  extra_data: Record<string, any>
  created_at: string
  updated_at: string
}

export interface ColorRule {
  id: string
  name: string
  color: string
  conditions: ColorCondition[]
  logic: 'AND' | 'OR'
  enabled: boolean
  priority: number
}

export interface ColorCondition {
  field: string
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'days_since'
  value: number | string
}

export interface ColumnConfig {
  id: string
  table_key: string
  key: string
  label: string
  enabled: boolean
  position: number
  source: 'data_api' | 'analytics_api' | 'custom'
  width?: number
}

export type TabType = 'uploaded' | 'pending' | 'rules'
