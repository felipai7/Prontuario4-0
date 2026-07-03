'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ScheduleTemplateShift, ScheduleTemplateAudit, Staff, ShiftType, ToastData } from '@/types'

interface Props {
  unitId: string
  staffList: Staff[]
  shiftTypesList: ShiftType[]
  souChefe: boolean
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const DIAS = Array.from({ length: 35 }, (_, i) => i + 1)
const selectCls = 'w-full border border-slate-300 rounded-md px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400'

export default function TemplateEditor({ unitId, staffList, shiftTypesList, souChefe, showToast }: Props) {
  const supabase = createClient()
  const [rows, setRows] = useState<ScheduleTemplateShift[]>([])
  const [loading, setLoading] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const [audit, setAudit] = useState<ScheduleTemplateAudit[]>([])

  const staffAtivo = useMemo(() => staffList.filter(s => s.active), [staffList])
  const staffMap = useMemo(() => Object.fromEntries(staffList.map(s => [s.id, s.full_name])), [staffList])
  const tiposAtivos = useMemo(() => shiftTypesList.filter(t => t.active), [shiftTypesList])

  const load = async () => {
    if (!unitId) { setRows([]); return }
    setLoading(true)
    const { data, error } = await supabase.from('schedule_template_shifts').select('*').eq('unit_id', unitId)
    setLoading(false)
    if (error) { showToast('Erro ao carregar mês padrão: ' + error.message, 'error'); return }
    setRows((data as ScheduleTemplateShift[]) ?? [])
  }

  useEffect(() => { load() }, [unitId])

  const loadAudit = async () => {
    const { data, error } = await supabase.from('schedule_template_audit').select('*')
      .eq('unit_id', unitId).order('changed_at', { ascending: false }).limit(50)
    if (error) { showToast('Erro ao carregar histórico: ' + error.message, 'error'); return }
    setAudit((data as ScheduleTemplateAudit[]) ?? [])
  }

  const handleToggleAudit = () => {
    setShowAudit(o => !o)
    if (!showAudit) loadAudit()
  }

  const getSlots = (dayNumber: number, shiftTypeId: string): ScheduleTemplateShift[] =>
    rows.filter(r => r.day_number === dayNumber && r.shift_type_id === shiftTypeId)

  const handleSlotChange = async (dayNumber: number, shiftTypeId: string, slotRow: ScheduleTemplateShift | undefined, newStaffId: string) => {
    if (!newStaffId && !slotRow) return // já vazio, nada a fazer
    if (!newStaffId && slotRow) {
      const { error } = await supabase.from('schedule_template_shifts').delete().eq('id', slotRow.id)
      if (error) { showToast('Erro: ' + error.message, 'error'); return }
      load()
      return
    }
    if (newStaffId && slotRow) {
      const { error } = await supabase.from('schedule_template_shifts').update({ staff_id: newStaffId }).eq('id', slotRow.id)
      if (error) { showToast('Erro: ' + error.message, 'error'); return }
      load()
      return
    }
    // newStaffId && !slotRow → nova atribuição
    const { error } = await supabase.from('schedule_template_shifts').insert({
      unit_id: unitId, day_number: dayNumber, shift_type_id: shiftTypeId, staff_id: newStaffId,
    })
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    load()
  }

  if (tiposAtivos.length === 0) {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold text-slate-700 mb-2">📋 Mês padrão (35 dias)</h3>
        <p className="text-sm text-slate-400">Cadastre ao menos um tipo de turno ativo para poder montar o mês padrão.</p>
      </section>
    )
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-slate-700">📋 Mês padrão (35 dias)</h3>
        {souChefe && (
          <button onClick={handleToggleAudit} className="text-xs font-medium text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1">
            {showAudit ? 'Ocultar histórico' : 'Ver histórico de alterações'}
          </button>
        )}
      </div>

      {showAudit && (
        <div className="bg-slate-50 rounded-lg p-3 max-h-64 overflow-y-auto space-y-1">
          {audit.length === 0 ? (
            <p className="text-xs text-slate-400">Nenhuma alteração registrada ainda.</p>
          ) : audit.map(a => (
            <p key={a.id} className="text-xs text-slate-600">
              Dia {a.day_number} — {a.old_staff_id ? (staffMap[a.old_staff_id] ?? '?') : 'vazio'} → {a.new_staff_id ? (staffMap[a.new_staff_id] ?? '?') : 'vazio'}
              <span className="text-slate-400"> · {new Date(a.changed_at).toLocaleString('pt-BR')}</span>
            </p>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="border border-slate-200 px-2 py-1 bg-slate-50 sticky left-0">Dia</th>
                {tiposAtivos.map(t => (
                  <th key={t.id} className="border border-slate-200 px-2 py-1 bg-slate-50" colSpan={2}>{t.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DIAS.map(dia => (
                <tr key={dia}>
                  <td className="border border-slate-200 px-2 py-1 text-center font-medium bg-slate-50 sticky left-0">{dia}</td>
                  {tiposAtivos.map(t => {
                    const slots = getSlots(dia, t.id)
                    const slot1 = slots[0]
                    const slot2 = slots[1]
                    const completo = slots.length >= 2
                    const bg = slots.length === 0 ? 'bg-red-50' : completo ? 'bg-emerald-50' : 'bg-amber-50'
                    return (
                      <td key={t.id} colSpan={2} className={`border border-slate-200 px-1 py-1 ${bg}`}>
                        {souChefe ? (
                          <div className="flex gap-1">
                            <select value={slot1?.staff_id ?? ''} disabled={!souChefe}
                              onChange={e => handleSlotChange(dia, t.id, slot1, e.target.value)} className={selectCls}>
                              <option value="">—</option>
                              {staffAtivo.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                            </select>
                            <select value={slot2?.staff_id ?? ''} disabled={!souChefe}
                              onChange={e => handleSlotChange(dia, t.id, slot2, e.target.value)} className={selectCls}>
                              <option value="">—</option>
                              {staffAtivo.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                            </select>
                          </div>
                        ) : (
                          <p className="px-1 text-slate-700">
                            {slots.length === 0 ? '—' : slots.map(s => staffMap[s.staff_id] ?? '?').join(' / ')}
                          </p>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-4 text-xs text-slate-500">
        <span><span className="inline-block w-3 h-3 bg-red-50 border border-slate-300 align-middle mr-1"></span>Sem ninguém</span>
        <span><span className="inline-block w-3 h-3 bg-amber-50 border border-slate-300 align-middle mr-1"></span>Incompleto (1/2)</span>
        <span><span className="inline-block w-3 h-3 bg-emerald-50 border border-slate-300 align-middle mr-1"></span>Completo (2/2)</span>
      </div>
    </section>
  )
}
