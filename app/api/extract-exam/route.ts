import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GoogleGenAI } from '@google/genai'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const apiKey = process.env.GOOGLEAISTUDIO_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Google AI API Key não configurada' }, { status: 500 })

  try {
    const body = await request.json()
    const { base64, mediaType } = body

    const ai = new GoogleGenAI({ apiKey })

    const prompt =
      'Analise este resultado de exame médico e retorne APENAS um JSON válido ' +
      '(sem markdown, sem texto extra) com este formato:\n' +
      '{"data_exame":"DD/MM/AAAA ou null","tipo_exame":"nome do painel",' +
      '"resultados":[{"nome":"parâmetro","valor":"valor","unidade":"ou null",' +
      '"referencia":"ou null","alterado":true,"direcao":"alto|baixo|normal|qualitativo"}],' +
      '"observacoes":"texto ou null"}\n' +
      'Use conhecimento médico padrão para "alterado" quando não há referência explícita.'

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { inlineData: { mimeType: mediaType, data: base64 } },
        prompt,
      ],
    })

    const raw = response.text?.trim() ?? ''

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
