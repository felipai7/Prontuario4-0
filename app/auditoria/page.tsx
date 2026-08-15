import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AuditoriaHome from '@/components/auditoria/AuditoriaHome'
import { ehIntensivista } from '@/lib/cargos'
import type { Staff } from '@/types'

export const dynamic = 'force-dynamic'

interface PacienteAuditoria {
  id: string
  nome: string
  unit_id: string
  unit_nome: string
  ativo: boolean
  data_internacao: string
  hora_internacao: string
}

/**
 * Auditoria geral (todos os pacientes/unidades) — só o chefe. Mesmo padrão
 * de proteção-por-UI que /indicadores: a RPC auditoria_pacientes() ignora
 * RLS de propósito (mesmo modelo de confiança de contagens_mes), então quem
 * decide quem chega aqui é esta página, não o banco.
 */
export default async function AuditoriaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: myStaff } = await supabase.from('staff').select('*').eq('user_id', user.id)
  const souChefe = ((myStaff as Staff[]) ?? []).some(s => s.active && ehIntensivista(s))

  if (!souChefe) {
    return <AuditoriaHome souChefe={false} userEmail={user.email ?? ''} pacientes={[]} />
  }

  const { data, error } = await supabase.rpc('auditoria_pacientes')

  return (
    <AuditoriaHome
      souChefe
      userEmail={user.email ?? ''}
      pacientes={(data as PacienteAuditoria[]) ?? []}
      erro={error?.message ?? null}
    />
  )
}
