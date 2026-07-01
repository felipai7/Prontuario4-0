import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAI, generateWithFallback } from '@/lib/ai'
import { calcAcumuladoTotal, calcAcumuladoMovel, calcBalanco, fmtData } from '@/lib/utils'
import type { Paciente, Exame, SinalVital, ExameImagem, PeriodoBalanco, DVA, PeriodoHemodinamica, ATB, CuidadosHorizontais } from '@/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const apiKey = process.env.GOOGLEAISTUDIO_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Google AI API Key não configurada' }, { status: 500 })

  try {
    const { paciente, exames, sinais, examesImagem, periodos, dvas, periodosHemo, atbs, cuidados }: {
      paciente: Paciente
      exames: Exame[]
      sinais: SinalVital[]
      examesImagem: ExameImagem[]
      periodos: PeriodoBalanco[]
      dvas: DVA[]
      periodosHemo: PeriodoHemodinamica[]
      atbs?: ATB[]
      cuidados?: CuidadosHorizontais | null
    } = await request.json()

    // ── Sinais Vitais (últimas 24h ou período atual) ─────────────────────────
    const currentPeriodo = periodosHemo.find(p => !p.fim)
    const cutoff = currentPeriodo
      ? new Date(currentPeriodo.inicio).getTime()
      : Date.now() - 24 * 3600 * 1000
    const recentSinais = sinais.filter(s => new Date(s.horario).getTime() >= cutoff)

    function range(vals: (number | null)[]): string {
      const v = vals.filter(x => x !== null) as number[]
      if (!v.length) return 'não registrado'
      if (v.length === 1) return String(v[0])
      return `${Math.min(...v)}–${Math.max(...v)}`
    }
    const svSection = recentSinais.length === 0
      ? 'Nenhum sinal vital registrado no período.'
      : [
          `FC: ${range(recentSinais.map(s => s.fc))} bpm`,
          `PA: ${range(recentSinais.map(s => s.pas))}/${range(recentSinais.map(s => s.pad))} mmHg`,
          `PAM: ${range(recentSinais.map(s => s.pam))} mmHg`,
          `Temp: ${range(recentSinais.map(s => s.temperatura))} °C`,
          `SatO₂: ${range(recentSinais.map(s => s.sato2))} %`,
          `HGT: ${range(recentSinais.map(s => s.hgt))} mg/dL`,
        ].join(' | ')

    // ── Hemodinâmica ─────────────────────────────────────────────────────────
    const ativosDVA = dvas.filter(d => d.ativo)
    const hemoSection = ativosDVA.length === 0
      ? 'Hemodinâmica estável sem vasopressores/inotrópicos.'
      : 'Em uso: ' + ativosDVA.map(d => `${d.droga} ${d.fluxo_ml_h} mL/h`).join(', ')

    // ── Exames laboratoriais (últimos 5) ─────────────────────────────────────
    const examesOrdenados = [...exames]
      .filter(e => e.resultados && e.resultados.length > 0)
      .sort((a, b) => {
        const pa = a.data_exame ?? a.created_at, pb = b.data_exame ?? b.created_at
        return pa < pb ? 1 : -1
      })
      .slice(0, 5)

    const examesSection = examesOrdenados.length === 0
      ? 'Nenhum exame laboratorial registrado.'
      : examesOrdenados.map(ex => {
          const alts = (ex.resultados || []).filter(r => r.alterado)
          const norm = (ex.resultados || []).filter(r => !r.alterado)
          return `${ex.tipo_exame} (${ex.data_exame || 'sem data'}):\n` +
            (alts.length ? `  ALTERADOS: ${alts.map(r => `${r.nome} ${r.valor}${r.unidade ? ' ' + r.unidade : ''} [${r.direcao?.toUpperCase()}]`).join(', ')}\n` : '') +
            (norm.length ? `  Normais: ${norm.map(r => `${r.nome} ${r.valor}${r.unidade ? ' ' + r.unidade : ''}`).join(', ')}` : '')
        }).join('\n\n')

    // ── Exames de imagem ──────────────────────────────────────────────────────
    const imagemSection = examesImagem.length === 0
      ? 'Nenhum exame de imagem registrado.'
      : examesImagem.map(img =>
          `${img.tipo_exame}${img.data_exame ? ` (${img.data_exame})` : ''}: ${img.resumo_ia || 'sem resumo'}`
        ).join('\n')

    // ── Balanço hídrico ───────────────────────────────────────────────────────
    const bhTotal = calcAcumuladoTotal(periodos)
    const bhMovel = calcAcumuladoMovel(periodos)
    const ultimoPeriodo = [...periodos].sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())[0]
    let bhSection = `Acumulado total: ${bhTotal > 0 ? '+' : ''}${bhTotal.toFixed(0)} mL | Acumulado móvel (últimos turnos): ${bhMovel > 0 ? '+' : ''}${bhMovel.toFixed(0)} mL`
    if (ultimoPeriodo) {
      const bc = calcBalanco(ultimoPeriodo)
      const diureseHora = ultimoPeriodo.horas_periodo > 0
        ? (ultimoPeriodo.diurese / ultimoPeriodo.horas_periodo).toFixed(1)
        : '?'
      const diureseKg = paciente.peso_kg && ultimoPeriodo.horas_periodo > 0
        ? (ultimoPeriodo.diurese / (paciente.peso_kg * ultimoPeriodo.horas_periodo)).toFixed(2)
        : null
      bhSection += `\nÚltimo turno (${ultimoPeriodo.horas_periodo}h): diurese ${ultimoPeriodo.diurese} mL → ${diureseHora} mL/h${diureseKg ? ` (${diureseKg} mL/kg/h)` : ''} | BH parcial: ${bc.parcial > 0 ? '+' : ''}${bc.parcial.toFixed(0)} mL`
    }

    // ── Antibioticoterapia ──────────────────────────────────────────────────────
    const ativosATB = (atbs ?? []).filter(a => a.ativo)
    const atbSection = ativosATB.length === 0
      ? 'Sem antibioticoterapia em curso.'
      : ativosATB.map(a => {
          const dias = Math.floor((Date.now() - new Date(a.data_inicio + 'T00:00:00').getTime()) / (24 * 3600 * 1000))
          return `${a.droga} — dia ${dias} de uso${a.dias_previstos != null ? ` (previsto: ${a.dias_previstos} dias)` : ''}${a.foco ? `, foco: ${a.foco}` : ''}`
        }).join('; ')

    // ── IBP / Anticoagulante / Previsão de alta / Pendências ─────────────────────
    const ibpSection = cuidados?.ibp_em_uso
      ? `Em uso — via ${cuidados.ibp_via ?? '?'}, dose ${cuidados.ibp_dose_valor ?? '?'} ${cuidados.ibp_dose_unidade ?? ''}, objetivo ${cuidados.ibp_objetivo ?? '?'}`
      : 'Sem uso de IBP.'
    const anticoagSection = cuidados?.anticoag_em_uso
      ? `Em uso — ${cuidados.anticoag_droga === 'Outro' ? cuidados.anticoag_droga_outro : cuidados.anticoag_droga}, via ${cuidados.anticoag_via ?? '?'}, dose ${cuidados.anticoag_dose_valor ?? '?'} ${cuidados.anticoag_dose_unidade ?? ''}, objetivo ${cuidados.anticoag_objetivo ?? '?'}`
      : 'Sem anticoagulação em curso.'
    const previsaoAltaSection = cuidados?.previsao_alta ? fmtData(cuidados.previsao_alta) : 'não definida'
    const pendenciasSection = cuidados?.pendencias || 'Nenhuma pendência registrada.'

    // ── Calcular idade ────────────────────────────────────────────────────────
    const dob = new Date(paciente.data_nascimento + 'T12:00:00')
    const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000))
    const diasInternado = Math.floor((Date.now() - new Date(paciente.data_internacao + 'T' + paciente.hora_internacao).getTime()) / (24 * 3600 * 1000))

    const prompt =
      `Você é médico especialista em medicina intensiva. Faça uma avaliação clínica OBJETIVA e CONCISA deste paciente de UTI.\n\n` +
      `PACIENTE: ${paciente.nome} | ${age} anos | Peso: ${paciente.peso_kg ? paciente.peso_kg + ' kg' : 'não registrado'}\n` +
      `Internação: ${fmtData(paciente.data_internacao)} às ${paciente.hora_internacao} (${diasInternado} dias)${paciente.saps3 != null ? ` | SAPS-3: ${paciente.saps3}` : ''}${paciente.paliativo ? ' | PACIENTE EM CUIDADOS PALIATIVOS' : ''}\n` +
      `Hipóteses: ${paciente.hipoteses || 'não informadas'}\n\n` +
      `SINAIS VITAIS (${currentPeriodo ? 'turno atual' : 'últimas 24h'}, ${recentSinais.length} aferições):\n${svSection}\n\n` +
      `HEMODINÂMICA:\n${hemoSection}\n\n` +
      `EXAMES LABORATORIAIS (${examesOrdenados.length} mais recentes):\n${examesSection}\n\n` +
      `EXAMES DE IMAGEM:\n${imagemSection}\n\n` +
      `BALANÇO HÍDRICO:\n${bhSection}\n\n` +
      `ANTIBIOTICOTERAPIA:\n${atbSection}\n\n` +
      `IBP: ${ibpSection}\n` +
      `ANTICOAGULAÇÃO: ${anticoagSection}\n` +
      `PREVISÃO DE ALTA: ${previsaoAltaSection}\n` +
      `PENDÊNCIAS/PROGRAMAÇÕES: ${pendenciasSection}\n\n` +
      `Forneça avaliação com os seguintes itens (linguagem médica técnica, máx. 320 palavras):\n` +
      `1. Resumo do caso: hipótese principal e contexto clínico\n` +
      `2. Principais alterações laboratoriais e tendências evolutivas\n` +
      `3. Achados de imagem relevantes (se disponíveis)\n` +
      `4. Débito urinário: valor em mL/h${paciente.peso_kg ? ' e mL/kg/h' : ''}, correlacione com creatinina/ureia (função renal normal ou alterada)\n` +
      `5. Tendência hemodinâmica: vasopressores/inotrópicos e tendência geral dos sinais vitais\n` +
      `6. Antibioticoterapia: esquema atual, dias de uso e alerta se ultrapassar tempo previsto\n` +
      `7. Profilaxias/anticoagulação (IBP e anticoagulante) e pendências relevantes registradas pela equipe`

    const ai = getAI()
    const texto = await generateWithFallback(ai, prompt)

    return NextResponse.json({ texto })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
