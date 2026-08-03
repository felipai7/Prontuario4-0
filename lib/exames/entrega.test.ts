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
