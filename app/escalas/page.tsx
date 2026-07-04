import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import EscalasHome from '@/components/escalas/EscalasHome'
import type { Unit, Staff } from '@/types'

export const dynamic = 'force-dynamic'

export default async function EscalasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: units } = await supabase.from('units').select('*').order('name')
  const { data: myStaff } = await supabase.from('staff').select('*').eq('user_id', user.id)

  return (
    <EscalasHome
      units={(units as Unit[]) ?? []}
      myStaff={(myStaff as Staff[]) ?? []}
      userEmail={user.email ?? ''}
    />
  )
}
