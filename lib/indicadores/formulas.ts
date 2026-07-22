// As fórmulas dos indicadores da UTI.
//
// Espelham a aba "Indicadores" da planilha do Dr. Flaubert, com as correções e
// redefinições que ele mandou (ver comentários marcados FLAUBERT). Cada indicador
// expõe numerador e denominador para conferência lado a lado com a planilha.
//
// Um indicador com `aguarda` ainda não tem dado de origem: o módulo que o alimenta
// não existe. Ele aparece na tela como pendente, e a fórmula entra quando o módulo
// chegar — não escrevemos fórmula contra campo que não existe.

import type { ContagensMes, ContagensFisioMes, ContagensEnfermagemMes, ContagensNutricaoMes, ContagensIrasMes, Indicador } from '@/types'

/** Divisão protegida — equivale ao IFERROR(...,"") da planilha. */
function razao(n: number | null, d: number | null, mult = 1): number | null {
  if (n == null || d == null || d === 0) return null
  return (n / d) * mult
}

interface Entrada {
  contagens: ContagensMes
  /** Leitos × dias do mês. Vem de lib/config.ts, não do banco. */
  leitosDia: number
  leitosAtivos: number
  /** Null enquanto não houver dado de fisioterapia no mês — os 6 ficam pendentes. */
  fisio?: ContagensFisioMes | null
  /** Null enquanto não houver dado de enfermagem no mês. */
  enfermagem?: ContagensEnfermagemMes | null
  /** Null enquanto não houver dado de nutrição no mês. */
  nutricao?: ContagensNutricaoMes | null
  /** Null enquanto não houver dado de IRAS no mês. */
  iras?: ContagensIrasMes | null
}

export function calcularIndicadores({
  contagens: c, leitosDia, leitosAtivos, fisio, enfermagem: enf, nutricao: nut, iras,
}: Entrada): Indicador[] {
  const viva = (
    id: string, nome: string, categoria: Indicador['categoria'], unidade: Indicador['unidade'],
    numerador: number, denominador: number, mult = 1,
  ): Indicador => ({
    id, nome, categoria, unidade, numerador, denominador,
    valor: razao(numerador, denominador, mult),
  })

  const pendente = (
    id: string, nome: string, categoria: Indicador['categoria'],
    unidade: Indicador['unidade'], aguarda: Indicador['aguarda'],
  ): Indicador => ({ id, nome, categoria, unidade, valor: null, numerador: null, denominador: null, aguarda })

  return [
    // ── Operacional ───────────────────────────────────────────────────────
    viva('taxa_ocupacao', 'Taxa de ocupação', 'Operacional', '%', c.pacientes_dia, leitosDia, 100),
    viva('giro_leito', 'Giro de leito', 'Operacional', 'saídas/leito', c.saidas, leitosAtivos),
    viva('intervalo_substituicao', 'Intervalo de substituição', 'Operacional', 'dias',
      leitosDia - c.pacientes_dia, c.saidas),
    viva('permanencia_media', 'Tempo médio de permanência', 'Operacional', 'dias',
      c.dias_permanencia_saidas, c.saidas),

    // ── Mortalidade ───────────────────────────────────────────────────────
    // FLAUBERT: "Mortalidade UTI = óbitos na UTI / todas as saídas, incluindo
    // transferências". `saidas` já soma alta + óbito + transferência.
    viva('mortalidade_geral', 'Mortalidade geral', 'Mortalidade', '%', c.saidas_obitos, c.saidas, 100),
    viva('mortalidade_24h_menos', 'Mortalidade <24h', 'Mortalidade', '%', c.obitos_ate_24h, c.saidas, 100),
    viva('mortalidade_24h_mais', 'Mortalidade >24h', 'Mortalidade', '%', c.obitos_apos_24h, c.saidas, 100),
    viva('mortalidade_paliativos', 'Mortalidade em paliativos', 'Mortalidade', '%',
      c.obitos_paliativos, c.saidas_paliativos, 100),
    viva('mortalidade_oncologicos', 'Mortalidade em oncológicos', 'Mortalidade', '%',
      c.obitos_oncologicos, c.saidas_oncologicos, 100),
    // SMR: mortalidade esperada pela equação SAPS 3 Central-South America.
    // Observado e esperado saem da mesma população (só quem tem SAPS 3) — usar
    // todos os óbitos contra um denominador parcial infla a razão.
    // PENDENTE DE VALIDAÇÃO com casos reais — ver supabase/indicadores_fase1.sql.
    viva('smr', 'SMR (mortalidade padronizada)', 'Mortalidade', 'razão',
      c.obitos_com_saps3, c.soma_mortalidade_esperada),
    viva('reinternacao_48h', 'Reinternação <48h', 'Mortalidade', '%', c.reinternacoes_48h, c.saidas, 100),
    viva('reinternacao_30d', 'Reinternação <30 dias', 'Mortalidade', '%', c.reinternacoes_30d, c.saidas, 100),

    // ── IRAS e segurança ──────────────────────────────────────────────────
    // Total de IRAS e "pacientes com IRAS" saem por soma/dedup dos eventos
    // classificados — inclui "outra", para o total não sair subestimado.
    ...(iras ? [
      viva('densidade_iras', 'Densidade de IRAS', 'IRAS e segurança', '/1000 pac-dia',
        iras.total_iras, c.pacientes_dia, 1000),
      viva('taxa_infeccao', 'Taxa de infecção mensal', 'IRAS e segurança', '%',
        iras.total_iras, c.admissoes, 100),
      viva('pct_pacientes_iras', '% pacientes com IRAS', 'IRAS e segurança', '%',
        iras.pacientes_com_iras, c.pacientes_internados_mes, 100),
    ] : [
      pendente('densidade_iras', 'Densidade de IRAS', 'IRAS e segurança', '/1000 pac-dia', 'Intensivista'),
      pendente('taxa_infeccao', 'Taxa de infecção mensal', 'IRAS e segurança', '%', 'Intensivista'),
      pendente('pct_pacientes_iras', '% pacientes com IRAS', 'IRAS e segurança', '%', 'Intensivista'),
    ]),
    // LPP em dois indicadores, por decisão do Dr. Felipe com aval do Dr. Flaubert.
    // Não é redundância: medem coisas diferentes.
    //
    //   Adquirida na UTI — o indicador de QUALIDADE. É a lesão que apareceu sob
    //   cuidado desta unidade; é sobre ela que a equipe age.
    //
    //   Total — inclui as que o paciente já trouxe. Mede CARGA de cuidado (uma
    //   UTI que recebe muita lesão de fora tem mais trabalho de curativo sem ter
    //   falhado), e é o que mantém a comparabilidade com o histórico da planilha,
    //   que nunca separou os dois.
    //
    // A distância entre os dois números é informação por si só: total alto com
    // adquirida baixa é bom cuidado recebendo caso grave de fora.
    enf
      ? viva('densidade_lpp', 'Densidade de LPP adquirida na UTI', 'IRAS e segurança', '/1000 pac-dia',
          enf.lpp_adquiridas_uti, c.pacientes_dia, 1000)
      : pendente('densidade_lpp', 'Densidade de LPP adquirida na UTI', 'IRAS e segurança', '/1000 pac-dia', 'Enfermagem'),
    enf
      ? viva('densidade_lpp_total', 'Densidade de LPP total (inclui admissão)', 'IRAS e segurança', '/1000 pac-dia',
          enf.lpp_total, c.pacientes_dia, 1000)
      : pendente('densidade_lpp_total', 'Densidade de LPP total (inclui admissão)', 'IRAS e segurança', '/1000 pac-dia', 'Enfermagem'),
    ...(iras ? [
      viva('di_pneumonia', 'DI pneumonia nosocomial', 'IRAS e segurança', '/1000 pac-dia',
        iras.pneumonia, c.pacientes_dia, 1000),
      viva('di_traqueite', 'DI traqueíte nosocomial', 'IRAS e segurança', '/1000 pac-dia',
        iras.traqueite, c.pacientes_dia, 1000),
      // Denominadores de dispositivo vêm da ENFERMAGEM (CVC-dia / SVD-dia). Se a
      // enfermagem não lançou dispositivos no mês, o denominador é 0 e razao()
      // devolve null: "sem denominador no período", honesto — não é pendência,
      // o numerador existe.
      viva('di_ipcs_total', 'DI IPCS total', 'IRAS e segurança', '/1000 CVC-dia',
        iras.ipcs_lab + iras.ipcs_clinica, enf?.cvc_dia ?? 0, 1000),
      viva('di_ipcs_lab', 'DI IPCS laboratorial', 'IRAS e segurança', '/1000 CVC-dia',
        iras.ipcs_lab, enf?.cvc_dia ?? 0, 1000),
      viva('di_ipcs_clinica', 'DI IPCS clínica', 'IRAS e segurança', '/1000 CVC-dia',
        iras.ipcs_clinica, enf?.cvc_dia ?? 0, 1000),
      viva('di_itu_svd', 'DI ITU-SVD', 'IRAS e segurança', '/1000 SVD-dia',
        iras.itu_svd, enf?.svd_dia ?? 0, 1000),
      viva('di_pav', 'DI PAV', 'IRAS e segurança', '/1000 ventilador-dia',
        iras.pav, c.ventilador_dia, 1000),
      viva('taxa_sepse_choque', 'Taxa de sepse/choque', 'IRAS e segurança', '%',
        iras.sepse_choque, c.admissoes, 100),
    ] : [
      pendente('di_pneumonia', 'DI pneumonia nosocomial', 'IRAS e segurança', '/1000 pac-dia', 'Intensivista'),
      pendente('di_traqueite', 'DI traqueíte nosocomial', 'IRAS e segurança', '/1000 pac-dia', 'Intensivista'),
      pendente('di_ipcs_total', 'DI IPCS total', 'IRAS e segurança', '/1000 CVC-dia', 'Intensivista'),
      pendente('di_ipcs_lab', 'DI IPCS laboratorial', 'IRAS e segurança', '/1000 CVC-dia', 'Intensivista'),
      pendente('di_ipcs_clinica', 'DI IPCS clínica', 'IRAS e segurança', '/1000 CVC-dia', 'Intensivista'),
      pendente('di_itu_svd', 'DI ITU-SVD', 'IRAS e segurança', '/1000 SVD-dia', 'Intensivista'),
      pendente('di_pav', 'DI PAV', 'IRAS e segurança', '/1000 ventilador-dia', 'Intensivista'),
      pendente('taxa_sepse_choque', 'Taxa de sepse/choque', 'IRAS e segurança', '%', 'Intensivista'),
    ]),

    // ── Dispositivos ──────────────────────────────────────────────────────
    enf
      ? viva('utilizacao_cvc', 'Taxa de utilização CVC', 'Dispositivos', '%',
          enf.cvc_dia, c.pacientes_dia, 100)
      : pendente('utilizacao_cvc', 'Taxa de utilização CVC', 'Dispositivos', '%', 'Enfermagem'),
    enf
      ? viva('utilizacao_svd', 'Taxa de utilização SVD', 'Dispositivos', '%',
          enf.svd_dia, c.pacientes_dia, 100)
      : pendente('utilizacao_svd', 'Taxa de utilização SVD', 'Dispositivos', '%', 'Enfermagem'),
    viva('utilizacao_vm', 'Taxa de utilização VM', 'Dispositivos', '%', c.ventilador_dia, c.pacientes_dia, 100),
    viva('hemodialise_100adm', 'Hemodiálise/100 admissões', 'Dispositivos', '/100 adm',
      c.pacientes_hemodialise, c.admissoes, 100),

    // ── Metabólico ────────────────────────────────────────────────────────
    // Derivados do HGT já registrado em Sinais Vitais — nenhum campo novo.
    //
    // DIVERGE DA PLANILHA DE PROPÓSITO: ela divide por "pacientes monitorados"
    // (110 de 118 no exemplo); aqui o denominador é TODO paciente internado.
    // Decisão clínica do Dr. Felipe: só se deixa de aferir HGT em quem não é
    // diabético, não está com dieta restrita e não usa corticoide — gente em quem
    // não se flagraria disglicemia de qualquer jeito. Sem registro = sem
    // disglicemia. Isso também estabiliza o indicador: com denominador de
    // monitorados, monitorar mais gente de baixo risco derruba a prevalência sem
    // nada clínico mudar.
    viva('prev_hipoglicemia', 'Prevalência de hipoglicemia (<70)', 'Metabólico', '%',
      c.pacientes_hipoglicemia, c.pacientes_internados_mes, 100),
    viva('prev_hiperglicemia', 'Prevalência de hiperglicemia (>180)', 'Metabólico', '%',
      c.pacientes_hiperglicemia, c.pacientes_internados_mes, 100),
    viva('disfuncao_glicemica_corticoide', '% disfunção glicêmica + corticoide', 'Metabólico', '%',
      c.pacientes_disfuncao_glicemica_corticoide, c.pacientes_disfuncao_glicemica, 100),

    // ── Fisioterapia respiratória ─────────────────────────────────────────
    // Sem nenhum registro no mês, os 6 ficam pendentes em vez de mostrar 0/0:
    // "não houve fisio registrada" é diferente de "houve e deu zero".
    ...(fisio ? [
      viva('sucesso_desmame', 'Sucesso de desmame da VM', 'Fisioterapia respiratória', '%',
        fisio.extubados_com_sucesso, fisio.tentativas_extubacao, 100),
      // Numerador e denominador restritos às planejadas: reintubar após
      // autoextubação não é falha de julgamento da equipe.
      viva('falha_extubacao', 'Falha de extubação', 'Fisioterapia respiratória', '%',
        fisio.reintubacoes_48h, fisio.extubacoes_planejadas, 100),
      viva('sucesso_desmame_dificil', 'Sucesso no desmame difícil', 'Fisioterapia respiratória', '%',
        fisio.desmame_dificil_sucesso, fisio.pacientes_desmame_dificil, 100),
      viva('vni_evita_iot', 'VNI sucesso p/ evitar IOT', 'Fisioterapia respiratória', '%',
        fisio.vni_evitou_iot, fisio.vni_objetivo_evitar_iot, 100),
      viva('decanulacao_tqt', 'Taxa decanulação TQT na UTI', 'Fisioterapia respiratória', '%',
        fisio.decanulados_na_uti, fisio.traqueo_elegiveis, 100),
      // Denominador é ventilador-dia, que vem da aba Ventilatório.
      viva('vm_protetora', '% VM protetora', 'Fisioterapia respiratória', '%',
        fisio.dias_vm_protetora, c.ventilador_dia, 100),
    ] : [
      pendente('sucesso_desmame', 'Sucesso de desmame da VM', 'Fisioterapia respiratória', '%', 'Fisioterapia'),
      pendente('falha_extubacao', 'Falha de extubação', 'Fisioterapia respiratória', '%', 'Fisioterapia'),
      pendente('sucesso_desmame_dificil', 'Sucesso no desmame difícil', 'Fisioterapia respiratória', '%', 'Fisioterapia'),
      pendente('vni_evita_iot', 'VNI sucesso p/ evitar IOT', 'Fisioterapia respiratória', '%', 'Fisioterapia'),
      pendente('decanulacao_tqt', 'Taxa decanulação TQT na UTI', 'Fisioterapia respiratória', '%', 'Fisioterapia'),
      pendente('vm_protetora', '% VM protetora', 'Fisioterapia respiratória', '%', 'Fisioterapia'),
    ]),

    // ── Nutrição ──────────────────────────────────────────────────────────
    // Onde diverge da planilha, o motivo está marcado FLAUBERT: são as
    // redefinições que ele mandou, incluindo dois erros de denominador que ele
    // mesmo reconheceu (cobertura de TN e elegibilidade para NE).
    ...(nut ? [
      viva('adequacao_np', 'Adequação NP >70%', 'Nutrição', '%',
        nut.dias_np_adequado, nut.dias_np, 100),
      viva('adequacao_ne', 'Adequação NE >70%', 'Nutrição', '%',
        nut.dias_ne_adequado, nut.dias_ne, 100),
      viva('aceitacao_vo', 'Aceitação VO >60%', 'Nutrição', '%',
        nut.dias_vo_adequado, nut.dias_vo, 100),
      viva('prev_deficit_nutricional', 'Prevalência déficit/risco nutricional', 'Nutrição', '%',
        nut.deficit_risco, nut.avaliados, 100),
      // FLAUBERT: o denominador exclui óbito, alta e transferência precoces —
      // quem saiu antes de 24h nunca teve chance de ser avaliado.
      viva('avaliacao_24h', 'Avaliação nutricional ≤24h', 'Nutrição', '%',
        nut.avaliados_ate_24h, nut.admissoes_elegiveis_24h, 100),
      viva('jejum_24h', 'Jejum >24h antes TN', 'Nutrição', '%',
        nut.jejum_maior_24h, nut.elegiveis_tn, 100),
      // FLAUBERT desdobrou diarreia em três indicadores no lugar de um.
      // "Episódio" segue a regra das 48h: um quadro que não resolve por 48h
      // continua sendo o mesmo episódio, por mais dias que dure.
      viva('incidencia_diarreia_ne', 'Incidência de diarreia em NE', 'Nutrição', '%',
        nut.pacientes_diarreia_ne, nut.pacientes_ne, 100),
      viva('densidade_diarreia_ne', 'Densidade de diarreia em NE', 'Nutrição', '/1000 pac-dia',
        nut.episodios_diarreia_ne, nut.dias_ne, 1000),
      viva('dias_diarreia_ne', 'Dias com diarreia em NE', 'Nutrição', '%',
        nut.dias_diarreia_ne, nut.dias_ne, 100),
      viva('incidencia_diarreia_vo', 'Incidência de diarreia em VO', 'Nutrição', '%',
        nut.pacientes_diarreia_vo, nut.pacientes_vo, 100),
      // Constipação é derivada do Balanço Hídrico (72h sem evacuar), não digitada.
      viva('prev_constipacao', 'Prevalência de constipação', 'Nutrição', '%',
        nut.constipados, nut.avaliados_constipacao, 100),
      viva('constipacao_opioide', 'Constipação relac. a opioides', 'Nutrição', '%',
        nut.constipados_opioide, nut.pacientes_opioide, 100),
      // FLAUBERT: "Total recebendo NE" é contador de pacientes-dia.
      viva('uso_ne', 'Uso de NE', 'Nutrição', '%', nut.dias_ne, c.pacientes_dia, 100),
      viva('uso_vo', 'Uso de VO', 'Nutrição', '%', nut.dias_vo, c.pacientes_dia, 100),
      viva('hipoglicemia_tn', 'Hipoglicemia relacionada a TN', 'Nutrição', '%',
        nut.hipoglicemia_tn, nut.elegiveis_tn, 100),
      viva('adequacao_nutricional_vm', 'Adequação nutricional em VM', 'Nutrição', '%',
        nut.dias_vm_nutricao_adequada, nut.dias_vm_com_nutricao, 100),
      // FLAUBERT: denominador é "pacientes avaliados", não pacientes-dia (erro da planilha).
      viva('elegibilidade_ne', 'Elegibilidade para NE', 'Nutrição', '%',
        nut.elegiveis_ne, nut.avaliados, 100),
      // FLAUBERT: denominador é "pacientes elegíveis para início de NE".
      viva('inicio_ne_48h', 'Início de NE em <48h', 'Nutrição', '%',
        nut.ne_iniciada_ate_48h, nut.elegiveis_inicio_ne, 100),
      // FLAUBERT: denominador é "pacientes elegíveis para TN", não pacientes-dia (erro da planilha).
      viva('cobertura_tn', 'Cobertura de terapia nutricional', 'Nutrição', '%',
        nut.elegiveis_tn_receberam, nut.elegiveis_tn, 100),
      // FLAUBERT dividiu adequação proteica em diária e por paciente (média ≥80%).
      viva('adequacao_proteica_diaria', 'Adequação proteica diária ≥80%', 'Nutrição', '%',
        nut.dias_proteica_adequada, nut.dias_elegiveis_tn, 100),
      viva('adequacao_proteica_paciente', 'Adequação proteica por paciente', 'Nutrição', '%',
        nut.pacientes_proteica_media_ok, nut.pacientes_proteica_avaliados, 100),
      viva('interrupcao_tn', 'Interrupção não justif. de TN', 'Nutrição', '%',
        nut.interrupcao_tn, nut.elegiveis_tn, 100),
      viva('intolerancia_gi', 'Intolerância GI grave', 'Nutrição', '%',
        nut.intolerancia_gi, nut.elegiveis_tn, 100),
      viva('constipacao_vm', 'Constipação >72h em VM', 'Nutrição', '%',
        nut.constipacao_vm, nut.dias_vm_com_nutricao, 100),
      viva('discussao_round', 'Discussão nutricional em round', 'Nutrição', '%',
        nut.dias_discutidos_round, c.pacientes_dia, 100),
      // Soma as três vias: mede a adequação da nutrição como um todo.
      viva('adequacao_global', 'Adequação nutricional global', 'Nutrição', '%',
        nut.dias_np_adequado + nut.dias_ne_adequado + nut.dias_vo_adequado,
        nut.dias_np + nut.dias_ne + nut.dias_vo, 100),
    ] : [
      pendente('adequacao_np', 'Adequação NP >70%', 'Nutrição', '%', 'Nutrição'),
      pendente('adequacao_ne', 'Adequação NE >70%', 'Nutrição', '%', 'Nutrição'),
      pendente('aceitacao_vo', 'Aceitação VO >60%', 'Nutrição', '%', 'Nutrição'),
      pendente('prev_deficit_nutricional', 'Prevalência déficit/risco nutricional', 'Nutrição', '%', 'Nutrição'),
      pendente('avaliacao_24h', 'Avaliação nutricional ≤24h', 'Nutrição', '%', 'Nutrição'),
      pendente('jejum_24h', 'Jejum >24h antes TN', 'Nutrição', '%', 'Nutrição'),
      pendente('incidencia_diarreia_ne', 'Incidência de diarreia em NE', 'Nutrição', '%', 'Nutrição'),
      pendente('densidade_diarreia_ne', 'Densidade de diarreia em NE', 'Nutrição', '/1000 pac-dia', 'Nutrição'),
      pendente('dias_diarreia_ne', 'Dias com diarreia em NE', 'Nutrição', '%', 'Nutrição'),
      pendente('incidencia_diarreia_vo', 'Incidência de diarreia em VO', 'Nutrição', '%', 'Nutrição'),
      pendente('prev_constipacao', 'Prevalência de constipação', 'Nutrição', '%', 'Nutrição'),
      pendente('constipacao_opioide', 'Constipação relac. a opioides', 'Nutrição', '%', 'Nutrição'),
      pendente('uso_ne', 'Uso de NE', 'Nutrição', '%', 'Nutrição'),
      pendente('uso_vo', 'Uso de VO', 'Nutrição', '%', 'Nutrição'),
      pendente('hipoglicemia_tn', 'Hipoglicemia relacionada a TN', 'Nutrição', '%', 'Nutrição'),
      pendente('adequacao_nutricional_vm', 'Adequação nutricional em VM', 'Nutrição', '%', 'Nutrição'),
      pendente('elegibilidade_ne', 'Elegibilidade para NE', 'Nutrição', '%', 'Nutrição'),
      pendente('inicio_ne_48h', 'Início de NE em <48h', 'Nutrição', '%', 'Nutrição'),
      pendente('cobertura_tn', 'Cobertura de terapia nutricional', 'Nutrição', '%', 'Nutrição'),
      pendente('adequacao_proteica_diaria', 'Adequação proteica diária ≥80%', 'Nutrição', '%', 'Nutrição'),
      pendente('adequacao_proteica_paciente', 'Adequação proteica por paciente', 'Nutrição', '%', 'Nutrição'),
      pendente('interrupcao_tn', 'Interrupção não justif. de TN', 'Nutrição', '%', 'Nutrição'),
      pendente('intolerancia_gi', 'Intolerância GI grave', 'Nutrição', '%', 'Nutrição'),
      pendente('constipacao_vm', 'Constipação >72h em VM', 'Nutrição', '%', 'Nutrição'),
      pendente('discussao_round', 'Discussão nutricional em round', 'Nutrição', '%', 'Nutrição'),
      pendente('adequacao_global', 'Adequação nutricional global', 'Nutrição', '%', 'Nutrição'),
    ]),
  ]
}

export const CATEGORIAS: Indicador['categoria'][] = [
  'Operacional', 'Mortalidade', 'IRAS e segurança', 'Dispositivos',
  'Metabólico', 'Fisioterapia respiratória', 'Nutrição',
]

/** Leitos-dia do mês: nº de leitos × dias do mês (mês corrente para em hoje). */
export function calcularLeitosDia(mes: Date, leitosAtivos: number, hoje = new Date()): number {
  const ano = mes.getFullYear(), m = mes.getMonth()
  const diasNoMes = new Date(ano, m + 1, 0).getDate()
  const mesmoMes = hoje.getFullYear() === ano && hoje.getMonth() === m
  const dias = mesmoMes ? Math.min(hoje.getDate(), diasNoMes) : diasNoMes
  return dias * leitosAtivos
}
