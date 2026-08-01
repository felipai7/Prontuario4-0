// ══════════════════════════════════════════════════════════════════════════
// Precedência dos matchers — declarada em UM lugar (A2).
//
// No doador, a precedência emergia da ordem dos `if`s dentro de um laço de
// centenas de linhas: mudar um padrão mexia em quem ganhava a linha, sem que
// isso ficasse visível em lugar nenhum. Aqui a ordem é este array.
// ══════════════════════════════════════════════════════════════════════════

import type { Matcher } from '../contratos'
import { matcherTabular } from './tabular'

/** Do mais específico para o mais genérico. */
export const matchers: readonly Matcher[] = Object.freeze([
  matcherTabular,
])
