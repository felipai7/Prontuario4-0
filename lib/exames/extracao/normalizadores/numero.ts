// ══════════════════════════════════════════════════════════════════════════
// Camada 6a · conversão numérica pt-BR.
//
// O problema central: em português, "4.500" pode ser quatro mil e quinhentos
// (ponto de milhar) ou quatro vírgula cinco (ponto decimal, se o laudo veio de
// um sistema em inglês). Ler errado não gera erro em lugar nenhum — gera uma
// conduta. Por isso a desambiguação usa CONTEXTO (unidade e analito), e não
// só o formato do texto.
// ══════════════════════════════════════════════════════════════════════════

import { ehDensidadeUrinaria, ehUnidadeDeContagem, type ContextoNormalizacao } from './contexto'

/**
 * Converte o texto de um número em pt-BR.
 *
 * Devolve `null` quando não há número reconhecível — nunca 0, que seria
 * indistinguível de um zero de verdade (foi assim que `< 5,0` virou `value: 0`
 * com status normal no doador).
 *
 * O contexto é obrigatório de propósito (ver contexto.ts, D3).
 */
export function converterNumero(bruto: string, ctx: ContextoNormalizacao): number | null {
  if (!bruto) return null

  // Remove operadores de censura e espaços. O sinal negativo FICA: "- 6,0" é
  // um base excess legítimo, e o espaço depois do sinal é comum nos laudos.
  const texto = bruto.replace(/[<>≤≥\s]/g, '').trim()
  if (!texto || !/\d/.test(texto)) return null

  const temVirgula = texto.includes(',')
  const temPonto = texto.includes('.')

  // Ambos presentes: formato pt-BR sem ambiguidade — ponto é milhar, vírgula decimal.
  if (temVirgula && temPonto) return finito(parseFloat(texto.replace(/\./g, '').replace(',', '.')))

  // Só vírgula: decimal.
  if (temVirgula) return finito(parseFloat(texto.replace(',', '.')))

  if (temPonto) {
    // Densidade urinária é sempre 1,0xx. Conhecimento do analito, não formato:
    // resolve "1.000" (densidade legítima) que a heurística de formato perdia.
    if (ehDensidadeUrinaria(ctx)) return finito(parseFloat(texto))

    const ultimo = texto.lastIndexOf('.')
    const depois = texto.slice(ultimo + 1)
    const contagem = ehUnidadeDeContagem(ctx.unidadeBruta)

    if (/^\d+$/.test(depois)) {
      // Contagem: o ponto é sempre milhar. "4.500 /mm³" = 4500.
      if (contagem) return finito(parseFloat(texto.replace(/\./g, '')))
      // Três dígitos depois do ponto, fora de contagem: milhar em pt-BR.
      if (depois.length === 3) return finito(parseFloat(texto.replace(/\./g, '')))
    }
    return finito(parseFloat(texto))
  }

  return finito(parseFloat(texto))
}

function finito(n: number): number | null {
  return Number.isFinite(n) ? n : null
}
