// SAPS 3 → mortalidade esperada.
//
// Espelho em TypeScript da função SQL `saps3_mortalidade_esperada` (usada em
// contagens_mes para somar a mortalidade esperada, base do SMR). Existe aqui
// para ser testável e reaproveitável na tela; os dois DEVEM concordar.
//
// Equação customizada para a América Central e do Sul (Moreno et al., Intensive
// Care Med 2005;31:1345-55). A constante é NEGATIVA — as fontes publicam sem o
// sinal, mas só com o menos a curva faz sentido (ver o teste de paridade).
//
// VALIDAÇÃO EM DOIS NÍVEIS:
//   1. Implementação (feito): o cálculo confere com a equação publicada, ponto
//      a ponto. É o que este arquivo e seu teste garantem.
//   2. Escolha da equação (pendente): confirmar que o Dr. Flaubert usa a mesma
//      equação regional no histórico dele. Só os números reais da coorte dele
//      resolvem — a implementação estar certa não garante que é a mesma régua.

const A = -64.5990
const B = 71.0599
const C = 13.2322

/** Mortalidade esperada (0–1) para um escore SAPS 3. Null se o escore for inválido. */
export function saps3MortalidadeEsperada(escore: number | null): number | null {
  if (escore == null || escore < 0) return null
  const logit = A + Math.log(escore + B) * C
  return Math.exp(logit) / (1 + Math.exp(logit))
}
