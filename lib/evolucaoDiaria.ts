import { resumoHemodinamica } from '@/components/modules/plantonista/HemodinamicaTab'
import { fmtData, diasDesde, resumoNeuro, resumoVentilatorio, resumoBalanco, resumoAntibioticoterapia, resumoProfilaxias } from '@/lib/utils'
import type {
  Paciente, SinalVital, DVA, PeriodoHemodinamica, PeriodoBalanco,
  ATB, CuidadosHorizontais, AvaliacaoNeurologica, SuporteVentilatorio,
} from '@/types'

export interface EvolucaoDiariaInput {
  paciente: Paciente
  sinais: SinalVital[]
  dvas: DVA[]
  periodosHemo: PeriodoHemodinamica[]
  periodos: PeriodoBalanco[]
  atbs: ATB[]
  cuidados: CuidadosHorizontais | null
  neuro: AvaliacaoNeurologica | null
  ventilatorio: SuporteVentilatorio | null
}

function diasInternado(dataInternacao: string, horaInternacao: string): number {
  const inicio = new Date(dataInternacao + 'T' + horaInternacao)
  return Math.max(0, Math.floor((Date.now() - inicio.getTime()) / (24 * 3600 * 1000)))
}

/**
 * Monta a evolução diária compilando o resumo determinístico de cada sistema
 * (mesma lógica exibida em cada aba, sem passar por IA) — pronta para colar
 * no prontuário oficial do hospital.
 */
export function montarEvolucaoDiaria(input: EvolucaoDiariaInput): string {
  const { paciente, sinais, dvas, periodosHemo, periodos, atbs, cuidados, neuro, ventilatorio } = input

  const linhas: string[] = []
  linhas.push(`EVOLUÇÃO — ${paciente.nome}`)
  linhas.push(
    `${fmtData(paciente.data_internacao)} às ${paciente.hora_internacao} · ` +
    `${diasInternado(paciente.data_internacao, paciente.hora_internacao)} dia(s) de internação` +
    (paciente.saps3 != null ? ` · SAPS-3: ${paciente.saps3}` : '') +
    (paciente.paliativo ? ' · PACIENTE EM CUIDADOS PALIATIVOS' : '')
  )
  if (paciente.hipoteses) linhas.push(`Hipóteses: ${paciente.hipoteses}`)
  linhas.push('')

  linhas.push('NEUROLÓGICO')
  linhas.push(resumoNeuro(neuro))
  linhas.push('')

  linhas.push('VENTILATÓRIO')
  linhas.push(resumoVentilatorio(ventilatorio))
  linhas.push('')

  linhas.push('HEMODINÂMICA')
  linhas.push(resumoHemodinamica(dvas, periodosHemo, sinais, paciente.peso_kg))
  linhas.push('')

  linhas.push('BALANÇO HÍDRICO')
  linhas.push(resumoBalanco(periodos, paciente.peso_kg))
  linhas.push('')

  linhas.push('ANTIBIOTICOTERAPIA')
  linhas.push(resumoAntibioticoterapia(atbs))
  linhas.push('')

  linhas.push('PROFILAXIAS')
  linhas.push(resumoProfilaxias(cuidados))

  if (cuidados?.pendencias) {
    linhas.push('')
    linhas.push('PENDÊNCIAS E PROGRAMAÇÕES')
    linhas.push(cuidados.pendencias)
  }

  return linhas.join('\n')
}
