// ══════════════════════════════════════════════════════════════════════════
// Diferencial leucocitário — compartilhado pelos matchers.
//
// Vive fora de `tabular.ts` porque o PIOX passa pelo matcher de dois-pontos, e
// enquanto a regra morava só num deles o mesmo laudo entregava o ABSOLUTO em
// alguns laboratórios e o PERCENTUAL noutros. Dados inconsistentes na mesma
// coluna da tabela são piores que qualquer uma das duas escolhas isolada.
// ══════════════════════════════════════════════════════════════════════════

import diferencial from '../catalogo/diferencial.json'
import { pareceReferencia, separarValorUnidade } from './colunas'

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
export function absolutoDoDiferencial(
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
