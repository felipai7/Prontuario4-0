import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import UTIGrid from '@/components/dashboard/UTIGrid'
import { carregarUnidade, COOKIE_UNIDADE } from '@/lib/unidade'
import type { Paciente, Unit } from '@/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  // A planta da UTI vem do banco, não mais de uma constante no código. Buscada
  // aqui no servidor para o mapa de leitos já chegar pronto na primeira pintura.
  const escolhida = (await cookies()).get(COOKIE_UNIDADE)?.value
  const unidade = user ? await carregarUnidade(supabase, user.id, escolhida) : null

  // Só busca a lista de unidades se houver mais de uma para escolher.
  const { data: units } = unidade && unidade.outrasUnidades > 0
    ? await supabase.from('units').select('*').order('name')
    : { data: null }

  // O RLS por unidade já limita o resultado ao que este usuário pode ver — não
  // é preciso (nem seria seguro confiar em) filtrar por unit_id no cliente.
  const { data: pacientes } = await supabase
    .from('pacientes')
    .select('*')
    .eq('ativo', true)
    .order('numero_leito')

  return (
    <UTIGrid
      initialPacientes={(pacientes as Paciente[]) ?? []}
      userEmail={user?.email ?? ''}
      unidade={unidade}
      unidades={(units as Unit[]) ?? []}
    />
  )
}
