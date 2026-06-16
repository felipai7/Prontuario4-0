import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const apiKey = process.env.GOOGLEAISTUDIO_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Google AI API Key não configurada' }, { status: 500 })

  try {
    const body = await request.json()
    const { base64, mediaType } = body

    const prompt =
      'Analise este resultado de exame médico e retorne APENAS um JSON válido ' +
      '(sem markdown, sem texto extra) com este formato:\n' +
      '{"data_exame":"DD/MM/AAAA ou null","tipo_exame":"nome do painel",' +
      '"resultados":[{"nome":"parâmetro","valor":"valor","unidade":"ou null",' +
      '"referencia":"ou null","alterado":true,"direcao":"alto|baixo|normal|qualitativo"}],' +
      '"observacoes":"texto ou null"}\n' +
      'Use conhecimento médico padrão para "alterado" quando não há referência explícita.'

    // Prepare content for Google's format
    const imagePart = {
      inlineData: {
        mimeType: mediaType,
        data: base64,
      }
    }

    const textPart = { text: prompt }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{
            parts: [imagePart, textPart]
          }]
        })
      }
    )

    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`)

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    let parsed: any = null
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    try { parsed = JSON.parse(m ? m[1].trim() : raw) } catch {}

    return NextResponse.json({
      tipo_exame:  parsed?.tipo_exame  || 'Exame',
      data_exame:  parsed?.data_exame  || null,
      resultados:  parsed?.resultados  || null,
      observacoes: parsed?.observacoes || null,
      raw_text:    parsed ? null : raw,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
