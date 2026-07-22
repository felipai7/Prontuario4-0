import { describe, it, expect } from 'vitest'
import { calcularIndicadores, calcularLeitosDia } from './formulas'
import type { ContagensMes, ContagensFisioMes, ContagensEnfermagemMes, ContagensNutricaoMes, ContagensIrasMes, Indicador } from '@/types'

// A linha de exemplo da aba "Dados Mensais" da planilha do Dr. Flaubert.
// Os valores esperados nos testes são os que a PRÓPRIA PLANILHA calcula.
// Se um teste daqui quebrar, o app divergiu da planilha — e é essa divergência
// que precisa doer, porque é ela que faz o Flaubert perder a confiança nos números.
//
// Leitos-dia (600) e leitos ativos (20) não estão aqui de propósito: vêm de
// lib/config.ts, não do banco.
const EXEMPLO_PLANILHA: ContagensMes = {
  pacientes_dia: 510,
  admissoes: 112,
  saidas: 108,
  saidas_altas: 92,            // 108 saídas - 16 óbitos (a planilha não separava transferência)
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
  saidas_com_saps3: 108,       // a planilha assume todo mundo pontuado
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

const calcular = (c: Partial<ContagensMes> = {}) =>
  calcularIndicadores({
    contagens: { ...EXEMPLO_PLANILHA, ...c },
    leitosDia: 600,
    leitosAtivos: 20,
  })

const pegar = (inds: Indicador[], id: string): Indicador => {
  const i = inds.find(x => x.id === id)
  if (!i) throw new Error(`indicador "${id}" não existe`)
  return i
}

const valor = (id: string, c: Partial<ContagensMes> = {}) => pegar(calcular(c), id).valor

describe('paridade com a planilha do Dr. Flaubert', () => {
  // Cada valor esperado foi lido da coluna correspondente da aba "Indicadores".
  it.each([
    ['taxa_ocupacao',                  85],
    ['giro_leito',                     5.4],
    ['intervalo_substituicao',         0.8333333333],
    ['permanencia_media',              4.4444444444],
    ['mortalidade_geral',              14.8148148148],
    ['mortalidade_24h_menos',          2.7777777778],
    ['mortalidade_24h_mais',           12.0370370370],
    ['mortalidade_paliativos',         55.5555555556],
    ['mortalidade_oncologicos',        36.3636363636],
    ['smr',                            1.1267605634],
    ['reinternacao_48h',               1.8518518519],
    ['reinternacao_30d',               5.5555555556],
    ['utilizacao_vm',                  31.3725490196],
    ['hemodialise_100adm',             5.3571428571],
    ['disfuncao_glicemica_corticoide', 37.0370370370],
  ])('%s = %f', (id, esperado) => {
    expect(valor(id as string)).toBeCloseTo(esperado as number, 6)
  })
})

describe('disglicemia: divergência deliberada da planilha', () => {
  // A planilha divide por "pacientes monitorados" (110 de 118 no exemplo).
  // Decisão do Dr. Felipe: dividir por TODOS os internados. Só se deixa de aferir
  // HGT em quem não é diabético, não tem dieta restrita e não usa corticoide —
  // em quem não se flagraria disglicemia de qualquer jeito. Sem registro = normal.
  //
  // Este bloco existe separado do de paridade para a divergência ficar registrada
  // como decisão, e não passar por engano quando alguém reencostar na planilha.
  it('divide por todos os internados (118), não pelos monitorados (110)', () => {
    expect(valor('prev_hipoglicemia')).toBeCloseTo(9 / 118 * 100, 6)
    expect(valor('prev_hiperglicemia')).toBeCloseTo(21 / 118 * 100, 6)
  })

  it('não usa mais o campo de monitorados — mudar a política de HGT não move o indicador', () => {
    const comMaisMonitorados = calcular({ pacientes_monitorados_glicemia: 118 })
    const comMenos           = calcular({ pacientes_monitorados_glicemia: 40 })
    expect(pegar(comMaisMonitorados, 'prev_hipoglicemia').valor)
      .toBe(pegar(comMenos, 'prev_hipoglicemia').valor)
  })

  it('paciente sem HGT conta como normal, não como desconhecido', () => {
    // 118 internados, ninguém com disglicemia registrada → 0%, não null.
    expect(valor('prev_hipoglicemia', { pacientes_hipoglicemia: 0 })).toBe(0)
  })
})

describe('SMR', () => {
  // Regressão do bug encontrado em produção: o numerador contava TODOS os óbitos
  // contra um denominador que só somava a mortalidade esperada de quem tinha
  // SAPS 3. Com cobertura parcial — que é o caso normal, já que o SAPS 3 é
  // opcional — isso inflava o SMR silenciosamente.
  it('usa apenas os óbitos de pacientes pontuados, não todos os óbitos', () => {
    const smr = pegar(calcular({
      saidas_obitos: 16,
      obitos_com_saps3: 8,          // metade dos óbitos sem SAPS 3
      saidas_com_saps3: 54,
      soma_mortalidade_esperada: 7.1,
    }), 'smr')

    expect(smr.numerador).toBe(8)   // não 16
    expect(smr.valor).toBeCloseTo(8 / 7.1, 6)
  })

  it('coincide com a planilha quando a cobertura de SAPS 3 é total', () => {
    expect(valor('smr')).toBeCloseTo(16 / 14.2, 6)
  })

  it('não calcula quando ninguém foi pontuado', () => {
    expect(valor('smr', { obitos_com_saps3: 0, soma_mortalidade_esperada: 0 })).toBeNull()
  })
})

describe('divisão por zero (equivale ao IFERROR da planilha)', () => {
  const semSaidas = () => calcular({
    saidas: 0, saidas_altas: 0, saidas_obitos: 0, obitos_ate_24h: 0, obitos_apos_24h: 0,
    dias_permanencia_saidas: 0, reinternacoes_48h: 0, reinternacoes_30d: 0,
  })

  it('devolve null em vez de Infinity ou NaN nos que dividem por saídas', () => {
    const inds = semSaidas()
    for (const id of ['mortalidade_geral', 'permanencia_media',
                      'intervalo_substituicao', 'reinternacao_48h']) {
      expect(pegar(inds, id).valor).toBeNull()
    }
  })

  it('giro de leito é 0, não null, quando não houve saídas', () => {
    // O denominador do giro é o nº de leitos, não as saídas: zero saídas em
    // 20 leitos é um giro de 0 — valor legítimo, não ausência de dado.
    expect(pegar(semSaidas(), 'giro_leito').valor).toBe(0)
  })

  it('mês sem nenhum paciente não quebra nenhum indicador', () => {
    const zerado: ContagensMes = { ...EXEMPLO_PLANILHA }
    for (const k of Object.keys(zerado) as (keyof ContagensMes)[]) zerado[k] = 0
    const inds = calcularIndicadores({ contagens: zerado, leitosDia: 0, leitosAtivos: 0 })
    for (const i of inds) {
      expect(i.valor === null || Number.isFinite(i.valor)).toBe(true)
    }
  })
})

describe('numerador e denominador expostos', () => {
  // A tela mostra "16 / 108" para conferência manual contra a planilha.
  it('mortalidade geral expõe óbitos sobre saídas', () => {
    const m = pegar(calcular(), 'mortalidade_geral')
    expect([m.numerador, m.denominador]).toEqual([16, 108])
  })

  it('transferência entra no denominador das saídas', () => {
    // Definição do Dr. Flaubert: "todas as saídas, incluindo transferências".
    const m = pegar(calcular({
      saidas: 110, saidas_altas: 92, saidas_obitos: 16, saidas_transferencias: 2,
    }), 'mortalidade_geral')
    expect(m.denominador).toBe(110)
    expect(m.valor).toBeCloseTo(16 / 110 * 100, 6)
  })
})

describe('fisioterapia respiratória', () => {
  const FISIO: ContagensFisioMes = {
    extubados_com_sucesso: 27,
    tentativas_extubacao: 30,
    reintubacoes_48h: 3,
    extubacoes_planejadas: 30,
    desmame_dificil_sucesso: 5,
    pacientes_desmame_dificil: 8,
    vni_evitou_iot: 12,
    vni_objetivo_evitar_iot: 15,
    decanulados_na_uti: 3,
    traqueo_elegiveis: 5,
    dias_vm_protetora: 130,
  }

  const comFisio = (f: Partial<ContagensFisioMes> = {}) =>
    calcularIndicadores({
      contagens: { ...EXEMPLO_PLANILHA },
      leitosDia: 600, leitosAtivos: 20,
      fisio: { ...FISIO, ...f },
    })

  // Mesmos números do exemplo da planilha → mesmos resultados.
  it.each([
    ['sucesso_desmame',         90],
    ['falha_extubacao',         10],
    ['sucesso_desmame_dificil', 62.5],
    ['vni_evita_iot',           80],
    ['decanulacao_tqt',         60],
    ['vm_protetora',            81.25],
  ])('%s = %f (paridade com a planilha)', (id, esperado) => {
    expect(pegar(comFisio(), id as string).valor).toBeCloseTo(esperado as number, 6)
  })

  it('% VM protetora usa ventilador-dia como denominador', () => {
    // O denominador vem da aba Ventilatório, não do módulo de fisio.
    const i = pegar(comFisio(), 'vm_protetora')
    expect(i.denominador).toBe(EXEMPLO_PLANILHA.ventilador_dia)
  })

  it('falha de extubação ignora extubações não planejadas', () => {
    // 30 tentativas, mas só 25 planejadas: uma autoextubação reintubada não
    // pode contar como falha de julgamento da equipe.
    const i = pegar(comFisio({ extubacoes_planejadas: 25, reintubacoes_48h: 2 }), 'falha_extubacao')
    expect([i.numerador, i.denominador]).toEqual([2, 25])
    expect(i.valor).toBeCloseTo(8, 6)
  })

  it('mês sem registro de fisio deixa os 6 pendentes, não zerados', () => {
    // "Não houve fisio registrada" ≠ "houve e deu zero".
    const inds = calcularIndicadores({
      contagens: EXEMPLO_PLANILHA, leitosDia: 600, leitosAtivos: 20, fisio: null,
    })
    for (const id of ['sucesso_desmame', 'falha_extubacao', 'sucesso_desmame_dificil',
                      'vni_evita_iot', 'decanulacao_tqt', 'vm_protetora']) {
      const i = pegar(inds, id)
      expect(i.aguarda).toBe('Fisioterapia')
      expect(i.valor).toBeNull()
    }
  })

  it('registro existente mas sem eventos do tipo devolve null, não NaN', () => {
    const inds = comFisio({ tentativas_extubacao: 0, extubados_com_sucesso: 0 })
    expect(pegar(inds, 'sucesso_desmame').valor).toBeNull()
  })

  it('com fisio, 23 indicadores vivos', () => {
    expect(comFisio().filter(i => !i.aguarda)).toHaveLength(23)
  })
})

describe('enfermagem', () => {
  const ENF: ContagensEnfermagemMes = {
    cvc_dia: 210,
    svd_dia: 180,
    lpp_adquiridas_uti: 3,
    lpp_total: 3,
    dispositivos_abertos: 0,
  }

  const comEnf = (e: Partial<ContagensEnfermagemMes> = {}) =>
    calcularIndicadores({
      contagens: { ...EXEMPLO_PLANILHA },
      leitosDia: 600, leitosAtivos: 20,
      enfermagem: { ...ENF, ...e },
    })

  it.each([
    ['densidade_lpp',        5.8823529412],   // 3 adquiridas / 510 × 1000
    ['densidade_lpp_total',  5.8823529412],   // 3 totais / 510 × 1000
    ['utilizacao_cvc',      41.1764705882],   // 210 / 510 × 100
    ['utilizacao_svd',      35.2941176471],   // 180 / 510 × 100
  ])('%s = %f (paridade com a planilha)', (id, esperado) => {
    expect(pegar(comEnf(), id as string).valor).toBeCloseTo(esperado as number, 6)
  })

  it('separa LPP adquirida na UTI de LPP total', () => {
    // 5 lesões no mês, 2 vieram da admissão. O indicador de qualidade conta as
    // 3 adquiridas; o de carga conta as 5 e é o que bate com o histórico da
    // planilha, que nunca separou os dois.
    const inds = comEnf({ lpp_total: 5, lpp_adquiridas_uti: 3 })

    const adquirida = pegar(inds, 'densidade_lpp')
    expect(adquirida.numerador).toBe(3)
    expect(adquirida.valor).toBeCloseTo(3 / 510 * 1000, 6)

    const total = pegar(inds, 'densidade_lpp_total')
    expect(total.numerador).toBe(5)
    expect(total.valor).toBeCloseTo(5 / 510 * 1000, 6)
  })

  it('UTI que só recebe lesão de fora tem total alto e adquirida zero', () => {
    // O caso que justifica os dois indicadores: nenhuma falha de cuidado aqui,
    // mas carga de curativo real.
    const inds = comEnf({ lpp_total: 6, lpp_adquiridas_uti: 0 })
    expect(pegar(inds, 'densidade_lpp').valor).toBe(0)
    expect(pegar(inds, 'densidade_lpp_total').valor).toBeCloseTo(6 / 510 * 1000, 6)
  })

  it('mês sem registro de enfermagem deixa os 3 pendentes', () => {
    const inds = calcularIndicadores({
      contagens: EXEMPLO_PLANILHA, leitosDia: 600, leitosAtivos: 20, enfermagem: null,
    })
    for (const id of ['densidade_lpp', 'utilizacao_cvc', 'utilizacao_svd']) {
      expect(pegar(inds, id).aguarda).toBe('Enfermagem')
      expect(pegar(inds, id).valor).toBeNull()
    }
  })

  it('IPCS e ITU aguardam o Intensivista, não a Enfermagem', () => {
    // A enfermagem entrega o denominador (CVC-dia / SVD-dia); o numerador é
    // diagnóstico de infecção, que é médico. Com enfermagem lançada, eles
    // continuam pendentes — e apontando para o módulo certo.
    const inds = comEnf()
    for (const id of ['di_ipcs_total', 'di_ipcs_lab', 'di_ipcs_clinica', 'di_itu_svd']) {
      expect(pegar(inds, id).aguarda).toBe('Intensivista')
    }
  })

  it('com enfermagem, 21 indicadores vivos', () => {
    expect(comEnf().filter(i => !i.aguarda)).toHaveLength(21)
  })

  it('com fisio e enfermagem juntas, 27 vivos', () => {
    const inds = calcularIndicadores({
      contagens: EXEMPLO_PLANILHA, leitosDia: 600, leitosAtivos: 20,
      enfermagem: ENF,
      fisio: {
        extubados_com_sucesso: 27, tentativas_extubacao: 30, reintubacoes_48h: 3,
        extubacoes_planejadas: 30, desmame_dificil_sucesso: 5, pacientes_desmame_dificil: 8,
        vni_evitou_iot: 12, vni_objetivo_evitar_iot: 15, decanulados_na_uti: 3,
        traqueo_elegiveis: 5, dias_vm_protetora: 130,
      },
    })
    expect(inds.filter(i => !i.aguarda)).toHaveLength(27)
  })
})

describe('nutrição', () => {
  // Números do exemplo da planilha, já com as redefinições do Dr. Flaubert.
  const NUT: ContagensNutricaoMes = {
    avaliados: 100, avaliados_ate_24h: 90, admissoes_elegiveis_24h: 100,
    deficit_risco: 22, elegiveis_ne: 45, elegiveis_tn: 95, elegiveis_tn_receberam: 76,
    dias_np: 5, dias_ne: 38, dias_vo: 52,
    dias_np_adequado: 4, dias_ne_adequado: 30, dias_vo_adequado: 40,
    dias_elegiveis_tn: 200, dias_proteica_adequada: 160,
    pacientes_proteica_media_ok: 25, pacientes_proteica_avaliados: 95,
    dias_vm_com_nutricao: 28, dias_vm_nutricao_adequada: 20,
    jejum_maior_24h: 6, ne_iniciada_ate_48h: 32, elegiveis_inicio_ne: 45,
    pacientes_ne: 38, pacientes_vo: 52,
    pacientes_diarreia_ne: 4, pacientes_diarreia_vo: 3,
    episodios_diarreia_ne: 5, dias_diarreia_ne: 9,
    constipados: 14, avaliados_constipacao: 100,
    constipados_opioide: 8, pacientes_opioide: 30, constipacao_vm: 5,
    intolerancia_gi: 2, interrupcao_tn: 3, hipoglicemia_tn: 4,
    dias_discutidos_round: 90, divergencias_diarreia: 0,
  }

  const comNut = (n: Partial<ContagensNutricaoMes> = {}) =>
    calcularIndicadores({
      contagens: { ...EXEMPLO_PLANILHA },
      leitosDia: 600, leitosAtivos: 20,
      nutricao: { ...NUT, ...n },
    })

  it.each([
    ['adequacao_np',              80],              // 4/5
    ['adequacao_ne',              78.9473684211],   // 30/38
    ['aceitacao_vo',              76.9230769231],   // 40/52
    ['prev_deficit_nutricional',  22],              // 22/100
    ['avaliacao_24h',             90],              // 90/100
    ['uso_ne',                     7.4509803922],   // 38/510
    ['uso_vo',                    10.1960784314],   // 52/510
    ['adequacao_nutricional_vm',  71.4285714286],   // 20/28
    ['adequacao_global',          77.8947368421],   // (4+30+40)/(5+38+52)
    ['discussao_round',           17.6470588235],   // 90/510
  ])('%s = %f (paridade com a planilha)', (id, esperado) => {
    expect(pegar(comNut(), id as string).valor).toBeCloseTo(esperado as number, 6)
  })

  it('cobertura de TN divide por elegíveis, não por pacientes-dia', () => {
    // Erro da planilha que o próprio Flaubert reconheceu: ela fazia 95/510.
    const i = pegar(comNut(), 'cobertura_tn')
    expect([i.numerador, i.denominador]).toEqual([76, 95])
    expect(i.valor).toBeCloseTo(80, 6)
  })

  it('elegibilidade para NE divide por avaliados, não por pacientes-dia', () => {
    const i = pegar(comNut(), 'elegibilidade_ne')
    expect([i.numerador, i.denominador]).toEqual([45, 100])
  })

  it('início de NE <48h divide por elegíveis para início', () => {
    // FLAUBERT redefiniu: a planilha dividia pelo total recebendo NE.
    const i = pegar(comNut(), 'inicio_ne_48h')
    expect([i.numerador, i.denominador]).toEqual([32, 45])
  })

  it('diarreia em NE vira três indicadores distintos', () => {
    const inc = pegar(comNut(), 'incidencia_diarreia_ne')
    const den = pegar(comNut(), 'densidade_diarreia_ne')
    const dia = pegar(comNut(), 'dias_diarreia_ne')
    // Incidência conta PACIENTES; densidade conta EPISÓDIOS; dias conta DIAS.
    expect(inc.numerador).toBe(4)
    expect(den.numerador).toBe(5)
    expect(dia.numerador).toBe(9)
    expect(den.valor).toBeCloseTo(5 / 38 * 1000, 6)
  })

  it('adequação proteica tem versão diária e por paciente', () => {
    expect(pegar(comNut(), 'adequacao_proteica_diaria').valor).toBeCloseTo(160 / 200 * 100, 6)
    // Por paciente é média ≥80%, definição do Flaubert.
    expect(pegar(comNut(), 'adequacao_proteica_paciente').valor).toBeCloseTo(25 / 95 * 100, 6)
  })

  it('mês sem registro de nutrição deixa os 26 pendentes', () => {
    const inds = calcularIndicadores({
      contagens: EXEMPLO_PLANILHA, leitosDia: 600, leitosAtivos: 20, nutricao: null,
    })
    const nutri = inds.filter(i => i.categoria === 'Nutrição')
    expect(nutri).toHaveLength(26)
    for (const i of nutri) {
      expect(i.aguarda).toBe('Nutrição')
      expect(i.valor).toBeNull()
    }
  })

  it('sem via registrada, os indicadores de via não quebram', () => {
    const inds = comNut({ dias_np: 0, dias_ne: 0, dias_vo: 0,
      dias_np_adequado: 0, dias_ne_adequado: 0, dias_vo_adequado: 0 })
    for (const id of ['adequacao_np', 'adequacao_ne', 'aceitacao_vo', 'adequacao_global']) {
      expect(pegar(inds, id).valor).toBeNull()
    }
  })
})

describe('IRAS e vigilância', () => {
  const IRAS: ContagensIrasMes = {
    total_iras: 5, pacientes_com_iras: 4,
    pav: 2, itu_svd: 1, ipcs_lab: 1, ipcs_clinica: 1, pneumonia: 1, traqueite: 0, outra: 0,
    sepse_choque: 18,
  }
  const ENF: ContagensEnfermagemMes = {
    cvc_dia: 210, svd_dia: 180, lpp_adquiridas_uti: 3, lpp_total: 3, dispositivos_abertos: 0,
  }

  const comIras = (i: Partial<ContagensIrasMes> = {}, enf: ContagensEnfermagemMes | null = ENF) =>
    calcularIndicadores({
      contagens: { ...EXEMPLO_PLANILHA }, leitosDia: 600, leitosAtivos: 20,
      iras: { ...IRAS, ...i }, enfermagem: enf,
    })

  it.each([
    ['densidade_iras',    5 / 510 * 1000],      // total / pacientes-dia
    ['taxa_infeccao',     5 / 112 * 100],       // total / admissões
    ['pct_pacientes_iras', 4 / 118 * 100],      // pacientes / internados
    ['di_pneumonia',      1 / 510 * 1000],
    ['di_ipcs_total',     2 / 210 * 1000],      // (lab+clínica) / CVC-dia
    ['di_ipcs_lab',       1 / 210 * 1000],
    ['di_itu_svd',        1 / 180 * 1000],
    ['di_pav',            2 / 160 * 1000],      // PAV / ventilador-dia (do EXEMPLO)
    ['taxa_sepse_choque', 18 / 112 * 100],      // sepse / admissões
  ])('%s = %f', (id, esperado) => {
    expect(pegar(comIras(), id as string).valor).toBeCloseTo(esperado as number, 6)
  })

  it('total de IRAS inclui "outra" — o denominador de dispositivo não', () => {
    // A densidade geral usa o total (com outra); as densidades específicas não.
    const inds = comIras({ total_iras: 6, outra: 1 })
    expect(pegar(inds, 'densidade_iras').numerador).toBe(6)
    expect(pegar(inds, 'di_pav').numerador).toBe(2)  // segue só os PAV
  })

  it('IPCS total é a soma de laboratorial e clínica', () => {
    const inds = comIras({ ipcs_lab: 3, ipcs_clinica: 2 })
    expect(pegar(inds, 'di_ipcs_total').numerador).toBe(5)
  })

  it('sem enfermagem, DI de dispositivo fica sem denominador (não pendente)', () => {
    // O numerador (IRAS) existe; o denominador (CVC-dia) viria da enfermagem.
    // Sem ela, o valor é null mas o indicador está VIVO — não aguardando módulo.
    const inds = comIras({}, null)
    const ipcs = pegar(inds, 'di_ipcs_total')
    expect(ipcs.aguarda).toBeUndefined()
    expect(ipcs.valor).toBeNull()
    // PAV usa ventilador-dia (de contagens_mes), então continua calculando.
    expect(pegar(inds, 'di_pav').valor).not.toBeNull()
  })

  it('mês sem IRAS deixa os 11 pendentes no Intensivista', () => {
    const inds = calcularIndicadores({
      contagens: EXEMPLO_PLANILHA, leitosDia: 600, leitosAtivos: 20, iras: null, enfermagem: ENF,
    })
    for (const id of ['densidade_iras', 'taxa_infeccao', 'pct_pacientes_iras',
                      'di_pneumonia', 'di_traqueite', 'di_ipcs_total', 'di_ipcs_lab',
                      'di_ipcs_clinica', 'di_itu_svd', 'di_pav', 'taxa_sepse_choque']) {
      expect(pegar(inds, id).aguarda).toBe('Intensivista')
      expect(pegar(inds, id).valor).toBeNull()
    }
  })

  it('com IRAS + enfermagem + fisio + nutrição, os 64 estão vivos', () => {
    const inds = calcularIndicadores({
      contagens: EXEMPLO_PLANILHA, leitosDia: 600, leitosAtivos: 20,
      iras: IRAS, enfermagem: ENF,
      fisio: {
        extubados_com_sucesso: 27, tentativas_extubacao: 30, reintubacoes_48h: 3,
        extubacoes_planejadas: 30, desmame_dificil_sucesso: 5, pacientes_desmame_dificil: 8,
        vni_evitou_iot: 12, vni_objetivo_evitar_iot: 15, decanulados_na_uti: 3,
        traqueo_elegiveis: 5, dias_vm_protetora: 130,
      },
      nutricao: {
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
      },
    })
    // Nenhum indicador aguardando módulo: todos têm fórmula.
    expect(inds.filter(i => i.aguarda)).toHaveLength(0)
  })
})

describe('indicadores pendentes', () => {
  const inds = calcular()

  it('não inventam valor sem o módulo que os alimenta', () => {
    for (const i of inds.filter(x => x.aguarda)) {
      expect(i.valor).toBeNull()
      expect(i.numerador).toBeNull()
      expect(i.denominador).toBeNull()
    }
  })

  it('17 vivos hoje, e todo indicador ou tem valor ou diz o que espera', () => {
    expect(inds.filter(i => !i.aguarda)).toHaveLength(17)
    for (const i of inds) {
      expect(i.aguarda != null || i.valor != null).toBe(true)
    }
  })

  it('nenhum id repetido', () => {
    const ids = inds.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('calcularLeitosDia', () => {
  it('mês passado conta todos os dias', () => {
    // Junho tem 30 dias; "hoje" em julho já deixou junho fechado.
    expect(calcularLeitosDia(new Date(2026, 5, 1), 19, new Date(2026, 6, 16))).toBe(30 * 19)
  })

  it('mês corrente para em hoje, sem contar dia futuro', () => {
    // Dia 16 de julho: 16 dias decorridos, não os 31 do mês.
    expect(calcularLeitosDia(new Date(2026, 6, 1), 19, new Date(2026, 6, 16))).toBe(16 * 19)
  })

  it('respeita fevereiro bissexto', () => {
    expect(calcularLeitosDia(new Date(2028, 1, 1), 10, new Date(2028, 6, 1))).toBe(29 * 10)
    expect(calcularLeitosDia(new Date(2026, 1, 1), 10, new Date(2026, 6, 1))).toBe(28 * 10)
  })

  it('mês futuro não conta dia nenhum além do mês', () => {
    // Não deve estourar os dias do mês nem virar negativo.
    const d = calcularLeitosDia(new Date(2026, 11, 1), 19, new Date(2026, 6, 16))
    expect(d).toBe(31 * 19)
  })
})
