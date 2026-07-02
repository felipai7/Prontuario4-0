import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAI, generateWithFallback } from '@/lib/ai'
import type { Exame, Paciente } from '@/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const apiKey = process.env.GOOGLEAISTUDIO_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Google AI API Key não configurada' }, { status: 500 })

  try {
    const { paciente, exames }: { paciente: Paciente; exames: Exame[] } = await request.json()

    const resumo = exames.map((ex, i) => {
      const alts = (ex.resultados || []).filter(r => r.alterado)
      const norm = (ex.resultados || []).filter(r => !r.alterado)
      return `Exame ${i + 1} — ${ex.tipo_exame} (${ex.data_exame || 'sem data'}):\n` +
        (alts.length ? '  ALTERADOS: ' + alts.map(r => `${r.nome}: ${r.valor} ${r.unidade || ''} [${r.direcao?.toUpperCase()}]`).join(', ') + '\n' : '') +
        (norm.length ? '  Normais: ' + norm.map(r => `${r.nome}: ${r.valor} ${r.unidade || ''}`).join(', ') : '')
    }).join('\n\n')

    const prompt =
      `Você é médico especialista em medicina intensiva. Analise a evolução dos exames laboratoriais do paciente.\n` +
      `Paciente: ${paciente.nome} | Hipóteses: ${paciente.hipoteses || 'não informadas'}\n\n` +
      `${resumo}\n\n` +
      `Forneça uma avaliação evolutiva objetiva e concisa: principais alterações encontradas, tendências evolutivas, ` +
      `correlações clínicas relevantes e pontos de atenção. Use linguagem médica técnica.`

    const ai = getAI()
    const texto = await generateWithFallback(ai, prompt)

    return NextResponse.json({ texto })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
