'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Shift, ShiftPayment, ShiftType, ToastData } from '@/types'

interface Props {
  unitId: string
  meuStaffId: string | null
  shiftTypesList: ShiftType[]
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

type PagamentoComPlantao = ShiftPayment & { shift: Shift }

function primeiroDiaMes(ref: Date): string {
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-01`
}
function fmtMesAno(ref: Date): string {
  return ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}
function fmtData(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtValor(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function FinanceiroPlantonista({ unitId, meuStaffId, shiftTypesList, showToast }: Props) {
  const supabase = createClient()
  const [ref, setRef] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [pagamentos, setPagamentos] = useState<PagamentoComPlantao[]>([])
  const [loading, setLoading] = useState(false)

  const shiftTypeMap = useMemo(() => Object.fromEntries(shiftTypesList.map(t => [t.id, t.name])), [shiftTypesList])

  const load = async () => {
    if (!unitId || !meuStaffId) { setPagamentos([]); return }
    setLoading(true)
    const mesInicio = primeiroDiaMes(ref)
    const proxMes = new Date(ref.getFullYear(), ref.getMonth() + 1, 1)
    const mesFim = primeiroDiaMes(proxMes)

    const { data, error } = await supabase
      .from('shift_payments')
      .select('*, shift:shifts!inner(*)')
      .eq('shift.unit_id', unitId)
      .eq('shift.staff_id', meuStaffId)
      .gte('shift.date', mesInicio)
      .lt('shift.date', mesFim)
    setLoading(false)
    if (error) { showToast('Erro ao carregar pagamentos: ' + error.message, 'error'); return }
    const lista = ((data as unknown as PagamentoComPlantao[]) ?? []).sort((a, b) => a.shift.date.localeCompare(b.shift.date))
    setPagamentos(lista)
  }

  useEffect(() => { load() }, [unitId, meuStaffId, ref])

  const total = pagamentos.reduce((acc, p) => acc + p.payment_value, 0)
  const totalPago = pagamentos.filter(p => p.payment_status === 'paid').reduce((acc, p) => acc + p.payment_value, 0)

  if (!meuStaffId) return null

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-slate-700">💰 Meus Pagamentos</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() - 1, 1))}
            className="text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1 text-sm">←</button>
          <span className="text-sm font-medium text-slate-700 capitalize min-w-[9rem] text-center">{fmtMesAno(ref)}</span>
          <button onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() + 1, 1))}
            className="text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1 text-sm">→</button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : pagamentos.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum plantão publicado com pagamento neste mês.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {pagamentos.map(p => (
              <li key={p.shift_id} className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <span className="text-slate-500">{fmtData(p.shift.date)}</span>
                <span className="text-slate-700">{p.shift.shift_type_id ? shiftTypeMap[p.shift.shift_type_id] ?? '?' : '?'}</span>
                <span className="font-medium text-slate-800">{fmtValor(p.payment_value)}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${p.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {p.payment_status === 'paid' ? 'Pago' : 'Pendente'}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-4 text-sm pt-2 border-t border-slate-200">
            <span className="text-slate-500">Total do mês: <strong className="text-slate-800">{fmtValor(total)}</strong></span>
            <span className="text-slate-500">Já pago: <strong className="text-emerald-700">{fmtValor(totalPago)}</strong></span>
          </div>
        </>
      )}
    </section>
  )
}
