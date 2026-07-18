import type { AlaId } from '@/lib/config'

export interface Paciente {
  id: string
  nome: string
  data_nascimento: string   // YYYY-MM-DD
  plano_saude: string
  data_internacao: string   // YYYY-MM-DD
  hora_internacao: string   // HH:MM
  peso_kg: number | null
  hipoteses: string | null
  ala_id: AlaId
  numero_leito: number
  saps3: number | null
  /** Quando o SAPS 3 foi pontuado — revela pontuação retrospectiva (feita já sabendo o desfecho). */
  saps3_calculado_em: string | null
  paliativo: boolean
  oncologico: boolean
  /** Alta anterior deste mesmo paciente, quando esta internação é uma reinternação. */
  readmissao_de: string | null
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface ResultadoExame {
  nome: string
  valor: string
  unidade: string | null
  referencia: string | null
  alterado: boolean
  direcao: 'alto' | 'baixo' | 'normal' | 'qualitativo'
}

export interface Exame {
  id: string
  paciente_id: string
  tipo_exame: string
  data_exame: string | null
  resultados: ResultadoExame[] | null
  observacoes: string | null
  raw_text: string | null
  nome_arquivo: string | null
  created_at: string
}

export interface PeriodoBalanco {
  id: string
  paciente_id: string
  inicio: string          // ISO timestamp
  fim: string             // ISO timestamp
  turno: 'diurno' | 'noturno'
  horas_periodo: number
  venoso: number
  oral_enteral: number
  agua_endogena: number
  diurese: number
  dialise: number
  febre: number
  evacuacao: number
  dreno: number
  vomitos: number
  sne_sng: number
  ostomia: number
  perdas_insensiveis: number
  /**
   * Checagem dupla da diarreia: médico e nutrição marcam de forma independente.
   * Null = não respondeu (ou não houve evacuação). Divergência entre os dois
   * vira pendência no painel de qualidade.
   */
  diarreica_medico: boolean | null
  diarreica_nutricao: boolean | null
  created_at: string
  updated_at: string
}

export type TipoSaida = 'alta' | 'obito' | 'transferencia'

export interface ResumoAlta {
  id: string
  paciente_id: string | null
  paciente_nome: string
  data_internacao: string
  /** Instante da saída (ISO). Editável: o registro pode ser feito depois do fato. */
  data_alta: string
  /** Null nos registros anteriores à Fase 1 — ficam de fora das contagens. */
  tipo_saida: TipoSaida | null
  paciente_snapshot: Paciente
  exames_snapshot: Exame[] | null
  balanco_snapshot: PeriodoBalanco[] | null
  neuro_snapshot: AvaliacaoNeurologica | null
  ventilatorio_snapshot: SuporteVentilatorio | null
  texto_resumo: string | null
  created_at: string
}

// Calculated values for a period
export interface BalancoCalculado {
  ganhos: number
  perdas: number
  parcial: number
}

export interface SinalVital {
  id: string
  paciente_id: string
  horario: string        // ISO timestamp
  turno: 'diurno' | 'noturno'
  temperatura: number | null
  pas: number | null
  pad: number | null
  pam: number | null
  fc: number | null
  fr: number | null
  sato2: number | null
  hgt: number | null
  observacoes: string | null
  created_at: string
  updated_at: string
}

export interface DVA {
  id: string
  paciente_id: string
  droga: string
  concentracao_valor: number
  concentracao_unidade: string
  concentracao_label: string
  fluxo_ml_h: number
  ativo: boolean
  periodo_id: string | null
  created_at: string
  updated_at: string
}

export interface PeriodoHemodinamica {
  id: string
  paciente_id: string
  turno: 'diurno' | 'noturno'
  data: string            // YYYY-MM-DD
  inicio: string          // ISO timestamp
  fim: string | null      // ISO timestamp, null = turno em aberto
  observacoes: string | null
  criado_em: string
}

export interface ExameImagem {
  id: string
  paciente_id: string
  tipo_exame: string
  data_exame: string | null
  arquivo_path: string | null
  arquivo_nome: string | null
  resumo_ia: string | null
  achados: Record<string, string> | null
  created_at: string
}

export type ToastType = 'success' | 'error' | 'warn'
export interface ToastData { id: string; msg: string; tipo: ToastType }

export type ViaIBP = 'Enteral' | 'Endovenoso'
export type ViaAnticoag = 'Subcutâneo' | 'Endovenoso' | 'Enteral'
export type Objetivo = 'profilatico' | 'terapeutico'
export type DrogaAnticoag = 'Enoxaparina' | 'Heparina Não Fracionada' | 'Apixabana' | 'Rivaroxabana' | 'Outro'

export interface ATB {
  id: string
  paciente_id: string
  droga: string
  data_inicio: string       // YYYY-MM-DD
  dia_inicial: 0 | 1        // 0 = data de início conta como D0; 1 = conta como D1
  dias_previstos: number | null
  foco: string | null
  ativo: boolean
  created_at: string
  updated_at: string
}

export type EscalaNeuro = 'RASS' | 'GLASGOW'
export type Sedativo = 'Propofol' | 'Midazolam' | 'Fentanil' | 'Dexmedetomidina' | 'Cetamina' | 'Outro'

export interface AvaliacaoNeurologica {
  id: string
  paciente_id: string
  data: string                     // YYYY-MM-DD
  turno: 'diurno' | 'noturno'
  escala: EscalaNeuro | null
  rass: number | null              // -5 a +4
  glasgow_ao: number | null        // 1-4
  glasgow_rv: number | null        // 1-5
  glasgow_rm: number | null        // 1-6
  sedacao_em_uso: boolean
  sedativos: Sedativo[] | null
  sedativo_outro: string | null
  despertar_diario: boolean | null
  created_at: string
  updated_at: string
}

export type ModalidadeVentilatoria = 'ar_ambiente' | 'o2_suplementar' | 'ventilacao_mecanica'
export type DispositivoO2 = 'Cateter nasal' | 'Máscara facial' | 'Máscara com reservatório' | 'CNAF' | 'VNI' | 'Outro'
export type ViaAereaVM = 'TOT' | 'TQT'

export interface SuporteVentilatorio {
  id: string
  paciente_id: string
  data: string                     // YYYY-MM-DD
  turno: 'diurno' | 'noturno'
  modalidade: ModalidadeVentilatoria | null
  o2_dispositivo: DispositivoO2 | null
  o2_fluxo_l_min: number | null
  vm_data_inicio: string | null    // YYYY-MM-DD
  vm_via: ViaAereaVM | null
  created_at: string
  updated_at: string
}

export interface Intercorrencia {
  id: string
  paciente_id: string
  horario: string           // ISO timestamp
  descricao: string
  conduta: string | null
  autor_email: string
  created_at: string
}

export interface CuidadosHorizontais {
  id: string
  paciente_id: string
  previsao_alta: string | null   // YYYY-MM-DD

  ibp_em_uso: boolean
  ibp_via: ViaIBP | null
  ibp_dose_valor: number | null
  ibp_dose_unidade: string | null
  ibp_objetivo: Objetivo | null

  anticoag_em_uso: boolean
  anticoag_droga: DrogaAnticoag | null
  anticoag_droga_outro: string | null
  anticoag_via: ViaAnticoag | null
  anticoag_dose_valor: number | null
  anticoag_dose_unidade: string | null
  anticoag_objetivo: Objetivo | null

  corticoide_em_uso: boolean
  opioide_em_uso: boolean

  updated_at: string
}

export interface PendenciaIntensivista {
  id: string
  paciente_id: string
  texto: string
  resolvida: boolean
  criado_em: string
  resolvida_em: string | null
}

export interface RegistroIntensivista {
  id: string
  paciente_id: string
  data: string              // YYYY-MM-DD
  orientacoes_condutas: string
  criado_em: string
  updated_at: string
}

// ── Módulo de Escalas ────────────────────────────────────────────────────────

// Cargo = profissão × nível. Duas dimensões porque enfermeiro/fisio/nutri ainda
// vão ganhar chefes: com enum plano isso viraria uma lista que toda regra
// precisa conhecer; assim, é um update. Ver supabase/cargos.sql.
export type Profissao = 'medico' | 'enfermeiro' | 'fisioterapeuta' | 'nutricionista'
export type Nivel = 'chefe' | 'plantonista'

/** Cargo do usuário logado. */
export interface Cargo {
  profissao: Profissao
  nivel: Nivel
}

// Os helpers de cargo (ehIntensivista, podeEditarModulo, labels) ficam em
// lib/cargos.ts — este arquivo é só de tipos, e é importado com `import type`.

export interface Unit {
  id: string
  name: string
  active: boolean
  created_at: string
}

export interface Staff {
  id: string
  user_id: string | null
  unit_id: string
  full_name: string
  profissao: Profissao
  nivel: Nivel
  active: boolean
  created_at: string
}

export interface ShiftType {
  id: string
  unit_id: string
  name: string
  start_time: string   // HH:MM:SS
  end_time: string     // HH:MM:SS
  duration_hours: number
  active: boolean
  created_at: string
}

export interface PaySettings {
  unit_id: string
  weekday_value: number
  weekend_value: number
  updated_at: string
}

export interface ScheduleTemplateShift {
  id: string
  unit_id: string
  day_number: number
  shift_type_id: string
  staff_id: string
  created_at: string
}

export interface PublishedMonth {
  unit_id: string
  month: string        // YYYY-MM-DD (dia 1)
  published_at: string
  published_by: string | null
}

export type ShiftStatus = 'scheduled' | 'swapped' | 'cancelled'

export interface Shift {
  id: string
  unit_id: string
  shift_type_id: string | null
  staff_id: string | null
  original_staff_id: string | null
  source_template_day: number | null
  date: string         // YYYY-MM-DD
  status: ShiftStatus
  created_by: string | null
  created_at: string
}

export type PaymentStatus = 'pending' | 'paid'

export interface ShiftPayment {
  shift_id: string
  payment_value: number
  payment_status: PaymentStatus
  paid_at: string | null
}

export type SwapStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled'

export interface SwapRequest {
  id: string
  unit_id: string
  shift_id: string
  requester_id: string
  target_staff_id: string
  status: SwapStatus
  reason: string | null
  created_at: string
  resolved_at: string | null
}

export interface AuditoriaIntensivista {
  id: string
  paciente_id: string
  tabela: 'cuidados_horizontais' | 'atbs' | 'pendencias_intensivista' | 'registros_intensivista'
  acao: 'INSERT' | 'UPDATE' | 'DELETE'
  changed_by: string | null
  changed_by_email: string | null
  dados_antigos: Record<string, unknown> | null
  dados_novos: Record<string, unknown> | null
  changed_at: string
}

// ── Indicadores ──────────────────────────────────────────────────────────────

/**
 * Contagens brutas de um mês, vindas da RPC `contagens_mes`.
 * Equivale a uma linha da aba "Dados Mensais" da planilha do Dr. Flaubert —
 * de propósito, para permitir conferência lado a lado.
 * Leitos-dia e nº de leitos não vêm daqui: saem de lib/config.ts.
 */
export interface ContagensMes {
  pacientes_dia: number
  admissoes: number
  saidas: number
  saidas_altas: number
  saidas_obitos: number
  saidas_transferencias: number
  dias_permanencia_saidas: number
  obitos_ate_24h: number
  obitos_apos_24h: number
  obitos_paliativos: number
  saidas_paliativos: number
  obitos_oncologicos: number
  saidas_oncologicos: number
  soma_mortalidade_esperada: number
  saidas_com_saps3: number
  obitos_com_saps3: number
  reinternacoes_48h: number
  reinternacoes_30d: number
  pacientes_internados_mes: number
  ventilador_dia: number
  pacientes_hemodialise: number
  pacientes_hipoglicemia: number
  pacientes_hiperglicemia: number
  pacientes_monitorados_glicemia: number
  pacientes_disfuncao_glicemica: number
  pacientes_disfuncao_glicemica_corticoide: number
}

// ── Fisioterapia ─────────────────────────────────────────────────────────────

export type TipoEventoFisio = 'extubacao' | 'desmame_dificil' | 'vni' | 'traqueostomia'

export interface FisioEvento {
  id: string
  paciente_id: string
  tipo: TipoEventoFisio
  /** Início do episódio. Para VNI, o 1º dia do conjunto de sessões — não uma sessão isolada. */
  data: string              // YYYY-MM-DD
  /** Fim do episódio (VNI). Null = em curso. */
  data_fim: string | null
  /** Extubação programada (não acidental) — denominador da falha de extubação. */
  planejada: boolean | null
  sucesso: boolean | null
  reintubou_48h: boolean | null
  objetivo_evitar_iot: boolean | null
  evitou_iot: boolean | null
  elegivel_decanulacao: boolean | null
  decanulado_na_uti: boolean | null
  observacao: string | null
  criado_em: string
  criado_por: string | null
}

export interface FisioAvaliacaoDiaria {
  id: string
  paciente_id: string
  data: string              // YYYY-MM-DD
  vm_protetora: boolean | null
  observacao: string | null
  criado_em: string
  criado_por: string | null
}

/** Contagens do mês vindas da RPC `contagens_fisio_mes`. */
export interface ContagensFisioMes {
  extubados_com_sucesso: number
  tentativas_extubacao: number
  reintubacoes_48h: number
  extubacoes_planejadas: number
  desmame_dificil_sucesso: number
  pacientes_desmame_dificil: number
  vni_evitou_iot: number
  vni_objetivo_evitar_iot: number
  decanulados_na_uti: number
  traqueo_elegiveis: number
  dias_vm_protetora: number
}

// ── Enfermagem ───────────────────────────────────────────────────────────────

export type TipoDispositivo = 'CVC' | 'SVD'

export interface Dispositivo {
  id: string
  paciente_id: string
  tipo: TipoDispositivo
  data_insercao: string          // YYYY-MM-DD
  /** Null = ainda instalado. O dia da retirada não conta como dia-dispositivo. */
  data_remocao: string | null
  observacao: string | null
  criado_em: string
  criado_por: string | null
}

export type EstagioLPP = '1' | '2' | '3' | '4' | 'Não classificável' | 'Tissular profunda'

export interface LppEvento {
  id: string
  paciente_id: string
  data: string                   // YYYY-MM-DD
  estagio: EstagioLPP
  local: string | null
  /** A densidade de LPP conta só as adquiridas: as de admissão são de outro serviço. */
  adquirida_na_uti: boolean
  observacao: string | null
  criado_em: string
  criado_por: string | null
}

/** Contagens do mês vindas da RPC `contagens_enfermagem_mes`. */
export interface ContagensEnfermagemMes {
  cvc_dia: number
  svd_dia: number
  lpp_adquiridas_uti: number
  lpp_total: number
  /** Dispositivos sem retirada em paciente já saído — retirada esquecida. */
  dispositivos_abertos: number
}

// ── Nutrição ─────────────────────────────────────────────────────────────────

export interface NutricaoAvaliacao {
  id: string
  paciente_id: string
  data_avaliacao: string          // YYYY-MM-DD
  hora_avaliacao: string | null
  risco_nutricional: boolean
  deficit: boolean
  observacao: string | null
  criado_em: string
  criado_por: string | null
}

/**
 * Registro diário. As vias são três porcentagens em vez de um campo "via":
 * o paciente pode estar em NE e VO no mesmo dia. Null = não recebeu por ali.
 */
export interface NutricaoDia {
  id: string
  paciente_id: string
  data: string                    // YYYY-MM-DD
  elegivel_tn: boolean
  elegivel_ne: boolean
  jejum: boolean
  np_pct_meta: number | null
  ne_pct_meta: number | null
  vo_pct_aceitacao: number | null
  proteica_pct: number | null
  intolerancia_gi_grave: boolean
  interrupcao_nao_justificada: boolean
  discutido_round: boolean
  hipoglicemia_relacionada_tn: boolean
  observacao: string | null
  criado_em: string
  criado_por: string | null
}

/** Contagens do mês vindas da RPC `contagens_nutricao_mes`. */
export interface ContagensNutricaoMes {
  avaliados: number
  avaliados_ate_24h: number
  admissoes_elegiveis_24h: number
  deficit_risco: number
  elegiveis_ne: number
  elegiveis_tn: number
  elegiveis_tn_receberam: number
  dias_np: number
  dias_ne: number
  dias_vo: number
  dias_np_adequado: number
  dias_ne_adequado: number
  dias_vo_adequado: number
  dias_elegiveis_tn: number
  dias_proteica_adequada: number
  pacientes_proteica_media_ok: number
  pacientes_proteica_avaliados: number
  dias_vm_com_nutricao: number
  dias_vm_nutricao_adequada: number
  jejum_maior_24h: number
  ne_iniciada_ate_48h: number
  elegiveis_inicio_ne: number
  pacientes_ne: number
  pacientes_vo: number
  pacientes_diarreia_ne: number
  pacientes_diarreia_vo: number
  episodios_diarreia_ne: number
  dias_diarreia_ne: number
  constipados: number
  avaliados_constipacao: number
  constipados_opioide: number
  pacientes_opioide: number
  constipacao_vm: number
  intolerancia_gi: number
  interrupcao_tn: number
  hipoglicemia_tn: number
  dias_discutidos_round: number
  /** Médico e nutrição discordaram sobre a evacuação ser diarreica. */
  divergencias_diarreia: number
}

/**
 * Qualidade do dado que sustenta os indicadores do mês (RPC `qualidade_mes`).
 * Os três grupos têm naturezas diferentes e não devem ser misturados na tela —
 * ver o comentário em supabase/qualidade.sql.
 */
export interface QualidadeMes {
  // Pendências: obrigatório sem exceção clínica.
  pacientes_ativos_sem_saps3: number
  saidas_sem_saps3: number
  saidas_sem_tipo: number
  // Contradições: o app sabe que o dado deveria existir.
  corticoide_sem_hgt: number
  // Cobertura: fato, sem juízo.
  saps3_ate_24h: number
  saps3_pontuados: number
  pacientes_com_hgt: number
  pacientes_internados: number
  pacientes_dia_com_balanco: number
  pacientes_dia: number
}

export type CategoriaIndicador =
  | 'Operacional' | 'Mortalidade' | 'IRAS e segurança' | 'Dispositivos'
  | 'Nutrição' | 'Metabólico' | 'Fisioterapia respiratória'

export type UnidadeIndicador = '%' | 'razão' | 'dias' | 'saídas/leito' | '/1000 pac-dia'
  | '/1000 CVC-dia' | '/1000 SVD-dia' | '/1000 ventilador-dia' | '/100 adm'

/** Módulo que ainda precisa ser construído para o indicador sair do "pendente". */
export type ModuloPendente = 'Enfermagem' | 'Fisioterapia' | 'Nutrição' | 'Intensivista'

export interface Indicador {
  id: string
  nome: string
  categoria: CategoriaIndicador
  unidade: UnidadeIndicador
  /** null = não calculável ainda (aguarda módulo) ou denominador zero. */
  valor: number | null
  numerador: number | null
  denominador: number | null
  /** Preenchido quando o dado de origem ainda não é coletado. */
  aguarda?: ModuloPendente
}

export interface ScheduleTemplateAudit {
  id: string
  unit_id: string
  day_number: number
  shift_type_id: string | null
  old_staff_id: string | null
  new_staff_id: string | null
  changed_by: string | null
  changed_at: string
}
