import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { type, videoTitle, videoDescription, keywords, count = 5 } = await req.json()

    let prompt = ''

    if (type === 'titles') {
      prompt = `Tu es un expert en optimisation YouTube. Génère ${count} titres accrocheurs et optimisés SEO pour une vidéo YouTube.

Titre actuel : "${videoTitle}"
Description : "${videoDescription?.slice(0, 300)}"
Mots-clés : ${keywords}

Règles :
- Titres entre 50-70 caractères
- Accrocheurs, curiosité naturelle, sans clickbait agressif  
- Optimisés pour les recherches YouTube
- En français
- Variés (questions, affirmations, chiffres...)
- Format : liste numérotée uniquement, sans commentaires`
    } else if (type === 'description') {
      prompt = `Tu es un expert en optimisation YouTube. Génère une description optimisée pour cette vidéo YouTube.

Titre : "${videoTitle}"
Description actuelle : "${videoDescription?.slice(0, 500)}"
Mots-clés : ${keywords}

Règles :
- 150-300 mots
- Les 2 premières lignes doivent donner envie (visibles sans cliquer "voir plus")
- Inclure les mots-clés naturellement
- Ajouter un appel à l'action subtil
- En français
- Format : texte direct, pas de commentaires`
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.8,
    })

    const result = completion.choices[0]?.message?.content || ''
    return NextResponse.json({ result, type })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
