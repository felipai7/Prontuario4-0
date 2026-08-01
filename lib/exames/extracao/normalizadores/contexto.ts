// ══════════════════════════════════════════════════════════════════════════
// Contexto exigido pelos normalizadores.
//
// D3 é a lição desta pasta: no clinBoard, `pNum(s, unitHint)` tinha o segundo
// parâmetro e NENHUM dos chamadores o passava — o ramo de desambiguação por
// unidade era código morto, e "4.500" com unidade de contagem virava 4,5. A
// correção de lá foi mover a unidade para antes do valor em nove chamadores.
//
// Aqui o contexto é obrigatório e sem valor padrão: chamar um normalizador sem
// ele não compila. A mesma classe de defeito deixa de ser possível.
// ══════════════════════════════════════════════════════════════════════════

import type { Analyte } from '../contratos'

export interface ContextoNormalizacao {
  /** Unidade como veio no laudo. String vazia quando o laudo não trouxe. */
  readonly unidadeBruta: string
  /** Analito já resolvido pelo catálogo, ou null quando não reconhecido. */
  readonly analito: Analyte | null
}

/**
 * Unidade de contagem celular: o ponto é separador de MILHAR, não decimal.
 *
 * "4.500 /mm³" é quatro mil e quinhentos leucócitos, não quatro e meio.
 */
export function ehUnidadeDeContagem(unidade: string): boolean {
  return /\/\s*(mm3|mm³|µL|uL|mcL)|mil\/|milh(õ|o)es\/|x?10[\^~E]?\d/i.test(unidade)
}

/**
 * Densidade urinária: sempre da ordem de 1,0xx.
 *
 * O doador tratava isto por formato ("parte inteira exatamente 1, primeiro
 * decimal 0, e nem todos zeros"), o que fazia "1.000" — densidade legítima —
 * virar mil. Com o analito no contexto, a regra deixa de ser adivinhação de
 * formato e passa a ser conhecimento: densidade urinária é decimal, ponto.
 */
export function ehDensidadeUrinaria(ctx: ContextoNormalizacao): boolean {
  return ctx.analito?.id === 'densidade.urine'
}
