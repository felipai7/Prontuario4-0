// ══════════════════════════════════════════════════════════════════════════
// Adaptador: resultado da extração → linhas da tabela `exames`.
//
// É a fronteira entre o módulo novo, que não interpreta nada (R3), e o schema
// que a tela já usa. Tudo que é decisão clínica de apresentação — se está
// alterado, para que lado, como exibir — acontece aqui, e não lá dentro.
//
// Decisões da Juliana em 01/08/2026, na revisão da integração:
//   Q4  valor censurado guarda o operador junto do número
//   Q5  cada data de coleta vira um registro próprio
// ══════════════════════════════════════════════════════════════════════════

import type { ExtractionResult, Observation } from '@/lib/exames/extracao'
import type { ResultadoExame } from '@/types'
import {
  interpretarCruzes,
  interpretarNumerico,
  interpretarQualitativo,
} from './interpretacao'

/** Uma linha pronta para inserir em `exames`. */
export interface ExameParaSalvar {
  tipo_exame: string
  /** "DD/MM/AAAA" ou "DD/MM/AAAA HH:MM", como a tela espera. Nunca inventada. */
  data_exame: string | null
  resultados: ResultadoExame[]
  observacoes: string | null
}

/** Motivos de revisão em português, para a tela mostrar sem traduzir. */
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

/** ISO → "DD/MM/AAAA HH:MM", que é o formato que a tela e o agrupamento leem. */
function paraFormatoDaTela(iso: string | null): string | null {
  if (!iso) return null
  const [data, hora] = iso.split('T')
  const [ano, mes, dia] = (data ?? '').split('-')
  if (!ano || !mes || !dia) return null
  return hora ? `${dia}/${mes}/${ano} ${hora.slice(0, 5)}` : `${dia}/${mes}/${ano}`
}

/** Texto de exibição do valor, preservando a grafia do laudo. */
function textoDoValor(o: Observation): string {
  return o.value.raw.trim() || '—'
}

function textoDaReferencia(o: Observation): string | null {
  const r = o.reference
  switch (r.kind) {
    case 'range': return `${r.min} - ${r.max}`
    case 'upperBound': return `até ${r.max}`
    case 'lowerBound': return `acima de ${r.min}`
    case 'qualitative': return r.raw
    // 'rejected' vira null DE PROPÓSITO: o laudo trouxe algo, e esse algo não
    // era uma faixa. Exibi-lo como se fosse referência é o defeito D5.
    default: return null
  }
}

function converter(o: Observation): ResultadoExame {
  const v = o.value
  const numerico = v.kind === 'numeric' ? v.value : null
  const censura = v.kind === 'numeric' && v.censoring !== 'none' ? v.censoring : null

  const interpretacao =
    v.kind === 'numeric' ? interpretarNumerico(v.value, censura, o.reference)
    : v.kind === 'qualitative' ? interpretarQualitativo(v.code)
    : v.kind === 'semiquantitative' ? interpretarCruzes(v.crosses)
    : { alterado: false, direcao: 'qualitativo' as const }

  return {
    nome: o.canonicalName ?? o.rawName,
    valor: textoDoValor(o),
    unidade: o.unit.canonical ?? (o.unit.raw || null),
    referencia: textoDaReferencia(o),
    alterado: interpretacao.alterado,
    direcao: interpretacao.direcao,
    valor_num: numerico,
    censura,
    analito_id: o.analyteId,
    revisar: o.requiresReview,
    motivos_revisao: o.reviewReasons.map(m => MOTIVOS[m] ?? m),
  }
}

/**
 * Divide o resultado da extração em uma linha por DATA DE COLETA.
 *
 * Um PDF pode agregar coletas de dias diferentes — o laboratório libera tudo
 * junto. Guardar como um exame só põe os resultados do segundo dia na data do
 * primeiro, e a evolução do paciente passa a mostrar o valor no dia errado,
 * sem nenhum aviso. Decisão da Juliana (Q5): cada data vira um registro.
 *
 * Exames sem data ficam num registro próprio com `data_exame: null` — nunca
 * herdam a data de outro grupo, e nunca recebem a data de hoje (R8: o doador
 * fazia isso, e era o defeito D6).
 */
export function adaptarParaExames(
  resultado: ExtractionResult,
  tipoPadrao = 'Exame',
): ExameParaSalvar[] {
  const porData = new Map<string, Observation[]>()
  for (const o of resultado.observations) {
    const chave = o.collectedAt.iso ?? ''
    const grupo = porData.get(chave)
    if (grupo) grupo.push(o)
    else porData.set(chave, [o])
  }

  const linhas: ExameParaSalvar[] = []
  // Ordem estável: mais antigo primeiro, sem data por último.
  const chaves = [...porData.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))

  for (const chave of chaves) {
    const observacoes = porData.get(chave)!
    linhas.push({
      tipo_exame: tipoPadrao,
      data_exame: paraFormatoDaTela(chave || null),
      resultados: observacoes.map(converter),
      observacoes: resumoDeAvisos(resultado, observacoes.length),
    })
  }

  return linhas
}

/**
 * Avisos do extrator em texto, no campo que a tela já exibe.
 *
 * A7 — o módulo devolve avisos como dado; traduzi-los para o usuário é
 * trabalho desta camada, não dele.
 */
function resumoDeAvisos(resultado: ExtractionResult, _quantidade: number): string | null {
  const partes: string[] = []

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
