import { describe, it, expect } from 'vitest'
import { calcularIndicadores, calcularLeitosDia } from './formulas'
import type { ContagensMes, Indicador } from '@/types'

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
