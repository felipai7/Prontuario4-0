import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import IndicadoresHome from '@/components/indicadores/IndicadoresHome'
import { calcularLeitosDia } from '@/lib/indicadores/formulas'
import { ehIntensivista } from '@/lib/cargos'
import { ALAS } from '@/lib/config'
import type {
  Staff, ContagensMes, QualidadeMes, ContagensFisioMes, ContagensEnfermagemMes,
} from '@/types'

export const dynamic = 'force-dynamic'

const LEITOS_ATIVOS = ALAS.reduce((n, a) => n + a.leitos.length, 0)

/**
 * Hoje no fuso de Brasília, e não no do servidor.
 *
 * A Vercel roda em UTC: perto da meia-noite, `new Date()` no servidor já estaria
 * no dia seguinte enquanto a UTI ainda está no dia anterior — e a taxa de
 * ocupação do mês corrente sairia com um dia a mais.
 */
function hojeEmBrasilia(): { ano: number; mes: number; dia: number } {
  const [ano, mes, dia] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number)
  return { ano, mes, dia }
}

/** Lê `?mes=AAAA-MM`. Fora do formato ou fora de faixa, cai no mês corrente. */
function mesDaUrl(valor: string | undefined, hoje: { ano: number; mes: number }) {
  const m = /^(\d{4})-(\d{2})$/.exec(valor ?? '')
  if (!m) return { ano: hoje.ano, mes: hoje.mes }
  const ano = Number(m[1]), mes = Number(m[2])
  if (mes < 1 || mes > 12 || ano < 2000 || ano > hoje.ano + 1) return { ano: hoje.ano, mes: hoje.mes }
  return { ano, mes }
}

/** As RPCs devolvem uma linha só. */
function uma<T>(d: unknown): T | null {
  return ((Array.isArray(d) ? d[0] : d) as T) ?? null
}

/**
 * Um módulo sem nenhum registro no mês fica pendente em vez de mostrar 0/0:
 * "não houve fisioterapia" é diferente de "houve e deu zero".
 */
function houveRegistro<T extends object>(o: T | null): T | null {
  return o != null && Object.values(o).some(v => Number(v) > 0) ? o : null
}

export default async function IndicadoresPage(
  { searchParams }: { searchParams: { mes?: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Indicadores são dado de gestão: só o Médico Intensivista enxerga.
  const { data: myStaff } = await supabase.from('staff').select('*').eq('user_id', user.id)
  const souChefe = ((myStaff as Staff[]) ?? []).some(s => s.active && ehIntensivista(s))

  const hoje = hojeEmBrasilia()
  const { ano, mes } = mesDaUrl(searchParams.mes, hoje)

  if (!souChefe) {
    return <IndicadoresHome souChefe={false} userEmail={user.email ?? ''}
      ano={ano} mes={mes} anoAtual={hoje.ano} mesCorrente={false}
      contagens={null} qualidade={null} fisio={null} enfermagem={null}
      leitosDia={0} leitosAtivos={LEITOS_ATIVOS} erro={null} />
  }

  // Os números são buscados AQUI, no servidor, e não no navegador. Assim a
  // página já chega pronta: nada de "Carregando..." piscando, uma viagem em vez
  // de duas, e — o que motivou a mudança — servidor e cliente renderizam a mesma
  // coisa, sem o React descartar o HTML por divergência na hidratação.
  const pMes = `${ano}-${String(mes).padStart(2, '0')}-01`
  const [contRes, qualRes, fisioRes, enfRes] = await Promise.all([
    supabase.rpc('contagens_mes',            { p_mes: pMes }),
    supabase.rpc('qualidade_mes',            { p_mes: pMes }),
    supabase.rpc('contagens_fisio_mes',      { p_mes: pMes }),
    supabase.rpc('contagens_enfermagem_mes', { p_mes: pMes }),
  ])

  const mesCorrente = ano === hoje.ano && mes === hoje.mes

  return (
    <IndicadoresHome
      souChefe
      userEmail={user.email ?? ''}
      ano={ano}
      mes={mes}
      anoAtual={hoje.ano}
      mesCorrente={mesCorrente}
      contagens={uma<ContagensMes>(contRes.data)}
      // Qualidade e módulos são acessórios: se falharem, os indicadores ainda
      // valem a visita.
      qualidade={qualRes.error ? null : uma<QualidadeMes>(qualRes.data)}
      fisio={fisioRes.error ? null : houveRegistro(uma<ContagensFisioMes>(fisioRes.data))}
      enfermagem={enfRes.error ? null : houveRegistro(uma<ContagensEnfermagemMes>(enfRes.data))}
      leitosDia={calcularLeitosDia(
        new Date(ano, mes - 1, 1), LEITOS_ATIVOS, new Date(hoje.ano, hoje.mes - 1, hoje.dia))}
      leitosAtivos={LEITOS_ATIVOS}
      erro={contRes.error?.message ?? null}
    />
  )
}
