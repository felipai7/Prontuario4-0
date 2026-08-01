// ══════════════════════════════════════════════════════════════════════════
// Camada 6d · faixa de referência.
//
// D5 mora aqui. Uma tabela pediátrica intercalada — "De 2 a 19 anos",
// "0 a 4 dias", "6 a 11 meses" — lida como faixa de referência produz alerta
// falso: um sódio de 140 comparado contra "2 a 19" vira "muito alto".
//
// Duas heranças do doador, com uma correção:
//   • A guarda de faixa etária é aplicada em TODOS os padrões, não só em um
//     (foi a propagação incompleta que criou o defeito).
//   • Rejeitar a referência NÃO descarta o valor. No doador, a guarda do
//     second-pass precisou ser relaxada justamente por isso.
//   • CORREÇÃO: o doador devolve `{refMin: 0, refMax: 55}` para "MENOR 55".
//     "Menor que 55" não afirma que o mínimo é zero. Aqui isso é
//     `kind: 'upperBound'`, sem limite inferior inventado.
// ══════════════════════════════════════════════════════════════════════════

import type { Reference, RefScope } from '../contratos'
import { converterNumero } from './numero'
import type { ContextoNormalizacao } from './contexto'

/** Unidade de tempo logo após um intervalo: o sinal de que aquilo é idade. */
const UNIDADE_ETARIA = /^\s*(anos?|dias?|m[eê]s(?:es)?|horas?|semanas?)\b/i

const ESCOPO_VAZIO: RefScope = { ageMin: null, ageMax: null, ageUnit: null, sex: null }

const RE_INTERVALO_TRACO = /([0-9][0-9.,]*)\s*[-–—]\s*([0-9][0-9.,]*)\s*([A-Za-zÀ-ÿ]*)/g
const RE_INTERVALO_A = /([0-9][0-9.,]*)\s+[aA]\s+([0-9][0-9.,]*)\s*([A-Za-zÀ-ÿ]*)/g
const RE_ATE =
  /(?:inferior\s+a|at[ée]|menor(?:\s+(?:que|de|ou\s+igual(?:\s+a)?))?|<\s*=?)\s*([0-9][0-9.,]*)/i
const RE_ACIMA =
  /(?:superior(?:\s+(?:a|ou\s+igual(?:\s+a)?))?|maior(?:\s+(?:que|de|ou\s+igual(?:\s+a)?))?|>\s*=?)\s*([0-9][0-9.,]*)/i

/** Verdadeiro quando o texto inteiro descreve uma faixa ETÁRIA, não de valor. */
export function ehFaixaEtaria(bruto: string): boolean {
  for (const re of [RE_INTERVALO_TRACO, RE_INTERVALO_A]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(bruto)) !== null) {
      if (UNIDADE_ETARIA.test(m[3] ?? '')) return true
    }
  }
  // "De 2 a 19 anos" com o sufixo separado por pontuação.
  return /\b\d+\s*(?:[-–—]|\s+a\s+)\s*\d+\s*(anos?|dias?|m[eê]s(?:es)?|semanas?|horas?)\b/i.test(bruto)
}

/**
 * Interpreta o texto da coluna de referência.
 *
 * Nunca inventa faixa: se o laudo não trouxe, o resultado é `absent`. Um
 * catálogo de apoio pode existir um dia, mas entra com procedência própria e
 * jamais é apresentado como se viesse do laudo.
 */
export function interpretarReferencia(bruto: string, ctx: ContextoNormalizacao): Reference {
  const texto = (bruto ?? '').trim()
  if (!texto) return { kind: 'absent' }

  const unidade = ctx.unidadeBruta

  // Intervalos, ignorando os que são faixa etária. Percorre TODAS as
  // ocorrências: um texto pode trazer a tabela pediátrica antes da faixa real.
  for (const re of [RE_INTERVALO_TRACO, RE_INTERVALO_A]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(texto)) !== null) {
      if (UNIDADE_ETARIA.test(m[3] ?? '')) continue
      const min = converterNumero(m[1]!, ctx)
      const max = converterNumero(m[2]!, ctx)
      if (min === null || max === null) continue
      if (min > max) {
        return { kind: 'rejected', raw: texto, reason: 'limite inferior maior que o superior' }
      }
      return { kind: 'range', min, max, unit: unidade, raw: texto, scope: null }
    }
  }

  // Se sobrou só faixa etária, isto NÃO é referência — e dizer isso é um dado
  // (R4). O valor da linha continua válido e é extraído normalmente.
  if (ehFaixaEtaria(texto)) {
    return { kind: 'rejected', raw: texto, reason: 'faixa etária lida onde se esperava referência' }
  }

  const ate = texto.match(RE_ATE)
  if (ate) {
    const max = converterNumero(ate[1]!, ctx)
    // Sem limite inferior inventado — a correção em relação ao doador.
    if (max !== null) return { kind: 'upperBound', max, unit: unidade, raw: texto, scope: null }
  }

  const acima = texto.match(RE_ACIMA)
  if (acima) {
    const min = converterNumero(acima[1]!, ctx)
    if (min !== null) return { kind: 'lowerBound', min, unit: unidade, raw: texto, scope: null }
  }

  // Havia texto e não reconheci nada. "Encontrei e não confio" é diferente de
  // "o laudo não trouxe" (R4), e a distinção é a presença de texto — não a
  // presença de dígito: "vide observação" e "vide observação 3" são o mesmo
  // caso, e classificá-los diferente só porque um tem número seria arbitrário.
  return { kind: 'rejected', raw: texto, reason: 'formato de referência não reconhecido' }
}

export { ESCOPO_VAZIO }
