'use client'
import { fmtNum } from '@/lib/utils'
import type { QualidadeMes } from '@/types'

interface Props {
  q: QualidadeMes
  /**
   * `pacientes_ativos_sem_saps3` é "agora", não do mês. Mostrá-lo ao olhar um
   * mês passado seria confundir o leitor com um paciente que está internado hoje.
   */
  mesCorrente: boolean
}

/**
 * Os três grupos são propositalmente diferentes na tela, porque são diferentes
 * na natureza:
 *
 *   Pendência   — some quando resolvida. Não existe paciente que dispense
 *                 SAPS 3 ou tipo de saída.
 *   Contradição — o app sabe que o dado deveria existir.
 *   Cobertura   — fato, sem juízo. Não aferir HGT em paciente de baixo risco é
 *                 decisão clínica correta. Se o painel acusasse isso todo dia,
 *                 a equipe aprenderia a ignorá-lo — justamente antes do dia em
 *                 que ele estivesse certo.
 */
export default function PainelQualidade({ q, mesCorrente }: Props) {
  const pendencias = [
    mesCorrente && q.pacientes_ativos_sem_saps3 && {
      texto: `${q.pacientes_ativos_sem_saps3} paciente(s) internado(s) agora sem SAPS-3`,
      porque: 'Sem o escore, a saída não pode ser registrada e o paciente fica fora do SMR.',
    },
    q.saidas_sem_saps3 && {
      texto: `${q.saidas_sem_saps3} saída(s) do mês sem SAPS-3`,
      porque: 'Ficam fora do SMR: observado e esperado precisam vir da mesma população.',
    },
    q.saidas_sem_tipo && {
      texto: `${q.saidas_sem_tipo} saída(s) sem tipo (alta/óbito/transferência)`,
      porque: 'São invisíveis para todo o bloco de mortalidade — não entram nem como alta.',
    },
  ].filter(Boolean) as { texto: string; porque: string }[]

  const contradicoes = [
    q.corticoide_sem_hgt && {
      texto: `${q.corticoide_sem_hgt} paciente(s) em corticoide sem nenhum HGT`,
      porque: 'Corticoide eleva glicemia: sem aferição, uma disglicemia passaria batida.',
    },
  ].filter(Boolean) as { texto: string; porque: string }[]

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div>
        <h2 className="font-semibold text-slate-700 text-sm">🔎 Qualidade do dado</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Um indicador vale o que vale a cobertura dele.
        </p>
      </div>

      {pendencias.length === 0 && contradicoes.length === 0 ? (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          ✅ Nenhuma pendência no mês.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {pendencias.map(p => <Item key={p.texto} {...p} tom="erro" />)}
          {contradicoes.map(c => <Item key={c.texto} {...c} tom="aviso" />)}
        </ul>
      )}

      <div className="space-y-2 pt-1">
        <p className="text-xs font-medium text-slate-500">Cobertura no mês</p>
        <Barra label="SAPS-3 pontuado nas primeiras 24h"
          n={q.saps3_ate_24h} d={q.saps3_pontuados}
          nota="Fora dessa janela, o escore é dado já sabendo o desfecho — e o SMR perde sentido." />
        <Barra label="Pacientes com algum HGT"
          n={q.pacientes_com_hgt} d={q.pacientes_internados}
          nota="Não aferir em paciente de baixo risco é decisão clínica, não falha." />
        <Barra label="Pacientes-dia com balanço hídrico"
          n={q.pacientes_dia_com_balanco} d={q.pacientes_dia} />
      </div>
    </section>
  )
}

function Item({ texto, porque, tom }: { texto: string; porque: string; tom: 'erro' | 'aviso' }) {
  const cor = tom === 'erro'
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-900'
  return (
    <li className={`border rounded-lg px-3 py-2 ${cor}`}>
      <p className="text-sm font-medium">{tom === 'erro' ? '⚠️' : '🔸'} {texto}</p>
      <p className="text-xs opacity-80 mt-0.5">{porque}</p>
    </li>
  )
}

function Barra({ label, n, d, nota }: { label: string; n: number; d: number; nota?: string }) {
  const pct = d === 0 ? null : (n / d) * 100
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-slate-600">{label}</p>
        <p className="text-xs font-semibold text-slate-700 whitespace-nowrap">
          {pct == null ? '—' : `${fmtNum(pct, 0)}%`}
          <span className="font-normal text-slate-400"> · {n}/{d}</span>
        </p>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
        <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${pct ?? 0}%` }} />
      </div>
      {nota && <p className="text-[11px] text-slate-400 mt-0.5">{nota}</p>}
    </div>
  )
}
