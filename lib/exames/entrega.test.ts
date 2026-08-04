import { describe, it, expect } from 'vitest'
import { montarEntrega } from './entrega'
import { extrairExames } from './extracao'
import { pdfDeLinhas, pdfTabular } from './extracao/_testes/pdfMinimo'

async function entregar(bytes: Uint8Array) {
  const r = await extrairExames({ document: { bytes, filename: null }, hints: null, options: null })
  return montarEntrega(r, false)
}

describe('D3 · cultura vira registro, não desaparece', () => {
  it('um laudo com cultura E exames entrega os dois', async () => {
    const e = await entregar(pdfDeLinhas([
      'BIOQUIMICA', 'Coleta: 12/05/2026',
      'Glicose              92    mg/dL      70 - 99',
      'HEMOCULTURA - 1ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: Escherichia coli',
    ]))
    const nomes = e.linhas.flatMap(l => l.valores.map(v => v.nome))
    expect(nomes).toContain('Glicose')
    expect(nomes.some(n => /Hemocultura/i.test(n))).toBe(true)
  })

  it('a cultura carrega o organismo isolado no valor', async () => {
    const e = await entregar(pdfDeLinhas([
      'HEMOCULTURA - 1ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: Escherichia coli',
    ]))
    const cultura = e.linhas.flatMap(l => l.valores).find(v => /Hemocultura/i.test(v.nome))
    expect(cultura?.valor).toMatch(/Escherichia coli/)
  })
})

describe('D4 e D5 · dois valores do mesmo exame', () => {
  const bytes = pdfTabular([
    ['GASOMETRIA ARTERIAL', 'Valores de referência'],
    ['Coleta: 08/04/2026'],
    ['pCO2', ':', '47,0 mmHg', '35,0 - 45,0 mmHg'],
    ['pCO2', ':', '33,0 mmHg', '35,0 - 45,0 mmHg'],
  ], [50, 170, 240, 380])

  it('os DOIS sobrevivem — o sistema não escolhe', async () => {
    const e = await entregar(bytes)
    const pco2 = e.linhas.flatMap(l => l.valores).filter(v => v.nome === 'PCO2 (Arterial)')
    expect(pco2).toHaveLength(1)
    expect(pco2[0]!.valor).toBe('47,0 / 33,0')
  })

  it('o conflito é marcado e entra nas pendências', async () => {
    const e = await entregar(bytes)
    const pco2 = e.linhas.flatMap(l => l.valores).find(v => v.nome === 'PCO2 (Arterial)')!
    expect(pco2.conflito).toBe(true)
    expect(pco2.precisaConferencia).toBe(true)
    expect(e.pendencias.some(p => p.nome === 'PCO2 (Arterial)')).toBe(true)
  })

  it('o conflito é canal "confira" — dois valores no laudo é dúvida sobre O VALOR', async () => {
    const e = await entregar(bytes)
    const pco2 = e.linhas.flatMap(l => l.valores).find(v => v.nome === 'PCO2 (Arterial)')!
    expect(pco2.confereValor).toBe(true)
  })

  it('R3 · em conflito o sistema não opina sobre alterado', async () => {
    const e = await entregar(bytes)
    const pco2 = e.linhas.flatMap(l => l.valores).find(v => v.nome === 'PCO2 (Arterial)')!
    expect(pco2.valorNumerico).toBeNull()
  })
})

describe('D9 · as pendências saem prontas para a tela', () => {
  it('resultado sem data de coleta aparece na lista', async () => {
    const e = await entregar(pdfDeLinhas([
      'BIOQUIMICA',
      'Glicose              92    mg/dL      70 - 99',
    ]))
    expect(e.pendencias).toContainEqual({ nome: 'Glicose', motivo: 'sem data de coleta' })
  })

  it('sem pendência, a lista vem vazia — não nula', async () => {
    const e = await entregar(pdfDeLinhas([
      'BIOQUIMICA', 'Coleta: 12/05/2026',
      'Glicose              92    mg/dL      70 - 99',
    ]))
    expect(e.pendencias).toEqual([])
  })
})

describe('R3.1 · dois canais de aviso — "confira" e "o laudo não trouxe"', () => {
  // Decisão da Juliana, 03/08/2026: medido no acervo real, 427 de 879
  // resultados (49%) ganhavam ⚠ só por `referenceAbsent` ou `unknownUnit` —
  // fadiga de alarme. A distinção não é severidade, é do que o marcador FALA:
  // dúvida sobre o VALOR (canal "confira", ⚠ + lista âmbar) vs. o laudo que
  // não trouxe um dado (canal "nota", discreto).
  const LAUDO_MISTO = [
    'GASOMETRIA ARTERIAL',
    'Coleta: 12/05/2026',
    // Sem coluna de referência: só `referenceAbsent` — canal "nota".
    'pH............:  7,38',
    // Faixa fisicamente impossível para potássio: `implausibleValue` — canal
    // "confira".
    'BIOQUIMICA',
    'Coleta: 12/05/2026',
    'Potássio             72,0    mmol/L     3,5 - 5,0',
  ]

  it('o valor implausível entra no canal "confira" — ⚠ e pendência', async () => {
    const e = await entregar(pdfDeLinhas(LAUDO_MISTO))
    const k = e.linhas.flatMap(l => l.valores).find(v => v.nome === 'Potássio')!
    expect(k.confereValor).toBe(true)
    expect(e.pendencias.some(p => p.nome === 'Potássio')).toBe(true)
  })

  it('o valor sem referência NÃO entra no canal "confira"', async () => {
    const e = await entregar(pdfDeLinhas(LAUDO_MISTO))
    const ph = e.linhas.flatMap(l => l.valores).find(v => v.nome === 'pH (Arterial)')!
    expect(ph.confereValor).toBe(false)
    expect(e.pendencias.some(p => p.nome === 'pH (Arterial)')).toBe(false)
  })

  it('referenceAbsent não some — continua visível no canal "nota"', async () => {
    const e = await entregar(pdfDeLinhas(LAUDO_MISTO))
    const ph = e.linhas.flatMap(l => l.valores).find(v => v.nome === 'pH (Arterial)')!
    expect(ph.motivosNota).toContain(
      'o laudo não trouxe faixa de referência — o valor não foi comparado com nada',
    )
    expect(e.notasLaudo.some(n => n.nome === 'pH (Arterial)')).toBe(true)
  })

  it('`precisaConferencia` mantém o significado antigo — QUALQUER motivo, dos dois canais', async () => {
    const e = await entregar(pdfDeLinhas(LAUDO_MISTO))
    const ph = e.linhas.flatMap(l => l.valores).find(v => v.nome === 'pH (Arterial)')!
    // Só tem motivo de canal "nota", mesmo assim `precisaConferencia` é true:
    // é o campo que ainda vira `revisar` no banco, e `revisar` não muda de
    // sentido nesta correção.
    expect(ph.precisaConferencia).toBe(true)
  })

  it('unknownUnit também é canal "nota", não "confira"', async () => {
    const e = await entregar(pdfDeLinhas([
      'BIOQUIMICA', 'Coleta: 12/05/2026',
      'Glicose              92    xyz      70 - 99',
    ]))
    const g = e.linhas.flatMap(l => l.valores).find(v => v.nome === 'Glicose')!
    expect(g.confereValor).toBe(false)
    expect(g.motivosNota.length).toBeGreaterThan(0)
  })
})

describe('a origem de cada número viaja junto', () => {
  it('cada valor sabe de que página e linha veio', async () => {
    const e = await entregar(pdfDeLinhas([
      'BIOQUIMICA', 'Coleta: 12/05/2026',
      'Glicose              92    mg/dL      70 - 99',
    ]))
    const g = e.linhas[0]!.valores[0]!
    expect(g.origem.pagina).toBe(1)
    expect(g.origem.regra).toBeTruthy()
  })
})
