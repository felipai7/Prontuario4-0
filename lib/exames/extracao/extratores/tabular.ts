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
import { ehRotuloDeMetadado } from './metadados'
import diferencial from '../catalogo/diferencial.json'

const CELULAS_DIFERENCIAL = new Set(
  (diferencial.cells as string[]).map(c => c.toUpperCase().replace(/\s+/g, ' ')),
)

/**
 * Diferencial leucocitário: a linha traz DOIS números.
 *
 *   Neutrófilos   :  69   %   8.625   /mm³   51 a 65   2.295 a 6.500
 *                    └ percentual      └ absoluto
 *
 * Decisão clínica de 31/07/2026: vale o ABSOLUTO, em /mm³. Sem esta função o
 * percentual venceria por posição — ele vem primeiro na linha —, e o exame
 * ficaria com o número errado sem nenhum sinal de que algo se perdeu.
 */
function absolutoDoDiferencial(
  nome: string,
  campos: string[],
): { valor: string; unidade: string; referencia: string } | null {
  if (!CELULAS_DIFERENCIAL.has(nome.toUpperCase().replace(/\s+/g, ' '))) return null

  // Duas diagramações no corpus, conforme o laudo separe ou cole valor e
  // unidade:
  //   HOC    "0"  "%"  "125"  "/mm³"  "1 a 5"  "45 a 500"
  //   HUGO   "0,0 %"   "125 uL"       "1 a 5 uL"
  // Percorrer em pares fixos só funciona no primeiro. Aqui os campos viram
  // pares (valor, unidade) qualquer que seja a diagramação.
  const referencias = campos.filter(pareceReferencia)
  const pares: { valor: string; unidade: string }[] = []
  const restantes = campos.filter(c => !pareceReferencia(c))
  const soNumero = /^[+-]?[\d.,]+$/
  const soUnidade = /^[%A-Za-zµ³/]+$/

  for (let i = 0; i < restantes.length; i++) {
    const campo = restantes[i]!.trim()
    if (soNumero.test(campo)) {
      const proximo = restantes[i + 1]?.trim() ?? ''
      if (soUnidade.test(proximo)) { pares.push({ valor: campo, unidade: proximo }); i++ }
      else pares.push({ valor: campo, unidade: '' })
      continue
    }
    const { valor, unidade } = separarValorUnidade(campo)
    if (soNumero.test(valor)) pares.push({ valor, unidade })
  }

  const iPct = pares.findIndex(p => p.unidade === '%')
  if (iPct < 0) return null
  const abs = pares.slice(iPct + 1).find(p => /\/?\s*(mm3|mm³|µL|uL|mcL)/i.test(p.unidade))
  if (!abs) return null

  // Havendo duas faixas, a segunda é a do absoluto; havendo uma, é dele.
  const referencia = referencias.length > 1 ? referencias[1]! : (referencias[0] ?? '')
  return { valor: abs.valor, unidade: abs.unidade, referencia }
}

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
    // `culture` entra: o que o extrator de culturas consumiu já foi retirado
    // antes de chegar aqui, e o que sobra é resultado comum que por acaso caiu
    // depois de um cabeçalho de cultura.
    return segment.kind === 'examSection' || segment.kind === 'eas' || segment.kind === 'culture'
  },

  match(linha: TextLine, segment: Segment, ctx: ParseContext): MatchOutcome {
    const colunas = separarColunas(linha)
    if (colunas.length < 2) return { kind: 'noMatch' }

    const nome = colunas[0]!.texto.replace(/[:.\s]+$/, '').trim()
    if (!nome || !RE_NOME.test(nome)) return { kind: 'noMatch' }
    // Cabeçalho e rodapé têm a mesma forma de um resultado. Não são desta
    // linha de montagem, e não são descarte: nunca foram candidatos.
    if (ehRotuloDeMetadado(nome)) return { kind: 'noMatch' }

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

    // Coluna de valor vazia: a linha parecia resultado e não é (R1, 7.B-2).
    if (!valorBruto.trim()) {
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

    // Exigir um DÍGITO no valor descartava todo resultado por palavra —
    // "Cor: INCOLOR", "Aspecto: LÍMPIDO", "Urobilinogênio: NORMAL". Exame
    // conhecido com algo na coluna de valor É um resultado; o tipo do valor
    // decide como representá-lo, e `text` é uma representação legítima.

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

    const absoluto = absolutoDoDiferencial(nome, resto)
    const observacao: RawObservation = {
      rawName: nome,
      rawValue: absoluto?.valor ?? valorBruto,
      rawUnit: absoluto?.unidade ?? unidadeBruta,
      rawReference: absoluto?.referencia ?? referenciaBruta,
      specimen: analito.defaultSpecimen,
      date: segment.date,
      provenance: proveniencia(linha, ctx, matcherTabular.id),
    }
    return { kind: 'observations', observations: [observacao] }
  },
}
