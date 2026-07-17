import { describe, it, expect } from 'vitest'
import { podeEditarModulo, ehIntensivista, apenasMedicos, labelCargo, CARGO_PADRAO } from './cargos'
import type { Cargo, Profissao } from '@/types'

// Espelham os módulos reais de lib/modules.tsx. Não importamos MODULOS aqui de
// propósito: aquele arquivo puxa a árvore de componentes inteira, e o que
// precisa de teste é a REGRA, não a lista.
const MOD = {
  plantonista:  { profissaoDona: 'medico' as Profissao },
  intensivista: { profissaoDona: 'medico' as Profissao, exigeChefe: true },
  enfermagem:   { profissaoDona: 'enfermeiro' as Profissao },
  fisioterapia: { profissaoDona: 'fisioterapeuta' as Profissao },
  nutricao:     { profissaoDona: 'nutricionista' as Profissao },
}

const cargo = (profissao: Profissao, nivel: Cargo['nivel'] = 'plantonista'): Cargo => ({ profissao, nivel })

const intensivista = cargo('medico', 'chefe')
const plantonista  = cargo('medico')
const enfermeiro   = cargo('enfermeiro')
const fisio        = cargo('fisioterapeuta')
const nutri        = cargo('nutricionista')

describe('Médico Intensivista', () => {
  it('é médico + chefe, e mais ninguém', () => {
    expect(ehIntensivista(intensivista)).toBe(true)
    expect(ehIntensivista(plantonista)).toBe(false)
    // O caso que o modelo de duas dimensões existe para acertar: um futuro
    // enfermeiro-chefe é chefe da ENFERMAGEM, não o intensivista da unidade.
    expect(ehIntensivista(cargo('enfermeiro', 'chefe'))).toBe(false)
    expect(ehIntensivista(null)).toBe(false)
  })

  it('edita todos os módulos, inclusive os das outras profissões', () => {
    for (const m of Object.values(MOD)) {
      expect(podeEditarModulo(intensivista, m)).toBe(true)
    }
  })
})

describe('cada profissão edita só a própria aba', () => {
  it.each([
    ['plantonista', plantonista, ['plantonista']],
    ['enfermeiro',  enfermeiro,  ['enfermagem']],
    ['fisio',       fisio,       ['fisioterapia']],
    ['nutri',       nutri,       ['nutricao']],
  ])('%s', (_nome, c, permitidos) => {
    for (const [id, m] of Object.entries(MOD)) {
      expect(podeEditarModulo(c as Cargo, m)).toBe((permitidos as string[]).includes(id))
    }
  })
})

describe('Médico Plantonista', () => {
  it('edita a própria aba mas não a do Intensivista, apesar de ambas serem de médico', () => {
    // É por isso que `exigeChefe` existe: a profissão sozinha não separa os dois.
    expect(podeEditarModulo(plantonista, MOD.plantonista)).toBe(true)
    expect(podeEditarModulo(plantonista, MOD.intensivista)).toBe(false)
  })
})

describe('sem cargo cadastrado', () => {
  it('cai em Médico Plantonista — vê tudo, edita só a aba dele', () => {
    expect(CARGO_PADRAO).toEqual({ profissao: 'medico', nivel: 'plantonista' })
    expect(podeEditarModulo(null, MOD.plantonista)).toBe(true)
    expect(podeEditarModulo(null, MOD.intensivista)).toBe(false)
    expect(podeEditarModulo(undefined, MOD.enfermagem)).toBe(false)
  })
})

describe('apenasMedicos', () => {
  it('tira da escala quem não é médico', () => {
    const equipe = [
      { id: '1', profissao: 'medico' as Profissao },
      { id: '2', profissao: 'enfermeiro' as Profissao },
      { id: '3', profissao: 'nutricionista' as Profissao },
      { id: '4', profissao: 'medico' as Profissao },
    ]
    expect(apenasMedicos(equipe).map(s => s.id)).toEqual(['1', '4'])
  })
})

describe('labelCargo', () => {
  it('nomeia os cargos de hoje', () => {
    expect(labelCargo(intensivista)).toContain('Médico Intensivista')
    expect(labelCargo(plantonista)).toContain('Médico Plantonista')
    expect(labelCargo(enfermeiro)).toContain('Enfermeiro')
    expect(labelCargo(nutri)).toContain('Nutricionista')
  })

  it('já nomeia os chefes das outras profissões, que ainda não existem', () => {
    expect(labelCargo(cargo('enfermeiro', 'chefe'))).toContain('Chefe')
    expect(labelCargo(cargo('fisioterapeuta', 'chefe'))).toContain('Chefe')
  })
})
