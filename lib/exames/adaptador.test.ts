import { describe, it, expect } from 'vitest'
import { adaptarParaExames } from './adaptador'
import { montarEntrega } from './entrega'
import { interpretarNumerico, interpretarQualitativo } from './interpretacao'
import { extrairExames } from './extracao'
import { pdfDeLinhas } from './extracao/_testes/pdfMinimo'

async function extrairEAdaptar(linhas: string[]) {
  const r = await extrairExames({
    document: { bytes: pdfDeLinhas(linhas), filename: null },
    hints: null,
    options: null,
  })
  return adaptarParaExames(montarEntrega(r, false))
}

// ══════════════════════════════════════════════════════════════════════════
// A fronteira entre o extrator (que não opina) e a tela (que precisa opinar).
// As três decisões da Juliana de 01/08/2026 viram comportamento aqui.
// ══════════════════════════════════════════════════════════════════════════

describe('Q5 · uma linha por data de coleta', () => {
  const LAUDO = [
    'HEMOGRAMA',
    'Coleta: 10/04/2026',
    'Hemoglobina        12,0    g/dL     12,0 - 16,0',
    'BIOQUIMICA',
    'Coleta: 12/04/2026',
    'Glicose              92    mg/dL      70 - 99',
  ]

  it('um PDF com duas coletas vira DOIS registros', async () => {
    const linhas = await extrairEAdaptar(LAUDO)
    expect(linhas).toHaveLength(2)
    expect(linhas.map(l => l.data_exame)).toEqual(['10/04/2026', '12/04/2026'])
  })

  it('cada resultado fica na data em que foi colhido', async () => {
    const linhas = await extrairEAdaptar(LAUDO)
    const nomes = (i: number) => linhas[i]!.resultados.map(r => r.nome)
    expect(nomes(0)).toContain('Hemoglobina')
    expect(nomes(1)).toContain('Glicose')
    expect(nomes(0)).not.toContain('Glicose')
  })

  it('uma coleta só continua sendo um registro só', async () => {
    const linhas = await extrairEAdaptar([
      'BIOQUIMICA', 'Coleta: 12/04/2026',
      'Glicose              92    mg/dL      70 - 99',
      'Ureia                40    mg/dL      15 - 45',
    ])
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.resultados).toHaveLength(2)
  })

  it('R8 · sem data no laudo, a data fica nula — nunca a de hoje', async () => {
    const linhas = await extrairEAdaptar([
      'BIOQUIMICA',
      'Glicose              92    mg/dL      70 - 99',
    ])
    expect(linhas[0]!.data_exame).toBeNull()
    expect(linhas[0]!.resultados[0]!.motivos_revisao).toContain('sem data de coleta')
  })
})

describe('Q4 · valor censurado guarda o operador', () => {
  it('"< 5,0" mantém o texto, o número e o operador', async () => {
    const linhas = await extrairEAdaptar([
      'BIOQUIMICA', 'Coleta: 12/04/2026',
      'PCR                 < 5,0    mg/L      0 - 5',
    ])
    const pcr = linhas[0]!.resultados.find(r => r.nome === 'PCR')!
    expect(pcr.valor).toBe('< 5,0')
    expect(pcr.valor_num).toBe(5)
    expect(pcr.censura).toBe('lt')
  })

  it('"≤" e "<" continuam distintos depois de salvos', async () => {
    const linhas = await extrairEAdaptar([
      'BIOQUIMICA', 'Coleta: 12/04/2026',
      'PCR                 < 5,0    mg/L      0 - 5',
      'Troponina          <= 0,01   ng/mL     ate 0,04',
    ])
    const porNome = new Map(linhas[0]!.resultados.map(r => [r.nome, r]))
    expect(porNome.get('PCR')!.censura).toBe('lt')
    expect(porNome.get('Troponina')!.censura).toBe('lte')
  })

  it('valor sem censura não ganha operador', async () => {
    const linhas = await extrairEAdaptar([
      'BIOQUIMICA', 'Coleta: 12/04/2026',
      'Glicose              92    mg/dL      70 - 99',
    ])
    const g = linhas[0]!.resultados[0]!
    expect(g.censura).toBeNull()
    expect(g.valor_num).toBe(92)
  })
})

describe('R3 · a interpretação acontece AQUI, não no extrator', () => {
  it('valor acima da faixa vira alterado para cima', () => {
    const r = interpretarNumerico(1.9, null, {
      kind: 'range', min: 0.6, max: 1.3, unit: 'mg/dL', raw: '0,6 - 1,3', scope: null,
    })
    expect(r).toEqual({ alterado: true, direcao: 'alto' })
  })

  it('valor CENSURADO não recebe opinião', () => {
    // "< 5,0" com referência "0 a 5" não permite dizer se está dentro: o
    // resultado só afirma que é menor que 5. Foi o defeito D4 do doador, que
    // gravava isso como zero normal.
    const r = interpretarNumerico(5, 'lt', {
      kind: 'range', min: 0, max: 5, unit: 'mg/L', raw: '0 - 5', scope: null,
    })
    expect(r.alterado).toBe(false)
    expect(r.direcao).toBe('normal')
  })

  it('referência rejeitada não gera alerta', () => {
    // Se o que estava na coluna era uma faixa etária (D5), comparar contra ela
    // produziria alarme falso.
    const r = interpretarNumerico(140, null, {
      kind: 'rejected', raw: 'De 2 a 19 anos', reason: 'faixa etária',
    })
    expect(r.alterado).toBe(false)
  })

  it('inconclusivo não é alterado — é ausência de informação', () => {
    expect(interpretarQualitativo('inconclusive').alterado).toBe(false)
    expect(interpretarQualitativo('indeterminate').alterado).toBe(false)
    expect(interpretarQualitativo('positive').alterado).toBe(true)
    expect(interpretarQualitativo('negative').alterado).toBe(false)
  })

  it('o extrator continua sem emitir opinião nenhuma', async () => {
    const r = await extrairExames({
      document: { bytes: pdfDeLinhas([
        'BIOQUIMICA', 'Coleta: 12/04/2026',
        'Creatinina          9,42     mg/dL      0,60 - 1,30',
      ]), filename: null },
      hints: null,
      options: null,
    })
    // Creatinina 9,42 é gravemente alterada, e o extrator não diz nada disso.
    expect(JSON.stringify(r.observations)).not.toMatch(/alterado|direcao|"alto"/)
  })
})

describe('R3.1 · os dois canais chegam ao banco em campos separados', () => {
  it('valor implausível: confere_valor true, e continua marcado em motivos_revisao', async () => {
    const linhas = await extrairEAdaptar([
      'BIOQUIMICA', 'Coleta: 12/04/2026',
      'Potássio             72,0    mmol/L      3,5 - 5,0',
    ])
    const r = linhas[0]!.resultados.find(r => r.nome === 'Potássio')!
    expect(r.confere_valor).toBe(true)
    expect(r.revisar).toBe(true)
    expect((r.motivos_revisao ?? []).some(m => /fisicamente possível/.test(m))).toBe(true)
  })

  it('sem faixa de referência: confere_valor false, mas revisar continua true (sentido antigo)', async () => {
    const linhas = await extrairEAdaptar([
      'GASOMETRIA ARTERIAL', 'Coleta: 12/04/2026',
      'pH............:  7,38',
    ])
    const r = linhas[0]!.resultados.find(r => r.nome === 'pH (Arterial)')!
    expect(r.confere_valor).toBe(false)
    expect(r.revisar).toBe(true)
    expect((r.motivos_revisao ?? []).some(m => /não trouxe faixa/.test(m))).toBe(true)
    expect((r.motivos_confere ?? []).length).toBe(0)
  })
})

describe('apresentação', () => {
  it('a referência rejeitada não é exibida como se fosse faixa', async () => {
    const linhas = await extrairEAdaptar([
      'BIOQUIMICA', 'Coleta: 12/04/2026',
      'Creatinina          1,42     mg/dL      De 2 a 19 anos',
    ])
    const c = linhas[0]!.resultados[0]!
    expect(c.referencia).toBeNull()
    expect(c.motivos_revisao).toContain('a coluna de referência não trazia uma faixa confiável')
  })

  it('os motivos de revisão saem em português', async () => {
    const linhas = await extrairEAdaptar([
      'BIOQUIMICA',
      'Glicose              92    mg/dL      70 - 99',
    ])
    const motivos = linhas[0]!.resultados[0]!.motivos_revisao ?? []
    expect(motivos.every(m => !/[A-Z][a-z]+[A-Z]/.test(m))).toBe(true)
  })

  it('A7 · o aviso do extrator vira texto para o usuário', async () => {
    const linhas = await extrairEAdaptar([
      'BIOQUIMICA', 'Coleta: 12/04/2026',
      'Xisantopina Refratada    42    ui/mL     1 - 9',
      'Glicose              92    mg/dL      70 - 99',
    ])
    expect(linhas[0]!.observacoes).toMatch(/não importada/)
  })
})
