import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import IndicadoresHome from '@/components/indicadores/IndicadoresHome'
import type { Staff } from '@/types'

export const dynamic = 'force-dynamic'

export default async function IndicadoresPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Indicadores são dado de gestão: só o chefe (Médico Intensivista) enxerga.
  const { data: myStaff } = await supabase.from('staff').select('*').eq('user_id', user.id)
  const souChefe = ((myStaff as Staff[]) ?? []).some(s => s.role === 'chefe' && s.active)

  return <IndicadoresHome souChefe={souChefe} userEmail={user.email ?? ''} />
}
