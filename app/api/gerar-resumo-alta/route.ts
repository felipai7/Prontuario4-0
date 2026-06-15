import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calcBalanco, calcAcumuladoTotal, calcAcumuladoMovel, fmtData } from '@/lib/utils'
import type { Paciente, Exame, PeriodoBalanco } from '@/types'

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

    // Build exam summary
    const exameSummary = exames.length === 0
      ? 'Nenhum exame registrado no sistema.'
      : exames.map((ex, i) => {
          const alts = (ex.resultados || []).filter(r => r.alterado)
          const norm = (ex.resultados || []).filter(r => !r.alterado)
          const altStr = alts.map(r => `${r.nome}: ${r.valor} ${r.unidade || ''} [${r.direcao?.toUpperCase()}]`).join(', ')
          const normStr = norm.map(r => `${r.nome}: ${r.valor} ${r.unidade || ''}`).join(', ')
          return `Exame ${i + 1} — ${ex.tipo_exame} (${ex.data_exame || 'sem data'}):\n` +
            (alts.length ? `  ALTERADOS: ${altStr}\n` : '') +
            (norm.length ? `  Normais: ${normStr}` : '')
        }).join('\n\n')

    // Build balance summary
    const bhTotal  = calcAcumuladoTotal(periodos)
    const bhMovel  = calcAcumuladoMovel(periodos)
    const bhSummary = periodos.length === 0
      ? 'Nenhum balanço hídrico registrado.'
      : `Balanço Acumulado Total: ${bhTotal > 0 ? '+' : ''}${bhTotal.toFixed(0)} mL | ` +
        `Acumulado Móvel (últimos 10 turnos): ${bhMovel > 0 ? '+' : ''}${bhMovel.toFixed(0)} mL`

    const prompt =
      `Você é um médico especialista em medicina intensiva. Gere um resumo clínico de alta UTI conciso e objetivo.\n\n` +
      `PACIENTE:\n` +
      `Nome: ${paciente.nome}\n` +
      `Data de nascimento: ${fmtData(paciente.data_nascimento)}\n` +
      `Peso: ${paciente.peso_kg ? paciente.peso_kg + ' Kg' : 'não registrado'}\n` +
      `Plano: ${paciente.plano_saude}\n` +
      `Internação: ${fmtData(paciente.data_internacao)} às ${paciente.hora_internacao}\n` +
      `Hipóteses Diagnósticas: ${paciente.hipoteses || 'não informadas'}\n\n` +
      `EXAMES LABORATORIAIS:\n${exameSummary}\n\n` +
      `BALANÇO HÍDRICO:\n${bhSummary}\n\n` +
      `Redija o resumo de alta incluindo: motivo de internação, evolução clínica, achados laboratoriais relevantes, balanço hídrico, condições de alta. ` +
      `Use linguagem médica formal. Seja objetivo e completo.`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      }
    )

    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`)

    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta'
    return NextResponse.json({ texto })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
