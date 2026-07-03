'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Shift, SwapRequest, Staff, ShiftType, ToastData } from '@/types'

interface Props {
  unitId: string
  staffList: Staff[]
  shiftTypesList: ShiftType[]
  meuStaffId: string | null
  souChefe: boolean
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400'
const labelCls = 'text-xs text-slate-500 font-medium block mb-1'

function fmtData(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente', accepted: 'Aceita', rejected: 'Recusada', cancelled: 'Cancelada',
}

export default function SwapRequests({ unitId, staffList, shiftTypesList, meuStaffId, souChefe, showToast }: Props) {
  const supabase = createClient()

  const staffMap = useMemo(() => Object.fromEntries(staffList.map(s => [s.id, s.full_name])), [staffList])
  const shiftTypeMap = useMemo(() => Object.fromEntries(shiftTypesList.map(t => [t.id, t.name])), [shiftTypesList])
  const colegas = useMemo(() => staffList.filter(s => s.active && s.id !== meuStaffId), [staffList, meuStaffId])

  const [meusPlantoes, setMeusPlantoes] = useState<Shift[]>([])
  const [swaps, setSwaps] = useState<SwapRequest[]>([])
  const [shiftsById, setShiftsById] = useState<Record<string, Shift>>({})
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!unitId) return
    setLoading(true)
    const hoje = new Date().toISOString().split('T')[0]

    const [{ data: plantoesData, error: plantoesErr }, { data: swapsData, error: swapsErr }] = await Promise.all([
      meuStaffId
        ? supabase.from('shifts').select('*').eq('unit_id', unitId).eq('staff_id', meuStaffId).gte('date', hoje).order('date')
        : Promise.resolve({ data: [] as Shift[], error: null }),
      supabase.from('swap_requests').select('*').eq('unit_id', unitId).order('created_at', { ascending: false }),
    ])
    if (plantoesErr) { showToast('Erro ao carregar seus plantões: ' + plantoesErr.message, 'error') }
    if (swapsErr) { showToast('Erro ao carregar trocas: ' + swapsErr.message, 'error') }
    setMeusPlantoes((plantoesData as Shift[]) ?? [])
    const swapsList = (swapsData as SwapRequest[]) ?? []
    setSwaps(swapsList)

    const idsFaltantes = Array.from(new Set(swapsList.map(s => s.shift_id)))
    if (idsFaltantes.length) {
      const { data: shiftsData, error: shiftsErr } = await supabase.from('shifts').select('*').in('id', idsFaltantes)
      if (shiftsErr) { showToast('Erro ao carregar plantões das trocas: ' + shiftsErr.message, 'error') }
      setShiftsById(Object.fromEntries(((shiftsData as Shift[]) ?? []).map(s => [s.id, s])))
    } else {
      setShiftsById({})
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [unitId, meuStaffId])

  // ── Nova solicitação de troca ──────────────────────────────────────────────
  const [shiftIdEscolhido, setShiftIdEscolhido] = useState('')
  const [targetStaffId, setTargetStaffId] = useState('')
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)

  const handleCreateSwap = async () => {
    if (!meuStaffId || !shiftIdEscolhido || !targetStaffId) { showToast('Selecione o plantão e o colega', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('swap_requests').insert({
      unit_id: unitId, shift_id: shiftIdEscolhido, requester_id: meuStaffId,
      target_staff_id: targetStaffId, reason: motivo.trim() || null,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Troca solicitada!')
    setShiftIdEscolhido(''); setTargetStaffId(''); setMotivo('')
    load()
  }

  const handleAccept = async (id: string) => {
    const { error } = await supabase.rpc('accept_swap', { p_swap_id: id })
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Troca aceita — plantão atualizado!')
    load()
  }

  const handleReject = async (id: string) => {
    const { error } = await supabase.from('swap_requests').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Troca recusada')
    load()
  }

  const handleCancel = async (id: string) => {
    const { error } = await supabase.from('swap_requests').update({ status: 'cancelled', resolved_at: new Date().toISOString() }).eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Solicitação cancelada')
    load()
  }

  const recebidas = swaps.filter(s => s.target_staff_id === meuStaffId && s.status === 'pending')
  const minhas = swaps.filter(s => s.requester_id === meuStaffId)
  const todas = swaps

  const linhaPlantao = (shiftId: string) => {
    const s = shiftsById[shiftId]
    if (!s) return '—'
    return `${fmtData(s.date)} · ${s.shift_type_id ? shiftTypeMap[s.shift_type_id] ?? '?' : '?'}`
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <h3 className="font-semibold text-slate-700">🔄 Trocas de Plantão</h3>

      {!meuStaffId && (
        <p className="text-sm text-slate-400">Você não está cadastrado na equipe desta unidade, então não pode solicitar trocas.</p>
      )}

      {meuStaffId && (
        <div className="bg-slate-50 rounded-lg p-3 space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Solicitar troca</p>
          {meusPlantoes.length === 0 ? (
            <p className="text-xs text-slate-400">Você não tem plantões futuros publicados nesta unidade.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select value={shiftIdEscolhido} onChange={e => setShiftIdEscolhido(e.target.value)} className={inputCls}>
                <option value="">Selecione seu plantão...</option>
                {meusPlantoes.map(s => (
                  <option key={s.id} value={s.id}>
                    {fmtData(s.date)} · {s.shift_type_id ? shiftTypeMap[s.shift_type_id] ?? '?' : '?'}
                  </option>
                ))}
              </select>
              <select value={targetStaffId} onChange={e => setTargetStaffId(e.target.value)} className={inputCls}>
                <option value="">Trocar com...</option>
                {colegas.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
              <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo (opcional)" className={inputCls} />
            </div>
          )}
          {meusPlantoes.length > 0 && (
            <div className="flex justify-end">
              <button onClick={handleCreateSwap} disabled={saving || !shiftIdEscolhido || !targetStaffId}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg">
                {saving ? 'Enviando...' : '+ Solicitar troca'}
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : (
        <>
          {recebidas.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Recebidas — aguardando sua resposta</p>
              <ul className="space-y-1.5">
                {recebidas.map(s => (
                  <li key={s.id} className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="text-slate-800">{linhaPlantao(s.shift_id)}</p>
                      <p className="text-xs text-slate-500">De {staffMap[s.requester_id] ?? '?'}{s.reason && ` · ${s.reason}`}</p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => handleAccept(s.id)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg">Aceitar</button>
                      <button onClick={() => handleReject(s.id)}
                        className="text-slate-500 hover:text-red-600 border border-slate-200 text-xs font-bold px-3 py-1.5 rounded-lg">Recusar</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {minhas.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Minhas solicitações</p>
              <ul className="space-y-1.5">
                {minhas.map(s => (
                  <li key={s.id} className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="text-slate-800">{linhaPlantao(s.shift_id)}</p>
                      <p className="text-xs text-slate-500">Para {staffMap[s.target_staff_id] ?? '?'} · {STATUS_LABEL[s.status]}</p>
                    </div>
                    {s.status === 'pending' && (
                      <button onClick={() => handleCancel(s.id)}
                        className="text-slate-500 hover:text-red-600 border border-slate-200 text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0">
                        Cancelar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {souChefe && todas.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Todas as trocas da unidade ({todas.length})</p>
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {todas.map(s => (
                  <li key={s.id} className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    {linhaPlantao(s.shift_id)} · {staffMap[s.requester_id] ?? '?'} → {staffMap[s.target_staff_id] ?? '?'} · <span className="font-semibold">{STATUS_LABEL[s.status]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recebidas.length === 0 && minhas.length === 0 && !(souChefe && todas.length > 0) && (
            <p className="text-sm text-slate-400">Nenhuma troca de plantão registrada.</p>
          )}
        </>
      )}
    </section>
  )
}
