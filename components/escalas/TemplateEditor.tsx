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
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
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
        <h3 className="font-semibold text-slate-700 mb-2">📋 Espelho da escala (mês padrão de 35 dias)</h3>
        <p className="text-sm text-slate-400">Cadastre ao menos um tipo de turno ativo para poder montar o espelho.</p>
      </section>
    )
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-slate-700">📋 Espelho da escala (mês padrão de 35 dias)</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Permanente: todos os meses são publicados a partir deste espelho, em ciclo contínuo.
            Só precisa ser editado quando alguém entra ou sai da escala em definitivo.
          </p>
        </div>
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
        <div className="grid grid-cols-7 gap-1">
          {DIAS_SEMANA.map(d => (
            <div key={d} className="text-center text-xs font-bold text-slate-400 py-1">{d}</div>
          ))}
          {DIAS.map(dia => (
            <div key={dia} className="border border-slate-200 rounded-lg p-1 space-y-1">
              <p className="text-xs font-semibold text-slate-500">{dia}</p>
              {tiposAtivos.map(t => {
                const slots = getSlots(dia, t.id)
                const slot1 = slots[0]
                const slot2 = slots[1]
                const completo = slots.length >= 2
                const bg = slots.length === 0 ? 'bg-red-50' : completo ? 'bg-emerald-50' : 'bg-amber-50'
                return (
                  <div key={t.id} className={`rounded px-1 py-0.5 ${bg}`}>
                    <p className="text-[11px] text-slate-500 truncate">{t.name}</p>
                    {souChefe ? (
                      <div className="space-y-0.5">
                        <select value={slot1?.staff_id ?? ''}
                          onChange={e => handleSlotChange(dia, t.id, slot1, e.target.value)} className={selectCls}>
                          <option value="">—</option>
                          {staffAtivo.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                        </select>
                        <select value={slot2?.staff_id ?? ''}
                          onChange={e => handleSlotChange(dia, t.id, slot2, e.target.value)} className={selectCls}>
                          <option value="">—</option>
                          {staffAtivo.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                        </select>
                      </div>
                    ) : (
                      <p className="text-[11px] font-medium text-slate-800 truncate">
                        {slots.length === 0 ? '—' : slots.map(s => staffMap[s.staff_id] ?? '?').join(' / ')}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
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
