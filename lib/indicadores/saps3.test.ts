import { describe, it, expect } from 'vitest'
import { saps3MortalidadeEsperada } from './saps3'

describe('SAPS 3 → mortalidade esperada (equação Central-South America)', () => {
  // Valores conferidos contra o cálculo independente da equação publicada E
  // contra a saída da função SQL saps3_mortalidade_esperada, no banco. Se este
  // teste quebrar, a implementação TypeScript divergiu — e a SQL (que alimenta
  // o SMR) precisa ser conferida junto.
  it.each([
    [20, 0.74],
    [30, 2.87],
    [40, 9.33],
    [50, 24.35],
    [60, 47.92],
    [70, 70.88],
    [80, 85.76],
    [90, 93.36],
    [100, 96.90],
    [120, 99.26],
  ])('escore %i → %f%%', (escore, pctEsperado) => {
    const pct = saps3MortalidadeEsperada(escore)! * 100
    expect(pct).toBeCloseTo(pctEsperado, 1)
  })

  it('é monotônica: escore maior, mortalidade maior', () => {
    let anterior = -1
    for (let s = 0; s <= 150; s += 5) {
      const m = saps3MortalidadeEsperada(s)!
      expect(m).toBeGreaterThan(anterior)
      anterior = m
    }
  })

  it('a constante é negativa — com o sinal positivo a curva satura perto de 100%', () => {
    // Regressão da armadilha: as fontes publicam a constante sem o menos. Com
    // ela positiva, um escore baixo (30) já daria mortalidade absurda.
    expect(saps3MortalidadeEsperada(30)! * 100).toBeLessThan(10)
  })

  it('escore inválido devolve null, não NaN', () => {
    expect(saps3MortalidadeEsperada(null)).toBeNull()
    expect(saps3MortalidadeEsperada(-5)).toBeNull()
  })
})
