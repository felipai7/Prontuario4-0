// ══════════════════════════════════════════════════════════════════════════
// O formato de entrega do domínio de exames.
//
// Antes de 03/08/2026 o adaptador convertia direto para o formato do BANCO
// (`@/types`), e por isso só exame numérico passava: aquele formato não tem
// lugar para cultura nem para marcação de revisão. Doze culturas e todas as
// marcações eram produzidas e descartadas na fronteira (achados A-03 e A-04).
//
// Este arquivo é o formato do DOMÍNIO. Ele carrega tudo que o módulo produz.
// Quem traduz para o banco é `adaptador.ts`, a peça de borda — e é o único
// lugar em `lib/exames/` que pode importar `@/types`.
// ══════════════════════════════════════════════════════════════════════════

import type { ExtractionResult, Observation, Reference, VeredictoPaciente } from './extracao'

export interface ValorEntregue {
  nome: string
  /** Grafia de exibição. Em conflito, os dois valores unidos por " / " (D5). */
  valor: string
  unidade: string | null
  /** Como exibir a referência — texto pronto para a tela. */
  referencia: string | null
  /**
   * O que `interpretarNumerico` precisa para decidir alterado/normal.
   *
   * Não é derivada de `referencia` (o texto de exibição): re-analisar o texto
   * repetiria o trabalho que o normalizador de referência já fez, e apagaria
   * a distinção entre `{kind:'absent'}` (o laudo não trouxe faixa) e
   * `{kind:'rejected'}` (o laudo trouxe algo que não é uma faixa confiável) —
   * distinção que existe porque uma faixa etária já foi lida como referência
   * e produziu alarme falso.
   */
  referenciaEstruturada: Reference
  /** `null` em conflito: sem escolher um valor, não há número (R3). */
  valorNumerico: number | null
  censura: 'lt' | 'lte' | 'gt' | 'gte' | null
  /**
   * Código do vocabulário qualitativo ("positive", "negative", ...), quando o
   * valor não é numérico. `null` em qualquer outro caso.
   *
   * Sem isto, "Nitrito: Negativo" e outros resultados de EAS chegariam ao
   * adaptador sem o dado que `interpretarQualitativo` precisa — a mesma perda
   * de informação na fronteira que este arquivo existe para evitar, só que
   * para resultado qualitativo em vez de cultura.
   */
  valorQualitativo: string | null
  /** Cruzes ("+++"), quando o valor é semiquantitativo. `null` nos demais casos. */
  cruzes: 1 | 2 | 3 | 4 | null
  analitoId: string | null
  precisaConferencia: boolean
  motivos: string[]
  conflito: boolean
  /** Rastreabilidade: de onde saiu este número. Sem texto do laudo (R10). */
  origem: { pagina: number; linha: number; regra: string }
}

export interface LinhaEntregue {
  dataColeta: string | null
  tipo: string
  valores: ValorEntregue[]
  observacoes: string | null
}

export interface Entrega {
  linhas: LinhaEntregue[]
  /** Pronta para a lista acima da tabela (D9). Vazia, nunca nula. */
  pendencias: { nome: string; motivo: string }[]
  conferenciaPaciente: VeredictoPaciente
  impressaoDigital: string
}

const MOTIVOS: Record<string, string> = {
  dateFromProximity: 'data deduzida pela proximidade, não por marcador de coleta',
  dateFromDocumentFallback: 'data do documento, não da coleta deste exame',
  dateAbsent: 'sem data de coleta',
  unknownAnalyte: 'exame não reconhecido no catálogo',
  unknownUnit: 'unidade não reconhecida',
  referenceRejected: 'a coluna de referência não trazia uma faixa confiável',
  implausibleValue: 'valor fora da faixa fisicamente possível',
  lowDetectionConfidence: 'laboratório não identificado com segurança',
  fallbackExtracted: 'lido por IA, não pelo extrator local',
  duplicateCollection: 'coleta possivelmente duplicada',
}

const CONFLITO = 'dois valores no mesmo laudo'

function iso(o: Observation): string { return o.collectedAt.iso ?? '' }

function paraFormatoDaTela(isoStr: string | null): string | null {
  if (!isoStr) return null
  const [data, hora] = isoStr.split('T')
  const [ano, mes, dia] = (data ?? '').split('-')
  if (!ano || !mes || !dia) return null
  return hora ? `${dia}/${mes}/${ano} ${hora.slice(0, 5)}` : `${dia}/${mes}/${ano}`
}

function textoDaReferencia(o: Observation): string | null {
  const r = o.reference
  switch (r.kind) {
    case 'range': return `${r.min} - ${r.max}`
    case 'upperBound': return `até ${r.max}`
    case 'lowerBound': return `acima de ${r.min}`
    case 'qualitative': return r.raw
    // 'rejected' vira null DE PROPÓSITO — o laudo trouxe algo, e esse algo não
    // era uma faixa. Exibi-lo como referência é o defeito D5 do doador.
    default: return null
  }
}

function deObservacao(o: Observation): ValorEntregue {
  const v = o.value
  return {
    nome: o.canonicalName ?? o.rawName,
    valor: v.raw.trim() || '—',
    unidade: o.unit.canonical ?? (o.unit.raw || null),
    referencia: textoDaReferencia(o),
    referenciaEstruturada: o.reference,
    valorNumerico: v.kind === 'numeric' ? v.value : null,
    censura: v.kind === 'numeric' && v.censoring !== 'none' ? v.censoring : null,
    valorQualitativo: v.kind === 'qualitative' ? v.code : null,
    cruzes: v.kind === 'semiquantitative' ? v.crosses : null,
    analitoId: o.analyteId,
    precisaConferencia: o.requiresReview,
    motivos: o.reviewReasons.map(m => MOTIVOS[m] ?? m),
    conflito: false,
    origem: { pagina: o.provenance.page, linha: o.provenance.lineIndex, regra: o.provenance.matcherId },
  }
}

/**
 * Funde dois ou mais valores do mesmo exame na mesma coleta (D4, D5).
 *
 * O sistema NÃO escolhe: mostra os dois, marca conflito, e deixa de opinar
 * sobre o número — `valorNumerico` vira null, então nenhuma camada acima
 * consegue classificar como alterado (R3).
 */
function fundirConflito(iguais: ValorEntregue[]): ValorEntregue {
  const base = iguais[0]!
  return {
    ...base,
    valor: iguais.map(v => v.valor).join(' / '),
    valorNumerico: null,
    censura: null,
    conflito: true,
    precisaConferencia: true,
    motivos: [...new Set([...iguais.flatMap(v => v.motivos), CONFLITO])],
  }
}

/** Uma cultura vira uma linha de texto, na tabela que já existe (D3). */
function deCultura(c: ExtractionResult['cultures'][number]): ValorEntregue {
  const organismos = c.isolates.map(i => i.organism).filter(Boolean)
  const texto =
    c.growth === 'noGrowth' ? 'Ausência de crescimento'
    : organismos.length > 0 ? organismos.join(', ')
    : c.growth === 'contaminated' ? 'Contaminada'
    : 'Indeterminada'
  const atb = c.isolates
    .flatMap(i => i.susceptibilities.map(s => `${s.antimicrobial} ${s.interpretation}`))
    .join(' · ')
  return {
    nome: c.specimen,
    valor: atb ? `${texto} — ${atb}` : texto,
    unidade: null,
    referencia: null,
    // Cultura não tem faixa de referência numérica — nunca teve o que rejeitar.
    referenciaEstruturada: { kind: 'absent' },
    valorNumerico: null,
    censura: null,
    valorQualitativo: null,
    cruzes: null,
    analitoId: null,
    precisaConferencia: true,
    motivos: ['cultura — confira o antibiograma no laudo'],
    conflito: false,
    origem: { pagina: c.provenance.page, linha: c.provenance.lineIndex, regra: c.provenance.matcherId },
  }
}

/**
 * Avisos do extrator em texto, no campo que a tela já exibe.
 *
 * A7 — o módulo devolve avisos como dado; traduzi-los para o usuário é
 * trabalho desta camada, não dele. Mesmo texto para toda linha do documento
 * porque os avisos são do DOCUMENTO, não da coleta — herdado de
 * `adaptador.ts`, que fazia isto antes desta inversão existir.
 */
function resumoDeAvisos(resultado: ExtractionResult, lidoPorIA: boolean): string | null {
  const partes: string[] = []

  if (lidoPorIA) partes.push('Lido por IA — não conferido pelo extrator local')

  const descartados = resultado.discarded.length
  if (descartados > 0) {
    partes.push(`${descartados} linha${descartados > 1 ? 's' : ''} não importada${descartados > 1 ? 's' : ''}`)
  }

  for (const aviso of resultado.warnings) {
    switch (aviso.code) {
      case 'corruptedTextLayer':
        partes.push('o texto do PDF veio ilegível e não foi usado')
        break
      case 'noTextLayer':
        partes.push('PDF sem texto (digitalizado): não foi possível ler')
        break
      case 'unrecognizedDocument':
        partes.push('laboratório não reconhecido')
        break
      case 'multipleCollectionDates':
        partes.push('o laudo traz coletas de datas diferentes')
        break
      case 'imagingSectionsIncomplete':
        partes.push('laudo de imagem sem cabeçalho de achados')
        break
      default:
        break
    }
  }

  return partes.length > 0 ? partes.join('; ') : null
}

export function montarEntrega(resultado: ExtractionResult, lidoPorIA: boolean): Entrega {
  const porData = new Map<string, ValorEntregue[]>()
  const guardar = (chave: string, valor: ValorEntregue) => {
    const g = porData.get(chave)
    if (g) g.push(valor); else porData.set(chave, [valor])
  }

  for (const o of resultado.observations) guardar(iso(o), deObservacao(o))
  for (const c of resultado.cultures) guardar(c.collectedAt.iso ?? '', deCultura(c))

  const linhas: LinhaEntregue[] = []
  const pendencias: { nome: string; motivo: string }[] = []
  const chaves = [...porData.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  const observacoes = resumoDeAvisos(resultado, lidoPorIA)

  for (const chave of chaves) {
    // Fusão de conflitos: mesmo nome, mesma coleta.
    const porNome = new Map<string, ValorEntregue[]>()
    for (const v of porData.get(chave)!) {
      const g = porNome.get(v.nome)
      if (g) g.push(v); else porNome.set(v.nome, [v])
    }
    const valores = [...porNome.values()].map(iguais =>
      iguais.length === 1 ? iguais[0]! : fundirConflito(iguais))

    for (const v of valores) {
      if (!v.precisaConferencia) continue
      for (const motivo of v.motivos) pendencias.push({ nome: v.nome, motivo })
    }

    linhas.push({
      dataColeta: paraFormatoDaTela(chave || null),
      tipo: 'Exame',
      valores,
      observacoes,
    })
  }

  return {
    linhas,
    pendencias,
    conferenciaPaciente: resultado.patientCheck,
    impressaoDigital: resultado.diagnostics.documentHash,
  }
}
