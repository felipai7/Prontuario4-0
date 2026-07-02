'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Shift, PublishedMonth, Staff, ShiftType, ToastData } from '@/types'

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

function fmtDiaSemana(dataStr: string): string {
  const d = new Date(dataStr + 'T12:00:00')
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

export default function MonthScheduleView({ unitId, staffList, shiftTypesList, showToast }: Props) {
  const supabase = createClient()
  const [ref, setRef] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [shifts, setShifts] = useState<Shift[]>([])
  const [publicado, setPublicado] = useState<PublishedMonth | null>(null)
  const [loading, setLoading] = useState(false)

  const staffMap = useMemo(() => Object.fromEntries(staffList.map(s => [s.id, s.full_name])), [staffList])
  const shiftTypeMap = useMemo(() => Object.fromEntries(shiftTypesList.map(t => [t.id, t.name])), [shiftTypesList])

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

  useEffect(() => { load() }, [unitId, ref])

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

      {publicado ? (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 inline-block">
          ✓ Mês publicado
        </p>
      ) : (
        <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 inline-block">
          Mês ainda não publicado
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : shifts.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum plantão registrado para este mês nesta unidade.</p>
      ) : (
        <ul className="space-y-1.5">
          {shifts.map(s => (
            <li key={s.id} className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <span className="text-slate-500 capitalize">{fmtDiaSemana(s.date)}</span>
              <span className="text-slate-700">{s.shift_type_id ? shiftTypeMap[s.shift_type_id] ?? '?' : '?'}</span>
              <span className="font-medium text-slate-800">{s.staff_id ? staffMap[s.staff_id] ?? '?' : '—'}</span>
              {s.status !== 'scheduled' && (
                <span className="text-xs text-amber-600 uppercase font-bold">{s.status === 'swapped' ? 'trocado' : 'cancelado'}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
