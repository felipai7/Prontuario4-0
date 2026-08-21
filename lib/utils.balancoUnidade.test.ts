import { describe, it, expect } from 'vitest'
import { balancoDaUnidade, balancoDeOutrasUnidades, evacuou, fmtEvacuacao } from './utils'
import type { PeriodoBalanco } from '@/types'

/**
 * Balanço não pode se misturar entre unidades quando o paciente transita
 * (UTI → Hospital): estes testes travam o filtro que separa "desta unidade"
 * de "de outra unidade" — é o que impede o acumulado/diurese de uma unidade
 * enxergar dados lançados na outra.
 */
const periodo = (unit_id: string | null): PeriodoBalanco => ({
  id: unit_id ?? 'sem-unidade', paciente_id: 'p1', unit_id,
  inicio: '2026-08-01T07:00:00Z', fim: '2026-08-01T19:00:00Z',
  turno: 'diurno', horas_periodo: 12,
  venoso: 0, oral_enteral: 0, agua_endogena: 0, diurese: 0, dialise: 0,
  febre: 0, evacuacao: 0, dreno: 0, vomitos: 0, sne_sng: 0, ostomia: 0,
  outros: 0, outros_nome: null, perdas_insensiveis: 0,
  diarreica_medico: null, diarreica_nutricao: null,
  created_at: '2026-08-01T07:00:00Z', updated_at: '2026-08-01T07:00:00Z',
})

describe('balancoDaUnidade', () => {
  it('mantém só os períodos da unidade dada', () => {
    const periodos = [periodo('uti'), periodo('hospital')]
    expect(balancoDaUnidade(periodos, 'uti').map(p => p.unit_id)).toEqual(['uti'])
  })

  it('unit_id nulo (registro anterior à migração) conta como desta unidade', () => {
    const periodos = [periodo(null), periodo('hospital')]
    expect(balancoDaUnidade(periodos, 'uti').map(p => p.unit_id)).toEqual([null])
  })
})

describe('balancoDeOutrasUnidades', () => {
  it('é o inverso: só o que foi lançado em OUTRA unidade', () => {
    const periodos = [periodo('uti'), periodo('hospital')]
    expect(balancoDeOutrasUnidades(periodos, 'uti').map(p => p.unit_id)).toEqual(['hospital'])
  })

  it('unit_id nulo nunca aparece como "de outra unidade"', () => {
    const periodos = [periodo(null), periodo('hospital')]
    expect(balancoDeOutrasUnidades(periodos, 'uti').map(p => p.unit_id)).toEqual(['hospital'])
  })
})

/**
 * Débito de ostomia conta como evacuação para todos os efeitos — quem tem
 * ostomia não evacua pelo reto, o débito da bolsa É a evacuação dele.
 */
describe('evacuou', () => {
  it('conta como evacuação quando só a ostomia teve débito', () => {
    expect(evacuou({ ...periodo('uti'), evacuacao: 0, ostomia: 150 })).toBe(true)
  })

  it('conta como evacuação no caminho tradicional (campo Evacuação)', () => {
    expect(evacuou({ ...periodo('uti'), evacuacao: 200, ostomia: 0 })).toBe(true)
  })

  it('não conta quando nenhum dos dois teve débito', () => {
    expect(evacuou({ ...periodo('uti'), evacuacao: 0, ostomia: 0 })).toBe(false)
  })
})

describe('fmtEvacuacao', () => {
  it('mostra o valor de Evacuação quando ele existe', () => {
    expect(fmtEvacuacao({ ...periodo('uti'), evacuacao: 200, ostomia: 0 })).toBe('200 mL')
  })

  it('cai para o débito de ostomia, rotulado, quando Evacuação está zerada', () => {
    expect(fmtEvacuacao({ ...periodo('uti'), evacuacao: 0, ostomia: 150 })).toBe('150 mL (via ostomia)')
  })
})
