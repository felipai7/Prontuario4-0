// Configuração de alas, leitos e planos — fonte única para todo o app.
//
// ATENÇÃO: o banco espelha os ids de ala numa check constraint
// (supabase/schema.sql: check (ala_id in ('uti-01', 'uti-02'))).
// Ao adicionar/renomear uma ala aqui, atualize também a constraint no banco.

export const ALAS = [
  { id: 'uti-01', nome: 'UTI 01', leitos: Array.from({ length: 9 },  (_, i) => i + 1)  },
  { id: 'uti-02', nome: 'UTI 02', leitos: Array.from({ length: 10 }, (_, i) => i + 10) },
] as const

export type AlaId = (typeof ALAS)[number]['id']

export const ALAS_MAP: Record<AlaId, string> =
  Object.fromEntries(ALAS.map(a => [a.id, a.nome])) as Record<AlaId, string>

export const PLANOS = ['IPASGO', 'Unimed', 'Particular', 'Bradesco', 'Outros']

// Listas de sugestão para os campos de droga/foco de ATB (Combobox) — o
// campo aceita digitação livre, então estas listas são só atalhos, não um enum.
export const ATBS_SUGERIDOS = [
  'Amicacina', 'Amoxicilina + Clavulanato', 'Ampicilina', 'Ampicilina + Sulbactam',
  'Anfotericina B', 'Azitromicina', 'Aztreonam', 'Caspofungina', 'Cefalexina',
  'Cefazolina', 'Cefepime', 'Ceftazidima', 'Ceftazidima + Avibactam', 'Ceftriaxona',
  'Ceftolozano + Tazobactam', 'Ciprofloxacino', 'Claritromicina', 'Clindamicina',
  'Colistina', 'Daptomicina', 'Doxiciclina', 'Ertapenem', 'Fluconazol',
  'Gentamicina', 'Levofloxacino', 'Linezolida', 'Meropenem', 'Meropenem + Vaborbactam',
  'Metronidazol', 'Micafungina', 'Oxacilina', 'Piperacilina + Tazobactam',
  'Polimixina B', 'Sulfametoxazol + Trimetoprima', 'Teicoplanina', 'Tigeciclina',
  'Vancomicina', 'Voriconazol',
]

export const FOCOS_INFECCIOSOS = [
  'Urinário', 'Pulmonar', 'Abdominal', 'Cutâneo', 'Pele e Partes Moles',
  'Sistema Nervoso Central', 'Otológico', 'Seios da Face', 'Ósseo', 'Articular',
  'Cirúrgico', 'Corrente Sanguínea / Cateter', 'Endocárdico', 'Ginecológico/Pélvico',
]
