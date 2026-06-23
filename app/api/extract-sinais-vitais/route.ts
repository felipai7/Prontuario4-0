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
      if (!e.message?.includes('503') && !e.message?.includes('UNAVAILABLE') && !e.message?.includes('overload')) throw e
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
    const { base64, mediaType } = await request.json()

    const prompt =
      'Analise esta folha de controle de sinais vitais de UTI hospitalar.\n' +
      'Extraia TODAS as leituras de sinais vitais registradas.\n' +
      'RESPONDA SOMENTE com JSON válido, sem texto extra, sem markdown.\n' +
      'Formato: {"data":"DD/MM/AAAA","leituras":[{"horario":"HH:MM","temperatura":null,"pas":null,"pad":null,"pam":null,"fc":null,"fr":null,"sato2":null,"hgt":null}]}\n' +
      'Regras:\n' +
      '- horario: hora da leitura no formato HH:MM\n' +
      '- temperatura: graus Celsius (decimal, ex: 36.5)\n' +
      '- pas: pressão sistólica em mmHg (inteiro)\n' +
      '- pad: pressão diastólica em mmHg (inteiro)\n' +
      '- pam: pressão arterial média em mmHg (inteiro, se registrado)\n' +
      '- fc: frequência cardíaca em bpm (inteiro)\n' +
      '- fr: frequência respiratória em irpm (inteiro)\n' +
      '- sato2: saturação O2 em % (número)\n' +
      '- hgt: glicemia capilar em mg/dL (número)\n' +
      '- Use null para campos não preenchidos ou ilegíveis\n' +
      '- Inclua TODAS as leituras, mesmo as parcialmente preenchidas\n' +
      '- data: data da folha no formato DD/MM/AAAA (null se não encontrar)'

    const ai = new GoogleGenAI({ apiKey })
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

    if (!parsed?.leituras?.length) {
      return NextResponse.json({ error: 'Não foi possível extrair leituras da imagem' }, { status: 422 })
    }

    return NextResponse.json(parsed)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
