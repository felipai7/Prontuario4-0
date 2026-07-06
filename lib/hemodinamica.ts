// Lógica de hemodinâmica (drogas vasoativas, cálculo de dose, resumo do turno)
// compartilhada entre a aba Hemodinâmica (UI) e a Evolução Diária (texto puro).
// Fica em lib/ — não em components/ — porque lib/evolucaoDiaria.ts depende
// dela e não deve importar de um arquivo de componente 'use client'.

import { fmtNum, boundaryStart } from '@/lib/utils'
import type { DVA, PeriodoHemodinamica, SinalVital } from '@/types'

export interface Variante { label: string; valor: number; unidade_conc: string }
export interface DrogaConfig {
  nome: string
  variantes: Variante[]
  dose_unidade: string
  dose_alvo_min: number
  dose_alvo_max: number
  dose_alvo_label: string
  usaPeso: boolean
  calcDose: (fluxo: number, conc: number, peso: number) => number
  formatDose: (d: number) => string
}

export const DROGAS: DrogaConfig[] = [
  {
    nome: 'Noradrenalina',
    variantes: [
      { label: 'Simples (64 mcg/mL)', valor: 64,  unidade_conc: 'mcg/mL' },
      { label: 'Dobrada (128 mcg/mL)', valor: 128, unidade_conc: 'mcg/mL' },
    ],
    dose_unidade: 'mcg/Kg/min', dose_alvo_min: 0.01, dose_alvo_max: 1.5,
    dose_alvo_label: '0,01 – 1,5 mcg/Kg/min',
    usaPeso: true,
    calcDose: (f, c, p) => (f * c) / (60 * p),
    formatDose: d => fmtNum(d, 3),
  },
  {
    nome: 'Vasopressina',
    variantes: [
      { label: 'Simples (0,2 UI/mL)', valor: 0.2, unidade_conc: 'UI/mL' },
      { label: 'Dobrada (0,4 UI/mL)', valor: 0.4, unidade_conc: 'UI/mL' },
    ],
    dose_unidade: 'UI/min', dose_alvo_min: 0.01, dose_alvo_max: 0.04,
    dose_alvo_label: '0,01 – 0,04 UI/min',
    usaPeso: false,
    calcDose: (f, c, _p) => (f * c) / 60,
    formatDose: d => fmtNum(d, 3),
  },
  {
    nome: 'Dopamina',
    variantes: [{ label: 'Padrão (1.000 mcg/mL)', valor: 1000, unidade_conc: 'mcg/mL' }],
    dose_unidade: 'mcg/Kg/min', dose_alvo_min: 1, dose_alvo_max: 20,
    dose_alvo_label: '1 – 20 mcg/Kg/min',
    usaPeso: true,
    calcDose: (f, c, p) => (f * c) / (60 * p),
    formatDose: d => fmtNum(d, 2),
  },
  {
    nome: 'Dobutamina',
    variantes: [{ label: 'Padrão (5.000 mcg/mL)', valor: 5000, unidade_conc: 'mcg/mL' }],
    dose_unidade: 'mcg/Kg/min', dose_alvo_min: 2, dose_alvo_max: 20,
    dose_alvo_label: '2 – 20 mcg/Kg/min',
    usaPeso: true,
    calcDose: (f, c, p) => (f * c) / (60 * p),
    formatDose: d => fmtNum(d, 2),
  },
  {
    nome: 'Nitroglicerina (Tridil)',
    variantes: [{ label: 'Padrão (200 mcg/mL)', valor: 200, unidade_conc: 'mcg/mL' }],
    dose_unidade: 'mcg/min', dose_alvo_min: 5, dose_alvo_max: 20,
    dose_alvo_label: '5 – 20 mcg/min (até 200 mcg/min)',
    usaPeso: false,
    calcDose: (f, c, _p) => (f * c) / 60,
    formatDose: d => fmtNum(d, 1),
  },
  {
    nome: 'Nitroprussiato (Nipride)',
    variantes: [{ label: 'Padrão (200 mcg/mL)', valor: 200, unidade_conc: 'mcg/mL' }],
    dose_unidade: 'mcg/Kg/min', dose_alvo_min: 0.3, dose_alvo_max: 10,
    dose_alvo_label: '0,3 – 10 mcg/Kg/min',
    usaPeso: true,
    calcDose: (f, c, p) => (f * c) / (60 * p),
    formatDose: d => fmtNum(d, 3),
  },
]

export const NITROS = ['Nitroglicerina (Tridil)', 'Nitroprussiato (Nipride)']
export const VASOPRESSORS_NO_DOBUT = ['Noradrenalina', 'Vasopressina', 'Dopamina']

export function getBlockReason(candidate: string, activeNames: string[]): string | null {
  if (activeNames.includes(candidate)) return 'Já está em uso'
  if (NITROS.includes(candidate)) {
    const otherNitro = activeNames.find(n => NITROS.includes(n))
    if (otherNitro) return `Incompatível com ${otherNitro}`
    const vaso = activeNames.find(n => VASOPRESSORS_NO_DOBUT.includes(n))
    if (vaso) return `Incompatível com vasopressor ativo (${vaso})`
  }
  if (VASOPRESSORS_NO_DOBUT.includes(candidate)) {
    const nitro = activeNames.find(n => NITROS.includes(n))
    if (nitro) return `Incompatível com vasodilatador ativo (${nitro})`
  }
  return null
}

export function getDrogaConfig(nome: string): DrogaConfig | undefined {
  return DROGAS.find(d => d.nome === nome)
}

export function calcDoseForDVA(dva: DVA, peso: number | null): number | null {
  const cfg = getDrogaConfig(dva.droga)
  if (!cfg) return null
  if (cfg.usaPeso && !peso) return null
  return cfg.calcDose(dva.fluxo_ml_h, dva.concentracao_valor, peso ?? 1)
}

export function doseAlert(dose: number, cfg: DrogaConfig): 'ok' | 'warn' | 'crit' {
  if (dose < cfg.dose_alvo_min * 0.9 || dose > cfg.dose_alvo_max * 1.1) return 'crit'
  if (dose > cfg.dose_alvo_max) return 'warn'
  return 'ok'
}

export type FcRange = { min: number; max: number }
export type PaRange = { pasMin: number; pasMax: number; padMin: number; padMax: number }

export function buildSummaryText(
  ativos: DVA[],
  peso: number | null,
  fcRange: FcRange | null,
  paRange: PaRange | null,
): string {
  let vitaisSuffix = ''
  if (fcRange || paRange) {
    const parts: string[] = []
    if (fcRange) parts.push(`FC entre ${fcRange.min} e ${fcRange.max} bpm`)
    if (paRange) parts.push(`PA entre ${paRange.pasMin}/${paRange.padMin} e ${paRange.pasMax}/${paRange.padMax} mmHg`)
    vitaisSuffix = `, mantendo ${parts.join(', ')} no período`
  }

  if (!ativos.length) return 'Hemodinâmica estável sem uso de agentes vasoativos' + vitaisSuffix + '.'

  const partes = ativos.map(dva => {
    const cfg = getDrogaConfig(dva.droga)
    const fluxoStr = dva.fluxo_ml_h % 1 === 0 ? String(dva.fluxo_ml_h) : fmtNum(dva.fluxo_ml_h, 1)
    if (!cfg || !peso) return `${dva.droga} ${fluxoStr} mL/h`
    const dose = cfg.calcDose(dva.fluxo_ml_h, dva.concentracao_valor, peso)
    return `${dva.droga} ${fluxoStr} mL/h (${cfg.formatDose(dose)} ${cfg.dose_unidade})`
  })
  const inicio = 'Hemodinâmica mantida às custas do uso de '
  const meio = partes.length === 1 ? partes[0] : partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1]
  return inicio + meio + vitaisSuffix + '.'
}

/** Filtra as DVAs pertencentes ao período hemodinâmico atual (ou sem período, se não houver turno aberto). */
export function filtrarAtivasNoPeriodo(dvas: DVA[], currentPeriodo: PeriodoHemodinamica | null): DVA[] {
  return dvas.filter(d =>
    d.ativo && (
      currentPeriodo
        ? (d.periodo_id === currentPeriodo.id || d.periodo_id === null)
        : d.periodo_id === null
    )
  )
}

/** Sinais vitais dentro da janela do período hemodinâmico atual (ou últimas 12h, se não houver turno aberto). */
export function sinaisNoPeriodo(sinais: SinalVital[], currentPeriodo: PeriodoHemodinamica | null): SinalVital[] {
  if (currentPeriodo) {
    const start = new Date(currentPeriodo.inicio).getTime()
    const end   = currentPeriodo.fim ? new Date(currentPeriodo.fim).getTime() : Date.now()
    return sinais.filter(s => {
      const t = new Date(s.horario).getTime()
      return t >= start && t <= end
    })
  }
  const cutoff = Date.now() - 12 * 3600 * 1000
  return sinais.filter(s => new Date(s.horario).getTime() >= cutoff)
}

export function calcRanges(periodSinais: SinalVital[]): { fcRange: FcRange | null; paRange: PaRange | null } {
  const fcVals  = periodSinais.filter(s => s.fc  !== null).map(s => s.fc!)
  const pasVals = periodSinais.filter(s => s.pas !== null).map(s => s.pas!)
  const padVals = periodSinais.filter(s => s.pad !== null).map(s => s.pad!)
  const fcRange: FcRange | null = fcVals.length >= 2
    ? { min: Math.min(...fcVals), max: Math.max(...fcVals) } : null
  const paRange: PaRange | null = pasVals.length >= 2 && padVals.length >= 2
    ? { pasMin: Math.min(...pasVals), pasMax: Math.max(...pasVals),
        padMin: Math.min(...padVals), padMax: Math.max(...padVals) } : null
  return { fcRange, paRange }
}

/**
 * Turno hemodinâmico mais recente pela ordenação de data/turno. No modelo
 * atual todo turno já nasce com início e fim definidos, então "o turno
 * vigente" é sempre o mais recente — não existe mais turno "aberto".
 */
export function ultimoPeriodoHemo(periodos: PeriodoHemodinamica[]): PeriodoHemodinamica | null {
  return [...periodos].sort((a, b) =>
    boundaryStart(b.data, b.turno).getTime() - boundaryStart(a.data, a.turno).getTime()
  )[0] ?? null
}

/** Resumo hemodinâmico determinístico do turno atual — usado no banner da aba e na Evolução Diária. */
export function resumoHemodinamica(
  dvas: DVA[],
  periodos: PeriodoHemodinamica[],
  sinais: SinalVital[],
  peso: number | null,
): string {
  const currentPeriodo = ultimoPeriodoHemo(periodos)
  const ativosDVA = filtrarAtivasNoPeriodo(dvas, currentPeriodo)
  const { fcRange, paRange } = calcRanges(sinaisNoPeriodo(sinais, currentPeriodo))
  return buildSummaryText(ativosDVA, peso, fcRange, paRange)
}
