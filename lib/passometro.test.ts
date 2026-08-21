import { describe, it, expect } from 'vitest'
import { gerarPlanilhaPassometro, gerarHtmlPassometro, agruparPorAla, type LinhaPassometro, type SecaoPassometro } from '@/lib/passometro'
import type { Unidade } from '@/lib/unidade'

function linhaFake(overrides: Partial<LinhaPassometro> = {}): LinhaPassometro {
  return {
    alaId: 'ala-1', vazio: false, leito: '2', nomeCurto: 'Fulana Tal', idade: '76 anos', admissao: '16/08',
    hd: 'PNM??', peso: '65Kg', diurese: '400mL(24h) 0,26mL/Kg/h', viaDiurese: 'Espontânea', acesso: 'AVP',
    hgt: '85/100', temp: '36,1 / 36,4', paTendencia: '→ normal', fcTendencia: '↑ taquicárdico',
    evac: '2x 19/08', evacConstipado: false, antimicrobiano: 'Mero D2', dva: '', corticoide: '',
    ibp: 'IBP VO', anticoag: 'Enoxaparina 40mg',
    labs: { leuco: '4710', hb: '8,9', ht: '28', plaq: '290', pcr: '157', lactato: '1,68', ureia: '37', creat: '0,5', na: '138', k: '2,95', mg: '2,0', ph: '7,46', bic: '33', pco2: '49', po2: '50', ca: '1,15' },
    pendencias: 'Tirar HGT de horário', previsaoAlta: '',
    ...overrides,
  }
}

const unidadeFake: Unidade = {
  unitId: 'unit-1', nome: 'UTI IMEC', leitosAtivos: 3, outrasUnidades: 0, requerSaps3: true, tipoUnidade: 'uti',
  alas: [{ id: 'ala-1', nome: 'UTI 01', leitos: ['1', '2', '3'], rotativo: false }],
}

describe('gerarPlanilhaPassometro', () => {
  it('gera o workbook sem lançar erro de merge, com paciente cheio e paciente quase vazio', () => {
    const secoes: SecaoPassometro[] = [
      { ala: unidadeFake.alas[0], linhas: [linhaFake(), linhaFake({ leito: '1', hd: '', peso: '', diurese: '', acesso: '', hgt: '', temp: '', paTendencia: '', fcTendencia: '', ibp: '', anticoag: '', labs: {}, pendencias: '' })] },
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

  it('mescla o cabeçalho dos 3 blocos de exames num título só, sem mesclar as células de dado', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    const wb = gerarPlanilhaPassometro(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro')!

    // Colunas 14-16 = os 3 blocos de exames.
    const cabecalho1 = ws.getCell(4, 14)
    const cabecalho2 = ws.getCell(4, 15)
    expect(cabecalho1.isMerged).toBe(true)
    expect(cabecalho2.isMerged).toBe(true)
    expect(cabecalho1.master.address).toBe(cabecalho2.master.address)
    expect(cabecalho1.master.value).toBe('Últimos Exames Laboratoriais')

    // Nas linhas de dado (5-6), cada bloco continua com seu próprio valor —
    // mesclado só com o par (rowA/rowB), não com os outros blocos.
    const dado1 = ws.getCell(5, 14)
    const dado2 = ws.getCell(5, 15)
    expect(dado1.master.address).not.toBe(dado2.master.address)
  })

  it('destaca a célula de Evac. quando o paciente está constipado', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ evac: 'Não desde admissão', evacConstipado: true })] }]
    const wb = gerarPlanilhaPassometro(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro')!
    const evacCell = ws.getCell(5, 8)
    expect(evacCell.font?.bold).toBe(true)
    expect(evacCell.font?.color).toEqual({ argb: 'FFDC2626' })
  })
})

describe('gerarHtmlPassometro', () => {
  it('gera HTML válido, sem lançar erro, com rowspan nas colunas mescladas e colspan no cabeçalho de exames', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    let html = ''
    expect(() => { html = gerarHtmlPassometro(unidadeFake, secoes) }).not.toThrow()

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('rowspan="2"') // colunas sem texto2 (ex.: Leito)
    expect(html).toContain('colspan="3"') // os 3 blocos de exames sob "Últimos Exames Laboratoriais"
    expect(html).toContain('Últimos Exames Laboratoriais')
  })

  it('destaca a célula de Evac. em vermelho quando constipado', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ evac: 'Não desde admissão', evacConstipado: true })] }]
    const html = gerarHtmlPassometro(unidadeFake, secoes)
    expect(html).toContain('color:#DC2626')
  })

  it('uma ala com poucos leitos vira 1 única página, sem sufixo de página', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake(), linhaFake({ leito: '3' })] }]
    const html = gerarHtmlPassometro(unidadeFake, secoes)
    expect(html.match(/class="pagina"/g)).toHaveLength(1)
    expect(html).not.toContain('página 1/')
  })

  it('uma ala com mais de 10 leitos vira várias páginas, com cabeçalho repetido em cada uma', () => {
    const alaGrande = { ...unidadeFake.alas[0], leitos: Array.from({ length: 12 }, (_, i) => String(i + 1)) }
    const linhas = alaGrande.leitos.map(leito => linhaFake({ leito }))
    const secoes: SecaoPassometro[] = [{ ala: alaGrande, linhas }]
    const html = gerarHtmlPassometro(unidadeFake, secoes)

    expect(html.match(/class="pagina"/g)).toHaveLength(2)
    expect(html).toContain('página 1/2')
    expect(html).toContain('página 2/2')
    expect(html.match(/<thead>/g)).toHaveLength(2) // cabeçalho de ala+coluna repetido em cada página
  })
})

describe('agruparPorAla', () => {
  it('gera uma linha por leito da planta, ocupado ou vazio, na ordem natural do leito', () => {
    // Só leitos 1 e 3 têm paciente; o leito 2 não tem nenhuma linha vinda do banco.
    const linhas = [linhaFake({ leito: '3' }), linhaFake({ leito: '1' })]
    const secoes = agruparPorAla(unidadeFake.alas, linhas)

    expect(secoes).toHaveLength(1)
    expect(secoes[0].linhas.map(l => l.leito)).toEqual(['1', '2', '3'])
    expect(secoes[0].linhas.map(l => l.vazio)).toEqual([false, true, false])
  })

  it('ala rotativo some da lista quando está vazia', () => {
    const alas = [...unidadeFake.alas, { id: 'ala-rot', nome: 'Rotativo', leitos: ['R1'], rotativo: true }]
    const secoes = agruparPorAla(alas, [linhaFake({ leito: '1' })])
    expect(secoes.map(s => s.ala.id)).toEqual(['ala-1'])
  })
})
