import { describe, it, expect } from 'vitest'
import {
  MODULE_VERSION,
  OPCOES_PADRAO,
  detectarLaboratorio,
  extrairExames,
  hashDocumento,
  resolverOpcoes,
} from './index'
import type { ExtractionRequest } from './index'
import { pdfDeLinhas } from './_testes/pdfMinimo'

// ── Fixtures sintéticas ────────────────────────────────────────────────────
// Zero dado de paciente: nomes, datas e valores são inventados. O cabeçalho do
// HUGO usa o CNES, que é sinal institucional público do estabelecimento — não
// identifica pessoa alguma.

const LAUDO_HUGO = pdfDeLinhas([
  'HOSPITAL DE URGENCIAS DE GOIAS   CNES 0697699',
  'HUGO - UTI ADULTO',
  'Paciente: PACIENTE DE TESTE          Registro: 000000',
  'Coleta: 12/05/2026 07:30',
  '',
  'BIOQUIMICA',
  'Creatinina          1,42     mg/dL      0,60 - 1,30',
  'Ureia                 68     mg/dL        15 - 45',
  'Potassio             5,1     mmol/L      3,5 - 5,1',
])

function pedido(bytes: Uint8Array, over: Partial<ExtractionRequest> = {}): ExtractionRequest {
  return {
    document: { bytes, filename: 'sintetico.pdf' },
    hints: null,
    options: null,
    ...over,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Invariantes da fronteira — valem em TODAS as fases, inclusive nesta.
// ═══════════════════════════════════════════════════════════════════════════

describe('fronteira: invariantes que não podem quebrar em nenhuma fase', () => {
  it('nunca lança, mesmo com bytes que não são um PDF', async () => {
    const lixo = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe])
    const r = await extrairExames(pedido(lixo))
    expect(r.documentKind).toBe('unrecognized')
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('nunca lança com documento vazio', async () => {
    const r = await extrairExames(pedido(new Uint8Array()))
    expect(r).toBeDefined()
    expect(Array.isArray(r.warnings)).toBe(true)
  })

  it('discarded e warnings são sempre arrays, nunca undefined (R1, A7)', async () => {
    const r = await extrairExames(pedido(LAUDO_HUGO))
    expect(Array.isArray(r.discarded)).toBe(true)
    expect(Array.isArray(r.warnings)).toBe(true)
    expect(Array.isArray(r.observations)).toBe(true)
    expect(Array.isArray(r.cultures)).toBe(true)
    expect(Array.isArray(r.imaging)).toBe(true)
  })

  it('R8 · duas chamadas com o mesmo PDF produzem objetos idênticos', async () => {
    const a = await extrairExames(pedido(LAUDO_HUGO))
    const b = await extrairExames(pedido(LAUDO_HUGO))
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('R8 · o resultado não carrega tempo de execução (quebraria a igualdade)', async () => {
    const r = await extrairExames(pedido(LAUDO_HUGO))
    const serializado = JSON.stringify(r.diagnostics)
    expect(serializado).not.toMatch(/duration|elapsed|tempo|ms"/i)
  })

  it('R9 · N documentos em paralelo dão o mesmo que em série', async () => {
    const docs = [
      pdfDeLinhas(['LAB A', 'Sodio 140 mmol/L 135 - 145']),
      pdfDeLinhas(['LAB B', 'GASOMETRIA ARTERIAL', 'pH 7,35 7,35 - 7,45']),
      pdfDeLinhas(['LAB C', 'EAS', 'Densidade 1.015 1,005 a 1,030']),
    ]
    const serie = []
    for (const d of docs) serie.push(await extrairExames(pedido(d)))
    const paralelo = await Promise.all(docs.map(d => extrairExames(pedido(d))))
    expect(paralelo).toEqual(serie)
  })

  it('R10 · o hash identifica o documento sem carregar conteúdo dele', async () => {
    const r = await extrairExames(pedido(LAUDO_HUGO))
    expect(r.diagnostics.documentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.diagnostics.documentHash).toBe(hashDocumento(LAUDO_HUGO))
    // Nenhum trecho do laudo pode aparecer no diagnóstico.
    expect(JSON.stringify(r.diagnostics)).not.toMatch(/Creatinina|PACIENTE/i)
  })

  it('R10 · retainRawText nasce desligado e o fallback de IA também (A5)', () => {
    expect(OPCOES_PADRAO.retainRawText).toBe(false)
    expect(OPCOES_PADRAO.enableFallbackExtractor).toBe(false)
    const resolvidas = resolverOpcoes({ retainRawText: true })
    expect(resolvidas.retainRawText).toBe(true)
    expect(resolvidas.enableFallbackExtractor).toBe(false)
  })

  it('R3 · nenhuma interpretação clínica atravessa a fronteira', async () => {
    const r = await extrairExames(pedido(LAUDO_HUGO))
    const chaves = JSON.stringify(r)
    expect(chaves).not.toMatch(/"status"|"alterado"|"direcao"|"critico"|"alerta"/i)
  })

  it('diagnostics declara a versão do módulo', async () => {
    const r = await extrairExames(pedido(LAUDO_HUGO))
    expect(r.diagnostics.moduleVersion).toBe(MODULE_VERSION)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Comportamento ainda não implementado — estes testes DEVEM falhar na F1.
// Cada bloco é o critério de aceite da fase indicada.
// ═══════════════════════════════════════════════════════════════════════════

describe('F2 · camada de texto', () => {
  it('lê as linhas do PDF, com página e contagem', async () => {
    const r = await extrairExames(pedido(LAUDO_HUGO))
    expect(r.diagnostics.pageCount).toBe(1)
    expect(r.diagnostics.lineCount).toBeGreaterThanOrEqual(8)
  })

  it('preserva a ordem de leitura de cima para baixo', async () => {
    const r = await extrairExames(pedido(LAUDO_HUGO, { options: { retainRawText: true } }))
    const linhas = r.discarded.map(d => d.rawLine).concat(r.observations.map(o => o.provenance.rawLine))
    expect(linhas.some(l => /CNES 0697699/.test(l))).toBe(true)
  })
})

describe('F8 · detecção de laboratório', () => {
  it('reconhece o HUGO pelo CNES (sinal institucional)', async () => {
    const r = await extrairExames(pedido(LAUDO_HUGO))
    expect(r.detection.profileId).toBe('hugo')
    expect(r.detection.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it('A4 · documento irreconhecível resolve para unrecognized, não para genérico', async () => {
    const r = await extrairExames(pedido(pdfDeLinhas(['Lista de compras', 'arroz', 'feijao'])))
    expect(r.detection.profileId).toBeNull()
    expect(r.documentKind).toBe('unrecognized')
    expect(r.warnings.map(w => w.code)).toContain('unrecognizedDocument')
  })

  it('7.B-12 · a detecção é pura sobre texto e testável sem PDF', () => {
    const deteccao = detectarLaboratorio({
      pages: [{ page: 1, width: 595, height: 842, itemCount: 2 }],
      lines: [
        { page: 1, index: 0, text: 'HOSPITAL DE URGENCIAS DE GOIAS CNES 0697699', y: 780, items: [], gaps: [] },
        { page: 1, index: 1, text: 'HUGO - UTI ADULTO', y: 766, items: [], gaps: [] },
      ],
      hasTextLayer: true,
    })
    expect(deteccao.profileId).toBe('hugo')
  })
})

describe('F5 · motor de extração laboratorial', () => {
  it('extrai as três observações da seção de bioquímica', async () => {
    const r = await extrairExames(pedido(LAUDO_HUGO))
    const nomes = r.observations.map(o => o.canonicalName)
    expect(nomes).toContain('Creatinina')
    expect(nomes).toContain('Ureia')
    expect(nomes).toContain('Potássio')
  })

  it('R5 · o valor carrega o operador de censura, e são quatro', async () => {
    const doc = pdfDeLinhas([
      'HOSPITAL DE URGENCIAS DE GOIAS   CNES 0697699',
      'Coleta: 12/05/2026',
      'BIOQUIMICA',
      'PCR                 < 5,0    mg/L      0 - 5',
      'Troponina          <= 0,01   ng/mL     ate 0,04',
      'D-dimero          > 10000    ng/mL     ate 500',
      'Ferritina         >= 2000    ng/mL     30 - 400',
    ])
    const r = await extrairExames(pedido(doc))
    const censuras = r.observations
      .map(o => (o.value.kind === 'numeric' ? o.value.censoring : null))
      .filter(Boolean)
    expect(censuras).toEqual(['lt', 'lte', 'gt', 'gte'])
  })

  it('R7 · cada observação carrega a data da SUA seção', async () => {
    const doc = pdfDeLinhas([
      'HOSPITAL DE URGENCIAS DE GOIAS   CNES 0697699',
      'HEMOGRAMA',
      'Coleta: 10/04/2026',
      'Hemoglobina        12,0    g/dL     12,0 - 16,0',
      'BIOQUIMICA',
      'Coleta: 12/04/2026',
      'Glicose              92    mg/dL      70 - 99',
    ])
    const r = await extrairExames(pedido(doc))
    const hb = r.observations.find(o => o.canonicalName === 'Hemoglobina')
    const gli = r.observations.find(o => o.canonicalName === 'Glicose')
    expect(hb?.collectedAt.iso).toBe('2026-04-10')
    expect(gli?.collectedAt.iso).toBe('2026-04-12')
  })

  it('R1/7.B-2 · linha rejeitada entra em discarded com motivo, nunca some', async () => {
    const doc = pdfDeLinhas([
      'HOSPITAL DE URGENCIAS DE GOIAS   CNES 0697699',
      'Coleta: 12/05/2026',
      'BIOQUIMICA',
      'Xisantopina Refratada    42    ui/mL     1 - 9',
    ])
    const r = await extrairExames(pedido(doc))
    expect(r.discarded.length).toBeGreaterThan(0)
    expect(r.discarded.map(d => d.reason)).toContain('unrecognizedAnalyte')
  })

  it('D2 · "Resultado Anterior" nunca vira valor atual', async () => {
    const doc = pdfDeLinhas([
      'HOSPITAL DE URGENCIAS DE GOIAS   CNES 0697699',
      'Coleta: 12/05/2026',
      'BIOQUIMICA',
      'Creatinina          1,42     mg/dL      0,60 - 1,30',
      'Resultado Anterior : 3,80    mg/dL',
    ])
    const r = await extrairExames(pedido(doc))
    const creatininas = r.observations.filter(o => o.canonicalName === 'Creatinina')
    expect(creatininas).toHaveLength(1)
    expect(creatininas[0]?.value).toMatchObject({ kind: 'numeric', value: 1.42 })
    expect(r.discarded.map(d => d.reason)).toContain('historicalResult')
  })
})
