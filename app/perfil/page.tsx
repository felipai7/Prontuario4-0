import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MeuPerfil from '@/components/perfil/MeuPerfil'
import type { Profissao, Nivel } from '@/types'

export const dynamic = 'force-dynamic'

interface StaffUnidadeRow {
  unit_id: string
  full_name: string
  profissao: Profissao
  nivel: Nivel
  units: { name: string } | { name: string }[] | null
}

/**
 * Autoperfil: nome e senha, editáveis pela própria pessoa — hoje só um chefe
 * consegue editar `staff.full_name` (RLS de escrita é 100% is_chefe). As
 * duas RPCs usadas aqui (atualizar_meu_nome, e supabase.auth.updateUser para
 * senha) são o caminho estreito que evita abrir INSERT/UPDATE geral em
 * `staff` — ver supabase/perfil_autoatendimento.sql.
 */
export default async function PerfilPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('staff')
    .select('unit_id, full_name, profissao, nivel, units(name)')
    .eq('user_id', user.id)
    .eq('active', true)
    .order('created_at')

  const minhasUnidades = ((data as StaffUnidadeRow[]) ?? []).map(s => {
    const u = Array.isArray(s.units) ? s.units[0] : s.units
    return {
      unitId: s.unit_id,
      unidadeNome: u?.name ?? 'Unidade',
      profissao: s.profissao,
      nivel: s.nivel,
    }
  })

  return (
    <MeuPerfil
      userEmail={user.email ?? ''}
      nomeAtual={data?.[0]?.full_name ?? ''}
      minhasUnidades={minhasUnidades}
    />
  )
}
