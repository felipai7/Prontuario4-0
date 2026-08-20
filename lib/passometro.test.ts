import { describe, it, expect } from 'vitest'
import { gerarPlanilhaPassometro, agruparPorAla, type LinhaPassometro, type SecaoPassometro } from '@/lib/passometro'
import type { Unidade } from '@/lib/unidade'
import type { Paciente } from '@/types'

function pacienteFake(overrides: Partial<Paciente> = {}): Paciente {
  return {
    id: 'p1', nome: 'Fulana de Tal', data_nascimento: '1950-01-01', plano_saude: 'Unimed',
    data_internacao: '2026-08-16', hora_internacao: '14:00', peso_kg: 65, hipoteses: 'PNM',
    ala_id: 'ala-1', numero_leito: '2', unit_id: 'unit-1', saps3: null, saps3_calculado_em: null,
    historico_patologico_pregresso: null, medicacoes_uso_continuo: null, resumo_admissao: null,
    paliativo: false, oncologico: false, readmissao_de: null, origem_uti_alta_id: null,
    ativo: true, created_at: '', updated_at: '', ...overrides,
  }
}

function linhaFake(overrides: Partial<LinhaPassometro> = {}): LinhaPassometro {
  return {
    paciente: pacienteFake(), leito: '2', nomeCurto: 'Fulana Tal', idade: '76 anos', admissao: '16/08',
    hd: 'PNM??', peso: '65Kg', diurese: '400mL(24h) 0,26mL/Kg/h', acesso: 'AVP',
    hgt: '85/100', temp: '36,1 / 36,4', paTendencia: '→ normal', fcTendencia: '↑ taquicárdico',
    evac: '', antimicrobiano: 'Mero D2', dva: '', corticoide: '',
    ibp: 'IBP VO', anticoag: 'Enoxaparina 40mg',
    labs: { leuco: '4710', hb: '8,9', ht: '28', plaq: '290', pcr: '157', lactato: '1,68', ureia: '37', creat: '0,5', na: '138', k: '2,95', mg: '2,0', ph: '7,46', bic: '33', pco2: '49', po2: '50', ca: '1,15' },
    pendencias: 'Tirar HGT de horário',
    ...overrides,
  }
}

const unidadeFake: Unidade = {
  unitId: 'unit-1', nome: 'UTI IMEC', leitosAtivos: 2, outrasUnidades: 0, requerSaps3: true, tipoUnidade: 'uti',
  alas: [{ id: 'ala-1', nome: 'UTI 01', leitos: ['1', '2'], rotativo: false }],
}

describe('gerarPlanilhaPassometro', () => {
  it('gera o workbook sem lançar erro de merge, com paciente cheio e paciente quase vazio', () => {
    const secoes: SecaoPassometro[] = [
      { ala: unidadeFake.alas[0], linhas: [linhaFake(), linhaFake({ leito: '1', paciente: pacienteFake({ id: 'p2', numero_leito: '1', peso_kg: null, hipoteses: null }), hd: '', peso: '', diurese: '', acesso: '', hgt: '', temp: '', paTendencia: '', fcTendencia: '', ibp: '', anticoag: '', labs: {}, pendencias: '' })] },
    ]

    expect(() => gerarPlanilhaPassometro(unidadeFake, secoes)).not.toThrow()
  })

  it('mescla as colunas sem texto2 e mantém as 4 colunas duplicadas sem mesclar', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    const wb = gerarPlanilhaPassometro(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro')!

    // Linha 4 = título+subtítulo(2) + cabeçalho da ala(1) + rótulos(1), depois começam os dados.
    const rowA = 5, rowB = 6
    // Coluna 1 = Leito: sem texto2, deve estar mesclada (mesmo `master`).
    const leitoA = ws.getCell(rowA, 1)
    const leitoB = ws.getCell(rowB, 1)
    expect(leitoA.isMerged).toBe(true)
    expect(leitoB.isMerged).toBe(true)
    expect(leitoA.master.address).toBe(leitoB.master.address)

    // Coluna 10 = Psicotrópicos/Analgesia (a 1ª das 4 duplicadas): NÃO deve mesclar.
    const psicoA = ws.getCell(rowA, 10)
    const psicoB = ws.getCell(rowB, 10)
    expect(psicoA.isMerged).toBe(false)
    expect(psicoB.isMerged).toBe(false)
  })

  it('agruparPorAla ordena os leitos naturalmente dentro da ala', () => {
    const itens = [
      { paciente: pacienteFake({ id: 'a', numero_leito: '10' }), linha: linhaFake({ leito: '10' }) },
      { paciente: pacienteFake({ id: 'b', numero_leito: '2' }), linha: linhaFake({ leito: '2' }) },
    ]
    const secoes = agruparPorAla(unidadeFake, itens)
    expect(secoes[0].linhas.map(l => l.leito)).toEqual(['2', '10'])
  })
})
