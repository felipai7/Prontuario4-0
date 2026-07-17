// Regras de cargo: quem é quem, e quem edita o quê.
//
// O cargo tem duas dimensões (ver supabase/cargos.sql):
//   profissao: medico | enfermeiro | fisioterapeuta | nutricionista
//   nivel:     chefe  | plantonista
//
// Regra de edição no prontuário:
//   • Médico Intensivista (medico + chefe) edita tudo — é o chefe da unidade.
//   • Todos os demais veem tudo e editam apenas a aba da própria profissão.
//
// Sem cargo cadastrado, a pessoa cai em Médico Plantonista: é o cargo mais
// comum e o menos permissivo entre os que já usam o app hoje.

import type { Cargo, Profissao } from '@/types'

export const CARGO_PADRAO: Cargo = { profissao: 'medico', nivel: 'plantonista' }

/** Médico + chefe = Médico Intensivista: manda na unidade e edita tudo. */
export function ehIntensivista(c: Cargo | null | undefined): boolean {
  return c?.profissao === 'medico' && c.nivel === 'chefe'
}

/**
 * Quem pode editar um módulo.
 *
 * `exigeChefe` existe porque a profissão sozinha não separa os dois módulos
 * médicos: ambos são de médico, mas só o intensivista edita o módulo dele.
 */
export function podeEditarModulo(
  cargo: Cargo | null | undefined,
  modulo: { profissaoDona: Profissao; exigeChefe?: boolean },
): boolean {
  const c = cargo ?? CARGO_PADRAO
  if (ehIntensivista(c)) return true
  if (c.profissao !== modulo.profissaoDona) return false
  return modulo.exigeChefe ? c.nivel === 'chefe' : true
}

const LABEL_CARGO: Record<Profissao, Record<Cargo['nivel'], string>> = {
  medico:         { chefe: '🎖️ Médico Intensivista',   plantonista: '🩺 Médico Plantonista' },
  enfermeiro:     { chefe: '🎖️ Enfermeiro Chefe',      plantonista: '💉 Enfermeiro' },
  fisioterapeuta: { chefe: '🎖️ Fisioterapeuta Chefe',  plantonista: '🫁 Fisioterapeuta' },
  nutricionista:  { chefe: '🎖️ Nutricionista Chefe',   plantonista: '🥗 Nutricionista' },
}

export function labelCargo(c: Cargo): string {
  return LABEL_CARGO[c.profissao][c.nivel]
}

export const PROFISSOES: { id: Profissao; label: string }[] = [
  { id: 'medico',         label: 'Médico' },
  { id: 'enfermeiro',     label: 'Enfermeiro' },
  { id: 'fisioterapeuta', label: 'Fisioterapeuta' },
  { id: 'nutricionista',  label: 'Nutricionista' },
]

/**
 * As escalas hoje são só dos médicos — o mesmo recorte que `is_chefe` faz no
 * banco. Sem isso, nutricionistas e fisios apareceriam nos seletores de plantão.
 */
export function apenasMedicos<T extends { profissao: Profissao }>(staff: T[]): T[] {
  return staff.filter(s => s.profissao === 'medico')
}
