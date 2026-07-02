// Registro central de módulos clínicos do paciente.
// O PacienteModal é só uma casca: renderiza as abas listadas aqui.
//
// Para adicionar um módulo novo:
//   1. Crie o componente da aba em components/
//   2. Registre-o abaixo com id, label e render
//   3. Se ainda estiver em desenvolvimento, aponte `flag` para uma
//      feature flag — o módulo só aparece com a flag ligada.

import ExamesTab       from '@/components/paciente/ExamesTab'
import BalancoTab      from '@/components/paciente/BalancoTab'
import SinaisVitaisTab from '@/components/paciente/SinaisVitaisTab'
import ExamesImagemTab from '@/components/paciente/ExamesImagemTab'
import HemodinamicaTab from '@/components/paciente/HemodinamicaTab'
import IntensivistaHorizontalTab from '@/components/paciente/IntensivistaHorizontalTab'
import { featureFlags, type FeatureFlag } from '@/lib/featureFlags'
import type { Paciente, Exame, PeriodoBalanco, SinalVital, ExameImagem, DVA, PeriodoHemodinamica, ATB, CuidadosHorizontais, ToastData } from '@/types'

/** Dados do paciente carregados pela casca e disponíveis a todos os módulos. */
export interface PacienteContext {
  paciente: Paciente
  exames: Exame[]
  periodos: PeriodoBalanco[]
  sinais: SinalVital[]
  examesImagem: ExameImagem[]
  dvas: DVA[]
  periodosHemo: PeriodoHemodinamica[]
  atbs: ATB[]
  cuidados: CuidadosHorizontais | null
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

export interface ModuleDef {
  id: string
  label: string
  /** Feature flag que libera o módulo; sem flag = sempre visível. */
  flag?: FeatureFlag
  render: (ctx: PacienteContext) => React.ReactNode
}

export const MODULES = [
  {
    id: 'balanco',
    label: '💧 Balanço Hídrico',
    render: ctx => <BalancoTab paciente={ctx.paciente} periodos={ctx.periodos} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
  },
  {
    id: 'sinais',
    label: '❤️ Sinais Vitais',
    render: ctx => <SinaisVitaisTab paciente={ctx.paciente} sinais={ctx.sinais} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
  },
  {
    id: 'exames',
    label: '🔬 Exames Laboratoriais',
    render: ctx => <ExamesTab paciente={ctx.paciente} exames={ctx.exames} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
  },
  {
    id: 'imagem',
    label: '🩻 Exames de Imagem',
    render: ctx => <ExamesImagemTab paciente={ctx.paciente} examesImagem={ctx.examesImagem} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
  },
  {
    id: 'hemo',
    label: '💊 Hemodinâmica',
    render: ctx => <HemodinamicaTab paciente={ctx.paciente} dvas={ctx.dvas} periodos={ctx.periodosHemo} sinais={ctx.sinais} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
  },
  {
    id: 'horizontal',
    label: '🩺 Intensivista Horizontal',
    render: ctx => <IntensivistaHorizontalTab paciente={ctx.paciente} atbs={ctx.atbs} cuidados={ctx.cuidados} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
  },
] as const satisfies readonly ModuleDef[]

export type ModuleId = (typeof MODULES)[number]['id']

/** Módulos visíveis na sessão atual (filtra os gateados por flag desligada). */
export function enabledModules(): readonly ModuleDef[] {
  return (MODULES as readonly ModuleDef[]).filter(m => !m.flag || featureFlags[m.flag])
}
