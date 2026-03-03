# YoutubeManager

Dashboard de gestion du catalogue YouTube — built with Next.js 14, Supabase, YouTube API & OpenAI.

## Stack
- **Next.js 14** (App Router)
- **Supabase** (base de données + auth tokens)
- **YouTube Data API v3 + Analytics API**
- **OpenAI GPT-4o-mini** (génération titres/descriptions)
- **TailwindCSS** (styling)

## Setup

### 1. Variables d'environnement
Copier `.env.example` en `.env.local` et remplir :
```
NEXTAUTH_URL=https://votre-app.vercel.app
NEXTAUTH_SECRET= # générer avec: openssl rand -base64 32
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
```

### 2. Base de données Supabase
Exécuter le fichier `supabase/migrations/001_initial.sql` dans l'éditeur SQL de Supabase.

### 3. Google Cloud Console
- Activer YouTube Data API v3
- Activer YouTube Analytics API
- Ajouter redirect URI : `https://votre-app.vercel.app/api/auth/callback/google`

### 4. Déploiement Vercel
```
vercel deploy
```

## Versioning
- `v0.1.0` — Structure initiale + auth YouTube + tableau vidéos
- `v0.2.0` — Colonnes dynamiques + filtres avancés
- `v0.3.0` — Import CSV + onglet pending
- `v0.4.0` — Moteur couleurs + règles configurables
- `v0.5.0` — Génération IA (titres + descriptions)
- `v1.0.0` — Version client production

## Architecture

```
app/
  api/           Routes API (YouTube sync, pending, color rules, AI)
  dashboard/     Page principale
components/
  layout/        Sidebar + TopBar
  videos/        Table YouTube + panneau détail
  pending/       Import CSV + table pending
  color-rules/   Éditeur de règles
lib/
  supabase/      Client Supabase
  utils/         format.ts, colorRules.ts
types/           Types TypeScript partagés
supabase/
  migrations/    SQL schema
```
