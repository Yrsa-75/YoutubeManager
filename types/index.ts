export interface Video {
  id: string
  youtube_id: string
  title: string
  description: string
  thumbnail_url: string
  published_at: string
  status: 'public' | 'private' | 'unlisted'
  duration: string
  tags: string[]
  category_id: string
  view_count: number
  like_count: number
  comment_count: number
  synced_at: string
  color_rule?: string
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
