import { describe, it, expect } from 'vitest'
import { espacamento, reconstruirLinhas, TOLERANCIA_Y } from './linhas'
import type { TextItem } from '../contratos'

// Fábrica: item com largura MEDIDA declarada explicitamente. É o parâmetro que
// o doador não tinha (estimava 4.5pt por caractere) e que esta camada exige.
function item(text: string, x: number, y: number, width: number): TextItem {
  return { text, x, y, width, height: 11 }
}

describe('espacamento a partir do vão medido', () => {
  it('vão desprezível junta os itens (mudança de fonte no meio da palavra)', () => {
    expect(espacamento(0)).toBe('')
    expect(espacamento(0.4)).toBe('')
  })
  it('vão de palavra vira espaço simples', () => {
    expect(espacamento(3)).toBe(' ')
  })
  it('vão de coluna próxima vira espaço duplo', () => {
    expect(espacamento(12)).toBe('  ')
  })
  it('vão de coluna separada vira espaço triplo', () => {
    expect(espacamento(60)).toBe('   ')
  })
})

describe('reconstruirLinhas', () => {
  it('agrupa itens da mesma linha visual e ordena por X', () => {
    const itens = [
      item('mg/dL', 200, 700, 26),
      item('Creatinina', 50, 700, 48),
      item('1,42', 150, 700, 20),
    ]
    const linhas = reconstruirLinhas(itens, 1, 0)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.text).toMatch(/^Creatinina\s+1,42\s+mg\/dL$/)
  })

  it('tolera desalinhamento vertical de até 3pt na mesma linha', () => {
    // Caso real dos laudos do HOC: nome, ":", valor e referência saem do PDF
    // com Y ligeiramente diferentes. Fronteira rígida partia a linha ao meio.
    const itens = [
      item('Potassio', 50, 700, 40),
      item('5,1', 150, 700 + TOLERANCIA_Y - 0.5, 14),
    ]
    expect(reconstruirLinhas(itens, 1, 0)).toHaveLength(1)
  })

  it('separa linhas genuinamente distintas', () => {
    const itens = [item('Ureia', 50, 700, 26), item('Creatinina', 50, 680, 48)]
    const linhas = reconstruirLinhas(itens, 1, 0)
    expect(linhas.map(l => l.text)).toEqual(['Ureia', 'Creatinina'])
  })

  it('ordena de cima para baixo, não pela ordem de emissão do PDF', () => {
    const itens = [item('rodape', 50, 60, 30), item('cabecalho', 50, 800, 40)]
    expect(reconstruirLinhas(itens, 1, 0).map(l => l.text)).toEqual(['cabecalho', 'rodape'])
  })

  it('o gap usa a largura medida, não o comprimento do texto', () => {
    // Texto longo e estreito: estimar 4.5pt/caractere daria gap negativo e
    // colaria as colunas. Com largura medida, o vão real é 20pt.
    const itens = [item('ABCDEFGHIJKLMNOP', 50, 700, 30), item('9,9', 100, 700, 12)]
    const linhas = reconstruirLinhas(itens, 1, 0)
    expect(linhas[0]!.gaps).toEqual([20])
    expect(linhas[0]!.text).toBe('ABCDEFGHIJKLMNOP  9,9')
  })

  it('preserva página e coordenada em cada linha', () => {
    const linhas = reconstruirLinhas([item('x', 50, 700, 5)], 3, 0)
    expect(linhas[0]!.page).toBe(3)
    expect(linhas[0]!.y).toBe(700)
    expect(linhas[0]!.items).toHaveLength(1)
  })

  it('o índice é global e contínuo, para a procedência não ter buraco (R2)', () => {
    const itens = [item('a', 50, 700, 5), item('  ', 60, 690, 5), item('b', 50, 680, 5)]
    const linhas = reconstruirLinhas(itens, 2, 10)
    expect(linhas.map(l => l.index)).toEqual([10, 11])
  })

  it('normaliza para NFC — acento decomposto quebraria a busca por nome', () => {
    const decomposto = 'Potássio' // "Potássio" com acento combinante
    const linhas = reconstruirLinhas([item(decomposto, 50, 700, 40)], 1, 0)
    expect(linhas[0]!.text).toBe('Potássio')
    expect(linhas[0]!.text.normalize('NFC')).toBe(linhas[0]!.text)
  })

  it('descarta itens vazios sem criar linha fantasma', () => {
    const itens = [item('   ', 50, 700, 5), item('valor', 50, 680, 22)]
    expect(reconstruirLinhas(itens, 1, 0).map(l => l.text)).toEqual(['valor'])
  })

  it('documento sem item nenhum devolve zero linhas', () => {
    expect(reconstruirLinhas([], 1, 0)).toEqual([])
  })

  it('R8 · duas execuções sobre a mesma entrada dão o mesmo resultado', () => {
    const itens = [item('b', 120, 700, 8), item('a', 50, 700.2, 8), item('c', 50, 680, 8)]
    expect(reconstruirLinhas(itens, 1, 0)).toEqual(reconstruirLinhas(itens, 1, 0))
  })
})
