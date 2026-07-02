'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ShiftType, ToastData } from '@/types'

interface Props {
  unitId: string
  souChefe: boolean
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400'

function fmtHora(t: string): string {
  return t.slice(0, 5)
}

export default function ShiftTypesAdmin({ unitId, souChefe, showToast }: Props) {
  const supabase = createClient()
  const [list, setList] = useState<ShiftType[]>([])
  const [loading, setLoading] = useState(false)

  const [nome, setNome] = useState('')
  const [inicio, setInicio] = useState('07:00')
  const [fim, setFim] = useState('19:00')
  const [duracao, setDuracao] = useState('12')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    if (!unitId) { setList([]); return }
    setLoading(true)
    const { data, error } = await supabase.from('shift_types').select('*').eq('unit_id', unitId).order('name')
    setLoading(false)
    if (error) { showToast('Erro ao carregar tipos de turno: ' + error.message, 'error'); return }
    setList((data as ShiftType[]) ?? [])
  }

  useEffect(() => { load() }, [unitId])

  const handleCreate = async () => {
    if (!nome.trim()) { showToast('Informe o nome do turno', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('shift_types').insert({
      unit_id: unitId, name: nome.trim(), start_time: inicio, end_time: fim,
      duration_hours: parseFloat(duracao) || 12,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Tipo de turno criado!')
    setNome(''); setInicio('07:00'); setFim('19:00'); setDuracao('12')
    load()
  }

  const handleToggleActive = async (st: ShiftType) => {
    const { error } = await supabase.from('shift_types').update({ active: !st.active }).eq('id', st.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    load()
  }

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
            <li key={st.id} className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg p-3">
              <div className="min-w-0">
                <p className={`text-sm font-medium ${st.active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{st.name}</p>
                <p className="text-xs text-slate-400">{fmtHora(st.start_time)}–{fmtHora(st.end_time)} · {st.duration_hours}h</p>
              </div>
              {souChefe && (
                <button onClick={() => handleToggleActive(st)}
                  className="text-xs font-medium text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1 flex-shrink-0">
                  {st.active ? 'Desativar' : 'Reativar'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {souChefe && (
        <div className="bg-slate-50 rounded-lg p-3 space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Novo tipo de turno</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Diurno" className={inputCls} />
            <input type="time" value={inicio} onChange={e => setInicio(e.target.value)} className={inputCls} />
            <input type="time" value={fim} onChange={e => setFim(e.target.value)} className={inputCls} />
            <input type="number" step="0.5" value={duracao} onChange={e => setDuracao(e.target.value)}
              placeholder="Duração (h)" className={inputCls} />
          </div>
          <div className="flex justify-end">
            <button onClick={handleCreate} disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg">
              {saving ? 'Criando...' : '+ Criar'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
