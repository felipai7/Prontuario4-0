import type { PeriodoBalanco, BalancoCalculado, AvaliacaoNeurologica, SuporteVentilatorio, ATB } from '@/types'

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

/** Formata número com casas decimais usando vírgula (padrão brasileiro). */
export function fmtNum(n: number, decimais: number): string {
  return n.toFixed(decimais).replace('.', ',')
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

/**
 * Dia atual de um ATB, respeitando se a data de início conta como D0 (dose
 * não completada no 1º dia) ou D1 (dose completa desde o início).
 */
export function diaAtualATB(atb: ATB): number {
  return diasDesde(atb.data_inicio) + atb.dia_inicial
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
