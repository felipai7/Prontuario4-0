'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Shift, PublishedMonth, Staff, ShiftType, ToastData } from '@/types'

interface Props {
  unitId: string
  staffList: Staff[]
  shiftTypesList: ShiftType[]
  souChefe: boolean
  /** Destaca os plantões desta pessoa na grade — null quando não está na equipe. */
  meuStaffId: string | null
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

interface PreviewRow {
  pub_date: string
  day_number: number
  shift_type_id: string
  shift_type_name: string
  staff_names: string[]
  vagas: number
}

function primeiroDiaMes(ref: Date): string {
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtMesAno(ref: Date): string {
  return ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function fmtDiaSemana(dataStr: string): string {
  const d = new Date(dataStr + 'T12:00:00')
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Grade do mês em semanas de 7 dias, com null nas células vazias antes/depois do mês. */
function celulasDoMes(ref: Date): (string | null)[] {
  const ano = ref.getFullYear(), mes = ref.getMonth()
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay()
  const totalDias = new Date(ano, mes + 1, 0).getDate()
  const celulas: (string | null)[] = []
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null)
  for (let d = 1; d <= totalDias; d++) celulas.push(`${ano}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  while (celulas.length % 7 !== 0) celulas.push(null)
  return celulas
}

export default function MonthScheduleView({ unitId, staffList, shiftTypesList, souChefe, meuStaffId, showToast }: Props) {
  const supabase = createClient()
  const [ref, setRef] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [shifts, setShifts] = useState<Shift[]>([])
  const [publicado, setPublicado] = useState<PublishedMonth | null>(null)
  const [loading, setLoading] = useState(false)

  const [revisando, setRevisando] = useState(false)
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [publicando, setPublicando] = useState(false)

  const staffMap = useMemo(() => Object.fromEntries(staffList.map(s => [s.id, s.full_name])), [staffList])
  const staffAtivo = useMemo(() => staffList.filter(s => s.active), [staffList])
  const shiftTypeMap = useMemo(() => Object.fromEntries(shiftTypesList.map(t => [t.id, t.name])), [shiftTypesList])
  const shiftTypeStartMap = useMemo(() => Object.fromEntries(shiftTypesList.map(t => [t.id, t.start_time])), [shiftTypesList])
  const shiftsPorDia = useMemo(() => {
    const m = new Map<string, Shift[]>()
    for (const s of shifts) m.set(s.date, [...(m.get(s.date) ?? []), s])
    // Diurno acima de Noturno: ordena pelo horário de início do tipo de turno —
    // a query só ordena por data, então sem isso os dois ficam intercalados na
    // ordem em que o banco devolveu.
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const inicioA = a.shift_type_id ? shiftTypeStartMap[a.shift_type_id] ?? '' : ''
        const inicioB = b.shift_type_id ? shiftTypeStartMap[b.shift_type_id] ?? '' : ''
        return inicioA.localeCompare(inicioB)
      })
    }
    return m
  }, [shifts, shiftTypeStartMap])

  const load = async () => {
    if (!unitId) return
    setLoading(true)
    const mesInicio = primeiroDiaMes(ref)
    const proxMes = new Date(ref.getFullYear(), ref.getMonth() + 1, 1)
    const mesFim = primeiroDiaMes(proxMes)

    const [{ data: shiftsData, error: shiftsErr }, { data: pubData, error: pubErr }] = await Promise.all([
      supabase.from('shifts').select('*').eq('unit_id', unitId).gte('date', mesInicio).lt('date', mesFim).order('date'),
      supabase.from('published_months').select('*').eq('unit_id', unitId).eq('month', mesInicio).maybeSingle(),
    ])
    setLoading(false)
    if (shiftsErr) { showToast('Erro ao carregar escala: ' + shiftsErr.message, 'error'); return }
    if (pubErr) { showToast('Erro ao carregar publicação: ' + pubErr.message, 'error'); return }
    setShifts((shiftsData as Shift[]) ?? [])
    setPublicado((pubData as PublishedMonth | null) ?? null)
  }

  useEffect(() => { load(); setRevisando(false); setPreview([]) }, [unitId, ref])

  const handleRevisar = async () => {
    setLoadingPreview(true)
    const { data, error } = await supabase.rpc('preview_publish_month', { p_unit_id: unitId, p_month: primeiroDiaMes(ref) })
    setLoadingPreview(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    setPreview((data as PreviewRow[]) ?? [])
    setRevisando(true)
  }

  const temTurnoVazio = preview.some(p => p.vagas === 0)

  const handlePublicar = async () => {
    setPublicando(true)
    const { error } = await supabase.rpc('publish_month', { p_unit_id: unitId, p_month: primeiroDiaMes(ref) })
    setPublicando(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Mês publicado!')
    setRevisando(false); setPreview([])
    load()
  }

  const handleAssignStaff = async (shift: Shift, newStaffId: string) => {
    if (!newStaffId || newStaffId === shift.staff_id) return
    const novoStatus = newStaffId === shift.original_staff_id ? 'scheduled' : 'swapped'
    const { error } = await supabase.from('shifts').update({ staff_id: newStaffId, status: novoStatus }).eq('id', shift.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Plantão atualizado!')
    load()
  }

  // ── Passar plantão direto da grade: clicar no próprio nome num dia X ───────
  // Atalho pro mesmo fluxo que já existe em SwapRequests.tsx (aba separada),
  // só que já com o plantão daquele dia pré-escolhido — sem precisar navegar
  // e escolher o plantão de novo numa lista.
  const [passarPlantaoShift, setPassarPlantaoShift] = useState<Shift | null>(null)
  const [enviandoPara,       setEnviandoPara]       = useState<string | null>(null)
  const colegas = useMemo(() => staffAtivo.filter(s => s.id !== meuStaffId), [staffAtivo, meuStaffId])

  const handleEnviarPlantao = async (targetStaffId: string) => {
    if (!meuStaffId || !passarPlantaoShift) return
    setEnviandoPara(targetStaffId)
    const { error } = await supabase.from('swap_requests').insert({
      unit_id: unitId, shift_id: passarPlantaoShift.id, requester_id: meuStaffId,
      target_staff_id: targetStaffId,
    })
    setEnviandoPara(null)
    if (error) { showToast('Erro ao solicitar troca: ' + error.message, 'error'); return }
    showToast(`Troca solicitada para ${staffMap[targetStaffId] ?? 'colega'} — aguardando resposta.`)
    setPassarPlantaoShift(null)
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-slate-700">📆 Escala publicada</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() - 1, 1))}
            className="text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1 text-sm">←</button>
          <span className="text-sm font-medium text-slate-700 capitalize min-w-[9rem] text-center">{fmtMesAno(ref)}</span>
          <button onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() + 1, 1))}
            className="text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1 text-sm">→</button>
        </div>
      </div>

      {meuStaffId && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-indigo-100 border border-indigo-400 align-middle"></span>
          Em destaque: seus plantões — clique no seu nome num dia pra passar o plantão pra um colega
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {publicado ? (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 inline-block">
            ✓ Mês publicado
          </p>
        ) : (
          <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 inline-block">
            Mês ainda não publicado
          </p>
        )}

        {souChefe && !publicado && !revisando && (
          <button onClick={handleRevisar} disabled={loadingPreview}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
            {loadingPreview ? 'Carregando...' : '🔍 Revisar publicação'}
          </button>
        )}
      </div>

      {revisando && (
        <div className="bg-slate-50 rounded-lg p-3 space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Prévia da publicação — {fmtMesAno(ref)}</p>

          {temTurnoVazio && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              ⚠️ Há turnos sem nenhum profissional atribuído no mês padrão. Preencha o editor do mês padrão antes de publicar.
            </p>
          )}

          <ul className="space-y-1 max-h-72 overflow-y-auto">
            {preview.map((p, i) => {
              const bg = p.vagas === 0 ? 'bg-red-50' : p.vagas === 1 ? 'bg-amber-50' : 'bg-emerald-50'
              return (
                <li key={i} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs ${bg}`}>
                  <span className="text-slate-500 capitalize">{fmtDiaSemana(p.pub_date)}</span>
                  <span className="text-slate-700">{p.shift_type_name}</span>
                  <span className="font-medium text-slate-800">{p.staff_names.length ? p.staff_names.join(' / ') : '—'}</span>
                </li>
              )
            })}
          </ul>

          <div className="flex justify-end gap-2">
            <button onClick={() => { setRevisando(false); setPreview([]) }}
              className="text-xs font-medium text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5">
              Cancelar
            </button>
            <button onClick={handlePublicar} disabled={temTurnoVazio || publicando}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
              {publicando ? 'Publicando...' : '✓ Confirmar publicação'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : shifts.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum plantão registrado para este mês nesta unidade.</p>
      ) : (
        // 7 colunas sempre (mesmo no celular) — em vez de truncar, o nome
        // quebra linha (Renato / Nunes) com fonte reduzida, pra caber sem
        // quebrar o formato de calendário.
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
          {DIAS_SEMANA.map(d => (
            <div key={d} className="text-center text-[10px] sm:text-xs font-bold text-slate-400 py-1">{d}</div>
          ))}
          {celulasDoMes(ref).map((dataStr, i) => {
            if (!dataStr) return <div key={i} className="min-h-[4.5rem]" />
            const doDia = shiftsPorDia.get(dataStr) ?? []
            return (
              <div key={dataStr} className="min-h-[4.5rem] border border-slate-200 rounded-lg p-0.5 sm:p-1 space-y-1">
                <p className="text-[10px] sm:text-xs font-semibold text-slate-500">{parseInt(dataStr.slice(8), 10)}</p>
                {doDia.map(s => {
                  const ehMeu = meuStaffId != null && s.staff_id === meuStaffId
                  const bg = ehMeu
                    ? 'bg-indigo-100 border border-indigo-400 ring-1 ring-indigo-300'
                    : s.status === 'swapped' ? 'bg-amber-50' : 'bg-slate-50'
                  return (
                    <div key={s.id} className={`text-[9px] sm:text-[11px] rounded px-0.5 sm:px-1 py-0.5 leading-tight ${bg}`}>
                      <p className={`break-words ${ehMeu ? 'text-indigo-500' : 'text-slate-500'}`}>{s.shift_type_id ? shiftTypeMap[s.shift_type_id] ?? '?' : '?'}</p>
                      {souChefe ? (
                        <select value={s.staff_id ?? ''} onChange={e => handleAssignStaff(s, e.target.value)}
                          className="w-full border border-slate-300 rounded px-0.5 py-0.5 text-[9px] sm:text-[11px] bg-white">
                          {staffAtivo.map(st => <option key={st.id} value={st.id}>{st.full_name}</option>)}
                        </select>
                      ) : ehMeu && meuStaffId ? (
                        <button onClick={() => setPassarPlantaoShift(s)}
                          title="Passar este plantão para um colega"
                          className="font-medium break-words text-indigo-900 underline decoration-dotted decoration-indigo-400 hover:text-indigo-600 text-left">
                          {s.staff_id ? staffMap[s.staff_id] ?? '?' : '—'}
                          {s.status === 'swapped' && ' 🔄'}
                        </button>
                      ) : (
                        <p className="font-medium break-words text-slate-800">
                          {s.staff_id ? staffMap[s.staff_id] ?? '?' : '—'}
                          {s.status === 'swapped' && ' 🔄'}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {passarPlantaoShift && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setPassarPlantaoShift(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">🔄 Passar plantão</h2>
              <button onClick={() => setPassarPlantaoShift(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
            </div>
            <p className="text-sm text-slate-600">
              {fmtDiaSemana(passarPlantaoShift.date)} ·{' '}
              {passarPlantaoShift.shift_type_id ? shiftTypeMap[passarPlantaoShift.shift_type_id] ?? '?' : '?'}.
              Escolha quem assume — a troca fica pendente até o colega aceitar.
            </p>

            {colegas.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum outro colega ativo nesta unidade.</p>
            ) : (
              <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                {colegas.map(c => (
                  <li key={c.id}>
                    <button onClick={() => handleEnviarPlantao(c.id)} disabled={enviandoPara !== null}
                      className="w-full text-left border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50
                                 disabled:opacity-50 rounded-lg px-3 py-2 text-sm text-slate-700 font-medium transition-colors">
                      {enviandoPara === c.id ? 'Enviando...' : c.full_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
