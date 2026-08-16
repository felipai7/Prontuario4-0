'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fmtData, fmtDataHora, labelTipoSaida } from '@/lib/utils'

interface PacienteAuditoria {
  id: string
  nome: string
  unit_id: string
  unit_nome: string
  ativo: boolean
  data_internacao: string
  hora_internacao: string
  ultimo_tipo_saida: string | null
}

interface DetalhePeriodo {
  unit_id: string; unit_nome: string; ala_id: string
  conta_indicador: boolean; desde: string; ate: string | null
}
interface DetalheAlta { tipo_saida: string; data_alta: string; unit_id: string }
interface Detalhe { historico: DetalhePeriodo[]; altas: DetalheAlta[] }

interface Props {
  souChefe: boolean
  userEmail: string
  pacientes: PacienteAuditoria[]
  erro?: string | null
}

export default function AuditoriaHome({ souChefe, userEmail, pacientes, erro }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [expandido, setExpandido] = useState<string | null>(null)
  const [detalhes, setDetalhes] = useState<Record<string, Detalhe>>({})
  const [carregandoId, setCarregandoId] = useState<string | null>(null)
  const [filtroUnidade, setFiltroUnidade] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativos' | 'inativos'>('todos')

  const toggle = async (p: PacienteAuditoria) => {
    if (expandido === p.id) { setExpandido(null); return }
    setExpandido(p.id)
    if (detalhes[p.id]) return
    setCarregandoId(p.id)
    const { data } = await supabase.rpc('auditoria_detalhe_paciente', { p_paciente_id: p.id })
    setDetalhes(d => ({ ...d, [p.id]: (data as Detalhe) ?? { historico: [], altas: [] } }))
    setCarregandoId(null)
  }

  if (!souChefe) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md text-center space-y-3">
          <p className="text-4xl">🔒</p>
          <h1 className="text-lg font-bold text-slate-800">Acesso restrito</h1>
          <p className="text-sm text-slate-500">A auditoria geral é restrita ao Médico Intensivista.</p>
          <button onClick={() => router.push('/dashboard')}
            className="mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">
            Voltar ao painel
          </button>
        </div>
      </div>
    )
  }

  const unidades = [...new Set(pacientes.map(p => p.unit_nome))].sort()
  const visiveis = pacientes
    .filter(p => !filtroUnidade || p.unit_nome === filtroUnidade)
    .filter(p => filtroStatus === 'todos' || (filtroStatus === 'ativos') === p.ativo)

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold">🗂️ Auditoria geral</h1>
            <p className="text-indigo-200 text-xs">{userEmail} · {pacientes.length} paciente(s) em todas as unidades</p>
          </div>
          <button onClick={() => router.push('/dashboard')}
            className="text-xs font-medium bg-white/15 hover:bg-white/25 border border-white/25 rounded-lg px-3 py-1.5">
            ← Painel
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-4">
        {erro && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">Erro: {erro}</p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <select value={filtroUnidade} onChange={e => setFiltroUnidade(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">Todas as unidades</option>
            {unidades.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value as typeof filtroStatus)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="todos">Ativos e inativos</option>
            <option value="ativos">Só ativos (internados)</option>
            <option value="inativos">Só inativos (alta/óbito)</option>
          </select>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Paciente</th>
                <th className="text-left px-4 py-2 font-medium">Unidade atual</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Admissão original</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map(p => (
                <>
                  <tr key={p.id} onClick={() => toggle(p)}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-2 font-medium text-slate-800">{p.nome}</td>
                    <td className="px-4 py-2 text-slate-600">{p.unit_nome}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        p.ativo ? 'bg-emerald-50 text-emerald-700'
                          : p.ultimo_tipo_saida === 'obito' ? 'bg-rose-50 text-rose-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {p.ativo ? 'Internado' : labelTipoSaida(p.ultimo_tipo_saida)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      {fmtData(p.data_internacao)} {p.hora_internacao?.substring(0, 5)}
                    </td>
                    <td className="px-4 py-2 text-slate-400">{expandido === p.id ? '▲' : '▼'}</td>
                  </tr>
                  {expandido === p.id && (
                    <tr key={p.id + '-detalhe'} className="bg-slate-50 border-t border-slate-100">
                      <td colSpan={5} className="px-4 py-3 text-xs">
                        {carregandoId === p.id ? (
                          <p className="text-slate-400">Carregando...</p>
                        ) : (
                          <div className="space-y-2">
                            <div>
                              <p className="font-semibold text-slate-500 mb-1">Histórico de unidades</p>
                              {(detalhes[p.id]?.historico ?? []).map((h, i) => (
                                <p key={i} className="text-slate-700">
                                  {h.unit_nome} — {h.ala_id}{!h.conta_indicador && <span className="text-sky-600 ml-1">(trânsito)</span>}
                                  {' · '}{fmtDataHora(h.desde)} → {h.ate ? fmtDataHora(h.ate) : 'atual'}
                                </p>
                              ))}
                            </div>
                            {(detalhes[p.id]?.altas.length ?? 0) > 0 && (
                              <div>
                                <p className="font-semibold text-slate-500 mb-1">Saídas registradas</p>
                                {detalhes[p.id].altas.map((a, i) => (
                                  <p key={i} className="text-slate-700">
                                    {labelTipoSaida(a.tipo_saida)} — {fmtDataHora(a.data_alta)}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {visiveis.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Nenhum paciente encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
