import { describe, it, expect } from 'vitest'
import {
  gerarPlanilhaPassometroEnfermagem, gerarHtmlPassometroEnfermagem, agruparPorAlaEnfermagem,
  formatarDieta, formatarCurativos,
  type LinhaPassometroEnfermagem, type SecaoPassometroEnfermagem,
} from '@/lib/passometroEnfermagem'
import type { Unidade } from '@/lib/unidade'
import type { Dispositivo, LppEvento, NutricaoDia } from '@/types'

function linhaFake(overrides: Partial<LinhaPassometroEnfermagem> = {}): LinhaPassometroEnfermagem {
  return {
    alaId: 'ala-1', vazio: false, leito: '2', nome: 'Fulana da Silva Tal', idade: '76 anos', admissao: '16/08',
    ventilatorio: 'C.N. 2 L/min', dispositivos: 'CVC (12/08), SVD (15/08)',
    dieta: 'NE 100%', diurese: '1200mL(24h) 0,77mL/Kg/h · SVD 15/08',
    curativos: '⚠️ LPP grau 2 (sacral)\n⚠️ CVC, SVD',
    antimicrobiano: 'Meropenem (D2/7)',
    pendenciasVisita: 'Tirar HGT de horário',
    ...overrides,
  }
}

const unidadeFake: Unidade = {
  unitId: 'unit-1', nome: 'UTI IMEC', leitosAtivos: 3, outrasUnidades: 0, requerSaps3: true, tipoUnidade: 'uti',
  alas: [{ id: 'ala-1', nome: 'UTI 01', leitos: ['1', '2', '3'], rotativo: false }],
}

function dispositivoFake(overrides: Partial<Dispositivo> = {}): Dispositivo {
  return {
    id: 'd1', paciente_id: 'pac-1', tipo: 'CVC', data_insercao: '2026-08-12', data_remocao: null,
    observacao: null, criado_em: '2026-08-12T00:00:00', criado_por: null,
    ...overrides,
  }
}
function lppFake(overrides: Partial<LppEvento> = {}): LppEvento {
  return {
    id: 'l1', paciente_id: 'pac-1', data: '2026-08-20', estagio: '2', local: 'Sacral',
    adquirida_na_uti: true, observacao: null, criado_em: '2026-08-20T00:00:00', criado_por: null,
    ...overrides,
  }
}
function nutricaoDiaFake(overrides: Partial<NutricaoDia> = {}): NutricaoDia {
  return {
    id: 'n1', paciente_id: 'pac-1', data: '2026-08-21', elegivel_tn: false, elegivel_ne: true, jejum: false,
    np_pct_meta: null, ne_pct_meta: 100, vo_pct_aceitacao: null, proteica_pct: null,
    intolerancia_gi_grave: false, interrupcao_nao_justificada: false, discutido_round: false,
    hipoglicemia_relacionada_tn: false, observacao: null, criado_em: '2026-08-21T08:00:00', criado_por: null,
    ...overrides,
  }
}

describe('formatarDieta', () => {
  it('sem registro do dia, fica em branco', () => {
    expect(formatarDieta(null)).toBe('')
  })
  it('monta NP/NE/VO/jejum a partir do registro do dia', () => {
    expect(formatarDieta(nutricaoDiaFake({ ne_pct_meta: 100 }))).toBe('NE 100%')
    expect(formatarDieta(nutricaoDiaFake({ ne_pct_meta: null, jejum: true }))).toBe('Jejum')
    expect(formatarDieta(nutricaoDiaFake({ np_pct_meta: 50, ne_pct_meta: null, vo_pct_aceitacao: 30 })))
      .toBe('NP 50% · VO 30%')
  })
})

describe('formatarCurativos', () => {
  it('sem LPP nem dispositivo, fica em branco', () => {
    expect(formatarCurativos([], [])).toBe('')
  })
  it('LPP mais recente (por data) + lista de dispositivos', () => {
    const lpps = [lppFake({ data: '2026-08-10', estagio: '1', local: 'Calcâneo' }), lppFake({ data: '2026-08-20', estagio: '2', local: 'Sacral' })]
    const disp = [dispositivoFake({ tipo: 'CVC' }), dispositivoFake({ tipo: 'SVD' })]
    const r = formatarCurativos(lpps, disp)
    expect(r).toContain('LPP grau 2 (Sacral)')
    expect(r).not.toContain('Calcâneo')
    expect(r).toContain('CVC, SVD')
  })
  it('só dispositivo, sem LPP', () => {
    const r = formatarCurativos([], [dispositivoFake({ tipo: 'TOT' })])
    expect(r).toBe('⚠️ TOT')
  })
})

describe('agruparPorAlaEnfermagem', () => {
  it('preenche leitos vazios e ordena por número do leito', () => {
    const linhas = [linhaFake({ leito: '3' }), linhaFake({ leito: '1' })]
    const secoes = agruparPorAlaEnfermagem(unidadeFake.alas, linhas)
    expect(secoes).toHaveLength(1)
    expect(secoes[0].linhas.map(l => l.leito)).toEqual(['1', '2', '3'])
    expect(secoes[0].linhas[1].vazio).toBe(true)
  })
})

describe('gerarPlanilhaPassometroEnfermagem', () => {
  it('gera o workbook sem lançar erro, com paciente cheio e leito vazio', () => {
    const secoes: SecaoPassometroEnfermagem[] = [
      { ala: unidadeFake.alas[0], linhas: [linhaFake(), linhaFake({ leito: '1', vazio: true, nome: '', idade: '', admissao: '', ventilatorio: '', dispositivos: '', dieta: '', diurese: '', curativos: '', antimicrobiano: '', pendenciasVisita: '' })] },
    ]
    expect(() => gerarPlanilhaPassometroEnfermagem(unidadeFake, secoes)).not.toThrow()
  })

  it('cada paciente ocupa exatamente 4 linhas físicas — leito e nome mesclados nas 4', async () => {
    const secoes: SecaoPassometroEnfermagem[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    const wb = gerarPlanilhaPassometroEnfermagem(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro Enfermagem')!
    // linha 1: título; 2: subtítulo; 3: cabeçalho da ala; 4: cabeçalho de coluna; 5-8: paciente.
    expect(ws.getCell(5, 1).value).toBe('2') // leito, na 1ª das 4 linhas físicas
    expect(ws.getCell(5, 1).isMerged).toBe(true)
    expect(ws.getCell(8, 1).isMerged).toBe(true) // última das 4 continua mesclada com a 1ª
  })

  it('coluna Ventilatório/Dispositivos/Dieta/Diurese: 1 item por linha física, com rótulo', () => {
    const secoes: SecaoPassometroEnfermagem[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    const wb = gerarPlanilhaPassometroEnfermagem(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro Enfermagem')!
    // Coluna 3 = Ventilatório/Dispositivos/Dieta/Diurese; linhas 5,6,7,8.
    expect(ws.getCell(5, 3).value).toBe('Ventilatório: C.N. 2 L/min')
    expect(ws.getCell(6, 3).value).toBe('Dispositivos: CVC (12/08), SVD (15/08)')
    expect(ws.getCell(7, 3).value).toBe('Dieta: NE 100%')
    expect(ws.getCell(8, 3).value).toBe('Diurese: 1200mL(24h) 0,77mL/Kg/h · SVD 15/08')
  })

  it('coluna ATB/BIC: ATB nas 2 primeiras linhas mescladas, BIC nas 2 últimas (em branco)', () => {
    const secoes: SecaoPassometroEnfermagem[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    const wb = gerarPlanilhaPassometroEnfermagem(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro Enfermagem')!
    expect(ws.getCell(5, 5).value).toBe('ATB: Meropenem (D2/7)')
    expect(ws.getCell(5, 5).isMerged).toBe(true)
    expect(ws.getCell(7, 5).value).toBe('BIC: ')
    expect(ws.getCell(7, 5).isMerged).toBe(true)
  })
})

describe('gerarHtmlPassometroEnfermagem', () => {
  it('gera html com os rótulos esperados e 4 <tr> por paciente', () => {
    const secoes: SecaoPassometroEnfermagem[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    const html = gerarHtmlPassometroEnfermagem(unidadeFake, secoes)
    expect(html).toContain('Passômetro de Enfermagem')
    expect(html).toContain('Ventilatório: C.N. 2 L/min')
    expect(html).toContain('Dieta: NE 100%')
    expect(html).toContain('ATB: Meropenem (D2/7)')
    expect(html).toContain('BIC: ')
    expect((html.match(/<tbody>/g) ?? []).length).toBe(1)
  })

  it('1 página por ala até o limite de 10 leitos', () => {
    const linhas = Array.from({ length: 9 }, (_, i) => linhaFake({ leito: String(i + 1) }))
    const secoes: SecaoPassometroEnfermagem[] = [{ ala: unidadeFake.alas[0], linhas }]
    const html = gerarHtmlPassometroEnfermagem(unidadeFake, secoes)
    expect((html.match(/class="pagina"/g) ?? []).length).toBe(1)
  })
})
