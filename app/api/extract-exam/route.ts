import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GoogleGenAI } from '@google/genai'

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-8b']

async function generateWithFallback(ai: GoogleGenAI, contents: any[]): Promise<string> {
  let lastErr: Error | null = null
  for (const model of MODELS) {
    try {
      const response = await ai.models.generateContent({ model, contents })
      return response.text?.trim() ?? ''
    } catch (e: any) {
      lastErr = e
      // Only retry on 503 / overload — other errors bubble out immediately
      if (!e.message?.includes('503') && !e.message?.includes('UNAVAILABLE') && !e.message?.includes('overload')) {
        throw e
      }
      await new Promise(r => setTimeout(r, 1500))
    }
  }
  throw lastErr
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const apiKey = process.env.GOOGLEAISTUDIO_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Google AI API Key não configurada' }, { status: 500 })

  try {
    const body = await request.json()
    const { base64, mediaType, rawText, images } = body
    // images: [{ base64, mediaType }]  — multi-image paste
    // base64 + mediaType               — single file upload
    // rawText                          — plain text paste

    const ai = new GoogleGenAI({ apiKey })

    const prompt =
      'Analise este resultado de exame médico laboratorial.\n' +
      'RESPONDA SOMENTE com um objeto JSON válido, sem texto antes ou depois, sem blocos markdown.\n' +
      'Formato obrigatório:\n' +
      '{"data_exame":"DD/MM/AAAA HH:MM (inclua horário de coleta se disponível) ou DD/MM/AAAA ou null","tipo_exame":"nome do painel",' +
      '"resultados":[{"nome":"parâmetro","valor":"valor","unidade":"unidade ou null",' +
      '"referencia":"referência ou null","alterado":true/false,"direcao":"alto|baixo|normal|qualitativo"}],' +
      '"observacoes":"observações ou null"}\n' +
      'Regras: inclua TODOS os parâmetros sem exceção; use conhecimento médico para "alterado" mesmo sem referência; ' +
      '"direcao" = alto se acima do normal, baixo se abaixo, qualitativo se positivo/negativo/reagente; ' +
      'data_exame é a data de COLETA (não liberação), null se ausente; ' +
      'se houver múltiplos painéis ou imagens combine tudo em um único JSON com todos os resultados.'

    let contents: any[]
    if (rawText) {
      contents = [`${prompt}\n\nTexto do laudo:\n${rawText}`]
    } else if (images && Array.isArray(images) && images.length > 0) {
      // Multiple images: interleave each image then the prompt at the end
      contents = [
        ...images.map((img: { base64: string; mediaType: string }) => ({
          inlineData: { mimeType: img.mediaType, data: img.base64 },
        })),
        prompt,
      ]
    } else {
      contents = [{ inlineData: { mimeType: mediaType, data: base64 } }, prompt]
    }

    const raw = await generateWithFallback(ai, contents)

    // Robust JSON extraction — try multiple strategies
    function tryParse(s: string): any { try { return JSON.parse(s) } catch { return null } }
    let parsed: any =
      tryParse(raw) ??
      (() => { const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/); return m ? tryParse(m[1].trim()) : null })() ??
      (() => { const m = raw.match(/\{[\s\S]*\}/); return m ? tryParse(m[0]) : null })() ??
      (() => { const i = raw.indexOf('{'); return i >= 0 ? tryParse(raw.slice(i)) : null })() ??
      null

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
