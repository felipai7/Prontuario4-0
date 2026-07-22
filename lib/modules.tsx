// Registro central de módulos e abas do prontuário do paciente.
// O PacienteModal é só uma casca: renderiza o seletor de módulos e as
// abas do módulo ativo a partir deste registro.
//
// Para adicionar um módulo futuro (Enfermagem, Nutrição, Fisioterapia):
//   1. Crie as abas em components/modules/<modulo>/
//   2. Registre o módulo em MODULOS abaixo
//
// Feature flag: com NEXT_PUBLIC_FF_NOVA_ESTRUTURA desligada, o app mostra
// um módulo único com as abas clássicas (LEGACY) — UI de produção intacta.

import PlantonistaTab  from '@/components/modules/plantonista/PlantonistaTab'
import BalancoTab      from '@/components/modules/plantonista/BalancoTab'
import SinaisVitaisTab from '@/components/modules/plantonista/SinaisVitaisTab'
import HemodinamicaTab from '@/components/modules/plantonista/HemodinamicaTab'
import NeurologicoTab  from '@/components/modules/plantonista/NeurologicoTab'
import VentilatorioTab from '@/components/modules/plantonista/VentilatorioTab'
import IntensivistaTab from '@/components/modules/intensivista/IntensivistaTab'
import FisioterapiaTab from '@/components/modules/fisioterapia/FisioterapiaTab'
import EnfermagemTab from '@/components/modules/enfermagem/EnfermagemTab'
import IrasTab from '@/components/modules/intensivista/IrasTab'
import NutricaoTab from '@/components/modules/nutricao/NutricaoTab'
import ExamesTab       from '@/components/modules/shared/ExamesTab'
import ExamesImagemTab from '@/components/modules/shared/ExamesImagemTab'
import { featureFlags } from '@/lib/featureFlags'
import type { Paciente, Exame, PeriodoBalanco, SinalVital, ExameImagem, DVA, PeriodoHemodinamica, ATB, CuidadosHorizontais, AvaliacaoNeurologica, SuporteVentilatorio, Intercorrencia, PendenciaIntensivista, RegistroIntensivista, FisioEvento, FisioAvaliacaoDiaria, Dispositivo, LppEvento, NutricaoAvaliacao, NutricaoDia, AuditoriaIntensivista, IrasEvento, IrasSepseChoque, ToastData, Cargo, Profissao } from '@/types'

/** Dados do paciente carregados pela casca e disponíveis a todas as abas. */
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
  neuroHistorico: AvaliacaoNeurologica[]
  ventHistorico: SuporteVentilatorio[]
  intercorrencias: Intercorrencia[]
  pendencias: PendenciaIntensivista[]
  registrosIntensivista: RegistroIntensivista[]
  fisioEventos: FisioEvento[]
  fisioAvaliacoes: FisioAvaliacaoDiaria[]
  dispositivos: Dispositivo[]
  lpps: LppEvento[]
  nutricaoAvaliacao: NutricaoAvaliacao | null
  nutricaoDias: NutricaoDia[]
  auditoria: AuditoriaIntensivista[]
  irasEventos: IrasEvento[]
  irasSepse: IrasSepseChoque | null
  /** Cargo do usuário logado. Null = sem cadastro em `staff` (cai no padrão). */
  cargo: Cargo | null
  /**
   * Se o usuário pode escrever no módulo ATIVO. Calculado pela casca a partir do
   * cargo e do dono do módulo — as abas não precisam conhecer a regra.
   */
  podeEditar: boolean
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

export interface TabDef {
  id: string
  label: string
  /**
   * Dono da aba, quando ele difere do dono do módulo. Existe porque uma aba
   * pode aparecer em mais de um módulo com papéis diferentes: Ventilatório é
   * registrada pela fisio, mas o plantonista precisa vê-la no módulo dele.
   * Sem isso, a permissão seguiria o módulo e o plantonista poderia editar.
   */
  dona?: DonoModulo
  render: (ctx: PacienteContext) => React.ReactNode
}

/** Quem edita: profissão e, opcionalmente, só o chefe dela. */
export interface DonoModulo {
  profissaoDona: Profissao
  exigeChefe?: boolean
}

export interface ModuloDef {
  id: string
  label: string
  /** Profissão que edita este módulo. Todo mundo enxerga; só o dono escreve. */
  profissaoDona: Profissao
  /**
   * Só o chefe da profissão edita. Necessário porque a profissão sozinha não
   * separa os dois módulos médicos — ambos são de médico.
   */
  exigeChefe?: boolean
  tabs: readonly TabDef[]
}

// ── Abas (instâncias únicas; as compartilhadas entram em mais de um módulo) ──

const painelPlantao: TabDef = {
  id: 'painel-plantao',
  label: '🚨 Painel do Plantão',
  render: ctx => (
    <PlantonistaTab paciente={ctx.paciente} sinais={ctx.sinais} dvas={ctx.dvas}
      periodos={ctx.periodos} atbs={ctx.atbs} cuidados={ctx.cuidados}
      intercorrencias={ctx.intercorrencias} pendencias={ctx.pendencias}
      registrosIntensivista={ctx.registrosIntensivista}
      onRefresh={ctx.onRefresh} showToast={ctx.showToast} />
  ),
}

const balanco: TabDef = {
  id: 'balanco',
  label: '💧 Balanço Hídrico',
  render: ctx => <BalancoTab paciente={ctx.paciente} periodos={ctx.periodos} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

const sinais: TabDef = {
  id: 'sinais',
  label: '❤️ Sinais Vitais',
  render: ctx => <SinaisVitaisTab paciente={ctx.paciente} sinais={ctx.sinais} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

const hemodinamica: TabDef = {
  id: 'hemo',
  label: '💊 Hemodinâmica',
  render: ctx => <HemodinamicaTab paciente={ctx.paciente} dvas={ctx.dvas} periodos={ctx.periodosHemo} sinais={ctx.sinais} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

const neurologico: TabDef = {
  id: 'neuro',
  label: '🧠 Neurológico',
  render: ctx => <NeurologicoTab paciente={ctx.paciente} historico={ctx.neuroHistorico} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

// Registrada pela fisioterapia em qualquer módulo onde apareça — inclusive no
// do plantonista, que a vê mas não edita. O ventilador-dia sai daqui, então
// ter um dono só evita dois registros divergindo sobre o mesmo dia.
const ventilatorio: TabDef = {
  id: 'ventilatorio',
  label: '🫁 Ventilatório',
  dona: { profissaoDona: 'fisioterapeuta' },
  render: ctx => <VentilatorioTab paciente={ctx.paciente} historico={ctx.ventHistorico}
    podeEditar={ctx.podeEditar} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

const examesLab: TabDef = {
  id: 'exames',
  label: '🔬 Exames Laboratoriais',
  render: ctx => <ExamesTab paciente={ctx.paciente} exames={ctx.exames} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

const examesImagem: TabDef = {
  id: 'imagem',
  label: '🩻 Exames de Imagem',
  render: ctx => <ExamesImagemTab paciente={ctx.paciente} examesImagem={ctx.examesImagem} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

const cuidadosHorizontais: TabDef = {
  id: 'horizontal',
  label: '📋 Cuidados Horizontais',
  render: ctx => <IntensivistaTab paciente={ctx.paciente} atbs={ctx.atbs} cuidados={ctx.cuidados}
    pendencias={ctx.pendencias} registrosIntensivista={ctx.registrosIntensivista}
    podeEditar={ctx.podeEditar}
    onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

const iras: TabDef = {
  id: 'iras',
  label: '🦠 IRAS e Vigilância',
  render: ctx => <IrasTab paciente={ctx.paciente} eventos={ctx.irasEventos} sepse={ctx.irasSepse}
    ventHistorico={ctx.ventHistorico} dispositivos={ctx.dispositivos}
    podeEditar={ctx.podeEditar} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

const fisioterapia: TabDef = {
  id: 'fisio',
  label: '🫁 Fisioterapia Respiratória',
  render: ctx => <FisioterapiaTab paciente={ctx.paciente} eventos={ctx.fisioEventos}
    avaliacoes={ctx.fisioAvaliacoes} ventHistorico={ctx.ventHistorico}
    podeEditar={ctx.podeEditar} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

const enfermagem: TabDef = {
  id: 'enfermagem',
  label: '💉 Dispositivos e LPP',
  render: ctx => <EnfermagemTab paciente={ctx.paciente} dispositivos={ctx.dispositivos}
    lpps={ctx.lpps} podeEditar={ctx.podeEditar}
    onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

const nutricao: TabDef = {
  id: 'nutricao',
  label: '🥗 Nutrição',
  render: ctx => <NutricaoTab paciente={ctx.paciente} avaliacao={ctx.nutricaoAvaliacao}
    dias={ctx.nutricaoDias} periodosBalanco={ctx.periodos}
    ventHistorico={ctx.ventHistorico} cuidados={ctx.cuidados} auditoria={ctx.auditoria}
    podeEditar={ctx.podeEditar}
    onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

// ── Módulos (nova estrutura) ────────────────────────────────────────────────

// Ao acrescentar um módulo (Enfermagem, Fisioterapia, Nutrição), declare a
// profissão dona: a regra de edição sai de graça, sem tocar em lib/cargos.ts.
export const MODULOS: readonly ModuloDef[] = [
  {
    id: 'plantonista',
    label: '🩺 Médico Plantonista',
    profissaoDona: 'medico',
    tabs: [painelPlantao, balanco, sinais, hemodinamica, neurologico, ventilatorio, examesLab, examesImagem],
  },
  {
    id: 'intensivista',
    label: '📋 Médico Intensivista',
    profissaoDona: 'medico',
    exigeChefe: true,
    tabs: [cuidadosHorizontais, iras, examesLab, examesImagem],
  },
  {
    id: 'fisioterapia',
    label: '🫁 Fisioterapia',
    profissaoDona: 'fisioterapeuta',
    tabs: [fisioterapia, ventilatorio, examesImagem],
  },
  {
    id: 'enfermagem',
    label: '💉 Enfermagem',
    profissaoDona: 'enfermeiro',
    // Balanço e Sinais Vitais entram porque já são preenchidos pela enfermagem
    // na prática; o dono deles continua sendo o módulo médico, então aqui
    // aparecem em leitura até decidirmos mover o registro.
    tabs: [enfermagem, balanco, sinais],
  },
  {
    id: 'nutricao',
    label: '🥗 Nutrição',
    profissaoDona: 'nutricionista',
    // Balanço entra porque a diarreia é marcada lá: a nutrição precisa ver as
    // evacuações do dia para avaliar tolerância. O dono continua sendo o médico.
    tabs: [nutricao, balanco],
  },
]

// ── Módulo único legado (flag desligada): as 6 abas clássicas ───────────────

const LEGACY: ModuloDef = {
  id: 'legacy',
  label: '',
  profissaoDona: 'medico',
  tabs: [
    balanco, sinais, examesLab, examesImagem, hemodinamica,
    { ...cuidadosHorizontais, label: '🩺 Médico Intensivista — Horizontal' },
  ],
}

/** Módulos visíveis na sessão atual, conforme a feature flag. */
export function modulosAtivos(): readonly ModuloDef[] {
  return featureFlags.novaEstrutura ? MODULOS : [LEGACY]
}
