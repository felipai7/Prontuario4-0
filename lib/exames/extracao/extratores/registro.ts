// ══════════════════════════════════════════════════════════════════════════
// Precedência dos matchers — declarada em UM lugar (A2).
//
// No doador, a precedência emergia da ordem dos `if`s dentro de um laço de
// centenas de linhas: mudar um padrão mexia em quem ganhava a linha, sem que
// isso ficasse visível em lugar nenhum. Aqui a ordem é este array.
// ══════════════════════════════════════════════════════════════════════════

import type { Matcher } from '../contratos'
import { matcherBloco } from './bloco'
import { matcherDoisPontos } from './doisPontos'
import { matcherTabular } from './tabular'

/**
 * Do mais específico para o mais genérico.
 *
 * `bloco` vem antes de `doisPontos` porque "Resultado : 154,1 mmol/L" casa nos
 * dois — e só o de bloco sabe ligar essa linha ao nome do exame que está acima
 * dela. Invertida, a ordem produziria um exame chamado "Resultado".
 */
export const matchers: readonly Matcher[] = Object.freeze([
  matcherBloco,
  matcherDoisPontos,
  matcherTabular,
])
