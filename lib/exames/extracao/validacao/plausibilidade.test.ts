import { describe, it, expect } from 'vitest'
import { checarPlausibilidade } from './plausibilidade'
import { carregarCatalogo, resolverAnalito } from '../catalogo'
import { extrairExames } from '../index'
import { pdfDeLinhas } from '../_testes/pdfMinimo'
import type { Analyte, ExamValue } from '../contratos'

const num = (value: number): ExamValue =>
  ({ kind: 'numeric', value, raw: String(value), censoring: 'none' })
const un = (raw: string) => ({ raw, canonical: raw || null })
const analito = (nome: string) => resolverAnalito(nome)!

// ══════════════════════════════════════════════════════════════════════════
// A faixa de plausibilidade existe para pegar ERRO DE LEITURA, não doença.
//
// O risco desta camada é inverso ao das outras: uma faixa apertada demais
// marca como suspeito justamente o valor crítico, que é o que mais importa
// numa UTI. Por isso metade destes testes verifica o que ela NÃO faz.
// ══════════════════════════════════════════════════════════════════════════

describe('valor gravemente alterado PASSA — não é erro de leitura', () => {
  const casos: [string, number, string][] = [
    ['Potássio', 7.2, 'mmol/L'],       // hipercalemia grave
    ['Potássio', 1.9, 'mmol/L'],       // hipocalemia grave
    ['Creatinina', 9.4, 'mg/dL'],      // insuficiência renal
    ['Sódio', 175, 'mmol/L'],          // hipernatremia grave
    ['Sódio', 105, 'mmol/L'],          // hiponatremia grave
    ['Glicose', 1200, 'mg/dL'],        // estado hiperosmolar
    ['Glicose', 18, 'mg/dL'],          // hipoglicemia grave
    ['Lactato', 22, 'mmol/L'],         // choque
    ['pH (Arterial)', 6.85, ''],       // acidose grave
    ['Plaquetas', 3000, '/mm³'],       // plaquetopenia gravíssima
    ['Leucócitos', 320000, '/mm³'],    // leucemia
    ['PCR', 480, 'mg/L'],              // sepse
    ['TGO (AST)', 15000, 'U/L'],       // hepatite fulminante
  ]
  for (const [nome, valor, unidade] of casos) {
    it(`${nome} ${valor} ${unidade} não é marcado`, () => {
      const r = checarPlausibilidade(num(valor), un(unidade), analito(nome))
      expect(r.veredito, `${nome} ${valor}`).toBe('plausivel')
    })
  }
})

describe('erro de ESCALA é pego', () => {
  it('sódio 1.400 — separador de milhar lido como decimal', () => {
    expect(checarPlausibilidade(num(1400), un('mmol/L'), analito('Sódio')).veredito)
      .toBe('implausivel')
  })

  it('creatinina 940 — vírgula perdida', () => {
    expect(checarPlausibilidade(num(940), un('mg/dL'), analito('Creatinina')).veredito)
      .toBe('implausivel')
  })

  it('pH 74 — o ponto sumiu', () => {
    expect(checarPlausibilidade(num(74), un(''), analito('pH (Arterial)')).veredito)
      .toBe('implausivel')
  })
})

describe('sem informação, o validador se cala — nunca aprova por omissão', () => {
  it('analito sem faixa devolve naoChecado, não plausível', () => {
    const semFaixa = { ...analito('Sódio'), plausibleRange: null } as Analyte
    const r = checarPlausibilidade(num(999999), un('mmol/L'), semFaixa)
    expect(r).toEqual({ veredito: 'naoChecado', porque: 'semFaixa' })
  })

  it('unidade diferente da faixa NÃO é comparada', () => {
    // 1,4 mg/dL de creatinina é 124 µmol/L. Comparar 124 contra a faixa em
    // mg/dL marcaria um valor perfeitamente normal como impossível.
    const r = checarPlausibilidade(num(124), un('µmol/L'), analito('Creatinina'))
    expect(r).toEqual({ veredito: 'naoChecado', porque: 'unidadeDiferente' })
  })

  it('valor qualitativo não é comparado', () => {
    const qual: ExamValue = { kind: 'qualitative', code: 'negative', raw: 'Negativo' }
    expect(checarPlausibilidade(qual, un('mmol/L'), analito('Sódio')))
      .toEqual({ veredito: 'naoChecado', porque: 'naoNumerico' })
  })

  it('analito nulo não quebra', () => {
    expect(checarPlausibilidade(num(5), un('mg/dL'), null).veredito).toBe('naoChecado')
  })

  it('grafia diferente da MESMA unidade é comparada', () => {
    // "/mm3" e "/mm³" são a mesma unidade; deixar de conferir por causa do
    // expoente seria perder cobertura sem ganhar segurança.
    expect(checarPlausibilidade(num(250000), un('/mm3'), analito('Plaquetas')).veredito)
      .toBe('plausivel')
  })
})

describe('R1 · valor implausível é MARCADO, nunca descartado', () => {
  it('o valor continua no resultado, com o motivo de revisão', async () => {
    const r = await extrairExames({
      document: { bytes: pdfDeLinhas([
        'BIOQUIMICA', 'Coleta: 12/05/2026',
        'Sódio             1400    mmol/L     135 - 145',
      ]), filename: null },
      hints: null,
      options: null,
    })
    const sodio = r.observations.find(o => o.canonicalName === 'Sódio')
    expect(sodio, 'o valor não pode desaparecer').toBeDefined()
    expect(sodio!.value).toMatchObject({ kind: 'numeric', value: 1400 })
    expect(sodio!.requiresReview).toBe(true)
    expect(sodio!.reviewReasons).toContain('implausibleValue')
    expect(r.discarded.some(d => d.reason === 'implausibleValue')).toBe(false)
  })

  it('valor normal não ganha o marcador', async () => {
    const r = await extrairExames({
      document: { bytes: pdfDeLinhas([
        'BIOQUIMICA', 'Coleta: 12/05/2026',
        'Sódio              140    mmol/L     135 - 145',
      ]), filename: null },
      hints: null,
      options: null,
    })
    const sodio = r.observations.find(o => o.canonicalName === 'Sódio')!
    expect(sodio.reviewReasons).not.toContain('implausibleValue')
  })
})

describe('toda faixa do catálogo é larga o bastante para o extremo clínico', () => {
  // Trava contra o erro mais provável desta camada: alguém "apertar" uma faixa
  // achando que ela é faixa de normalidade.
  const extremos: [string, number, string][] = [
    ['Potássio', 8.5, 'mmol/L'], ['Sódio', 190, 'mmol/L'], ['Glicose', 1400, 'mg/dL'],
    ['Creatinina', 25, 'mg/dL'], ['Hemoglobina', 2.5, 'g/dL'], ['PCR', 500, 'mg/L'],
    ['Lactato', 30, 'mmol/L'], ['TTPA', 250, 's'], ['INR', 15, ''],
  ]
  for (const [nome, valor, unidade] of extremos) {
    it(`${nome} ${valor} continua cabendo`, () => {
      expect(checarPlausibilidade(num(valor), un(unidade), analito(nome)).veredito)
        .toBe('plausivel')
    })
  }

  it('nenhuma faixa é estreita a ponto de parecer faixa de normalidade', () => {
    // Para quase todo exame, a faixa fisicamente possível é MUITO mais larga
    // que a de referência: creatinina vai de 0,05 a 30 enquanto a referência
    // vai de 0,6 a 1,3. Se alguém colar a referência aqui, a razão despenca.
    //
    // As exceções são reais e não são descuido: sódio, cloro e cálcio iônico
    // são regulados numa janela estreita, e fora dela a pessoa não está viva.
    // Ficam listadas nominalmente para que ESTREITAR outro exame quebre.
    const ESTREITOS_DE_VERDADE = new Set(['Sódio', 'Cloro', 'Cálcio iônico'])
    const catalogo = carregarCatalogo()
    const suspeitas: string[] = []
    for (const a of Object.values(catalogo.analytes)) {
      const f = a.plausibleRange
      if (!f || ESTREITOS_DE_VERDADE.has(a.canonicalName)) continue
      // A razão só diz algo em grandeza estritamente positiva. Base excess vai
      // de -40 a 40, e adimensionais como o pH têm escala própria.
      if (f.min <= 0 || f.unit === '') continue
      if (f.max / f.min < 4) suspeitas.push(`${a.canonicalName} ${f.min}–${f.max}`)
    }
    expect(suspeitas).toEqual([])
  })

  it('mesmo os estreitos comportam o extremo compatível com a vida', () => {
    expect(checarPlausibilidade(num(190), un('mmol/L'), analito('Sódio')).veredito).toBe('plausivel')
    expect(checarPlausibilidade(num(98), un('mmol/L'), analito('Sódio')).veredito).toBe('plausivel')
    expect(checarPlausibilidade(num(170), un('mmol/L'), analito('Cloro')).veredito).toBe('plausivel')
    expect(checarPlausibilidade(num(60), un('mmol/L'), analito('Cloro')).veredito).toBe('plausivel')
  })
})
