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

const NOMES_DE_DESCARTE = new Set(descartes.skipNames)

/** "Nome...........: valor" — o pontilhado é alinhamento, não parte do nome. */
const RE_NOME_VALOR = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s()%/+-]*?)[.\s]*:\s*(.+)$/

export const matcherDoisPontos: Matcher = {
  id: 'doisPontos',

  applicability(segment: Segment): boolean {
    return segment.kind === 'examSection' || segment.kind === 'eas'
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

    return {
      kind: 'observations',
      observations: [{
        rawName: nome,
        rawValue: valorBruto,
        rawUnit: unidadeBruta,
        rawReference: referenciaBruta,
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
