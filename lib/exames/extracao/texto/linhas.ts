// ══════════════════════════════════════════════════════════════════════════
// Camada 1b · reconstrução de linhas a partir de itens de texto posicionados.
//
// Puro: não conhece PDF, pdfjs nem I/O. Recebe itens com coordenada e largura
// MEDIDA, devolve linhas. Isso é o que permite testar a geometria sem gerar
// PDF nenhum — e testar o PDF de verdade separadamente (7.B-11).
// ══════════════════════════════════════════════════════════════════════════

import type { TextItem, TextLine } from '../contratos'

/**
 * Tolerância vertical do agrupamento, em pontos.
 *
 * Herdado do clinBoard (Y_CLUSTER_PX = 3), que substituiu um "snap" por
 * arredondamento depois de descobrir que fronteiras rígidas separavam nome,
 * ":", valor e referência da MESMA linha visual quando o PDF os emitia com Y
 * 2–3pt diferentes — caso real nos laudos do HOC.
 */
export const TOLERANCIA_Y = 3

/**
 * Limiares de espaçamento horizontal, em pontos de espaço REAL entre itens.
 *
 * Diferença central em relação ao doador: lá o gap era
 *   `x[k] - x[k-1] - (texto[k-1].length * 4.5)`
 * ou seja, largura de caractere ESTIMADA. Um laudo em fonte condensada ou
 * monoespaçada estimava errado e colava colunas — e colunas coladas viram
 * "valor" onde havia "referência". Aqui o gap é
 *   `x[k] - (x[k-1] + width[k-1])`
 * com `width` medido pelo próprio PDF.
 *
 * Como o gap passou a ser espaço tipográfico de verdade, os limiares são
 * menores que os do doador (2/14/40, que operavam sobre um número inflado).
 */
export const JUNTAR = 0.6
export const ESPACO_SIMPLES = 8
export const ESPACO_DUPLO = 25

/** Um item vazio ou só com espaço não participa da geometria. */
function relevante(item: TextItem): boolean {
  return item.text.trim().length > 0
}

/**
 * Agrupa itens por proximidade vertical, sem fronteiras fixas.
 *
 * O centro do grupo é média corrida: um item entra se estiver a até
 * `TOLERANCIA_Y` do centro corrente, e o centro se ajusta. Ancorar na média,
 * e não no primeiro item, evita que uma linha levemente inclinada se parta ao
 * meio.
 */
function agruparPorY(itens: TextItem[]): { y: number; itens: TextItem[] }[] {
  const grupos: { y: number; itens: TextItem[] }[] = []
  // Y descendente: no sistema do PDF, o topo da página tem Y maior.
  const ordenados = [...itens].sort((a, b) => b.y - a.y || a.x - b.x)

  for (const item of ordenados) {
    const grupo = grupos.find(g => Math.abs(item.y - g.y) <= TOLERANCIA_Y)
    if (grupo) {
      grupo.itens.push(item)
      grupo.y = (grupo.y * (grupo.itens.length - 1) + item.y) / grupo.itens.length
    } else {
      grupos.push({ y: item.y, itens: [item] })
    }
  }

  return grupos.sort((a, b) => b.y - a.y)
}

/** Espaço a inserir entre dois itens, a partir do vão medido entre eles. */
export function espacamento(gap: number): string {
  if (gap < JUNTAR) return ''
  if (gap < ESPACO_SIMPLES) return ' '
  if (gap < ESPACO_DUPLO) return '  '
  return '   '
}

/**
 * Reconstrói as linhas de uma página.
 *
 * `indicePrimeiraLinha` mantém o índice de linha GLOBAL do documento, porque é
 * ele que aparece em toda procedência (R2) e em `discarded` — um índice por
 * página tornaria dois itens diferentes indistinguíveis no relatório.
 */
export function reconstruirLinhas(
  itens: TextItem[],
  pagina: number,
  indicePrimeiraLinha: number,
): TextLine[] {
  const grupos = agruparPorY(itens.filter(relevante))
  const linhas: TextLine[] = []

  grupos.forEach((grupo, i) => {
    const ordenados = [...grupo.itens].sort((a, b) => a.x - b.x)
    const gaps: number[] = []
    let texto = ''

    ordenados.forEach((item, k) => {
      if (k > 0) {
        const anterior = ordenados[k - 1]!
        const gap = item.x - (anterior.x + anterior.width)
        gaps.push(gap)
        texto += espacamento(gap)
      }
      texto += item.text
    })

    texto = texto.trim()
    if (texto.length === 0) return

    linhas.push({
      page: pagina,
      index: indicePrimeiraLinha + i,
      // NFC: o pdfjs pode emitir forma decomposta ("Ç" = C + cedilha
      // combinante). Sem normalizar, `===` e classes como [ÇÃÕ] falham em
      // silêncio — e falhar em silêncio num nome de exame parte o histórico
      // do paciente em duas colunas.
      text: texto.normalize('NFC'),
      y: grupo.y,
      items: ordenados,
      gaps,
    })
  })

  // Reindexa: grupos vazios foram descartados acima e não podem deixar buraco.
  return linhas.map((linha, i) => ({ ...linha, index: indicePrimeiraLinha + i }))
}
