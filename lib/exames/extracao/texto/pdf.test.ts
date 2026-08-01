import { describe, it, expect } from 'vitest'
import { ErroLeituraPdf, lerDocumento, temAssinaturaPdf } from './pdf'
import { construirPdf, pdfDeLinhas } from '../_testes/pdfMinimo'

// ══════════════════════════════════════════════════════════════════════════
// 7.B-11 — este é o arquivo que o clinBoard não tem.
//
// Lá, a suíte sintética alimenta TEXTO direto ao parser: junção de itens,
// ordenação por coluna, multipágina e ligaduras ficam cobertos só pelos
// fixtures reais, que não estão no repositório. Aqui os PDFs são de verdade,
// gerados por script, sem nenhum dado de paciente.
// ══════════════════════════════════════════════════════════════════════════

describe('assinatura do arquivo', () => {
  it('aceita bytes que começam com %PDF', () => {
    expect(temAssinaturaPdf(pdfDeLinhas(['x']))).toBe(true)
  })

  it('rejeita arquivo renomeado — o MIME do navegador é falsificável', () => {
    expect(temAssinaturaPdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false) // PNG
    expect(temAssinaturaPdf(new Uint8Array())).toBe(false)
  })

  it('erro de leitura tem mensagem fixa, sem conteúdo do documento (R10)', async () => {
    await expect(lerDocumento(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(ErroLeituraPdf)
    await lerDocumento(new Uint8Array([1, 2, 3])).catch((e: ErroLeituraPdf) => {
      expect(e.motivo).toBe('assinaturaInvalida')
      expect(e.message).not.toMatch(/\d{2}\/\d{2}\/\d{4}/)
    })
  })
})

describe('leitura de um PDF de verdade', () => {
  it('reconstrói as linhas na ordem visual', async () => {
    const doc = await lerDocumento(
      pdfDeLinhas(['PRIMEIRA LINHA', 'SEGUNDA LINHA', 'TERCEIRA LINHA']),
    )
    expect(doc.hasTextLayer).toBe(true)
    expect(doc.lines.map(l => l.text)).toEqual([
      'PRIMEIRA LINHA',
      'SEGUNDA LINHA',
      'TERCEIRA LINHA',
    ])
  })

  it('preserva página e coordenadas', async () => {
    const doc = await lerDocumento(pdfDeLinhas(['unica']))
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0]).toMatchObject({ page: 1, width: 595, height: 842 })
    expect(doc.lines[0]!.page).toBe(1)
    expect(doc.lines[0]!.y).toBeGreaterThan(700)
  })

  it('separa colunas de uma linha tabular pelo vão medido', async () => {
    // Layout típico de laudo: nome | valor | unidade | referência.
    const doc = await lerDocumento(
      construirPdf([
        {
          linhas: [
            { texto: 'Creatinina', x: 50, y: 700, tamanho: 11 },
            { texto: '1,42', x: 220, y: 700, tamanho: 11 },
            { texto: 'mg/dL', x: 300, y: 700, tamanho: 11 },
            { texto: '0,60 - 1,30', x: 400, y: 700, tamanho: 11 },
          ],
        },
      ]),
    )
    expect(doc.lines).toHaveLength(1)
    const linha = doc.lines[0]!
    expect(linha.text).toBe('Creatinina   1,42   mg/dL   0,60 - 1,30')
    // Os quatro itens continuam individualizados, com os vãos reais.
    expect(linha.items).toHaveLength(4)
    expect(linha.gaps).toHaveLength(3)
    expect(linha.gaps.every(g => g > 25)).toBe(true)
  })

  it('a largura vem medida do PDF, não estimada por contagem de caractere', async () => {
    const doc = await lerDocumento(pdfDeLinhas(['ABCDEFGHIJ']))
    const item = doc.lines[0]!.items[0]!
    expect(item.width).toBeGreaterThan(0)
    // 10 caracteres em Helvetica 11pt medem ~60pt; a estimativa do doador
    // (10 × 4,5 = 45pt) erraria por ~30%.
    expect(item.width).toBeGreaterThan(50)
    expect(item.width).toBeLessThan(80)
  })

  it('documento multipágina: índice de linha é contínuo entre páginas', async () => {
    const doc = await lerDocumento(
      construirPdf([
        { linhas: [{ texto: 'PAGINA UM A', x: 50, y: 700, tamanho: 11 }, { texto: 'PAGINA UM B', x: 50, y: 680, tamanho: 11 }] },
        { linhas: [{ texto: 'PAGINA DOIS', x: 50, y: 700, tamanho: 11 }] },
      ]),
    )
    expect(doc.pages).toHaveLength(2)
    expect(doc.lines.map(l => l.index)).toEqual([0, 1, 2])
    expect(doc.lines.map(l => l.page)).toEqual([1, 1, 2])
    expect(doc.lines[2]!.text).toBe('PAGINA DOIS')
  })

  it('PDF sem camada de texto é reconhecido como tal, não como vazio (seção 9)', async () => {
    // Página válida sem nenhum operador de texto = PDF escaneado.
    const doc = await lerDocumento(construirPdf([{ linhas: [] }]))
    expect(doc.pages).toHaveLength(1)
    expect(doc.hasTextLayer).toBe(false)
    expect(doc.lines).toEqual([])
  })

  it('acento sobrevive à ida e volta pelo PDF', async () => {
    // Regressão: sem /WinAnsiEncoding na fonte, o PDF usa a StandardEncoding
    // embutida do Helvetica e "POTÁSSIO" volta como "POT`SSIO". Um teste com
    // acento passava a provar a coisa errada, em silêncio.
    const doc = await lerDocumento(
      pdfDeLinhas(['POTÁSSIO', 'Método REFERÊNCIA CRÍTICO', 'Hemácias Cálcio iônico Coágulo']),
    )
    expect(doc.lines.map(l => l.text)).toEqual([
      'POTÁSSIO',
      'Método REFERÊNCIA CRÍTICO',
      'Hemácias Cálcio iônico Coágulo',
    ])
  })

  it('R8 · duas leituras do mesmo PDF produzem o mesmo objeto', async () => {
    const bytes = pdfDeLinhas(['Sodio  140  mmol/L  135 - 145'])
    expect(await lerDocumento(bytes)).toEqual(await lerDocumento(bytes))
  })

  it('R9 · leituras simultâneas não se contaminam', async () => {
    const a = pdfDeLinhas(['DOCUMENTO A', 'Sodio 140'])
    const b = pdfDeLinhas(['DOCUMENTO B', 'Potassio 5,1'])
    const [ra, rb] = await Promise.all([lerDocumento(a), lerDocumento(b)])
    expect(ra.lines[0]!.text).toBe('DOCUMENTO A')
    expect(rb.lines[0]!.text).toBe('DOCUMENTO B')
  })

  it('não neutraliza os bytes do chamador (o hash ainda precisa deles)', async () => {
    const bytes = pdfDeLinhas(['x'])
    const antes = bytes.length
    await lerDocumento(bytes)
    expect(bytes.length).toBe(antes)
    expect(bytes[0]).toBe(0x25)
  })
})
