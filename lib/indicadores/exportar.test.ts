import { describe, it, expect } from 'vitest'
import { gerarCsvDadosMensais, nomeArquivoCsv, contarPreenchidos, COLUNAS_TOTAIS, type LinhaExport } from './exportar'
import type {
  ContagensFisioMes, ContagensEnfermagemMes, ContagensNutricaoMes, ContagensIrasMes,
} from '@/types'

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

  it('sem fisio nem enfermagem, preenche 24 dos 75 campos', () => {
    // A planilha tem 77 colunas (A..BY), mas duas não são dado: `mes` e o
    // rótulo livre da coluna B. Sobram 75 campos.
    expect(contarPreenchidos(LINHA)).toBe(24)
    expect(COLUNAS_TOTAIS).toBe(75)
  })
})

describe('colunas de fisioterapia e enfermagem', () => {
  const FISIO: ContagensFisioMes = {
    extubados_com_sucesso: 27, tentativas_extubacao: 30, reintubacoes_48h: 3,
    extubacoes_planejadas: 30, desmame_dificil_sucesso: 5, pacientes_desmame_dificil: 8,
    vni_evitou_iot: 12, vni_objetivo_evitar_iot: 15, decanulados_na_uti: 3,
    traqueo_elegiveis: 5, dias_vm_protetora: 130,
  }
  const ENF: ContagensEnfermagemMes = {
    cvc_dia: 210, svd_dia: 180, lpp_adquiridas_uti: 2, lpp_total: 3, dispositivos_abertos: 0,
  }

  const completa: LinhaExport = { ...LINHA, fisio: FISIO, enfermagem: ENF }
  const v = celulas(gerarCsvDadosMensais(new Date(2026, 6, 1), completa), 1)

  it('preenche as 3 colunas de enfermagem nas posições certas', () => {
    expect(v[21]).toBe('3')    // V  = Total de LPP
    expect(v[28]).toBe('210')  // AC = CVC-dia
    expect(v[29]).toBe('180')  // AD = SVD-dia
  })

  it('leva o TOTAL de LPP, não só as adquiridas', () => {
    // A planilha nunca separou os dois; mandar só as adquiridas quebraria a
    // comparabilidade com a série histórica dele.
    expect(v[21]).toBe('3')
    expect(v[21]).not.toBe('2')
  })

  it('preenche as 11 colunas de fisioterapia (BD..BN)', () => {
    expect(v[55]).toBe('27')   // BD = Extubados com sucesso
    expect(v[56]).toBe('30')   // BE = Tentativas de extubação
    expect(v[57]).toBe('3')    // BF = Reintubações <48h
    expect(v[65]).toBe('130')  // BN = Dias em VM protetora
  })

  it('mês completo preenche 38 dos 75 campos', () => {
    expect(contarPreenchidos(completa)).toBe(38)
  })

  it('mês sem fisio deixa as colunas dela VAZIAS, não zeradas', () => {
    // Zerar afirmaria "nenhuma extubação no mês"; vazio diz "não sei" e
    // preserva o que ele lançou à mão.
    const semFisio = celulas(gerarCsvDadosMensais(new Date(2026, 6, 1), { ...LINHA, enfermagem: ENF }), 1)
    expect(semFisio[55]).toBe('')
    expect(semFisio[65]).toBe('')
    expect(semFisio[28]).toBe('210')   // enfermagem continua preenchida
  })

  it('mês sem enfermagem deixa as colunas dela vazias', () => {
    const semEnf = celulas(gerarCsvDadosMensais(new Date(2026, 6, 1), { ...LINHA, fisio: FISIO }), 1)
    expect(semEnf[21]).toBe('')
    expect(semEnf[28]).toBe('')
    expect(semEnf[55]).toBe('27')      // fisio continua preenchida
  })

  it('cabeçalho e valores seguem alinhados com todas as fontes', () => {
    const linhas_ = gerarCsvDadosMensais(new Date(2026, 6, 1), completa).split('\r\n')
    expect(linhas_[1].split(';')).toHaveLength(linhas_[0].split(';').length)
  })
})

describe('colunas de nutrição e IRAS', () => {
  const FISIO: ContagensFisioMes = {
    extubados_com_sucesso: 27, tentativas_extubacao: 30, reintubacoes_48h: 3,
    extubacoes_planejadas: 30, desmame_dificil_sucesso: 5, pacientes_desmame_dificil: 8,
    vni_evitou_iot: 12, vni_objetivo_evitar_iot: 15, decanulados_na_uti: 3,
    traqueo_elegiveis: 5, dias_vm_protetora: 130,
  }
  const ENF: ContagensEnfermagemMes = {
    cvc_dia: 210, svd_dia: 180, lpp_adquiridas_uti: 2, lpp_total: 3, dispositivos_abertos: 0,
  }
  const NUT: ContagensNutricaoMes = {
    avaliados: 100, avaliados_ate_24h: 90, admissoes_elegiveis_24h: 100,
    deficit_risco: 22, elegiveis_ne: 45, elegiveis_tn: 95, elegiveis_tn_receberam: 76,
    dias_np: 5, dias_ne: 38, dias_vo: 52, dias_np_adequado: 4, dias_ne_adequado: 30,
    dias_vo_adequado: 40, dias_elegiveis_tn: 200, dias_proteica_adequada: 160,
    pacientes_proteica_media_ok: 25, pacientes_proteica_avaliados: 95,
    dias_vm_com_nutricao: 28, dias_vm_nutricao_adequada: 20, jejum_maior_24h: 6,
    ne_iniciada_ate_48h: 32, elegiveis_inicio_ne: 45, pacientes_ne: 38, pacientes_vo: 52,
    pacientes_diarreia_ne: 4, pacientes_diarreia_vo: 3, episodios_diarreia_ne: 5,
    dias_diarreia_ne: 9, constipados: 14, avaliados_constipacao: 100,
    constipados_opioide: 8, pacientes_opioide: 30, constipacao_vm: 5,
    intolerancia_gi: 2, interrupcao_tn: 3, hipoglicemia_tn: 4,
    dias_discutidos_round: 90, divergencias_diarreia: 0,
  }
  const IRAS: ContagensIrasMes = {
    total_iras: 5, pacientes_com_iras: 4,
    pav: 2, itu_svd: 1, ipcs_lab: 1, ipcs_clinica: 1, pneumonia: 1, traqueite: 0, outra: 0,
    sepse_choque: 18,
  }

  const cheia: LinhaExport = { ...LINHA, fisio: FISIO, enfermagem: ENF, nutricao: NUT, iras: IRAS }
  const v = celulas(gerarCsvDadosMensais(new Date(2026, 6, 1), cheia), 1)
  const cab = celulas(gerarCsvDadosMensais(new Date(2026, 6, 1), cheia), 0)

  // Confere valor pelo RÓTULO da coluna, não por índice fixo — se a ordem mudar,
  // o teste acompanha em vez de mentir.
  const porRotulo = (trecho: string) => v[cab.findIndex(c => c.includes(trecho))]

  it('preenche as colunas de IRAS', () => {
    expect(porRotulo('Total de IRAS')).toBe('5')
    expect(porRotulo('Pacientes com pelo menos uma IRAS')).toBe('4')
    expect(porRotulo('PAV (mes)')).toBe('2')
    expect(porRotulo('IPCS laboratorial')).toBe('1')
    expect(porRotulo('sepse/choque')).toBe('18')
  })

  it('preenche as colunas de nutrição', () => {
    expect(porRotulo('Total recebendo NE')).toBe('38')
    expect(porRotulo('Deficit/risco nutricional')).toBe('22')
    expect(porRotulo('Diarreia em pacientes com NE')).toBe('4')
    // "Adequacao proteica (n)" é o por-paciente (25), não os dias (160).
    expect(porRotulo('Adequacao proteica')).toBe('25')
    expect(porRotulo('Discussao nutricional em round')).toBe('90')
  })

  it('com todos os módulos, preenche os 75 campos', () => {
    expect(contarPreenchidos(cheia)).toBe(75)
  })

  it('cabeçalho e valores seguem alinhados', () => {
    expect(v).toHaveLength(cab.length)
  })

  it('mês só com IRAS: nutrição fica vazia, IRAS preenchida', () => {
    const soIras = celulas(gerarCsvDadosMensais(new Date(2026, 6, 1), { ...LINHA, iras: IRAS }), 1)
    const cabS = celulas(gerarCsvDadosMensais(new Date(2026, 6, 1), { ...LINHA, iras: IRAS }), 0)
    const idx = (t: string) => cabS.findIndex(c => c.includes(t))
    expect(soIras[idx('Total de IRAS')]).toBe('5')
    expect(soIras[idx('Total recebendo NE')]).toBe('')  // nutrição ausente
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
