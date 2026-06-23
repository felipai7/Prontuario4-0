export interface Paciente {
  id: string
  nome: string
  data_nascimento: string   // YYYY-MM-DD
  plano_saude: string
  data_internacao: string   // YYYY-MM-DD
  hora_internacao: string   // HH:MM
  peso_kg: number | null
  hipoteses: string | null
  ala_id: 'uti-01' | 'uti-02'
  numero_leito: number
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
  created_at: string
  updated_at: string
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
