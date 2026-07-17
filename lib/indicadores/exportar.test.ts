import { describe, it, expect } from 'vitest'
import { gerarCsvDadosMensais, nomeArquivoCsv, COLUNAS_PREENCHIDAS, COLUNAS_TOTAIS, type LinhaExport } from './exportar'

const LINHA: LinhaExport = {
  leitos_dia: 600,
  leitos_ativos: 20,
  pacientes_dia: 510,
  admissoes: 112,
  saidas: 108,
  saidas_altas: 92,
  saidas_obitos: 16,
  saidas_transferencias: 0,
  dias_permanencia_saidas: 480,
  obitos_ate_24h: 3,
  obitos_apos_24h: 13,
  obitos_paliativos: 5,
  saidas_paliativos: 9,
  obitos_oncologicos: 4,
  saidas_oncologicos: 11,
  soma_mortalidade_esperada: 14.2,
  saidas_com_saps3: 108,
  obitos_com_saps3: 16,
  reinternacoes_48h: 2,
  reinternacoes_30d: 6,
  pacientes_internados_mes: 118,
  ventilador_dia: 160,
  pacientes_hemodialise: 6,
  pacientes_hipoglicemia: 9,
  pacientes_hiperglicemia: 21,
  pacientes_monitorados_glicemia: 110,
  pacientes_disfuncao_glicemica: 27,
  pacientes_disfuncao_glicemica_corticoide: 10,
}

const linhas = (csv: string) => csv.split('\r\n')
const celulas = (csv: string, i: number) => linhas(csv)[i].split(';')

describe('CSV no formato da aba "Dados Mensais"', () => {
  const csv = gerarCsvDadosMensais(new Date(2026, 6, 1), LINHA)

  it('tem cabeçalho e uma linha de valores', () => {
    expect(linhas(csv)).toHaveLength(2)
  })

  it('cabeçalho e valores têm o mesmo número de colunas', () => {
    // Se desalinhar, ele cola na planilha e cada número cai na coluna errada —
    // sem erro nenhum, só indicador errado.
    expect(celulas(csv, 1)).toHaveLength(celulas(csv, 0).length)
  })

  it('mantém a ordem de colunas da planilha', () => {
    const cab = celulas(csv, 0)
    expect(cab[0]).toBe('mes')
    expect(cab[2]).toContain('Leitos-dia')
    expect(cab[4]).toContain('Pacientes-dia')
    expect(cab[8]).toContain('Obitos totais')
    expect(cab.at(-1)).toContain('Discussao nutricional')
  })

  it('põe os valores nas colunas certas', () => {
    const v = celulas(csv, 1)
    expect(v[0]).toBe('2026-07')
    expect(v[2]).toBe('600')   // leitos-dia
    expect(v[4]).toBe('510')   // pacientes-dia
    expect(v[8]).toBe('16')    // óbitos totais
    expect(v[20]).toBe('118')  // total de pacientes internados no mês
  })
})

describe('vazio não é zero', () => {
  const v = celulas(gerarCsvDadosMensais(new Date(2026, 6, 1), LINHA), 1)

  it('deixa vazio o que o app ainda não calcula', () => {
    // Coluna S (índice 18) = "Total de IRAS": módulo não existe. Zerar aqui
    // apagaria o lançamento manual dele ao colar na planilha.
    expect(v[18]).toBe('')
    expect(v[21]).toBe('')  // LPP
    expect(v[32]).toBe('')  // NP >70% da meta
  })

  it('zero de verdade sai como zero', () => {
    const csv = gerarCsvDadosMensais(new Date(2026, 6, 1), { ...LINHA, obitos_ate_24h: 0 })
    expect(celulas(csv, 1)[9]).toBe('0')
  })

  it('preenche 24 dos 75 campos', () => {
    // A planilha tem 77 colunas (A..BY), mas duas não são dado: `mes` e o
    // rótulo livre da coluna B. Sobram 75 campos.
    expect(COLUNAS_PREENCHIDAS).toBe(24)
    expect(COLUNAS_TOTAIS).toBe(75)
  })
})

describe('formato que o Excel em pt-BR entende', () => {
  it('separa por ponto-e-vírgula', () => {
    const csv = gerarCsvDadosMensais(new Date(2026, 6, 1), LINHA)
    expect(csv).toContain(';')
  })

  it('usa vírgula decimal na mortalidade esperada', () => {
    // Com ponto, o Excel pt-BR leria 14.2 como texto ou como 142.
    const csv = gerarCsvDadosMensais(new Date(2026, 6, 1), LINHA)
    expect(celulas(csv, 1)[15]).toBe('14,2')
  })

  it('não arredonda a mortalidade esperada', () => {
    // É soma de probabilidades: arredondar para inteiro destruiria o SMR.
    const csv = gerarCsvDadosMensais(new Date(2026, 6, 1), { ...LINHA, soma_mortalidade_esperada: 7.4791 })
    expect(celulas(csv, 1)[15]).toBe('7,4791')
  })
})

describe('nomeArquivoCsv', () => {
  it('usa ano-mês com zero à esquerda', () => {
    expect(nomeArquivoCsv(new Date(2026, 0, 1))).toBe('dados-mensais-2026-01.csv')
    expect(nomeArquivoCsv(new Date(2026, 11, 1))).toBe('dados-mensais-2026-12.csv')
  })
})
