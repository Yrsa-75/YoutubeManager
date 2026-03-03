-- YoutubeManager - Schema initial
-- v0.1.0

-- Table des vidéos YouTube synchronisées
CREATE TABLE IF NOT EXISTS videos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  youtube_id TEXT UNIQUE NOT NULL,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ,
  status TEXT DEFAULT 'public',
  duration TEXT,
  tags TEXT[],
  category_id TEXT,
  view_count BIGINT DEFAULT 0,
  like_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_youtube_id ON videos(youtube_id);
CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_view_count ON videos(view_count DESC);

-- Table des vidéos en attente (import CSV)
CREATE TABLE IF NOT EXISTS pending_videos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  internal_id TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  keywords TEXT,
  category TEXT,
  language TEXT DEFAULT 'fr',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'ready', 'validated')),
  extra_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_videos(status);

-- Table des tokens OAuth (stockage sécurisé)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at BIGINT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: Bloquer tout accès public (sécurité)
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON oauth_tokens USING (false);

-- Table des règles de couleur
CREATE TABLE IF NOT EXISTS color_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '[]',
  logic TEXT DEFAULT 'AND' CHECK (logic IN ('AND', 'OR')),
  enabled BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Règles par défaut
INSERT INTO color_rules (name, color, conditions, logic, enabled, priority) VALUES
  ('Inactive', '#ef4444', '[{"field":"days_since_upload","operator":"gte","value":180},{"field":"view_count","operator":"lt","value":10000}]', 'AND', true, 0),
  ('Vieillissante', '#f97316', '[{"field":"days_since_upload","operator":"gte","value":180}]', 'AND', true, 1),
  ('Performante', '#22c55e', '[{"field":"view_count","operator":"gt","value":100000}]', 'AND', true, 2)
ON CONFLICT DO NOTHING;

-- Table de configuration des colonnes
CREATE TABLE IF NOT EXISTS column_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  table_key TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  position INTEGER DEFAULT 0,
  source TEXT DEFAULT 'data_api',
  width INTEGER
);

-- Table des logs de synchronisation
CREATE TABLE IF NOT EXISTS sync_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  videos_synced INTEGER DEFAULT 0,
  status TEXT DEFAULT 'success',
  error_message TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
