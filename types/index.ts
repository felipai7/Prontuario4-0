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
  paliativo: boolean
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
  created_at: string
  updated_at: string
}

export interface ResumoAlta {
  id: string
  paciente_nome: string
  data_internacao: string
  data_alta: string
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

export type StaffRole = 'plantonista' | 'chefe'

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
  role: StaffRole
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
