'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ShiftType, ToastData } from '@/types'

interface Props {
  unitId: string
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

function fmtHora(t: string): string {
  return t.slice(0, 5)
}

// Tipos de turno são configurados por programação (via migration), não
// por esta UI — a unidade raramente muda de horários/turnos, então o
// chefe só visualiza o que já está cadastrado.
export default function ShiftTypesAdmin({ unitId, showToast }: Props) {
  const supabase = createClient()
  const [list, setList] = useState<ShiftType[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!unitId) { setList([]); return }
    setLoading(true)
    const { data, error } = await supabase.from('shift_types').select('*').eq('unit_id', unitId).order('name')
    setLoading(false)
    if (error) { showToast('Erro ao carregar tipos de turno: ' + error.message, 'error'); return }
    setList((data as ShiftType[]) ?? [])
  }

  useEffect(() => { load() }, [unitId])

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <h3 className="font-semibold text-slate-700">🕐 Tipos de turno</h3>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum tipo de turno cadastrado nesta unidade.</p>
      ) : (
        <ul className="space-y-2">
          {list.map(st => (
            <li key={st.id} className="border border-slate-200 rounded-lg p-3">
              <p className={`text-sm font-medium ${st.active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{st.name}</p>
              <p className="text-xs text-slate-400">{fmtHora(st.start_time)}–{fmtHora(st.end_time)} · {st.duration_hours}h</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
