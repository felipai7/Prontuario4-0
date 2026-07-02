import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAI, generateWithFallback } from '@/lib/ai'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const apiKey = process.env.GOOGLEAISTUDIO_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'API Key não configurada' }, { status: 500 })

  try {
    const { base64, mediaType } = await request.json()
    const ai = getAI()

    const prompt =
      'Você é um especialista em medicina e laudos de exames de imagem (radiologia, ultrassonografia, TC, RM, ecocardiograma, etc.).\n' +
      'Analise este laudo de exame de imagem e extraia as informações mais relevantes.\n' +
      'RESPONDA APENAS com JSON válido, sem texto extra, sem markdown.\n' +
      'Formato:\n' +
      '{\n' +
      '  "tipo_exame": "nome do tipo de exame (ex: Radiografia de Tórax, TC de Abdome, Ecocardiograma)",\n' +
      '  "data_exame": "DD/MM/AAAA ou null se não encontrado",\n' +
      '  "resumo": "resumo clínico em 2-4 frases dos achados mais relevantes e conclusão",\n' +
      '  "achados": {\n' +
      '    "chave": "descrição do achado"\n' +
      '  },\n' +
      '  "conclusao": "conclusão ou impressão diagnóstica do radiologista"\n' +
      '}\n' +
      'Regras:\n' +
      '- Em achados, use chaves descritivas curtas (ex: "Pulmões", "Coração", "Derrame pleural", "Fratura")\n' +
      '- Destaque SEMPRE achados patológicos relevantes\n' +
      '- Se não for um exame de imagem, retorne {"erro": "Arquivo não parece ser um laudo de exame de imagem"}'

    const raw = await generateWithFallback(ai, [
      { inlineData: { mimeType: mediaType, data: base64 } },
      prompt,
    ])

    function tryParse(s: string): any { try { return JSON.parse(s) } catch { return null } }
    const parsed =
      tryParse(raw) ??
      (() => { const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/); return m ? tryParse(m[1].trim()) : null })() ??
      (() => { const m = raw.match(/\{[\s\S]*\}/); return m ? tryParse(m[0]) : null })() ??
      null

    if (!parsed) return NextResponse.json({ error: 'Não foi possível extrair dados do laudo' }, { status: 422 })
    if (parsed.erro) return NextResponse.json({ error: parsed.erro }, { status: 422 })

    return NextResponse.json(parsed)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
