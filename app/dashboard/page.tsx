import { createClient } from '@/lib/supabase/server'
import UTIGrid from '@/components/dashboard/UTIGrid'
import type { Paciente } from '@/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const { data: pacientes } = await supabase
    .from('pacientes')
    .select('*')
    .eq('ativo', true)
    .order('numero_leito')

  return (
    <UTIGrid
      initialPacientes={(pacientes as Paciente[]) ?? []}
      userEmail={user?.email ?? ''}
    />
  )
}
