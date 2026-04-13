import { NextRequest, NextResponse } from 'next/server'

const LANG_LABELS: Record<string, string> = {
  fr: 'français',
  en: 'English',
  es: 'español',
  de: 'Deutsch',
}

export async function POST(req: NextRequest) {
  try {
    const { type, videoTitle, videoDescription, keywords, hint, count, language } = await req.json()

    if (!type || !videoTitle) {
      return NextResponse.json({ error: 'Missing type or videoTitle' }, { status: 400 })
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })
    }

    const lang = LANG_LABELS[language] || LANG_LABELS['fr']
    const titleCount = count || 3

    let systemPrompt: string
    let userPrompt: string

    if (type === 'titles') {
      systemPrompt = `You are a YouTube SEO expert. Generate exactly ${titleCount} alternative video titles. Each title must be in ${lang}. Titles should be catchy, optimized for click-through rate, and relevant to the video content. Return only the numbered titles, one per line, no extra commentary.`
      userPrompt = `Original title: "${videoTitle}"\n${videoDescription ? `Description: "${videoDescription.slice(0, 300)}"` : ''}\n${keywords ? `Keywords: ${keywords}` : ''}\n${hint ? `Additional instructions: ${hint}` : ''}\n\nGenerate ${titleCount} alternative titles in ${lang}.`
    } else {
      systemPrompt = `You are a YouTube SEO expert. Write an optimized video description in ${lang}. The description should be engaging, include relevant keywords naturally, and follow YouTube best practices (hook in first 2 lines, structured with sections, include a call to action). Return only the description text, no extra commentary.`
      userPrompt = `Video title: "${videoTitle}"\n${videoDescription ? `Current description: "${videoDescription.slice(0, 500)}"` : ''}\n${keywords ? `Keywords: ${keywords}` : ''}\n${hint ? `Additional instructions: ${hint}` : ''}\n\nWrite an optimized description in ${lang}.`
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 1000,
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'OpenAI API error')
    }

    const result = data.choices?.[0]?.message?.content?.trim() || ''
    return NextResponse.json({ result })
  } catch (error: any) {
    console.error('AI generate error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
