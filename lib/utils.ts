import type { PeriodoBalanco, BalancoCalculado, AvaliacaoNeurologica, SuporteVentilatorio, ATB, CuidadosHorizontais } from '@/types'

// ── Formatação ─────────────────────────────────────────────────────────────

export function fmtData(str: string | null | undefined): string {
  if (!str) return ''
  return new Date(str + 'T12:00:00').toLocaleDateString('pt-BR')
}

export function fmtDataHora(str: string | null | undefined): string {
  if (!str) return ''
  return new Date(str).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function calcAge(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const dob   = new Date(dateStr + 'T12:00:00')
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  return `${age} anos`
}

export function isDateFuture(str: string): boolean {
  if (!str) return false
  const [y, m, d] = str.split('-').map(Number)
  const date  = new Date(y, m - 1, d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return date > today
}

/** Dias corridos desde uma data YYYY-MM-DD até hoje (mínimo 0). */
export function diasDesde(dataYYYYMMDD: string): number {
  const inicio = new Date(dataYYYYMMDD + 'T00:00:00')
  const hoje   = new Date(); hoje.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((hoje.getTime() - inicio.getTime()) / (24 * 3600 * 1000)))
}

// ── Resumos clínicos em texto (usados nos prompts de IA) ───────────────────

export function resumoNeuro(neuro: AvaliacaoNeurologica | null | undefined): string {
  if (!neuro) return 'Não registrado.'
  const partes: string[] = []
  if (neuro.escala === 'GLASGOW' && neuro.glasgow_ao != null && neuro.glasgow_rv != null && neuro.glasgow_rm != null) {
    partes.push(`Glasgow ${neuro.glasgow_ao + neuro.glasgow_rv + neuro.glasgow_rm} (AO ${neuro.glasgow_ao} + RV ${neuro.glasgow_rv} + RM ${neuro.glasgow_rm})`)
  } else if (neuro.rass != null) {
    partes.push(`RASS ${neuro.rass > 0 ? '+' : ''}${neuro.rass}`)
  }
  if (neuro.sedacao_em_uso) {
    const drogas = (neuro.sedativos ?? []).map(s => s === 'Outro' ? (neuro.sedativo_outro || 'outro sedativo') : s)
    partes.push(`sedação com ${drogas.length ? drogas.join(' + ') : 'sedativo não especificado'}`)
    if (neuro.despertar_diario === true)  partes.push('em despertar diário')
    if (neuro.despertar_diario === false) partes.push('sem despertar diário')
  } else {
    partes.push('sem sedação')
  }
  return partes.length ? partes.join(', ') : 'Não registrado.'
}

export function resumoVentilatorio(v: SuporteVentilatorio | null | undefined): string {
  if (!v || !v.modalidade) return 'Não registrado.'
  if (v.modalidade === 'ar_ambiente') return 'Ar ambiente.'
  if (v.modalidade === 'o2_suplementar') {
    return `O₂ suplementar${v.o2_dispositivo ? ` por ${v.o2_dispositivo}` : ''}${v.o2_fluxo_l_min != null ? ` a ${v.o2_fluxo_l_min} L/min` : ''}.`
  }
  const dias = v.vm_data_inicio ? diasDesde(v.vm_data_inicio) : null
  return `Ventilação mecânica${v.vm_via ? ` via ${v.vm_via}` : ''}${dias != null ? ` há ${dias} dia(s)` : ''}.`
}

export function resumoAntibioticoterapia(atbs: ATB[]): string {
  const ativos = atbs.filter(a => a.ativo)
  if (!ativos.length) return 'Sem antibioticoterapia em curso.'
  const partes = ativos.map(a => {
    const dias = diasDesde(a.data_inicio)
    const alerta = a.dias_previstos != null ? dias >= a.dias_previstos : dias > 7
    return `${a.droga} (D${dias}${a.dias_previstos != null ? `/${a.dias_previstos}` : ''}${a.foco ? `, foco: ${a.foco}` : ''})${alerta ? ' ⚠️' : ''}`
  })
  return `Em uso: ${partes.join(', ')}.`
}

export function resumoProfilaxias(cuidados: CuidadosHorizontais | null | undefined): string {
  if (!cuidados) return 'Não registrado.'
  const partes: string[] = []
  partes.push(cuidados.ibp_em_uso
    ? `IBP em uso${cuidados.ibp_via ? ` (${cuidados.ibp_via}${cuidados.ibp_dose_valor != null ? `, ${cuidados.ibp_dose_valor} ${cuidados.ibp_dose_unidade ?? ''}` : ''}${cuidados.ibp_objetivo ? `, ${cuidados.ibp_objetivo}` : ''})` : ''}`
    : 'sem IBP')
  partes.push(cuidados.anticoag_em_uso
    ? `anticoagulação com ${cuidados.anticoag_droga === 'Outro' ? (cuidados.anticoag_droga_outro || 'droga não especificada') : cuidados.anticoag_droga}${cuidados.anticoag_via ? ` (${cuidados.anticoag_via}${cuidados.anticoag_dose_valor != null ? `, ${cuidados.anticoag_dose_valor} ${cuidados.anticoag_dose_unidade ?? ''}` : ''}${cuidados.anticoag_objetivo ? `, ${cuidados.anticoag_objetivo}` : ''})` : ''}`
    : 'sem anticoagulação')
  return partes.join('; ') + '.'
}

// ── Turnos ────────────────────────────────────────────────────────────────

export function getTurno(dt: Date): 'diurno' | 'noturno' {
  const h = dt.getHours()
  return h >= 7 && h < 19 ? 'diurno' : 'noturno'
}

/** Returns the next turn boundary (07:00 or 19:00) after a given datetime */
export function getNextBoundary(dt: Date): Date {
  const result = new Date(dt)
  result.setSeconds(0, 0)
  result.setMinutes(0)
  const h = dt.getHours()
  if (h >= 7 && h < 19) {
    result.setHours(19)                           // next boundary today at 19:00
  } else if (h >= 19) {
    result.setDate(result.getDate() + 1)
    result.setHours(7)                            // next boundary tomorrow at 07:00
  } else {
    result.setHours(7)                            // between 00:00–07:00 → 07:00 today
  }
  return result
}

export function calcHoras(inicio: Date, fim: Date): number {
  return (fim.getTime() - inicio.getTime()) / 3_600_000
}

// ── Cálculos de Balanço Hídrico ───────────────────────────────────────────

/** Água endógena pro-rateada: 200 mL / 12 h */
export function calcAguaEndogena(horas: number): number {
  return Math.round(((200 / 12) * horas) * 10) / 10
}

/** Perdas insensíveis pro-rateadas: 0,5 mL/Kg/h */
export function calcPerdasInsensiveis(pesoKg: number, horas: number): number {
  return Math.round(0.5 * pesoKg * horas * 10) / 10
}

export function calcBalanco(p: PeriodoBalanco): BalancoCalculado {
  const ganhos = p.venoso + p.oral_enteral + p.agua_endogena
  const perdas = p.diurese + p.dialise + p.febre + p.evacuacao +
                 p.dreno + p.vomitos + p.sne_sng + p.ostomia + p.perdas_insensiveis
  return { ganhos, perdas, parcial: ganhos - perdas }
}

export function calcAcumuladoTotal(periodos: PeriodoBalanco[]): number {
  return periodos.reduce((acc, p) => acc + calcBalanco(p).parcial, 0)
}

export function calcAcumuladoMovel(periodos: PeriodoBalanco[]): number {
  // Last 10 periods = last 5 days
  const ultimos = [...periodos]
    .sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())
    .slice(0, 10)
  return ultimos.reduce((acc, p) => acc + calcBalanco(p).parcial, 0)
}

export function resumoBalanco(periodos: PeriodoBalanco[], pesoKg: number | null): string {
  if (!periodos.length) return 'Não registrado.'
  const ultimo = [...periodos].sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())[0]
  const bc = calcBalanco(ultimo)
  const diureseHora = ultimo.horas_periodo > 0 ? (ultimo.diurese / ultimo.horas_periodo).toFixed(1) : null
  const diureseKg = pesoKg && ultimo.horas_periodo > 0
    ? (ultimo.diurese / (pesoKg * ultimo.horas_periodo)).toFixed(2) : null
  const movel = calcAcumuladoMovel(periodos)
  return `Último turno (${ultimo.turno}, ${ultimo.horas_periodo}h): diurese ${ultimo.diurese} mL` +
    (diureseHora ? ` (${diureseHora} mL/h${diureseKg ? `, ${diureseKg} mL/kg/h` : ''})` : '') +
    `, BH parcial ${bc.parcial > 0 ? '+' : ''}${bc.parcial.toFixed(0)} mL. ` +
    `Acumulado móvel (últimos turnos): ${movel > 0 ? '+' : ''}${movel.toFixed(0)} mL.`
}

/** Given admission datetime, return the first period's start/end/horas */
export function calcFirstPeriod(admissionISO: string): {
  inicio: Date; fim: Date; horas: number; turno: 'diurno' | 'noturno'
} {
  const inicio = new Date(admissionISO)
  const fim    = getNextBoundary(inicio)
  const horas  = calcHoras(inicio, fim)
  return { inicio, fim, horas, turno: getTurno(inicio) }
}

/** Given the end of the last registered period, return the next period spec */
export function calcNextPeriod(lastFimISO: string): {
  inicio: Date; fim: Date; horas: number; turno: 'diurno' | 'noturno'
} {
  const inicio = new Date(lastFimISO)
  const fim    = new Date(inicio.getTime() + 12 * 3_600_000)
  return { inicio, fim, horas: 12, turno: getTurno(inicio) }
}

export function fmtTurno(turno: string, inicio: string): string {
  const dt  = new Date(inicio)
  const dia = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  return `${dia} ${turno === 'diurno' ? '☀️ Diurno' : '🌙 Noturno'}`
}

export function colorParcial(value: number): string {
  if (value > 200)  return 'text-red-600 font-bold'
  if (value > 0)    return 'text-orange-500 font-semibold'
  if (value > -200) return 'text-green-600 font-semibold'
  return 'text-blue-600 font-bold'
}
