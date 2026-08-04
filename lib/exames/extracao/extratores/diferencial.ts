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

  // Havendo DUAS faixas, a ordem resolve: a primeira é do percentual e a
  // segunda é do absoluto, na mesma sequência dos valores.
  //
  // Havendo UMA SÓ, a ordem não resolve nada, e usá-la assim mesmo era o
  // defeito I2: a faixa que sobra é quase sempre a do PERCENTUAL, e encostada
  // num valor absoluto ela produz alarme na DIREÇÃO ERRADA. Neutrófilos de
  // 500/mm³ é neutropenia grave; comparados contra "51 a 65" (percentual),
  // 500 fica acima do máximo e a tela mostra vermelho com seta para CIMA —
  // "neutrofilia", o oposto do que o paciente tem.
  //
  // Com uma faixa só, ela só vale se DECLARAR a unidade do absoluto. Sem
  // unidade não dá para saber de quem ela é, e o honesto é não ter faixa: sem
  // referência, `interpretarNumerico` não opina e a marcação de revisão
  // aparece. Perder a faixa custa uma cor na tela; herdar a errada custa a
  // leitura invertida de uma neutropenia.
  const referencia =
    referencias.length > 1 ? referencias[1]!
    : referencias.length === 1 && ehFaixaDoAbsoluto(referencias[0]!) ? referencias[0]!
    : ''
  return { valor: abs.valor, unidade: abs.unidade, referencia }
}

/**
 * A faixa declara, no fim, uma unidade de CONTAGEM ABSOLUTA.
 *
 * Ancorada no fim e exigindo um caractere não-alfabético antes, para "uL" não
 * casar dentro de uma palavra ("adulto") — a mesma armadilha que o `/i` de uma
 * regex de unidade já pregou neste projeto.
 */
function ehFaixaDoAbsoluto(faixa: string): boolean {
  if (/%/.test(faixa)) return false
  return /(?:^|[^A-Za-zÀ-ÿ])\/?\s*(?:mm3|mm³|µL|uL|mcL)\s*$/i.test(faixa.trim())
}
