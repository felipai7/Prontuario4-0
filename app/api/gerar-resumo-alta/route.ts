import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calcAcumuladoTotal, calcAcumuladoMovel, calcBalanco, fmtData, resumoNeuro, resumoVentilatorio } from '@/lib/utils'
import { getAI, generateWithFallback } from '@/lib/ai'
import type { Paciente, Exame, PeriodoBalanco, SinalVital, ExameImagem, DVA, ATB, CuidadosHorizontais, AvaliacaoNeurologica, SuporteVentilatorio } from '@/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const apiKey = process.env.GOOGLEAISTUDIO_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Google AI API Key não configurada' }, { status: 500 })

  try {
    const { paciente, exames, periodos, sinais, examesImagem, dvas, atbs, cuidados, neuro, ventilatorio }: {
      paciente: Paciente
      exames: Exame[]
      periodos: PeriodoBalanco[]
      sinais?: SinalVital[]
      examesImagem?: ExameImagem[]
      dvas?: DVA[]
      atbs?: ATB[]
      cuidados?: CuidadosHorizontais | null
      neuro?: AvaliacaoNeurologica | null
      ventilatorio?: SuporteVentilatorio | null
    } = await request.json()

    // ── Exames laboratoriais ──────────────────────────────────────────────────
    const exameSummary = exames.length === 0
      ? 'Nenhum exame registrado.'
      : exames.map((ex, i) => {
          const alts = (ex.resultados || []).filter(r => r.alterado)
          const norm = (ex.resultados || []).filter(r => !r.alterado)
          return `Exame ${i + 1} — ${ex.tipo_exame} (${ex.data_exame || 'sem data'}):\n` +
            (alts.length ? `  ALTERADOS: ${alts.map(r => `${r.nome}: ${r.valor} ${r.unidade || ''} [${r.direcao?.toUpperCase()}]`).join(', ')}\n` : '') +
            (norm.length ? `  Normais: ${norm.map(r => `${r.nome}: ${r.valor} ${r.unidade || ''}`).join(', ')}` : '')
        }).join('\n\n')

    // ── Balanço hídrico ───────────────────────────────────────────────────────
    const bhTotal = calcAcumuladoTotal(periodos)
    const bhMovel = calcAcumuladoMovel(periodos)
    let bhSummary = periodos.length === 0
      ? 'Nenhum balanço hídrico registrado.'
      : `Acumulado Total da Internação: ${bhTotal > 0 ? '+' : ''}${bhTotal.toFixed(0)} mL | Acumulado Móvel (últimos 10 turnos): ${bhMovel > 0 ? '+' : ''}${bhMovel.toFixed(0)} mL`

    if (periodos.length > 0) {
      const sorted = [...periodos].sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())
      const ultimo = sorted[0]
      const bc = calcBalanco(ultimo)
      const dHora = ultimo.horas_periodo > 0 ? (ultimo.diurese / ultimo.horas_periodo).toFixed(1) : '?'
      bhSummary += `\nÚltimo turno: diurese ${ultimo.diurese} mL (${dHora} mL/h), BH ${bc.parcial > 0 ? '+' : ''}${bc.parcial.toFixed(0)} mL`
    }

    // ── Sinais vitais ─────────────────────────────────────────────────────────
    const svSection = (!sinais || sinais.length === 0)
      ? 'Não registrados.'
      : (() => {
          const fc  = sinais.map(s => s.fc).filter(Boolean) as number[]
          const pas = sinais.map(s => s.pas).filter(Boolean) as number[]
          const pad = sinais.map(s => s.pad).filter(Boolean) as number[]
          const temp = sinais.map(s => s.temperatura).filter(Boolean) as number[]
          const sat = sinais.map(s => s.sato2).filter(Boolean) as number[]
          const rng = (arr: number[]) => arr.length ? `${Math.min(...arr)}–${Math.max(...arr)}` : 'NR'
          return `FC ${rng(fc)} bpm | PA ${rng(pas)}/${rng(pad)} mmHg | Temp ${rng(temp)} °C | SatO₂ ${rng(sat)} %`
        })()

    // ── Exames de imagem ──────────────────────────────────────────────────────
    const imagemSection = (!examesImagem || examesImagem.length === 0)
      ? 'Nenhum exame de imagem registrado.'
      : examesImagem.map(img =>
          `${img.tipo_exame}${img.data_exame ? ` (${img.data_exame})` : ''}: ${img.resumo_ia || img.achados ? JSON.stringify(img.achados) : 'sem descrição'}`
        ).join('\n')

    // ── Hemodinâmica ──────────────────────────────────────────────────────────
    const ativosDVA = (dvas || []).filter(d => d.ativo)
    const hemoSection = ativosDVA.length === 0
      ? 'Hemodinamicamente estável na alta, sem vasopressores.'
      : 'Em uso na alta: ' + ativosDVA.map(d => `${d.droga} ${d.fluxo_ml_h} mL/h`).join(', ')

    // ── Antibioticoterapia (histórico completo da internação) ───────────────────
    const atbSection = (!atbs || atbs.length === 0)
      ? 'Nenhum ATB registrado durante a internação.'
      : atbs.map(a => {
          const fim = a.ativo ? 'em uso na alta' : 'encerrado'
          return `${a.droga} — início ${fmtData(a.data_inicio)}${a.dias_previstos != null ? `, previsto: ${a.dias_previstos}d` : ''}${a.foco ? `, foco: ${a.foco}` : ''} (${fim})`
        }).join('\n')

    // ── Profilaxias / anticoagulação na alta ─────────────────────────────────────
    const ibpSection = cuidados?.ibp_em_uso
      ? `Em uso — via ${cuidados.ibp_via ?? '?'}, dose ${cuidados.ibp_dose_valor ?? '?'} ${cuidados.ibp_dose_unidade ?? ''}, objetivo ${cuidados.ibp_objetivo ?? '?'}`
      : 'Sem uso de IBP.'
    const anticoagSection = cuidados?.anticoag_em_uso
      ? `Em uso — ${cuidados.anticoag_droga === 'Outro' ? cuidados.anticoag_droga_outro : cuidados.anticoag_droga}, via ${cuidados.anticoag_via ?? '?'}, dose ${cuidados.anticoag_dose_valor ?? '?'} ${cuidados.anticoag_dose_unidade ?? ''}, objetivo ${cuidados.anticoag_objetivo ?? '?'}`
      : 'Sem anticoagulação em curso.'

    // ── Calcular duração da internação ────────────────────────────────────────
    const admDate = new Date(paciente.data_internacao + 'T' + (paciente.hora_internacao || '00:00'))
    const diasInternado = Math.round((Date.now() - admDate.getTime()) / (24 * 3600 * 1000))

    const prompt =
      `Você é médico especialista em medicina intensiva. Gere um resumo clínico de alta da UTI.\n\n` +
      `PACIENTE: ${paciente.nome}\n` +
      `Nascimento: ${fmtData(paciente.data_nascimento)} | Peso: ${paciente.peso_kg ? paciente.peso_kg + ' Kg' : 'não registrado'}\n` +
      `Plano: ${paciente.plano_saude}\n` +
      `Internação: ${fmtData(paciente.data_internacao)} às ${paciente.hora_internacao} (${diasInternado} dias)${paciente.saps3 != null ? ` | SAPS-3: ${paciente.saps3}` : ''}${paciente.paliativo ? ' | paciente em cuidados paliativos' : ''}\n` +
      `Hipóteses: ${paciente.hipoteses || 'não informadas'}\n\n` +
      `EXAMES LABORATORIAIS:\n${exameSummary}\n\n` +
      `EXAMES DE IMAGEM:\n${imagemSection}\n\n` +
      `SINAIS VITAIS (range da internação):\n${svSection}\n\n` +
      `BALANÇO HÍDRICO:\n${bhSummary}\n\n` +
      `HEMODINÂMICA NA ALTA:\n${hemoSection}\n\n` +
      `NEUROLÓGICO/SEDAÇÃO NA ALTA: ${resumoNeuro(neuro)}\n` +
      `VENTILATÓRIO NA ALTA: ${resumoVentilatorio(ventilatorio)}\n\n` +
      `ANTIBIOTICOTERAPIA (histórico da internação):\n${atbSection}\n\n` +
      `IBP na alta: ${ibpSection}\n` +
      `ANTICOAGULAÇÃO na alta: ${anticoagSection}\n\n` +
      `Redija resumo de alta com: motivo de internação, evolução clínica desde a admissão, principais achados laboratoriais e de imagem, balanço hídrico e débito urinário, condições hemodinâmicas na alta, estado neurológico e suporte ventilatório na alta (se registrados), antibioticoterapia recebida, profilaxias/anticoagulação mantidas na alta. Seja objetivo sem ser prolixo. Use linguagem médica formal.`

    const ai = getAI()
    const texto = await generateWithFallback(ai, prompt)

    return NextResponse.json({ texto })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
