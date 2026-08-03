// ══════════════════════════════════════════════════════════════════════════
// Interpretação clínica de um resultado de exame.
//
// Vive FORA do módulo de extração, de propósito. R3: o extrator lê e
// normaliza; quem decide se um valor está alto, baixo ou normal é este
// arquivo, que recebe o resultado já extraído.
//
// No clinBoard os dois moram juntos — `getStatus` é chamado de dentro do
// parser —, e essa foi a única das dezesseis correções que ficou como dívida
// estrutural, por custo de refatoração. Aqui o módulo nasceu separado; manter
// assim é o trabalho.
//
// Consequência prática: mudar a regra de "alterado" não toca no extrator, e
// mudar o extrator não muda nenhum alerta.
// ══════════════════════════════════════════════════════════════════════════

import type { Reference } from '@/lib/exames/extracao'

/**
 * Mesmo vocabulário de `ResultadoExame['direcao']` (`@/types`), mas declarado
 * aqui em vez de importado de lá — este arquivo é interno a `lib/exames/`, e
 * só `adaptador.ts` e `agrupamento.ts` conhecem o formato do banco (inversão
 * de dependência de 03/08/2026, ver `entrega.ts`).
 */
export type Direcao = 'alto' | 'baixo' | 'normal' | 'qualitativo'

export interface Interpretacao {
  alterado: boolean
  direcao: Direcao
}

const NORMAL: Interpretacao = { alterado: false, direcao: 'normal' }

/**
 * Sem faixa confiável — ou com valor censurado —, o resultado não recebe
 * opinião.
 *
 * O formato é o mesmo de "normal" porque é o que a tela sabe exibir hoje. A
 * diferença aparece para o usuário pelo campo `referencia`, que fica nulo, e
 * pelo marcador de revisão: o extrator já classificou a linha como pendente.
 */
const SEM_OPINIAO: Interpretacao = { alterado: false, direcao: 'normal' }
const QUALITATIVO_ALTERADO: Interpretacao = { alterado: true, direcao: 'qualitativo' }
const QUALITATIVO_NORMAL: Interpretacao = { alterado: false, direcao: 'qualitativo' }

/**
 * Códigos qualitativos que representam achado.
 *
 * `indeterminate` e `inconclusive` NÃO entram: um exame inconclusivo não é um
 * exame alterado, é um exame que não respondeu. Tratá-los como alteração
 * produziria alarme onde não há informação.
 */
const CODIGOS_COM_ACHADO = new Set([
  'positive', 'reactive', 'detected', 'present',
  'rare', 'occasional', 'moderate', 'abundant',
])

const CODIGOS_SEM_ACHADO = new Set([
  'negative', 'nonreactive', 'undetected', 'absent',
])

/**
 * Interpreta um valor numérico contra a faixa de referência do laudo.
 *
 * Regras que importam clinicamente:
 *
 *  • Valor CENSURADO não é interpretado. "< 5,0" com referência "0 a 5" não
 *    permite dizer se está dentro: o resultado só afirma que é menor que 5.
 *    Chutar aqui é exatamente o que R1 proíbe, e foi o defeito D4 do doador,
 *    que gravava `< 5,0` como zero normal.
 *
 *  • Referência REJEITADA não interpreta. Se o que estava na coluna de
 *    referência era uma faixa etária (D5), comparar contra ela produz alarme
 *    falso. Sem referência confiável, o resultado fica sem opinião.
 */
export function interpretarNumerico(
  valor: number,
  censura: 'lt' | 'lte' | 'gt' | 'gte' | null,
  referencia: Reference,
): Interpretacao {
  if (censura) return SEM_OPINIAO
  switch (referencia.kind) {
    case 'range':
      if (valor < referencia.min) return { alterado: true, direcao: 'baixo' }
      if (valor > referencia.max) return { alterado: true, direcao: 'alto' }
      return NORMAL
    case 'upperBound':
      return valor > referencia.max ? { alterado: true, direcao: 'alto' } : NORMAL
    case 'lowerBound':
      return valor < referencia.min ? { alterado: true, direcao: 'baixo' } : NORMAL
    default:
      // 'absent' e 'rejected': o laudo não trouxe faixa confiável.
      return SEM_OPINIAO
  }
}

/** Interpreta um resultado qualitativo pelo código do vocabulário. */
export function interpretarQualitativo(codigo: string): Interpretacao {
  if (CODIGOS_COM_ACHADO.has(codigo)) return QUALITATIVO_ALTERADO
  if (CODIGOS_SEM_ACHADO.has(codigo)) return QUALITATIVO_NORMAL
  // indeterminado, inconclusivo: sem informação, não sem alteração.
  return QUALITATIVO_NORMAL
}

/** Semiquantitativo: qualquer cruz é achado. */
export function interpretarCruzes(cruzes: number): Interpretacao {
  return cruzes > 0 ? QUALITATIVO_ALTERADO : QUALITATIVO_NORMAL
}
