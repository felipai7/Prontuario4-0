import { describe, it, expect } from 'vitest'
import { nomeCanonico, REGIOES_POR_MODALIDADE, MODALIDADES } from './examesImagem'

describe('nomeCanonico', () => {
  it('modalidade + região vira "<Modalidade> de <Região>"', () => {
    expect(nomeCanonico('TC', 'Tórax')).toBe('TC de Tórax')
    expect(nomeCanonico('Angio-TC', 'Coronárias')).toBe('Angio-TC de Coronárias')
    expect(nomeCanonico('RX', 'Joelho')).toBe('RX de Joelho')
  })

  it('Eco é a exceção: vira "Ecocardiograma <variante>", não "Eco de <variante>"', () => {
    expect(nomeCanonico('Eco', 'Transtorácico')).toBe('Ecocardiograma Transtorácico')
    expect(nomeCanonico('Eco', 'Transesofágico')).toBe('Ecocardiograma Transesofágico')
  })

  it('Eco "Controle" tem redação própria', () => {
    expect(nomeCanonico('Eco', 'Controle')).toBe('Ecocardiograma (controle)')
  })

  it('região vazia devolve só a modalidade — usado como sinal de seleção incompleta', () => {
    expect(nomeCanonico('TC', '')).toBe('TC')
  })

  it('toda modalidade do catálogo tem pelo menos uma região', () => {
    for (const m of MODALIDADES) {
      expect(REGIOES_POR_MODALIDADE[m].length).toBeGreaterThan(0)
    }
  })
})
