import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calcAcumuladoTotal, calcAcumuladoMovel, fmtData } from '@/lib/utils'
import { GoogleGenAI } from '@google/genai'
import type { Paciente, Exame, PeriodoBalanco } from '@/types'

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-8b']

async function generateWithFallback(ai: GoogleGenAI, prompt: string): Promise<string> {
  let lastErr: Error | null = null
  for (const model of MODELS) {
    try {
      const response = await ai.models.generateContent({ model, contents: [prompt] })
      return response.text?.trim() ?? ''
    } catch (e: any) {
      lastErr = e
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
    const { paciente, exames, periodos }: {
      paciente: Paciente; exames: Exame[]; periodos: PeriodoBalanco[]
    } = await request.json()

    const exameSummary = exames.length === 0
      ? 'Nenhum exame registrado.'
      : exames.map((ex, i) => {
          const alts = (ex.resultados || []).filter(r => r.alterado)
          const norm = (ex.resultados || []).filter(r => !r.alterado)
          return `Exame ${i + 1} — ${ex.tipo_exame} (${ex.data_exame || 'sem data'}):\n` +
            (alts.length ? `  ALTERADOS: ${alts.map(r => `${r.nome}: ${r.valor} ${r.unidade || ''} [${r.direcao?.toUpperCase()}]`).join(', ')}\n` : '') +
            (norm.length ? `  Normais: ${norm.map(r => `${r.nome}: ${r.valor} ${r.unidade || ''}`).join(', ')}` : '')
        }).join('\n\n')

    const bhTotal = calcAcumuladoTotal(periodos)
    const bhMovel = calcAcumuladoMovel(periodos)
    const bhSummary = periodos.length === 0
      ? 'Nenhum balanço hídrico registrado.'
      : `Acumulado Total: ${bhTotal > 0 ? '+' : ''}${bhTotal.toFixed(0)} mL | Acumulado Móvel (10 turnos): ${bhMovel > 0 ? '+' : ''}${bhMovel.toFixed(0)} mL`

    const prompt =
      `Você é médico especialista em medicina intensiva. Gere um resumo clínico de alta UTI.\n\n` +
      `PACIENTE: ${paciente.nome}\n` +
      `Nascimento: ${fmtData(paciente.data_nascimento)} | Peso: ${paciente.peso_kg ? paciente.peso_kg + ' Kg' : 'não registrado'}\n` +
      `Plano: ${paciente.plano_saude} | Internação: ${fmtData(paciente.data_internacao)} às ${paciente.hora_internacao}\n` +
      `Hipóteses: ${paciente.hipoteses || 'não informadas'}\n\n` +
      `EXAMES:\n${exameSummary}\n\n` +
      `BALANÇO HÍDRICO:\n${bhSummary}\n\n` +
      `Redija resumo de alta com: motivo de internação, evolução clínica, achados laboratoriais, balanço hídrico, condições de alta. Linguagem médica formal.`

    const ai = new GoogleGenAI({ apiKey })
    const texto = await generateWithFallback(ai, prompt)

    return NextResponse.json({ texto })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
