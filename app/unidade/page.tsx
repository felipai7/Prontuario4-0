import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import UnidadeAdmin from '@/components/unidade/UnidadeAdmin'
import { ehIntensivista } from '@/lib/cargos'
import type { Staff, Unit } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * Configuração da unidade: alas, leitos e o cadastro de novas unidades.
 *
 * É o que tornou o multi-unidade autossuficiente. Enquanto a planta morava em
 * lib/config.ts, atender um cliente novo era tarefa de programador; aqui o
 * próprio intensivista faz.
 */
export default async function UnidadePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: myStaff } = await supabase.from('staff').select('*').eq('user_id', user.id)
  const staff = (myStaff as Staff[]) ?? []
  const souChefe = staff.some(s => s.active && ehIntensivista(s))

  // O RLS já limita `units` às minhas unidades — a lista nunca vaza cliente alheio.
  const { data: units } = await supabase.from('units').select('*').order('name')

  return (
    <UnidadeAdmin
      souChefe={souChefe}
      userEmail={user.email ?? ''}
      units={(units as Unit[]) ?? []}
      meuNome={staff.find(s => s.active)?.full_name ?? ''}
    />
  )
}
