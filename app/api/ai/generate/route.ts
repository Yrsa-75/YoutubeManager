import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const LANG_LABELS: Record<string, string> = {
  fr: 'français',
  en: 'English',
  es: 'español',
  de: 'Deutsch',
}

// Nouveau prompt de reformulation de titres (fourni par le client).
// {count} et {lang} sont injectés dynamiquement.
function buildTitlesSystemPrompt(count: number, lang: string): string {
  return `Tu es un assistant de reformulation de titres YouTube.
Ta mission unique est de reformuler le titre fourni, rien d'autre.
Tu ne proposes jamais d'idée vidéo, miniature, description, tags, hashtags, plan ou analyse.
Tu ne fais aucune recherche extérieure et n'utilises aucune information hors du titre.
Tu produis exactement ${count} reformulations par titre fourni.
Tu réponds uniquement avec une liste numérotée de 1 à ${count}.
Chaque ligne contient uniquement un titre reformulé, sans explication.
Tu rédiges les reformulations en ${lang}.
Tu conserves le sujet, le sens, le ton et la promesse exacte du titre original.
Tu n'inventes jamais de chiffre, date, lieu, nom, événement, secret, danger ou conséquence.
Tu gardes les noms propres et chiffres déjà présents s'ils sont utiles au sens.
Tu n'ajoutes aucun nouveau chiffre ni détail absent du titre source.
Chaque reformulation doit porter une seule idée claire.
Un titre = une idée forte, pas deux angles ou deux promesses mélangés.
Chaque titre doit rester compréhensible sans contexte extérieur.
Vise 40 à 70 caractères quand c'est naturel, idéalement 55 à 70.
Les 3 à 4 premiers mots doivent porter l'accroche principale.
Le titre doit accrocher fort, mais jamais par du sensationnalisme.
Le choc vient de la tension, du concret, du contraste ou de la bascule.
Chaque titre doit ouvrir une question sans tout révéler.
Il doit vendre une idée, une projection ou un fantasme simple.
Évite les titres plats, refermés ou purement descriptifs.
Évite les titres catalogue : "tout savoir sur", "portrait de", "plongée dans", "retour sur".
Ne rends pas un titre plus négatif qu'il ne l'est.
N'ajoute pas peur, horreur, drame, mort, scandale ou danger absent du titre source.
Cherche la curiosité ailleurs : secret, face cachée, paradoxe, enjeu, détail qui détonne.
Tu peux déplacer, simplifier, condenser ou rendre la phrase plus naturelle.
Tu évites "…", "!", parenthèses, crochets et emojis sauf s'ils existent déjà.
Varie les ${count} propositions : directe, curieuse, immersive, tendue, naturelle.
Si le titre source est pauvre, reformule sans combler les informations manquantes.`
}

// --- Appel OpenAI (GPT-5.5) -------------------------------------------------
async function callOpenAI(system: string, user: string): Promise<{ ok: boolean; result?: string; error?: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { ok: false, error: 'OPENAI_API_KEY non configurée' }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-5.5',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        // Les modèles 5.x utilisent max_completion_tokens (et imposent la température par défaut)
        max_completion_tokens: 1200,
      }),
    })
    const d = await r.json()
    if (!r.ok) return { ok: false, error: d.error?.message || `OpenAI HTTP ${r.status}` }
    const result = d.choices?.[0]?.message?.content?.trim() || ''
    return { ok: true, result }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

// --- Appel Anthropic (Claude Opus 4.8) --------------------------------------
async function callClaude(system: string, user: string): Promise<{ ok: boolean; result?: string; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY non configurée (à ajouter dans Vercel)' }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    const d = await r.json()
    if (!r.ok) return { ok: false, error: d.error?.message || `Anthropic HTTP ${r.status}` }
    const result = (Array.isArray(d.content) ? d.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : '').trim()
    return { ok: true, result }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { type, videoTitle, videoDescription, keywords, hint, count, language } = await req.json()
    if (!type || !videoTitle) {
      return NextResponse.json({ error: 'Missing type or videoTitle' }, { status: 400 })
    }

    const lang = LANG_LABELS[language] || LANG_LABELS['fr']
    const titleCount = count || 3

    let systemPrompt: string
    let userPrompt: string

    if (type === 'titles') {
      systemPrompt = buildTitlesSystemPrompt(titleCount, lang)
      userPrompt = `Titre original : "${videoTitle}"\n${keywords ? `Mots-clés présents : ${keywords}\n` : ''}${hint ? `Indications supplémentaires : ${hint}\n` : ''}\nReformule ce titre en ${titleCount} propositions, en ${lang}.`
    } else {
      systemPrompt = `Tu es un expert SEO YouTube. Rédige une description vidéo optimisée en ${lang}. La description doit être engageante, intégrer naturellement les mots-clés pertinents, et suivre les bonnes pratiques YouTube (accroche dès les 2 premières lignes, structure en sections, appel à l'action). Réponds uniquement avec le texte de la description, sans commentaire.`
      userPrompt = `Titre de la vidéo : "${videoTitle}"\n${videoDescription ? `Description actuelle : "${String(videoDescription).slice(0, 500)}"\n` : ''}${keywords ? `Mots-clés : ${keywords}\n` : ''}${hint ? `Indications supplémentaires : ${hint}\n` : ''}\nRédige une description optimisée en ${lang}.`
    }

    // Les deux modèles en parallèle. allSettled : si l'un échoue (ex. clé manquante),
    // l'autre est quand même renvoyé.
    const [gpt, claude] = await Promise.all([
      callOpenAI(systemPrompt, userPrompt),
      callClaude(systemPrompt, userPrompt),
    ])

    return NextResponse.json({
      type,
      gpt: { model: 'GPT-5.5', ...gpt },
      claude: { model: 'Claude Opus 4.8', ...claude },
    })
  } catch (error: any) {
    console.error('AI generate error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
