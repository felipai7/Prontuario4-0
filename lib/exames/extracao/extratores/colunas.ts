// ══════════════════════════════════════════════════════════════════════════
// Separação de uma linha em colunas, pelo VÃO MEDIDO entre itens.
//
// É aqui que o trabalho da camada de texto se paga. O doador separava colunas
// com uma cascata de expressões regulares sobre o texto já reconstruído —
// frágil, porque o espaçamento do texto reconstruído dependia de uma largura de
// caractere estimada. Aqui a fronteira de coluna é geometria: um vão maior que
// `ESPACO_DUPLO` pontos separa campos; um vão menor é espaço dentro do campo.
// ══════════════════════════════════════════════════════════════════════════

import type { TextLine } from '../contratos'

export interface Coluna {
  texto: string
  /** Índice do primeiro item da coluna, para a procedência apontar o lugar certo. */
  inicio: number
}

/**
 * Largura aproximada de um espaço, em pontos, para o corpo de texto da linha.
 *
 * Em Helvetica e similares o espaço mede cerca de 0,28 em. Derivar do tamanho
 * da fonte da própria linha — e não de uma constante absoluta — é o que faz a
 * separação funcionar tanto num laudo em corpo 8 quanto num em corpo 12.
 */
function larguraDeEspaco(linha: TextLine): number {
  const alturas = linha.items.map(i => i.height).filter(h => h > 0)
  if (alturas.length === 0) return 3
  const media = alturas.reduce((a, b) => a + b, 0) / alturas.length
  return Math.max(1.5, media * 0.28)
}

/**
 * Vão a partir do qual dois itens são COLUNAS diferentes, e não palavras da
 * mesma coluna.
 *
 * O fator foi MEDIDO, não escolhido: `scripts/rodar-corpus.mts --calibrar`
 * varre o corpus real e mostra o penhasco entre 1,8 e 2,2 — abaixo disso as
 * palavras de um mesmo campo se partem (6,8 colunas por linha, quando um laudo
 * tabular tem ~4), e a partir de 2,6 a curva estabiliza. Um palpite anterior de
 * 1,8 passava nos testes sintéticos só porque o PDF gerado usa vãos mais largos
 * que os de um laudo real — o motivo de a calibração ser feita sobre o corpus.
 */
export const FATOR_COLUNA = 2.6

export function limiarDeColuna(linha: TextLine): number {
  return larguraDeEspaco(linha) * FATOR_COLUNA
}

/**
 * Divide a linha nos vãos largos.
 *
 * Linha sem geometria (itens vazios) cai no espaçamento do texto, para que
 * entrada sintética de teste e texto colado continuem funcionando.
 */
export function separarColunas(linha: TextLine, limite?: number): Coluna[] {
  if (linha.items.length === 0) {
    return linha.text
      .split(/\s{2,}/)
      .map(t => t.trim())
      .filter(Boolean)
      .map((texto, i) => ({ texto, inicio: i }))
  }

  const corte = limite ?? limiarDeColuna(linha)
  const colunas: Coluna[] = []
  let atual: string[] = []
  let inicio = 0

  linha.items.forEach((item, i) => {
    if (i > 0) {
      const vao = linha.gaps[i - 1] ?? 0
      if (vao >= corte) {
        colunas.push({ texto: atual.join(''), inicio })
        atual = []
        inicio = i
      } else if (vao >= 0.6) {
        atual.push(' ')
      }
    }
    atual.push(item.text)
  })

  if (atual.length) colunas.push({ texto: atual.join(''), inicio })

  // Alguns PDFs — e o gerador sintético — emitem a linha inteira como UM item
  // de texto, com os espaços de alinhamento dentro dele. Nesse caso não há vão
  // entre itens para medir, e a única fronteira disponível é a corrida de
  // espaços. Vale só dentro de cada coluna já separada geometricamente, então
  // não desfaz o trabalho da medição quando ela existe.
  return colunas
    .flatMap(c => c.texto.split(/\s{2,}/).map(t => ({
      // Dois-pontos no INÍCIO da coluna é alinhamento: conforme a largura do
      // vão, "Hemoglobina   :   9,3" sai com o ":" em coluna própria ou colado
      // no valor (": 9,3"). As duas formas aparecem no corpus.
      //
      // O traço NUNCA é removido daqui: "- 6,0" é um base excess legítimo, e o
      // "-" sozinho no antibiograma significa "não testado".
      texto: t.replace(/\s+/g, ' ').replace(/^[:;·|]+\s*/, '').trim(),
      inicio: c.inicio,
    })))
    // Uma coluna só com pontuação é alinhamento, não dado. No hemograma do HOC
    // os dois-pontos ficam numa coluna PRÓPRIA, separados por vãos largos
    // ("Hemácias   :   3,10   /mm³"), e mantê-la fazia o matcher tabular ler
    // ":" como se fosse o valor — 115 exames perdidos em quatro laudos.
    // O traço NÃO entra nesta lista: no antibiograma "-" significa "não
    // testado", que é informação. Filtrá-lo custou 9 antimicrobianos na
    // primeira tentativa desta correção.
    .filter(c => c.texto.length > 0 && !/^[:.;,·|]+$/.test(c.texto))
}

const RE_VALOR_E_UNIDADE =
  /^([<>≤≥]?\s*=?\s*[+-]?\s*[\d.,]+|\+{1,4}|[1-4]\s*\+|1\s*[:/]\s*\d+)\s+(.+)$/

/**
 * Separa "1,42 mg/dL" em valor e unidade quando vieram na mesma coluna.
 *
 * Acontece quando o laudo não alinha a unidade numa coluna própria. Devolve a
 * unidade vazia quando não há o que separar — nunca inventa unidade.
 */
export function separarValorUnidade(campo: string): { valor: string; unidade: string } {
  const m = campo.trim().match(RE_VALOR_E_UNIDADE)
  if (!m) return { valor: campo.trim(), unidade: '' }
  return { valor: m[1]!.replace(/\s+/g, ' ').trim(), unidade: m[2]!.trim() }
}

const RE_TEM_FAIXA =
  /\d\s*(?:[-–—]|\s+a\s+)\s*\d|inferior\s+a|at[ée]\s+\d|menor|maior|superior|^[<>≤≥]\s*=?\s*\d/i

/** Heurística de "isto é a coluna de referência", não de valor. */
export function pareceReferencia(campo: string): boolean {
  return RE_TEM_FAIXA.test(campo.trim())
}
