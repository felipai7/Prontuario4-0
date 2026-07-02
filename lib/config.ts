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
