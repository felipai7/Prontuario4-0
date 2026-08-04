import { describe, it, expect } from 'vitest'
import { absolutoDoDiferencial } from './diferencial'
import { extrairExames } from '../index'
import { pdfTabular } from '../_testes/pdfMinimo'

// ══════════════════════════════════════════════════════════════════════════
// I2 · a faixa do PERCENTUAL não pode virar a faixa do ABSOLUTO.
//
// A linha do diferencial traz DOIS números e, quando o laudo é generoso, DUAS
// faixas — uma para cada. Havendo as duas, a segunda é a do absoluto e a
// regra posicional funciona. Havendo UMA SÓ, a regra antiga a usava do mesmo
// jeito, e a faixa que sobrou é quase sempre a do percentual.
//
// A consequência é um alarme na DIREÇÃO ERRADA. Neutrófilos de 500/mm³ é
// neutropenia grave — o paciente está sem defesa. Comparado contra "51 a 65"
// (a faixa PERCENTUAL), 500 fica ACIMA do máximo, e a tela pinta de vermelho
// com seta para CIMA. Quem lê entende "neutrofilia", o oposto exato do que o
// paciente tem.
//
// Sem faixa confiável, o honesto é não ter faixa: `{kind:'absent'}` faz
// `interpretarNumerico` não opinar, e a marcação de revisão aparece.
// ══════════════════════════════════════════════════════════════════════════

describe('I2 · faixa única só vale se a unidade dela combinar com a do absoluto', () => {
  it('faixa única SEM unidade não é atribuída ao absoluto', () => {
    // A sonda do revisor, letra por letra.
    const r = absolutoDoDiferencial('Neutrófilos', ['15', '%', '500', '/mm³', '51 a 65'])
    expect(r).toEqual({ valor: '500', unidade: '/mm³', referencia: '' })
  })

  it('faixa única em PERCENTUAL não é atribuída ao absoluto', () => {
    const r = absolutoDoDiferencial('Neutrófilos', ['15', '%', '500', '/mm³', '51 a 65 %'])
    expect(r?.referencia).toBe('')
  })

  it('faixa única com a unidade DO ABSOLUTO continua valendo', () => {
    // Não é para o conserto custar a faixa certa: o HUGO traz só uma, e ela é
    // a do absoluto, identificada pela unidade.
    const r = absolutoDoDiferencial('Linfócitos', ['15,0 %', '1875 uL', '900 - 3500 uL'])
    expect(r).toEqual({ valor: '1875', unidade: 'uL', referencia: '900 - 3500 uL' })
  })

  it('havendo DUAS faixas, a segunda continua sendo a do absoluto', () => {
    const r = absolutoDoDiferencial('Bastonetes', ['1', '%', '125', '/mm³', '1 a 5', '45 a 500'])
    expect(r?.referencia).toBe('45 a 500')
  })
})

describe('I2 · ponta a ponta: nenhum alarme de direção invertida', () => {
  const COLUNAS = [50, 150, 200, 240, 300, 360, 430]
  const bytes = pdfTabular([
    ['HEMOGRAMA'],
    ['Coleta: 12/05/2026'],
    ['Neutrófilos', ':', '15', '%', '500', '/mm³', '51 a 65'],
  ], COLUNAS)

  it('o absoluto sai SEM faixa, e não com a faixa do percentual', async () => {
    const r = await extrairExames({ document: { bytes, filename: null }, hints: null, options: null })
    const neutro = r.observations.find(o => /Neutr[óo]filos/i.test(o.canonicalName ?? ''))
    expect(neutro?.value).toMatchObject({ kind: 'numeric', value: 500 })
    // O que importa clinicamente: NÃO é uma faixa 51–65 encostada num /mm³.
    expect(neutro?.reference.kind).not.toBe('range')
  })
})
