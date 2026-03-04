import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export async function POST(req: NextRequest) {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const { type, videoTitle, videoDescription, keywords, hint, count = 5 } = await req.json()

    let prompt = ''

    if (type === 'titles') {
      prompt = 'Tu es un expert en optimisation YouTube. Genere ' + count + ' titres accrocheurs pour une video YouTube.\n\nTitre actuel : "' + videoTitle + '"\nDescription : "' + (videoDescription || '').slice(0, 300) + '"\nMots-cles : ' + keywords + '\n\nRegles :\n- 50-70 caracteres\n- Accrocheurs, sans clickbait agressif\n- Optimises SEO YouTube\n- En francais\n- Format : liste numerotee uniquement'+ (hint ? '\n\nIndications supplémentaires : ' + hint : '')
    } else {
      prompt = 'Tu es un expert en optimisation YouTube. Genere une description optimisee.\n\nTitre : "' + videoTitle + '"\nDescription actuelle : "' + (videoDescription || '').slice(0, 500) + '"\nMots-cles : ' + keywords + '\n\nRegles :\n- 150-300 mots\n- 2 premieres lignes accrocheuses\n- Mots-cles integres naturellement\n- En francais'
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.8,
    })

    const result = completion.choices[0]?.message?.content || ''
    return NextResponse.json({ result, type })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Erreur inconnue'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
