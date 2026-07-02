import { resumoHemodinamica } from '@/components/modules/plantonista/HemodinamicaTab'
import { fmtData, diaAtualATB, fmtNum } from '@/lib/utils'
import type {
  Paciente, SinalVital, DVA, PeriodoHemodinamica, PeriodoBalanco,
  ATB, AvaliacaoNeurologica, SuporteVentilatorio, Intercorrencia,
} from '@/types'

export interface EvolucaoDiariaInput {
  paciente: Paciente
  sinais: SinalVital[]
  dvas: DVA[]
  periodosHemo: PeriodoHemodinamica[]
  periodos: PeriodoBalanco[]
  atbs: ATB[]
  neuro: AvaliacaoNeurologica | null
  ventilatorio: SuporteVentilatorio | null
  intercorrencias: Intercorrencia[]
}

// ── 1. Estado geral ──────────────────────────────────────────────────────────
// Frase fixa para fins administrativos — todo paciente de UTI é sempre
// classificado em grave estado geral, independente da estabilidade clínica.
function fraseEstadoGeral(): string {
  return 'Avalio paciente em leito de UTI, em grave estado geral.'
}

// ── 2. Neurológico ───────────────────────────────────────────────────────────

const RASS_DESCRITIVO: Record<number, string> = {
  [4]:  'Paciente combativo, agressivo, com risco iminente à equipe',
  [3]:  'Paciente muito agitado, removendo tubos ou cateteres',
  [2]:  'Paciente agitado, com movimentos frequentes e não propositais',
  [1]:  'Paciente inquieto, ansioso, porém sem movimentos agressivos',
  [0]:  'Paciente desperto, abertura ocular espontânea, resposta verbal orientada e obedecendo comandos',
  [-1]: 'Paciente sonolento, abertura ocular aos chamados, resposta verbal confusa, localiza estímulos',
  [-2]: 'Paciente em sedação leve, desperta brevemente ao chamado com contato visual breve',
  [-3]: 'Paciente em sedação moderada, com movimento ou abertura ocular ao chamado, sem contato visual',
  [-4]: 'Paciente em sedação profunda, sem resposta à voz, com movimento ou abertura ocular ao estímulo físico',
  [-5]: 'Paciente não desperta, sem resposta à voz ou ao estímulo físico',
}

const GLASGOW_AO: Record<number, string> = {
  4: 'abertura ocular espontânea', 3: 'abertura ocular ao chamado', 2: 'abertura ocular à dor', 1: 'sem abertura ocular',
}
const GLASGOW_RV: Record<number, string> = {
  5: 'resposta verbal orientada', 4: 'resposta verbal confusa', 3: 'palavras inapropriadas',
  2: 'sons incompreensíveis', 1: 'sem resposta verbal',
}
const GLASGOW_RM: Record<number, string> = {
  6: 'obedecendo comandos', 5: 'localizando dor', 4: 'retirada inespecífica à dor',
  3: 'flexão anormal à dor (decorticação)', 2: 'extensão anormal à dor (descerebração)', 1: 'sem resposta motora',
}

function sufixoSedacao(neuro: AvaliacaoNeurologica): string {
  if (!neuro.sedacao_em_uso) return ', sem sedativos'
  const drogas = (neuro.sedativos ?? []).map(s => s === 'Outro' ? (neuro.sedativo_outro || 'sedativo não especificado') : s)
  let s = `, sedado com ${drogas.length ? drogas.join(' e ') : 'sedativo não especificado'}`
  if (neuro.despertar_diario === true)  s += ', em despertar diário'
  if (neuro.despertar_diario === false) s += ', sem despertar diário'
  return s
}

function fraseNeurologica(neuro: AvaliacaoNeurologica | null): string {
  if (!neuro) return 'Avaliação neurológica não registrada.'

  if (neuro.escala === 'GLASGOW' && neuro.glasgow_ao != null && neuro.glasgow_rv != null && neuro.glasgow_rm != null) {
    const total = neuro.glasgow_ao + neuro.glasgow_rv + neuro.glasgow_rm
    const lead = total === 15 ? 'desperto' : total >= 13 ? 'sonolento' : total >= 9 ? 'torporoso' : 'em coma'
    return `Paciente ${lead}, ${GLASGOW_AO[neuro.glasgow_ao]}, ${GLASGOW_RV[neuro.glasgow_rv]} e ${GLASGOW_RM[neuro.glasgow_rm]}` +
      sufixoSedacao(neuro) + '.'
  }

  if (neuro.rass != null) {
    const base = RASS_DESCRITIVO[neuro.rass] ?? `Paciente em RASS ${neuro.rass > 0 ? '+' : ''}${neuro.rass}`
    return base + sufixoSedacao(neuro) + '.'
  }

  return 'Avaliação neurológica não registrada.'
}

// ── 3. Ventilatório ──────────────────────────────────────────────────────────

function fraseVentilatoria(v: SuporteVentilatorio | null): string {
  if (!v || !v.modalidade) return 'Suporte ventilatório não registrado.'
  if (v.modalidade === 'ar_ambiente') return 'Paciente em ar ambiente.'
  if (v.modalidade === 'o2_suplementar') {
    return `Paciente em uso de O₂ suplementar${v.o2_dispositivo ? ` por ${v.o2_dispositivo}` : ''}${v.o2_fluxo_l_min != null ? ` a ${v.o2_fluxo_l_min} L/min` : ''}.`
  }
  return `Paciente em ventilação mecânica${v.vm_via ? ` por ${v.vm_via}` : ''}${v.vm_data_inicio ? ` desde ${fmtData(v.vm_data_inicio)}` : ''}.`
}

// ── 5. Diurese (últimas 24h, ou desde a admissão se internação mais recente) ─

function fraseDiurese(periodos: PeriodoBalanco[], pesoKg: number | null): string {
  if (!periodos.length) return 'Diurese não registrada desde a admissão.'

  const ordenados = [...periodos].sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())

  let janela: PeriodoBalanco[] = []
  let horasAcum = 0
  for (const p of ordenados) {
    janela.push(p)
    horasAcum += p.horas_periodo
    if (horasAcum >= 24) break
  }

  // Se a soma dos turnos disponíveis não chega a 24h, é porque a internação
  // é recente e ainda não há histórico suficiente — janela vira "desde admissão".
  const desdeAdmissao = horasAcum < 24
  const diureseTotal = janela.reduce((acc, p) => acc + p.diurese, 0)
  const horasJanela = Math.min(horasAcum, 24)
  const sufixoJanela = desdeAdmissao ? `${Math.round(horasJanela)}h desde admissão` : '24h'

  const rate = pesoKg && horasJanela > 0 ? diureseTotal / (pesoKg * horasJanela) : null
  const rateStr = rate != null ? `, ${fmtNum(rate, 2)}mL/Kg/h` : ''

  if (diureseTotal === 0) {
    return `Paciente anúrico, sem débito urinário nas últimas ${sufixoJanela}.`
  }
  if (rate != null && rate < 0.1) {
    return `Paciente anúrico, débito urinário residual de ${Math.round(diureseTotal)}mL nas últimas ${sufixoJanela}, <0,1mL/Kg/h.`
  }
  if (rate != null && rate < 0.5) {
    return `Paciente oligúrico, débito urinário de ${Math.round(diureseTotal)}mL nas últimas ${sufixoJanela}${rateStr}.`
  }
  return `Diurese presente, débito urinário de ${Math.round(diureseTotal)}mL nas últimas ${sufixoJanela}${rateStr}.`
}

// ── 6. Evacuação ─────────────────────────────────────────────────────────────

function fraseEvacuacao(periodos: PeriodoBalanco[]): string {
  const comEvacuacao = periodos.filter(p => p.evacuacao > 0)
  if (!comEvacuacao.length) return 'Sem evacuações desde admissão.'
  const ultimo = [...comEvacuacao].sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())[0]
  const dataPeriodo = fmtData(ultimo.inicio.slice(0, 10))
  return `Última evacuação registrada de ${ultimo.evacuacao}mL no período ${ultimo.turno} de ${dataPeriodo}.`
}

// ── 7. Antibioticoterapia ────────────────────────────────────────────────────

function fraseAntibioticoterapia(atbs: ATB[]): string {
  const ativos = atbs.filter(a => a.ativo)
  if (!ativos.length) return 'Paciente em vigilância infecciosa, sem evidência de foco infeccioso instalado.'

  const grupos = new Map<string, ATB[]>()
  for (const a of ativos) {
    const foco = a.foco?.trim() || 'não especificado'
    if (!grupos.has(foco)) grupos.set(foco, [])
    grupos.get(foco)!.push(a)
  }

  const juntarComE = (itens: string[]): string =>
    itens.length === 1 ? itens[0] : itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1]

  const partesGrupo: string[] = []
  for (const [foco, atbsDoFoco] of grupos) {
    const nomes = atbsDoFoco.map(a => `${a.droga} (D${diaAtualATB(a)}${a.dias_previstos != null ? `/D${a.dias_previstos}` : ''})`)
    partesGrupo.push(`${juntarComE(nomes)} para foco ${foco}`)
  }

  return `Paciente em uso de ${juntarComE(partesGrupo)}.`
}

// ── 8. Intercorrências (último turno, 12h) ───────────────────────────────────

function fraseIntercorrencias(intercorrencias: Intercorrencia[]): string {
  const cutoff = Date.now() - 12 * 3_600_000
  const doPeriodo = intercorrencias
    .filter(i => new Date(i.horario).getTime() >= cutoff)
    .sort((a, b) => new Date(a.horario).getTime() - new Date(b.horario).getTime())

  if (!doPeriodo.length) return 'Sem intercorrências no período.'

  const partes = doPeriodo.map(i => `${i.descricao}${i.conduta ? ` (conduta: ${i.conduta})` : ''}`)
  return `Intercorrências no período: ${partes.join('; ')}.`
}

/**
 * Monta a evolução diária em texto discursivo corrido, pronta para colar no
 * prontuário oficial do hospital — sem dados de identificação do paciente,
 * sem tópicos/rótulos, um parágrafo único.
 */
export function montarEvolucaoDiaria(input: EvolucaoDiariaInput): string {
  const { paciente, sinais, dvas, periodosHemo, periodos, atbs, neuro, ventilatorio, intercorrencias } = input

  const frases = [
    fraseEstadoGeral(),
    fraseNeurologica(neuro),
    fraseVentilatoria(ventilatorio),
    resumoHemodinamica(dvas, periodosHemo, sinais, paciente.peso_kg),
    fraseDiurese(periodos, paciente.peso_kg),
    fraseEvacuacao(periodos),
    fraseAntibioticoterapia(atbs),
    fraseIntercorrencias(intercorrencias),
  ]

  return frases.join(' ')
}
