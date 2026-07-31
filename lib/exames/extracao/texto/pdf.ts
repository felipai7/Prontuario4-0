// ══════════════════════════════════════════════════════════════════════════
// Camada 1a · bytes do PDF → itens de texto com geometria.
//
// Único ponto do módulo que fala com o pdfjs. Fica isolado aqui para que a
// reconstrução de linhas (linhas.ts) seja pura e testável sem PDF, e para que
// trocar de leitor de PDF um dia não toque em mais nada.
//
// Versão do pdfjs deliberadamente igual à do clinBoard (3.11.174): na fase de
// paridade (F9), as divergências encontradas precisam ser do parser, não de
// dois leitores de PDF diferentes lendo o mesmo arquivo.
// ══════════════════════════════════════════════════════════════════════════

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js'
import type { DocumentText, PageMetrics, TextItem, TextLine } from '../contratos'
import { reconstruirLinhas } from './linhas'

/**
 * Erro da camada de texto.
 *
 * A mensagem é FIXA e nunca interpola conteúdo do documento: as rotas deste
 * repositório devolvem `e.message` cru ao navegador, então uma mensagem com
 * trecho de laudo dentro vazaria pela rede sem passar por log nenhum (R10).
 */
export class ErroLeituraPdf extends Error {
  readonly motivo: 'assinaturaInvalida' | 'documentoIlegivel'
  constructor(motivo: 'assinaturaInvalida' | 'documentoIlegivel') {
    super(
      motivo === 'assinaturaInvalida'
        ? 'Arquivo não é um PDF válido (assinatura %PDF ausente).'
        : 'Não foi possível ler o documento PDF.',
    )
    this.name = 'ErroLeituraPdf'
    this.motivo = motivo
  }
}

/**
 * Confere a assinatura `%PDF` nos primeiros bytes.
 *
 * O MIME type informado pelo navegador é falsificável — basta renomear o
 * arquivo. O cabeçalho não é. Herdado do clinBoard, que já rejeitava aqui
 * antes de entregar o buffer ao pdfjs.
 */
export function temAssinaturaPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 //// F
  )
}

/** Item de texto como o pdfjs o entrega. Tipado localmente para não vazar o SDK. */
interface ItemPdfJs {
  str?: string
  width?: number
  height?: number
  transform?: number[]
}

/**
 * Lê o documento e devolve linhas com página, coordenadas e vãos medidos.
 *
 * `width` vem do próprio pdfjs — é a largura MEDIDA do item, não uma estimativa
 * por contagem de caracteres. É o que separa esta camada da do doador e o que
 * torna o vão entre colunas confiável em fonte condensada ou monoespaçada.
 */
export async function lerDocumento(bytes: Uint8Array): Promise<DocumentText> {
  if (!temAssinaturaPdf(bytes)) throw new ErroLeituraPdf('assinaturaInvalida')

  let documento
  try {
    documento = await pdfjs.getDocument({
      // Cópia: o pdfjs transfere/neutraliza o buffer que recebe, e o chamador
      // ainda precisa dos bytes originais para calcular o hash (R8).
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
    }).promise
  } catch {
    throw new ErroLeituraPdf('documentoIlegivel')
  }

  const pages: PageMetrics[] = []
  const lines: TextLine[] = []

  try {
    for (let numero = 1; numero <= documento.numPages; numero++) {
      const pagina = await documento.getPage(numero)
      const viewport = pagina.getViewport({ scale: 1 })
      const conteudo = await pagina.getTextContent()

      const itens: TextItem[] = []
      for (const bruto of conteudo.items as ItemPdfJs[]) {
        const texto = bruto.str
        const transform = bruto.transform
        if (!texto || !transform || transform.length < 6) continue
        itens.push({
          text: texto,
          x: transform[4]!,
          y: transform[5]!,
          width: bruto.width ?? 0,
          height: bruto.height ?? 0,
        })
      }

      pages.push({
        page: numero,
        width: viewport.width,
        height: viewport.height,
        itemCount: itens.length,
      })
      lines.push(...reconstruirLinhas(itens, numero, lines.length))
    }
  } catch {
    throw new ErroLeituraPdf('documentoIlegivel')
  } finally {
    await documento.destroy()
  }

  return {
    pages,
    lines,
    // Sem nenhum item de texto em nenhuma página, o PDF é imagem escaneada.
    // Seção 9: nesta fase isso resolve para `unrecognized` com aviso — OCR é
    // um FallbackExtractor posterior, não um remendo aqui.
    hasTextLayer: lines.length > 0,
  }
}
