import { describe, it, expect } from 'vitest'
import { extrairExames } from './index'
import { pdfDeLinhas } from './_testes/pdfMinimo'

// ══════════════════════════════════════════════════════════════════════════
// I3 · "não tenho opinião" não pode se parecer com "conferi, está normal".
//
// `interpretarNumerico` devolve SEM_OPINIAO quando a referência é `absent`, e
// SEM_OPINIAO tem exatamente a mesma forma de NORMAL — `alterado:false`,
// `direcao:'normal'`. Enquanto o motor não marcava nada, o valor era gravado
// com `revisar:false` e chegava à tela como texto cinza comum, indistinguível
// de um resultado conferido contra a faixa do laudo e confirmado normal.
//
// É rotina em gasometria: o laudo imprime pH, pCO2 e BE sem coluna de
// referência. O MESMO exame, colado como print, volta da IA em vermelho —
// porque a IA opina com conhecimento médico e o extrator local não tem faixa.
// A médica vê dois resultados contraditórios do mesmo papel e não tem como
// saber qual acreditar.
//
// Marcar `absent` como pendente devolve a distinção: o ⚠ e a linha de
// pendência aparecem, e o cinza volta a significar "conferido".
// ══════════════════════════════════════════════════════════════════════════

const extrair = (linhas: string[]) =>
  extrairExames({ document: { bytes: pdfDeLinhas(linhas), filename: null }, hints: null, options: null })

describe('I3 · valor numérico sem faixa de referência pede conferência', () => {
  const GASO = [
    'GASOMETRIA ARTERIAL',
    'Coleta: 12/05/2026',
    'pH............:  7,38',
    'pCO2..........:  41,0  mmHg',
  ]

  it('o pH sem coluna de referência nasce marcado para revisão', async () => {
    const r = await extrair(GASO)
    const ph = r.observations.find(o => o.canonicalName === 'pH (Arterial)')!
    expect(ph.reference.kind).toBe('absent')
    expect(ph.requiresReview).toBe(true)
    expect(ph.reviewReasons).toContain('referenceAbsent')
  })

  it('COM faixa no laudo, o valor normal continua limpo — sem pendência inventada', async () => {
    const r = await extrair([
      'GASOMETRIA ARTERIAL',
      'Coleta: 12/05/2026',
      // Três espaços, e não dois: com dois, o vão medido fica abaixo do corte
      // de coluna e a faixa nem chega a ser lida — a fixture provaria a coisa
      // errada (o valor sairia sem referência pelo motivo errado).
      'pH............:  7,38   7,35 a 7,45',
    ])
    const ph = r.observations.find(o => o.canonicalName === 'pH (Arterial)')!
    expect(ph.reference.kind).toBe('range')
    expect(ph.reviewReasons).not.toContain('referenceAbsent')
  })

  it('resultado QUALITATIVO sem faixa não vira pendência', async () => {
    // "Negativo" é interpretável sozinho: `interpretarQualitativo` dá uma
    // opinião de verdade sem precisar de faixa nenhuma. Marcar estes também
    // encheria a lista de pendências de linhas sem defeito — e lista de
    // alarme que sempre toca é lista que ninguém lê.
    const r = await extrair([
      'ROTINA DE URINA',
      'Coleta: 12/05/2026',
      'Nitrito.......:  Negativo',
    ])
    const nit = r.observations.find(o => /Nitrito/i.test(o.canonicalName ?? ''))!
    expect(nit.reference.kind).toBe('absent')
    expect(nit.reviewReasons).not.toContain('referenceAbsent')
  })
})
