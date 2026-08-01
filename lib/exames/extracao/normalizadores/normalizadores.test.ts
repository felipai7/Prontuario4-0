import { describe, it, expect } from 'vitest'
import { converterNumero } from './numero'
import { interpretarValor, lerCensura, ehNaoUsadoClinicamente } from './valor'
import { normalizarUnidade, limparUnidade } from './unidade'
import { interpretarReferencia, ehFaixaEtaria } from './referencia'
import { ehUnidadeDeContagem, type ContextoNormalizacao } from './contexto'
import { resolverAnalito } from '../catalogo'

/** Contexto obrigatório — nenhum normalizador aceita entrada sem ele (D3). */
function ctx(unidadeBruta = '', nomeAnalito: string | null = null): ContextoNormalizacao {
  return { unidadeBruta, analito: nomeAnalito ? resolverAnalito(nomeAnalito) : null }
}

// ══════════════════════════════════════════════════════════════════════════
// Cada caso abaixo corresponde a um defeito real observado em produção.
// ══════════════════════════════════════════════════════════════════════════

describe('converterNumero · desambiguação pt-BR', () => {
  it('"4.500" com unidade de contagem é quatro mil e quinhentos', () => {
    expect(converterNumero('4.500', ctx('/mm³'))).toBe(4500)
    expect(converterNumero('4.500', ctx('x10~3/uL'))).toBe(4500)
  })

  it('"8.094" fora de contagem continua milhar (três casas em pt-BR)', () => {
    // Neutrófilos: tratar como decimal invertia o status para "baixo".
    expect(converterNumero('8.094', ctx(''))).toBe(8094)
  })

  it('"1.015" de densidade urinária é decimal', () => {
    expect(converterNumero('1.015', ctx('', 'Densidade'))).toBeCloseTo(1.015, 5)
  })

  it('"1.000" de densidade urinária também é decimal', () => {
    // O doador exigia "nem todos zeros depois do ponto" e transformava esta
    // densidade legítima em mil. Com o analito no contexto, some a adivinhação.
    expect(converterNumero('1.000', ctx('', 'Densidade'))).toBe(1)
  })

  it('"1.000" sem contexto de densidade continua sendo mil', () => {
    expect(converterNumero('1.000', ctx(''))).toBe(1000)
  })

  it('vírgula é decimal; ponto e vírgula juntos é milhar + decimal', () => {
    expect(converterNumero('6,8', ctx(''))).toBeCloseTo(6.8, 5)
    expect(converterNumero('1.234,56', ctx(''))).toBeCloseTo(1234.56, 5)
  })

  it('"- 6,0" com espaço após o sinal é negativo (base excess)', () => {
    expect(converterNumero('- 6,0', ctx('mmol/L'))).toBeCloseTo(-6, 5)
    expect(converterNumero('-6,0', ctx('mmol/L'))).toBeCloseTo(-6, 5)
  })

  it('texto sem número devolve null, nunca 0', () => {
    // Devolver 0 foi como "< 5,0" virou zero com status normal no doador.
    expect(converterNumero('', ctx(''))).toBeNull()
    expect(converterNumero('ausente', ctx(''))).toBeNull()
    expect(converterNumero('---', ctx(''))).toBeNull()
  })

  it('reconhece unidade de contagem em suas várias grafias', () => {
    for (const u of ['/mm3', '/mm³', '/µL', '/uL', 'mil/mm³', 'x10~3/uL', '10^3/uL']) {
      expect(ehUnidadeDeContagem(u), u).toBe(true)
    }
    expect(ehUnidadeDeContagem('mg/dL')).toBe(false)
  })
})

describe('lerCensura · R5, os QUATRO operadores', () => {
  it('distingue estrito de não-estrito nos dois sentidos', () => {
    expect(lerCensura('< 5,0').censoring).toBe('lt')
    expect(lerCensura('<= 5').censoring).toBe('lte')
    expect(lerCensura('≤ 5').censoring).toBe('lte')
    expect(lerCensura('> 10000').censoring).toBe('gt')
    expect(lerCensura('>= 100').censoring).toBe('gte')
    expect(lerCensura('≥ 100').censoring).toBe('gte')
  })

  it('"≤" não colapsa em "<" — foi o atalho do doador', () => {
    expect(lerCensura('≤ 5').censoring).not.toBe(lerCensura('< 5').censoring)
    expect(lerCensura('≥ 5').censoring).not.toBe(lerCensura('> 5').censoring)
  })

  it('sem operador, a censura é "none"', () => {
    expect(lerCensura('5,0')).toEqual({ censoring: 'none', resto: '5,0' })
  })
})

describe('interpretarValor · o valor carrega sua própria semântica', () => {
  it('"< 0,01" mantém o limite E o operador', () => {
    expect(interpretarValor('< 0,01', ctx('ng/mL'))).toEqual({
      kind: 'numeric', value: 0.01, censoring: 'lt', raw: '< 0,01',
    })
  })

  it('"> 10000" idem', () => {
    expect(interpretarValor('> 10000', ctx('ng/mL'))).toMatchObject({
      kind: 'numeric', value: 10000, censoring: 'gt',
    })
  })

  it('"≤ 5" e "≥ 100" produzem lte e gte', () => {
    expect(interpretarValor('≤ 5', ctx('mg/L'))).toMatchObject({ censoring: 'lte', value: 5 })
    expect(interpretarValor('≥ 100', ctx('mg/L'))).toMatchObject({ censoring: 'gte', value: 100 })
  })

  it('7.B-1 · o mesmo analito censurado nos três formatos dá o mesmo valor', () => {
    // No doador, a censura funcionava no bloco "Resultado:" e no EAS, mas não
    // na tabela multiparâmetro — lá devolvia null e sumia sem registro.
    const esperado = { kind: 'numeric', value: 5, censoring: 'lt' }
    expect(interpretarValor('< 5,0', ctx('mg/L', 'PCR'))).toMatchObject(esperado)
    expect(interpretarValor('<5,0', ctx('mg/L', 'PCR'))).toMatchObject(esperado)
    expect(interpretarValor('< 5,0 ', ctx('mg/L', 'PCR'))).toMatchObject(esperado)
  })

  it('"1:80" é título, não razão nem decimal', () => {
    expect(interpretarValor('1:80', ctx(''))).toEqual({
      kind: 'titer', numerator: 1, denominator: 80, raw: '1:80',
    })
  })

  it('cruzes viram semiquantitativo, nas duas grafias', () => {
    expect(interpretarValor('+++', ctx(''))).toMatchObject({ kind: 'semiquantitative', crosses: 3 })
    expect(interpretarValor('2+', ctx(''))).toMatchObject({ kind: 'semiquantitative', crosses: 2 })
    expect(interpretarValor('++++', ctx(''))).toMatchObject({ kind: 'semiquantitative', crosses: 4 })
  })

  it('vocabulário qualitativo vira código, sem status clínico junto (R3)', () => {
    expect(interpretarValor('NEGATIVO', ctx(''))).toMatchObject({ kind: 'qualitative', code: 'negative' })
    expect(interpretarValor('Não Reagente', ctx(''))).toMatchObject({ code: 'nonreactive' })
    expect(interpretarValor('INDETERMINADO', ctx(''))).toMatchObject({ code: 'indeterminate' })
    expect(interpretarValor('INCONCLUSIVO', ctx(''))).toMatchObject({ code: 'inconclusive' })
  })

  it('"indeterminado" e "inconclusivo" são códigos próprios, não "alterado"', () => {
    const a = interpretarValor('INDETERMINADO', ctx(''))
    const b = interpretarValor('INCONCLUSIVO', ctx(''))
    expect(a).not.toEqual(b)
  })

  it('descrição física do líquor é texto — decisão clínica de 31/07/2026', () => {
    for (const termo of ['XANTOCRÔMICO', 'LÍMPIDO', 'TURVO', 'HEMORRÁGICO']) {
      expect(interpretarValor(termo, ctx('')), termo).toMatchObject({ kind: 'text' })
    }
  })

  it('"IMUNE" é marcado como não usado clinicamente, para virar descarte visível', () => {
    expect(ehNaoUsadoClinicamente('IMUNE')).toBe(true)
    expect(ehNaoUsadoClinicamente('Não Imune')).toBe(true)
    expect(ehNaoUsadoClinicamente('NEGATIVO')).toBe(false)
  })

  it('"5 colônias" não vira o número 5 em silêncio', () => {
    expect(interpretarValor('5 colônias', ctx(''))).toMatchObject({ kind: 'text' })
  })

  it('R8 · duas chamadas com a mesma entrada dão o mesmo objeto', () => {
    expect(interpretarValor('< 5,0', ctx('mg/L'))).toEqual(interpretarValor('< 5,0', ctx('mg/L')))
  })
})

describe('normalizarUnidade', () => {
  it('"x10~3/uL" resolve para a forma canônica', () => {
    expect(normalizarUnidade('x10~3/uL').canonical).toBe('10³/µL')
  })

  it('"74,6 %:" — a pontuação do layout não faz parte da unidade', () => {
    expect(limparUnidade('%:')).toBe('%')
    expect(normalizarUnidade('%:').canonical).toBe('%')
  })

  it('grafias diferentes da mesma unidade convergem', () => {
    expect(normalizarUnidade('mg/dl').canonical).toBe('mg/dL')
    expect(normalizarUnidade('MG/DL').canonical).toBe('mg/dL')
    expect(normalizarUnidade('/mm3').canonical).toBe('/mm³')
    expect(normalizarUnidade('UFC/mL').canonical).toBe('CFU/mL')
  })

  it('unidade desconhecida devolve canonical null, preservando o texto bruto', () => {
    const r = normalizarUnidade('quilogramas por furlong')
    expect(r.canonical).toBeNull()
    expect(r.raw).toBe('quilogramas por furlong')
  })

  it('unidade ausente não vira string vazia canônica', () => {
    expect(normalizarUnidade('').canonical).toBeNull()
  })
})

describe('interpretarReferencia · D5, a guarda de faixa etária', () => {
  it('faixa numérica comum vira range', () => {
    expect(interpretarReferencia('0,60 - 1,30', ctx('mg/dL'))).toMatchObject({
      kind: 'range', min: 0.6, max: 1.3,
    })
    expect(interpretarReferencia('135 a 145', ctx('mmol/L'))).toMatchObject({
      kind: 'range', min: 135, max: 145,
    })
  })

  it('"De 2 a 19 anos" NÃO é referência', () => {
    const r = interpretarReferencia('De 2 a 19 anos', ctx('mg/dL'))
    expect(r.kind).toBe('rejected')
  })

  it('"0 a 4 dias" e "6 a 11 meses" também não são', () => {
    expect(interpretarReferencia('0 a 4 dias', ctx('')).kind).toBe('rejected')
    expect(interpretarReferencia('6 a 11 meses', ctx('')).kind).toBe('rejected')
    expect(ehFaixaEtaria('6 a 11 meses')).toBe(true)
    expect(ehFaixaEtaria('0,60 - 1,30')).toBe(false)
  })

  it('rejeitar a referência não impede extrair o valor', () => {
    // Foi por isso que a guarda do second-pass precisou ser relaxada no doador.
    const ref = interpretarReferencia('De 2 a 19 anos', ctx('mg/dL'))
    const valor = interpretarValor('1,42', ctx('mg/dL', 'Creatinina'))
    expect(ref.kind).toBe('rejected')
    expect(valor).toMatchObject({ kind: 'numeric', value: 1.42 })
  })

  it('tabela pediátrica antes da faixa real: pega a faixa real', () => {
    const r = interpretarReferencia('0 a 4 dias   135 - 145', ctx('mmol/L'))
    expect(r).toMatchObject({ kind: 'range', min: 135, max: 145 })
  })

  it('"ATÉ 105" e "MENOR 38" viram upperBound SEM inventar mínimo zero', () => {
    // O doador devolvia refMin: 0. "Menor que 38" não afirma que o mínimo é 0.
    const a = interpretarReferencia('ATÉ 105', ctx('mg/dL'))
    expect(a).toMatchObject({ kind: 'upperBound', max: 105 })
    expect(a).not.toHaveProperty('min')
    expect(interpretarReferencia('MENOR 38', ctx(''))).toMatchObject({ kind: 'upperBound', max: 38 })
    expect(interpretarReferencia('INFERIOR A 8', ctx(''))).toMatchObject({ kind: 'upperBound', max: 8 })
    expect(interpretarReferencia('< 500', ctx(''))).toMatchObject({ kind: 'upperBound', max: 500 })
  })

  it('"SUPERIOR A 20" e "> 100" viram lowerBound', () => {
    expect(interpretarReferencia('SUPERIOR A 20', ctx(''))).toMatchObject({ kind: 'lowerBound', min: 20 })
    expect(interpretarReferencia('> 100', ctx(''))).toMatchObject({ kind: 'lowerBound', min: 100 })
  })

  it('R4 · ausência distingue "não veio" de "não confio"', () => {
    // Vazio = o laudo não trouxe faixa. Qualquer outra coisa que eu não
    // reconheça = trouxe algo e eu não confio. As duas afirmações são
    // diferentes, e colapsá-las em `null` é o que R4 proíbe.
    expect(interpretarReferencia('', ctx(''))).toEqual({ kind: 'absent' })
    expect(interpretarReferencia('   ', ctx(''))).toEqual({ kind: 'absent' })
    expect(interpretarReferencia('vide observação', ctx('')).kind).toBe('rejected')
    expect(interpretarReferencia('vide observação 3', ctx('')).kind).toBe('rejected')
    expect(interpretarReferencia('12 // 8 ??', ctx('')).kind).toBe('rejected')
  })

  it('intervalo invertido é rejeitado, não silenciosamente aceito', () => {
    expect(interpretarReferencia('145 - 135', ctx(''))).toMatchObject({ kind: 'rejected' })
  })
})
