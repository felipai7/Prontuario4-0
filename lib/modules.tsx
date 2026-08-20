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
import BalancoDiarioTab from '@/components/modules/plantonista/BalancoDiarioTab'
import SinaisVitaisTab from '@/components/modules/plantonista/SinaisVitaisTab'
import HemodinamicaTab from '@/components/modules/plantonista/HemodinamicaTab'
import NeurologicoTab  from '@/components/modules/plantonista/NeurologicoTab'
import VentilatorioTab from '@/components/modules/plantonista/VentilatorioTab'
import IntensivistaTab from '@/components/modules/intensivista/IntensivistaTab'
import FisioterapiaTab from '@/components/modules/fisioterapia/FisioterapiaTab'
import EnfermagemTab from '@/components/modules/enfermagem/EnfermagemTab'
import PendenciasTab from '@/components/modules/shared/PendenciasTab'
import IrasTab from '@/components/modules/intensivista/IrasTab'
import NutricaoTab from '@/components/modules/nutricao/NutricaoTab'
import ExamesTab       from '@/components/modules/shared/ExamesTab'
import ExamesImagemTab from '@/components/modules/shared/ExamesImagemTab'
import { featureFlags } from '@/lib/featureFlags'
import type { Paciente, Exame, PeriodoBalanco, SinalVital, ExameImagem, DVA, PeriodoHemodinamica, ATB, CuidadosHorizontais, AvaliacaoNeurologica, SuporteVentilatorio, Intercorrencia, PendenciaIntensivista, RegistroIntensivista, FisioEvento, FisioAvaliacaoDiaria, Dispositivo, LppEvento, SwabVigilancia, NutricaoAvaliacao, NutricaoDia, AuditoriaIntensivista, IrasEvento, IrasSepseChoque, ToastData, Cargo, Profissao } from '@/types'

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
  swabs: SwabVigilancia[]
  nutricaoAvaliacao: NutricaoAvaliacao | null
  nutricaoDias: NutricaoDia[]
  auditoria: AuditoriaIntensivista[]
  irasEventos: IrasEvento[]
  irasSepse: IrasSepseChoque | null
  /** Cargo do usuário logado. Null = sem cadastro em `staff` (cai no padrão). */
  cargo: Cargo | null
  /** Tipo da unidade em exibição — decide rótulos e o que aparece nas abas
   *  compartilhadas (ex.: Resumo esconde DVA e usa balanço diário no Hospital). */
  tipoUnidade: 'uti' | 'enfermaria'
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
      registrosIntensivista={ctx.registrosIntensivista} swabs={ctx.swabs}
      examesImagem={ctx.examesImagem} tipoUnidade={ctx.tipoUnidade}
      onRefresh={ctx.onRefresh} showToast={ctx.showToast} />
  ),
}

const balanco: TabDef = {
  id: 'balanco',
  label: '💧 Balanço Hídrico',
  render: ctx => <BalancoTab paciente={ctx.paciente} periodos={ctx.periodos} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

// Variante do Hospital: 1 lançamento por dia, sem os cálculos automáticos
// que a UTI faz por turno (ver comentário no topo de BalancoDiarioTab.tsx).
const balancoDiario: TabDef = {
  id: 'balanco',
  label: '💧 Balanço Hídrico',
  render: ctx => <BalancoDiarioTab paciente={ctx.paciente} periodos={ctx.periodos} onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
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
    dispositivos={ctx.dispositivos}
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
    lpps={ctx.lpps} swabs={ctx.swabs} ventHistorico={ctx.ventHistorico} podeEditar={ctx.podeEditar}
    onRefresh={ctx.onRefresh} showToast={ctx.showToast} />,
}

// Escrita fica em cuidadosHorizontais (módulo Médico Intensivista, chefe) —
// aqui é só leitura, replicada nos módulos de quem não passa por lá no dia a
// dia (enfermagem, fisioterapia, nutrição) mas precisa saber o que ficou
// pendente. Sem dona explícito não haveria problema (a aba não tem nenhum
// controle de escrita), mas registrar o dono real evita confusão se algum
// dia um botão de resolver pendência entrar aqui.
const pendenciasOrientacoes: TabDef = {
  id: 'pendencias',
  label: '📝 Pendências e Orientações',
  dona: { profissaoDona: 'medico', exigeChefe: true },
  render: ctx => <PendenciasTab pendencias={ctx.pendencias} registrosIntensivista={ctx.registrosIntensivista} />,
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
    // Exames Laboratoriais logo após o Balanço, a pedido do plantonista: são as
    // duas abas mais consultadas na passagem de plantão, e ficavam nas pontas.
    tabs: [painelPlantao, balanco, examesLab, sinais, hemodinamica, neurologico, ventilatorio, examesImagem],
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
    tabs: [pendenciasOrientacoes, fisioterapia, ventilatorio, examesImagem],
  },
  {
    id: 'enfermagem',
    label: '💉 Enfermagem',
    profissaoDona: 'enfermeiro',
    // Balanço e Sinais Vitais entram porque já são preenchidos pela enfermagem
    // na prática; o dono deles continua sendo o módulo médico, então aqui
    // aparecem em leitura até decidirmos mover o registro.
    tabs: [pendenciasOrientacoes, enfermagem, balanco, sinais],
  },
  {
    id: 'nutricao',
    label: '🥗 Nutrição',
    profissaoDona: 'nutricionista',
    // Balanço entra porque a diarreia é marcada lá: a nutrição precisa ver as
    // evacuações do dia para avaliar tolerância. O dono continua sendo o médico.
    tabs: [pendenciasOrientacoes, nutricao, balanco],
  },
]

// ── Módulos da enfermaria (Hospital): só Médico + Internos ──────────────────
//
// "Internos" é a mesma permissão de "Médico Plantonista" de hoje, só com
// rótulo diferente — nenhuma regra nova (decisão do plano: "só o nome
// muda"). Dispositivos/LPP/Swabs (aba `enfermagem`) entra dentro de
// Internos porque o módulo de Enfermagem inteiro fica oculto na enfermaria
// — reaproveita o TabDef como já existe, sem separar dispositivos do resto
// (decisão do plano).
//
// "Painel do Plantão" vira "Resumo" no Hospital e aparece nos DOIS módulos
// (Médico e Internos) — spread sobre o TabDef original só pra trocar o
// rótulo, mesmo `render`/`id`. Hemodinâmica, Neurológico e Ventilatório saem
// por completo (não são usados no Hospital); Balanço usa a variante diária
// (`balancoDiario`).
const resumo: TabDef = { ...painelPlantao, label: '📋 Resumo' }

const MODULOS_ENFERMARIA: readonly ModuloDef[] = [
  {
    id: 'medico',
    label: '📋 Médico',
    profissaoDona: 'medico',
    exigeChefe: true,
    tabs: [resumo, cuidadosHorizontais, iras, examesLab, examesImagem],
  },
  {
    id: 'internos',
    label: '🩺 Internos',
    profissaoDona: 'medico',
    tabs: [resumo, balancoDiario, examesLab, sinais, examesImagem, enfermagem],
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

/** Módulos visíveis na sessão atual, conforme a feature flag e o tipo da
 *  unidade — 'uti' mantém os 5 módulos de sempre, 'enfermaria' mostra só
 *  Médico + Internos (ver decisão 6/7 do plano de transferência). */
export function modulosAtivos(tipoUnidade: 'uti' | 'enfermaria' = 'uti'): readonly ModuloDef[] {
  if (!featureFlags.novaEstrutura) return [LEGACY]
  return tipoUnidade === 'enfermaria' ? MODULOS_ENFERMARIA : MODULOS
}
