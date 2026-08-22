import { describe, it, expect } from 'vitest'
import {
  gerarPlanilhaPassometro, gerarHtmlPassometro, agruparPorAla, ordenarExamesRecentes,
  faixaMinMax, blocoVital, ultimaEvacuacao, formatarIbp, formatarAnticoag, formatarRespiracao,
  valorLabsMaisRecente,
  type LinhaPassometro, type SecaoPassometro,
} from '@/lib/passometro'
import type { Unidade } from '@/lib/unidade'
import type { Exame, PeriodoBalanco, CuidadosHorizontais, SuporteVentilatorio, ResultadoExame } from '@/types'

function linhaFake(overrides: Partial<LinhaPassometro> = {}): LinhaPassometro {
  return {
    alaId: 'ala-1', vazio: false, leito: '2', nome: 'Fulana da Silva Tal', idade: '76 anos', admissao: '16/08',
    hd: 'PNM??', peso: '65Kg', diurese: '400mL(24h) 0,26mL/Kg/h', viaDiurese: 'Espontânea', acesso: 'AVP',
    hgt: '85/100', temp: '36,1–37,4', respiracao: 'C.N. 2 L/min',
    fcResumo: 'FC Máx: 98\nFC Méd: 85\nFC Mín: 72',
    pasResumo: 'PAS Máx: 145\nPAS Méd: 130\nPAS Mín: 110',
    padResumo: 'PAD Máx: 90\nPAD Méd: 78\nPAD Mín: 65',
    evac: '2x 19/08', evacConstipado: false, antimicrobiano: 'Mero D2', dva: '', corticoide: '',
    ibp: 'Pant 40mg VO', anticoag: 'Enoxa 40mg', anticoagTerapeutico: false,
    labs: { leuco: '4710', hb: '8,9', ht: '28', plaq: '290', pcr: '157', lactato: '1,68', ureia: '37', creat: '0,5', na: '138', k: '2,95', mg: '2,0', ph: '7,46', bic: '33', pco2: '49', po2: '50', ca: '1,15' },
    pendencias: 'Tirar HGT de horário', previsaoAlta: '', previsaoAltaHoje: false,
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
      {
        ala: unidadeFake.alas[0], linhas: [linhaFake(), linhaFake({
          leito: '1', hd: '', peso: '', diurese: '', acesso: '', hgt: '', temp: '', respiracao: '',
          fcResumo: '', pasResumo: '', padResumo: '', ibp: '', anticoag: '', labs: {}, pendencias: '',
        })],
      },
    ]

    expect(() => gerarPlanilhaPassometro(unidadeFake, secoes)).not.toThrow()
  })

  it('mescla as colunas sem texto2 e mantém as colunas duplicadas (2 itens/paciente) sem mesclar', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    const wb = gerarPlanilhaPassometro(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro')!

    // Título+subtítulo(2) + cabeçalho da ala(1) + cabeçalho de coluna em 2
    // linhas físicas(2) = linha 5; os dados começam na 6.
    const rowA = 6, rowB = 7
    // Coluna 1 = Leito: sem texto2, deve estar mesclada (mesmo `master`).
    const leitoA = ws.getCell(rowA, 1)
    const leitoB = ws.getCell(rowB, 1)
    expect(leitoA.isMerged).toBe(true)
    expect(leitoB.isMerged).toBe(true)
    expect(leitoA.master.address).toBe(leitoB.master.address)

    // Coluna 10 = Psicotrópicos/Analgesia: NÃO deve mesclar.
    const psicoA = ws.getCell(rowA, 10)
    const psicoB = ws.getCell(rowB, 10)
    expect(psicoA.isMerged).toBe(false)
    expect(psicoB.isMerged).toBe(false)
  })

  it('mescla o cabeçalho dos 3 blocos de exames num título só (2 linhas x 3 colunas), sem mesclar as células de dado', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    const wb = gerarPlanilhaPassometro(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro')!

    // Colunas 14-16 = os 3 blocos de exames; cabeçalho ocupa as linhas 4-5.
    const cabecalho1 = ws.getCell(4, 14)
    const cabecalho2 = ws.getCell(4, 15)
    expect(cabecalho1.isMerged).toBe(true)
    expect(cabecalho2.isMerged).toBe(true)
    expect(cabecalho1.master.address).toBe(cabecalho2.master.address)
    expect(cabecalho1.master.value).toBe('Últimos Exames Laboratoriais')

    // Nas linhas de dado (6-7), cada bloco continua com seu próprio valor —
    // mesclado só com o par (rowA/rowB), não com os outros blocos.
    const dado1 = ws.getCell(6, 14)
    const dado2 = ws.getCell(6, 15)
    expect(dado1.master.address).not.toBe(dado2.master.address)
  })

  it('cabeçalho de coluna com texto2 divide label/label2 em 2 linhas físicas, sem mesclar', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    const wb = gerarPlanilhaPassometro(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro')!

    // Coluna 11 = DVA/Corticoide — exemplo citado pelo Felipe: "DVA" em cima, "Corticoide" embaixo.
    expect(ws.getCell(4, 11).value).toBe('DVA')
    expect(ws.getCell(5, 11).value).toBe('Corticoide')
    expect(ws.getCell(4, 11).isMerged).toBe(false)
    expect(ws.getCell(5, 11).isMerged).toBe(false)

    // Coluna 13 = PAS/PAD (em cima) / FC (embaixo) — também dividida.
    expect(ws.getCell(4, 13).value).toBe('PAS / PAD')
    expect(ws.getCell(5, 13).value).toBe('FC')
    expect(ws.getCell(4, 13).isMerged).toBe(false)
  })

  it('destaca a célula de Evac. em negrito (sem cor — a impressora é P&B) quando o paciente está constipado', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ evac: 'Não desde admissão', evacConstipado: true })] }]
    const wb = gerarPlanilhaPassometro(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro')!
    const evacCell = ws.getCell(6, 8)
    expect(evacCell.font?.bold).toBe(true)
    expect(evacCell.font?.color).toBeUndefined()
  })

  it('Leito e Previsão de Alta saem com fonte bem maior que o resto da tabela', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ previsaoAlta: '22/08' })] }]
    const wb = gerarPlanilhaPassometro(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro')!
    expect(ws.getCell(6, 1).font?.size).toBe(20) // Leito
    expect(ws.getCell(6, 18).font?.size).toBe(16) // Previsão de Alta
  })

  it('destaca "Hoje!" na Previsão de Alta quando a alta é prevista pro dia da geração', () => {
    const comHoje = [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ previsaoAlta: '22/08', previsaoAltaHoje: true })] }]
    const semHoje = [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ previsaoAlta: '22/08', previsaoAltaHoje: false })] }]
    const wbComHoje = gerarPlanilhaPassometro(unidadeFake, comHoje)
    const wbSemHoje = gerarPlanilhaPassometro(unidadeFake, semHoje)
    expect(wbComHoje.getWorksheet('Passômetro')!.getCell(6, 18).value).toBe('22/08\nHoje!')
    expect(wbSemHoje.getWorksheet('Passômetro')!.getCell(6, 18).value).toBe('22/08')
  })

  it('negrito só na linha de anticoagulante quando é terapêutico, não na de IBP', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ anticoagTerapeutico: true })] }]
    const wb = gerarPlanilhaPassometro(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro')!
    // Coluna 12 = IBP/Anticoag.; rowA (linha 6) = IBP, rowB (linha 7) = anticoagulante.
    expect(ws.getCell(6, 12).font?.bold).toBeFalsy()
    expect(ws.getCell(7, 12).font?.bold).toBe(true)
  })

  it('não trunca mais o nome do paciente (nome completo, não só primeiro+último)', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ nome: 'Graciema Peixoto Rodrigues Souza' })] }]
    const wb = gerarPlanilhaPassometro(unidadeFake, secoes)
    const ws = wb.getWorksheet('Passômetro')!
    expect(ws.getCell(6, 2).value).toContain('Graciema Peixoto Rodrigues Souza')
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

  it('cabeçalho de coluna com texto2 vira 2 <th> em <tr> separados, seguindo o padrão da coluna', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    const html = gerarHtmlPassometro(unidadeFake, secoes)
    expect(html).toContain('<th>DVA</th>')
    expect(html).toContain('<th>Corticoide</th>')
    expect(html).toContain('<th>Insulina</th>')
    expect(html).toContain('<th>Respiração</th>')
    expect(html).toContain('<th>PAS / PAD</th>')
    expect(html).toContain('<th>FC</th>')
  })

  it('destaca a célula de Evac. em negrito (sem cor — a impressora é P&B) quando constipado', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ evac: 'Não desde admissão', evacConstipado: true })] }]
    const html = gerarHtmlPassometro(unidadeFake, secoes)
    expect(html).toContain('style="font-weight:bold;">Não desde admissão')
    expect(html).not.toContain('color:#DC2626')
  })

  it('Leito e Previsão de Alta saem com font-size bem maior no HTML também', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake()] }]
    const html = gerarHtmlPassometro(unidadeFake, secoes)
    expect(html).toContain('font-size:20pt')
    expect(html).toContain('font-size:16pt')
  })

  it('destaca "Hoje!" na Previsão de Alta quando a alta é prevista pro dia da geração', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ previsaoAlta: '22/08', previsaoAltaHoje: true })] }]
    const html = gerarHtmlPassometro(unidadeFake, secoes)
    expect(html).toContain('22/08<br>Hoje!')
  })

  it('negrito só na linha de anticoagulante terapêutico, não na de IBP', () => {
    const terapeutico = gerarHtmlPassometro(unidadeFake, [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ anticoagTerapeutico: true })] }])
    const profilatico = gerarHtmlPassometro(unidadeFake, [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ anticoagTerapeutico: false })] }])
    expect(terapeutico).toContain('font-weight:bold;">Enoxa 40mg')
    expect(profilatico).not.toContain('font-weight:bold;">Enoxa 40mg')
  })

  it('não trunca mais o nome do paciente (nome completo, não só primeiro+último)', () => {
    const secoes: SecaoPassometro[] = [{ ala: unidadeFake.alas[0], linhas: [linhaFake({ nome: 'Graciema Peixoto Rodrigues Souza' })] }]
    const html = gerarHtmlPassometro(unidadeFake, secoes)
    expect(html).toContain('Graciema Peixoto Rodrigues Souza')
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

function exameFake(overrides: Partial<Exame> = {}): Exame {
  return {
    id: 'ex-1', paciente_id: 'p1', tipo_exame: 'Bioquímica', resultados: null,
    observacoes: null, raw_text: null, nome_arquivo: null,
    data_exame: null, created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * `data_exame` é "DD/MM/AAAA" — `new Date()` direto nele confunde dia com mês
 * (formato americano) e devolve Invalid Date sempre que o dia é > 12,
 * fazendo o "mais recente" escolhido não ser o de fato mais recente (era o
 * bug por trás dos valores desatualizados no passômetro).
 */
describe('ordenarExamesRecentes', () => {
  it('coloca o exame mais recente primeiro mesmo com dia > 12 (que quebraria new Date direto)', () => {
    const antigo = exameFake({ id: 'antigo', data_exame: '05/08/2026' })
    const recente = exameFake({ id: 'recente', data_exame: '20/08/2026' })
    expect(ordenarExamesRecentes([antigo, recente]).map(e => e.id)).toEqual(['recente', 'antigo'])
  })

  it('não inverte dia e mês em datas ambíguas (05/08 é 5 de agosto, não 8 de maio)', () => {
    const cincoDeAgosto = exameFake({ id: 'ago', data_exame: '05/08/2026' })
    const primeiroDeMaio = exameFake({ id: 'mai', data_exame: '01/05/2026' })
    // Maio vem antes de agosto — se o parser trocasse dia/mês, "05/08" viraria
    // 8 de maio e ficaria DEPOIS de "01/05" (1º de maio) na ordenação.
    expect(ordenarExamesRecentes([primeiroDeMaio, cincoDeAgosto]).map(e => e.id)).toEqual(['ago', 'mai'])
  })

  it('sem data_exame, cai para created_at', () => {
    const semData = exameFake({ id: 'sem-data', data_exame: null, created_at: '2026-08-10T00:00:00Z' })
    const comData = exameFake({ id: 'com-data', data_exame: '01/08/2026' })
    expect(ordenarExamesRecentes([comData, semData]).map(e => e.id)).toEqual(['sem-data', 'com-data'])
  })
})

describe('faixaMinMax (Temp.)', () => {
  it('mín–máx quando há mais de uma aferição', () => {
    expect(faixaMinMax([36.1, 37.8, 36.9])).toBe('36,1–37,8')
  })
  it('só o valor, sem traço, quando há 1 única aferição (ou todas iguais)', () => {
    expect(faixaMinMax([36.5])).toBe('36,5')
    expect(faixaMinMax([36.5, 36.5])).toBe('36,5')
  })
  it('vazio sem nenhuma aferição', () => {
    expect(faixaMinMax([])).toBe('')
  })
})

describe('blocoVital (FC/PAS/PAD)', () => {
  it('sempre as 3 linhas (Máx/Méd/Mín, nessa ordem), com o nome do vital em cada uma', () => {
    expect(blocoVital('FC', [70, 90, 100])).toBe('FC Máx: 100\nFC Méd: 87\nFC Mín: 70')
  })
  it('não colapsa mesmo quando todas as aferições deram o mesmo valor — formato fixo de 3 linhas', () => {
    expect(blocoVital('PAS', [120])).toBe('PAS Máx: 120\nPAS Méd: 120\nPAS Mín: 120')
  })
  it('vazio sem nenhuma aferição', () => {
    expect(blocoVital('FC', [])).toBe('')
  })
})

function periodoFake(overrides: Partial<PeriodoBalanco> = {}): PeriodoBalanco {
  return {
    id: 'p1', paciente_id: 'pac-1', unit_id: 'unit-1',
    inicio: '2026-08-20T07:00:00', fim: '2026-08-20T19:00:00',
    turno: 'diurno', horas_periodo: 12,
    venoso: 0, oral_enteral: 0, agua_endogena: 0, diurese: 0, dialise: 0,
    febre: 0, evacuacao: 0, dreno: 0, vomitos: 0, sne_sng: 0, ostomia: 0,
    outros: 0, outros_nome: null, perdas_insensiveis: 0,
    diarreica_medico: null, diarreica_nutricao: null,
    created_at: '2026-08-20T07:00:00', updated_at: '2026-08-20T07:00:00',
    ...overrides,
  }
}

describe('ultimaEvacuacao', () => {
  it('divide o volume lançado (mL) por 200 pra obter o nº de episódios', () => {
    const { texto } = ultimaEvacuacao([periodoFake({ evacuacao: 400 })], '2026-08-01')
    expect(texto).toContain('2x')
  })

  it('arredonda pro episódio mais próximo quando o volume não é múltiplo exato de 200', () => {
    // 300mL / 200 = 1,5 -> arredonda pra 2.
    const { texto } = ultimaEvacuacao([periodoFake({ evacuacao: 300 })], '2026-08-01')
    expect(texto).toContain('2x')
  })

  it('débito de ostomia mostra o VOLUME (mL), não converte em episódios', () => {
    const { texto } = ultimaEvacuacao([periodoFake({ evacuacao: 0, ostomia: 450 })], '2026-08-01')
    expect(texto).toContain('450mL (ostomia)')
    expect(texto).not.toContain('x') // não deve aparecer contagem de episódios
  })

  it('conta ostomia como evacuação pra não marcar constipado indevidamente', () => {
    const { constipado } = ultimaEvacuacao([periodoFake({ evacuacao: 0, ostomia: 300, inicio: new Date().toISOString() })], '2026-08-01')
    expect(constipado).toBe(false)
  })

  it('sem nenhum episódio nem débito de ostomia, mostra "Não desde admissão"', () => {
    const { texto } = ultimaEvacuacao([], '2026-08-01')
    expect(texto).toBe('Não desde admissão')
  })
})

const cuidadosFake = (overrides: Partial<CuidadosHorizontais> = {}): CuidadosHorizontais => ({
  id: 'c1', paciente_id: 'pac-1', previsao_alta: null,
  ibp_em_uso: false, ibp_via: null, ibp_dose_valor: null, ibp_dose_unidade: null,
  ibp_frequencia: null, ibp_objetivo: null,
  anticoag_em_uso: false, anticoag_droga: null, anticoag_droga_outro: null, anticoag_via: null,
  anticoag_dose_valor: null, anticoag_dose_unidade: null, anticoag_frequencia: null, anticoag_objetivo: null,
  corticoide_em_uso: false, opioide_em_uso: false, updated_at: '2026-08-20T00:00:00',
  ...overrides,
})

describe('formatarIbp', () => {
  it('abrevia pra "Pant", com dose e via — sem frequência quando é 1x/dia', () => {
    const texto = formatarIbp(cuidadosFake({
      ibp_em_uso: true, ibp_via: 'Enteral', ibp_dose_valor: 40, ibp_dose_unidade: 'mg', ibp_frequencia: '1x/dia',
    }))
    expect(texto).toBe('Pant 40mg VO')
  })

  it('mostra a frequência abreviada quando é mais de 1x/dia', () => {
    const texto = formatarIbp(cuidadosFake({
      ibp_em_uso: true, ibp_via: 'Endovenoso', ibp_dose_valor: 40, ibp_dose_unidade: 'mg', ibp_frequencia: '2x/dia',
    }))
    expect(texto).toBe('Pant 40mg EV 2x')
  })

  it('vazio quando não está em uso', () => {
    expect(formatarIbp(cuidadosFake({ ibp_em_uso: false }))).toBe('')
    expect(formatarIbp(null)).toBe('')
  })
})

describe('formatarAnticoag', () => {
  it('abrevia o nome da droga e mostra a dose, sem frequência quando é 1x/dia', () => {
    const texto = formatarAnticoag(cuidadosFake({
      anticoag_em_uso: true, anticoag_droga: 'Enoxaparina', anticoag_dose_valor: 40, anticoag_dose_unidade: 'mg',
      anticoag_frequencia: '1x/dia', anticoag_objetivo: 'profilatico',
    }))
    expect(texto).toBe('Enoxa 40mg')
  })

  it('Heparina Não Fracionada vira HNF', () => {
    const texto = formatarAnticoag(cuidadosFake({
      anticoag_em_uso: true, anticoag_droga: 'Heparina Não Fracionada', anticoag_dose_valor: 5000, anticoag_dose_unidade: 'UI',
    }))
    expect(texto).toBe('HNF 5000UI')
  })

  it('mostra a frequência quando é mais de 1x/dia (terapêutico)', () => {
    const texto = formatarAnticoag(cuidadosFake({
      anticoag_em_uso: true, anticoag_droga: 'Rivaroxabana', anticoag_dose_valor: 2.5, anticoag_dose_unidade: 'mg',
      anticoag_frequencia: '2x/dia', anticoag_objetivo: 'terapeutico',
    }))
    expect(texto).toBe('Rivaroxa 2.5mg 2x')
  })

  it('vazio quando não está em uso', () => {
    expect(formatarAnticoag(cuidadosFake({ anticoag_em_uso: false }))).toBe('')
    expect(formatarAnticoag(null)).toBe('')
  })
})

function ventFake(overrides: Partial<SuporteVentilatorio> = {}): SuporteVentilatorio {
  return {
    id: 'v1', paciente_id: 'pac-1', data: '2026-08-20', turno: 'diurno',
    modalidade: null, o2_dispositivo: null, o2_fluxo_l_min: null, vm_data_inicio: null, vm_via: null,
    created_at: '2026-08-20T07:00:00', updated_at: '2026-08-20T07:00:00',
    ...overrides,
  }
}

describe('formatarRespiracao', () => {
  it('"A.A." pra ar ambiente', () => {
    expect(formatarRespiracao(ventFake({ modalidade: 'ar_ambiente' }))).toBe('A.A.')
  })

  it('"C.N. X L/min" pra cateter nasal', () => {
    const texto = formatarRespiracao(ventFake({ modalidade: 'o2_suplementar', o2_dispositivo: 'Cateter nasal', o2_fluxo_l_min: 2 }))
    expect(texto).toBe('C.N. 2 L/min')
  })

  it('"MNR Y L/min" pra máscara com reservatório (máscara não reinalante)', () => {
    const texto = formatarRespiracao(ventFake({ modalidade: 'o2_suplementar', o2_dispositivo: 'Máscara com reservatório', o2_fluxo_l_min: 10 }))
    expect(texto).toBe('MNR 10 L/min')
  })

  it('"VM TOT" ou "VM TQT" pra ventilação mecânica, seguindo a via aérea', () => {
    expect(formatarRespiracao(ventFake({ modalidade: 'ventilacao_mecanica', vm_via: 'TOT' }))).toBe('VM TOT')
    expect(formatarRespiracao(ventFake({ modalidade: 'ventilacao_mecanica', vm_via: 'TQT' }))).toBe('VM TQT')
  })

  it('vazio sem nenhum registro', () => {
    expect(formatarRespiracao(null)).toBe('')
    expect(formatarRespiracao(ventFake({ modalidade: null }))).toBe('')
  })
})

function resultadoFake(analito_id: string, valor: string): ResultadoExame {
  return { nome: analito_id, valor, unidade: null, referencia: null, alterado: false, direcao: 'normal', analito_id }
}

/**
 * Regressão do bug relatado: pH/HCO3(Bic)/pCO2/pO2/Lactato só buscavam a
 * variante `.serum` no catálogo, mas gasometria grava `.art`/`.ven` — a
 * coluna de exames do passômetro nunca mostrava nenhum dado de gasometria.
 * Também trava a preferência pedida: arterial > venosa > soro, DENTRO do
 * mesmo exame (não entre exames de dias diferentes).
 */
describe('valorLabsMaisRecente', () => {
  const variantesPh = { serum: 'ph.serum', art: 'ph.art', ven: 'ph.ven' }

  it('encontra o valor quando o exame só tem a variante arterial (bug: antes só buscava .serum)', () => {
    const exame = { ...exameFake(), resultados: [resultadoFake('ph.art', '7,38')] }
    expect(valorLabsMaisRecente([exame], variantesPh)).toBe('7,38')
  })

  it('encontra o valor quando o exame só tem a variante venosa', () => {
    const exame = { ...exameFake(), resultados: [resultadoFake('ph.ven', '7,32')] }
    expect(valorLabsMaisRecente([exame], variantesPh)).toBe('7,32')
  })

  it('quando o mesmo exame tem arterial E venosa, usa só a arterial', () => {
    const exame = { ...exameFake(), resultados: [resultadoFake('ph.ven', '7,32'), resultadoFake('ph.art', '7,38')] }
    expect(valorLabsMaisRecente([exame], variantesPh)).toBe('7,38')
  })

  it('soro é o último critério — só usado quando não há arterial nem venosa naquele exame', () => {
    const exame = { ...exameFake(), resultados: [resultadoFake('ph.serum', '7,40')] }
    expect(valorLabsMaisRecente([exame], variantesPh)).toBe('7,40')
  })

  it('não mistura exames — a preferência arterial>venosa vale dentro do exame mais recente, não entre exames', () => {
    // Exame mais antigo só tem arterial; o mais recente só tem venosa — o
    // mais recente vence (é o mesmo comportamento de "mais recente" de sempre).
    const antigo = { ...exameFake({ id: 'antigo', data_exame: '01/08/2026' }), resultados: [resultadoFake('ph.art', '7,20')] }
    const recente = { ...exameFake({ id: 'recente', data_exame: '20/08/2026' }), resultados: [resultadoFake('ph.ven', '7,35')] }
    expect(valorLabsMaisRecente([recente, antigo], variantesPh)).toBe('7,35')
  })

  it('vazio quando nenhum exame tem a variante buscada', () => {
    const exame = { ...exameFake(), resultados: [resultadoFake('creatinina.serum', '0,8')] }
    expect(valorLabsMaisRecente([exame], variantesPh)).toBe('')
  })
})
