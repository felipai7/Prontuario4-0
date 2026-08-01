import { describe, it, expect } from 'vitest'
import { extrairExames } from '../index'
import { pdfDeLinhas } from '../_testes/pdfMinimo'
import { ehRotuloDeMetadado } from './metadados'

// ══════════════════════════════════════════════════════════════════════════
// Um teste por LAYOUT de laudo, com PDF sintético.
//
// Este arquivo existe por causa de um erro concreto: a suíte ficou verde com
// um extrator que produzia ZERO observação em 11 dos 25 laudos reais. Os
// testes sintéticos só cobriam o layout tabular, então "verde" significava
// apenas "o layout que eu testei funciona".
//
// Cada bloco abaixo reproduz o layout de um laboratório real, com dados
// fictícios. Nenhum dado de paciente.
// ══════════════════════════════════════════════════════════════════════════

async function extrair(linhas: string[]) {
  return extrairExames({
    document: { bytes: pdfDeLinhas(linhas), filename: null },
    hints: null,
    options: null,
  })
}

describe('layout tabular (HUGO, IMEC)', () => {
  it('nome | valor | unidade | referência na mesma linha', async () => {
    const r = await extrair([
      'BIOQUIMICA',
      'Coleta: 12/05/2026',
      'Creatinina          1,42     mg/dL      0,60 - 1,30',
      'Ureia                 68     mg/dL        15 - 45',
    ])
    expect(r.observations.map(o => o.canonicalName).sort()).toEqual(['Creatinina', 'Ureia'])
    const cr = r.observations.find(o => o.canonicalName === 'Creatinina')!
    expect(cr.value).toMatchObject({ kind: 'numeric', value: 1.42 })
    expect(cr.unit.canonical).toBe('mg/dL')
    expect(cr.reference).toMatchObject({ kind: 'range', min: 0.6, max: 1.3 })
    expect(cr.provenance.matcherId).toBe('tabular')
  })
})

describe('layout em bloco (HOC)', () => {
  // O nome fica sozinho numa linha e o valor vem depois, rotulado como
  // "Resultado:". É o caso D9 — no doador, essa linha era consumida e sumia.
  const LAUDO = [
    'SÓDIO',
    'Método: POTENCIOMETRIA   Material biológico: SORO',
    'Resultado   :  154,1   mmol/L',
    'VALOR DE REFERÊNCIA: 135,0 A 148,0 mmol/L',
    'VALOR CRÍTICO ALTO : 158,0 mmol/L',
    'POTÁSSIO',
    'Método: POTENCIOMETRIA   Material biológico: SORO',
    'Resultado   :  3,98   mmol/L',
    'VALOR DE REFERÊNCIA: 3,70 A 5,30 mmol/L',
  ]

  it('liga a linha de resultado ao nome do exame que está acima', async () => {
    const r = await extrair(LAUDO)
    const nomes = r.observations.map(o => o.canonicalName).sort()
    expect(nomes).toEqual(['Potássio', 'Sódio'])
  })

  it('extrai valor, unidade e a referência da linha seguinte', async () => {
    const r = await extrair(LAUDO)
    const sodio = r.observations.find(o => o.canonicalName === 'Sódio')!
    expect(sodio.value).toMatchObject({ kind: 'numeric', value: 154.1 })
    expect(sodio.unit.canonical).toBe('mmol/L')
    expect(sodio.reference).toMatchObject({ kind: 'range', min: 135, max: 148 })
    expect(sodio.provenance.matcherId).toBe('bloco')
  })

  it('R3 · "VALOR CRÍTICO" não vira resultado — é interpretação', async () => {
    const r = await extrair(LAUDO)
    expect(r.observations.some(o => /158/.test(JSON.stringify(o.value)))).toBe(false)
    expect(r.discarded.map(d => d.reason)).toContain('referenceTable')
  })

  it('D9 · resultado sem exame acima não some: entra em discarded', async () => {
    const r = await extrair(['BIOQUIMICA', 'Coleta: 12/05/2026', 'Resultado   :  9,9   mg/dL'])
    expect(r.observations).toHaveLength(0)
    expect(r.discarded.some(d => /sem exame identific/.test(d.detail ?? ''))).toBe(true)
  })
})

describe('layout com dois-pontos e pontilhado (PIOX)', () => {
  const LAUDO = [
    'HEMOGRAMA COMPLETO',
    'Data de Coleta: 03/04/2026',
    'ERITROGRAMA',
    'Resultado   Valor Referencial',
    'Hemoglobinas..: 10,2  g/dL   12,0 a 16,0 g/dL',
    'Hematócrito...: 30,6  %   37,0 a 47,0 %',
    'Plaquetas.....: 180000  /mm3   150000 a 400000 /mm3',
  ]

  it('o pontilhado de alinhamento não faz parte do nome', async () => {
    const r = await extrair(LAUDO)
    expect(r.observations.map(o => o.rawName)).not.toContain('Hemoglobinas..')
    expect(r.observations.map(o => o.canonicalName)).toContain('Hemoglobina')
  })

  it('extrai valor, unidade e referência da mesma linha', async () => {
    const r = await extrair(LAUDO)
    const ht = r.observations.find(o => o.canonicalName === 'Hematócrito')!
    expect(ht.value).toMatchObject({ kind: 'numeric', value: 30.6 })
    expect(ht.unit.canonical).toBe('%')
    expect(ht.reference).toMatchObject({ kind: 'range', min: 37, max: 47 })
    expect(ht.provenance.matcherId).toBe('doisPontos')
  })

  it('o cabeçalho "Resultado   Valor Referencial" não vira exame', async () => {
    const r = await extrair(LAUDO)
    expect(r.observations.map(o => o.rawName)).not.toContain('Resultado')
  })
})

describe('metadado nunca é confundido com resultado', () => {
  it('rótulos de identificação, data e laboratório são reconhecidos como tal', () => {
    const rotulos = [
      'Paciente', 'Data Nasc', 'Dt. Nasc.', 'Convênio', 'Pedido', 'Prontuário',
      'CNES', 'CPF', 'RG', 'Cep', 'Tel', 'Responsável Técnico', 'Assinado Por',
      'Documento', 'Método', 'Material', 'Nota', 'Liberação', 'Valor de Referência',
      'Adultos', 'Crianças', 'Mulheres', 'Menos de 24 horas',
    ]
    for (const r of rotulos) expect(ehRotuloDeMetadado(r), r).toBe(true)
  })

  it('nomes de exame de verdade NÃO são confundidos com metadado', () => {
    const exames = [
      'Creatinina', 'Ureia', 'Sódio', 'Potássio', 'Hemoglobina', 'Hematócrito',
      'Leucócitos', 'Plaquetas', 'TGO', 'TGP', 'Bilirrubina Total', 'PCR',
      'Troponina', 'Lactato', 'Magnésio', 'Cálcio iônico',
    ]
    for (const e of exames) expect(ehRotuloDeMetadado(e), e).toBe(false)
  })

  it('prosa longa não é nome de exame', () => {
    expect(ehRotuloDeMetadado(
      'A intensidade da reabsorção tubular varia de acordo com o estado volêmico',
    )).toBe(true)
  })

  it('cabeçalho de laudo não polui o canal de descarte', async () => {
    const r = await extrair([
      'Paciente  : FULANO DE TAL   Pedido  : 020028928',
      'Dt. Nasc. : 06/11/1932   Entrada  : 05/04/2026',
      'Convênio : PLANO X   Tel: 3245-0000',
      'BIOQUIMICA',
      'Coleta: 12/05/2026',
      'Creatinina          1,42     mg/dL      0,60 - 1,30',
    ])
    expect(r.observations).toHaveLength(1)
    // Nenhum rótulo de cabeçalho chega como "analito desconhecido": esse canal
    // precisa ficar legível para o usuário achar o que importa (7.B-4).
    const desconhecidos = r.discarded.filter(d => d.reason === 'unrecognizedAnalyte')
    expect(desconhecidos).toEqual([])
  })
})
