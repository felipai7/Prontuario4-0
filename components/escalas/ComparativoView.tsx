'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Shift, ShiftType, Staff, ToastData } from '@/types'

interface Props {
  unitId: string
  staffList: Staff[]
  shiftTypesList: ShiftType[]
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

function primeiroDiaMes(ref: Date): string {
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-01`
}
function fmtMesAno(ref: Date): string {
  return ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}
function fmtData(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function ComparativoView({ unitId, staffList, shiftTypesList, showToast }: Props) {
  const supabase = createClient()
  const [ref, setRef] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(false)

  const staffMap = useMemo(() => Object.fromEntries(staffList.map(s => [s.id, s.full_name])), [staffList])
  const shiftTypeMap = useMemo(() => Object.fromEntries(shiftTypesList.map(t => [t.id, t.name])), [shiftTypesList])

  const load = async () => {
    if (!unitId) return
    setLoading(true)
    const mesInicio = primeiroDiaMes(ref)
    const proxMes = new Date(ref.getFullYear(), ref.getMonth() + 1, 1)
    const mesFim = primeiroDiaMes(proxMes)
    const { data, error } = await supabase.from('shifts').select('*')
      .eq('unit_id', unitId).gte('date', mesInicio).lt('date', mesFim).order('date')
    setLoading(false)
    if (error) { showToast('Erro ao carregar comparativo: ' + error.message, 'error'); return }
    setShifts((data as Shift[]) ?? [])
  }

  useEffect(() => { load() }, [unitId, ref])

  const trocados = shifts.filter(s => s.original_staff_id !== s.staff_id)

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-slate-700">📊 Comparativo Planejado × Executado</h3>
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
      ) : shifts.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum plantão publicado neste mês.</p>
      ) : (
        <>
          <p className="text-xs text-slate-400">{trocados.length} de {shifts.length} plantão(ões) trocado(s) em relação ao planejado.</p>
          <ul className="space-y-1.5 max-h-96 overflow-y-auto">
            {shifts.map(s => {
              const trocado = s.original_staff_id !== s.staff_id
              return (
                <li key={s.id} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm border ${trocado ? 'bg-amber-50 border-amber-200' : 'border-slate-200'}`}>
                  <span className="text-slate-500 flex-shrink-0">{fmtData(s.date)}</span>
                  <span className="text-slate-500 flex-shrink-0">{s.shift_type_id ? shiftTypeMap[s.shift_type_id] ?? '?' : '?'}</span>
                  <span className="text-slate-700 flex-1 min-w-0 truncate">
                    Planejado: {s.original_staff_id ? staffMap[s.original_staff_id] ?? '?' : '—'}
                  </span>
                  <span className={`flex-1 min-w-0 truncate font-medium ${trocado ? 'text-amber-800' : 'text-slate-800'}`}>
                    Executado: {s.staff_id ? staffMap[s.staff_id] ?? '?' : '—'}
                  </span>
                  {trocado && <span className="text-xs font-bold text-amber-700 flex-shrink-0">🔄 trocado</span>}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
