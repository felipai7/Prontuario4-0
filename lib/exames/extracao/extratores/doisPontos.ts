// ══════════════════════════════════════════════════════════════════════════
// Matcher de dois-pontos — o layout do PIOX e de outros laudos com pontilhado.
//
//     Hemácias......: 3,01  tera/L   4,0 a 5,5 tera/L
//     VCM...........: 101,7 fl   80,0 a 100,0 ft
//
// Nome e valor ficam na MESMA coluna, porque o pontilhado de alinhamento não
// deixa vão nenhum entre eles. Aqui a fronteira é o dois-pontos, e o pontilhado
// é ruído a remover do nome.
//
// A2 — não conhece nenhum outro matcher. A precedência em relação ao matcher de
// bloco (que também casaria "Resultado : 154,1") é declarada em registro.ts.
// ══════════════════════════════════════════════════════════════════════════

import type { Matcher, MatchOutcome, ParseContext, Segment, TextLine } from '../contratos'
import { separarColunas, separarValorUnidade, pareceReferencia } from './colunas'
import { resolverAnalito } from '../catalogo'
import { ehNaoUsadoClinicamente } from '../normalizadores/valor'
import descartes from '../catalogo/descartes.json'
import { ehRotuloDeMetadado } from './metadados'
import { absolutoDoDiferencial } from './diferencial'

const NOMES_DE_DESCARTE = new Set(descartes.skipNames)

/**
 * "Nome...........: valor" — o pontilhado é alinhamento, não parte do nome.
 *
 * O ponto entra na classe do NOME, e não só no pontilhado final, porque o
 * leucograma do PIOX abrevia para caber na coluna: "Neutr.Totais..:",
 * "Linf.Atípicos.:". Sem isso a linha inteira não casava e o exame sumia — e
 * some também "V.C.M.", "C.H.C.M." e afins. O `*?` preguiçoso garante que o
 * pontilhado final continue sendo comido pelo `[.\s]*`.
 */
const RE_NOME_VALOR = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s.()%/+-]*?)[.\s]*:\s*(.+)$/

export const matcherDoisPontos: Matcher = {
  id: 'doisPontos',

  applicability(segment: Segment): boolean {
    // `culture` entra: o que o extrator de culturas consumiu já foi retirado
    // antes de chegar aqui, e o que sobra é resultado comum que por acaso caiu
    // depois de um cabeçalho de cultura.
    return segment.kind === 'examSection' || segment.kind === 'eas' || segment.kind === 'culture'
  },

  match(linha: TextLine, segment: Segment, ctx: ParseContext): MatchOutcome {
    const colunas = separarColunas(linha).map(c => c.texto)
    const primeira = colunas[0] ?? ''
    const m = primeira.match(RE_NOME_VALOR)
    if (!m) return { kind: 'noMatch' }

    const nome = m[1]!.replace(/[.\s]+$/, '').trim()
    if (!nome || ehRotuloDeMetadado(nome)) return { kind: 'noMatch' }
    if (NOMES_DE_DESCARTE.has(nome.toUpperCase().replace(/\s+/g, ' '))) return { kind: 'noMatch' }

    const { valor: valorBruto, unidade: unidadeColada } = separarValorUnidade(m[2]!.trim())
    if (!valorBruto) return { kind: 'noMatch' }

    const seguintes = colunas.slice(1)
    const referenciaBruta = seguintes.find(pareceReferencia) ?? ''
    const unidadeBruta =
      unidadeColada || seguintes.find(c => c !== referenciaBruta && !pareceReferencia(c)) || ''

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

    const analito = resolverAnalito(nome, segment.specimen)
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

    // O PIOX diagrama o diferencial com dois-pontos: "Bastonetes....: 1 % 73
    // /mm³". Sem esta chamada, este laboratório entregava o PERCENTUAL e os
    // demais o ABSOLUTO — a mesma coluna da tabela com duas grandezas.
    // O nome CANÔNICO, não o bruto: o PIOX escreve "Neutr.Totais" e a lista
    // do diferencial guarda "Neutrófilos". Testar o bruto fazia o laudo
    // abreviado receber o percentual enquanto os outros recebiam o absoluto.
    const absoluto = absolutoDoDiferencial(analito?.canonicalName ?? nome, [valorBruto, ...seguintes])

    return {
      kind: 'observations',
      observations: [{
        rawName: nome,
        rawValue: absoluto?.valor ?? valorBruto,
        rawUnit: absoluto?.unidade ?? unidadeBruta,
        rawReference: absoluto?.referencia ?? referenciaBruta,
        specimen: analito.defaultSpecimen,
        date: segment.date,
        provenance: {
          page: linha.page,
          lineIndex: linha.index,
          rawLine: ctx.options.retainRawText ? linha.text : '',
          matcherId: matcherDoisPontos.id,
          profileId: ctx.profile.id,
          fallbackUsed: false,
        },
      }],
    }
  },
}
