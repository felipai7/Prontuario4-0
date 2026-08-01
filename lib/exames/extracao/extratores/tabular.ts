// ══════════════════════════════════════════════════════════════════════════
// Matcher tabular — o caminho principal dos laudos laboratoriais.
//
// Layout: nome | valor | unidade | referência, em colunas separadas por vãos
// largos. Diferente do doador, a fronteira de coluna aqui é GEOMETRIA (vão
// medido entre itens), não uma cascata de expressões regulares sobre o texto
// reconstruído.
//
// A2 — o matcher não conhece nenhum outro. Precedência é declarada em
// registro.ts, não emerge da ordem de `if`s dentro de um laço.
// ══════════════════════════════════════════════════════════════════════════

import type { Matcher, MatchOutcome, ParseContext, RawObservation, Segment, TextLine } from '../contratos'
import { separarColunas, separarValorUnidade, pareceReferencia } from './colunas'
import { interpretarValor, ehNaoUsadoClinicamente } from '../normalizadores/valor'
import { resolverAnalito } from '../catalogo'
import especimes from '../catalogo/especimes.json'

/** Parâmetros descartados de propósito dentro da gasometria, por redundância. */
const DESCARTE_GASO = new Set(
  (especimes.gasometry.deliberatelyDiscarded as string[]).map(s => s.toUpperCase()),
)

/** O nome tem que parecer nome de exame: começa por letra e não é só número. */
const RE_NOME = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s.,()\-+/%]*$/

function proveniencia(linha: TextLine, ctx: ParseContext, matcherId: string) {
  return {
    page: linha.page,
    lineIndex: linha.index,
    rawLine: ctx.options.retainRawText ? linha.text : '',
    matcherId,
    profileId: ctx.profile.id,
    fallbackUsed: false,
  }
}

export const matcherTabular: Matcher = {
  id: 'tabular',

  applicability(segment: Segment): boolean {
    return segment.kind === 'examSection' || segment.kind === 'eas'
  },

  match(linha: TextLine, segment: Segment, ctx: ParseContext): MatchOutcome {
    const colunas = separarColunas(linha)
    if (colunas.length < 2) return { kind: 'noMatch' }

    const nome = colunas[0]!.texto.replace(/[:.\s]+$/, '').trim()
    if (!nome || !RE_NOME.test(nome)) return { kind: 'noMatch' }

    // Campos após o nome. A atribuição é POSICIONAL, e não por aparência: num
    // laudo o layout é sempre nome | valor | unidade | referência, e um valor
    // censurado ("< 5,0") é indistinguível de um limite de referência
    // ("< 500") quando se olha só a forma. Foi assim que a primeira versão
    // deste matcher classificou a PCR censurada como referência e perdeu o
    // valor — exatamente o resíduo 7.B-1 que este módulo existe para não ter.
    const resto = colunas.slice(1).map(c => c.texto)
    if (resto.length === 0) return { kind: 'noMatch' }

    const { valor: valorBruto, unidade: unidadeColada } = separarValorUnidade(resto[0]!)
    const seguintes = resto.slice(1)
    const referenciaBruta = seguintes.find(pareceReferencia) ?? ''
    const unidadeBruta =
      unidadeColada || seguintes.find(c => c !== referenciaBruta && !pareceReferencia(c)) || ''

    // Descarte deliberado dentro da gasometria: hemoglobina e tipo de coleta
    // são redundantes com o hemograma. Decisão clínica mantida em 31/07/2026 —
    // com o registro que faltava no doador, onde simplesmente sumiam.
    const emGasometria = segment.specimen === 'arterialBlood' || segment.specimen === 'venousBlood'
    if (emGasometria && DESCARTE_GASO.has(nome.toUpperCase())) {
      return {
        kind: 'discarded',
        items: [{
          page: linha.page,
          lineIndex: linha.index,
          rawLine: ctx.options.retainRawText ? linha.text : '',
          reason: 'notUsedClinically',
          detail: `${nome}: redundante com o hemograma dentro da gasometria`,
        }],
      }
    }

    const analito = resolverAnalito(nome, segment.specimen)

    // Decisão clínica de 31/07/2026: resultado de imunidade não é importado —
    // mas fica visível, em vez de sumir.
    if (ehNaoUsadoClinicamente(valorBruto)) {
      return {
        kind: 'discarded',
        items: [{
          page: linha.page,
          lineIndex: linha.index,
          rawLine: ctx.options.retainRawText ? linha.text : '',
          reason: 'notUsedClinically',
          detail: `${nome}: resultado de imunidade não é importado`,
        }],
      }
    }

    const valor = interpretarValor(valorBruto, {
      unidadeBruta,
      analito,
    })

    // Sem valor reconhecível, a linha não é resultado — mas parecia um, então
    // não pode sumir (R1, 7.B-2).
    if (valor.kind === 'text' && !/\d/.test(valorBruto)) {
      return {
        kind: 'discarded',
        items: [{
          page: linha.page,
          lineIndex: linha.index,
          rawLine: ctx.options.retainRawText ? linha.text : '',
          reason: 'noValueFound',
          detail: nome,
        }],
      }
    }

    // R1 — nome fora do catálogo resolve para "não extraí", com registro.
    // Extrair com o nome cru criaria uma segunda linha no histórico do
    // paciente para um exame que já existe com outro nome.
    if (!analito) {
      return {
        kind: 'discarded',
        items: [{
          page: linha.page,
          lineIndex: linha.index,
          rawLine: ctx.options.retainRawText ? linha.text : '',
          reason: 'unrecognizedAnalyte',
          detail: nome,
        }],
      }
    }

    const observacao: RawObservation = {
      rawName: nome,
      rawValue: valorBruto,
      rawUnit: unidadeBruta,
      rawReference: referenciaBruta,
      specimen: analito.defaultSpecimen,
      date: segment.date,
      provenance: proveniencia(linha, ctx, matcherTabular.id),
    }
    return { kind: 'observations', observations: [observacao] }
  },
}
