'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PaySettings, ToastData } from '@/types'

interface Props {
  unitId: string
  souChefe: boolean
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400'
const labelCls = 'text-xs text-slate-500 font-medium block mb-1'

export default function PaySettingsAdmin({ unitId, souChefe, showToast }: Props) {
  const supabase = createClient()
  const [config, setConfig] = useState<PaySettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [weekday, setWeekday] = useState('')
  const [weekend, setWeekend] = useState('')

  const load = async () => {
    if (!unitId || !souChefe) { setConfig(null); return }
    setLoading(true)
    const { data, error } = await supabase.from('pay_settings').select('*').eq('unit_id', unitId).maybeSingle()
    setLoading(false)
    if (error) { showToast('Erro ao carregar valores: ' + error.message, 'error'); return }
    const cfg = data as PaySettings | null
    setConfig(cfg)
    setWeekday(cfg ? String(cfg.weekday_value) : '1000')
    setWeekend(cfg ? String(cfg.weekend_value) : '1100')
  }

  useEffect(() => { load() }, [unitId, souChefe])

  const handleSave = async () => {
    const wd = parseFloat(weekday), we = parseFloat(weekend)
    if (isNaN(wd) || isNaN(we)) { showToast('Valores inválidos', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('pay_settings').upsert({
      unit_id: unitId, weekday_value: wd, weekend_value: we, updated_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Valores salvos!')
    load()
  }

  if (!souChefe) return null

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <h3 className="font-semibold text-slate-700">💰 Valor do plantão</h3>
      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Dia de semana (R$)</label>
            <input type="number" step="0.01" value={weekday} onChange={e => setWeekday(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Fim de semana (R$)</label>
            <input type="number" step="0.01" value={weekend} onChange={e => setWeekend(e.target.value)} className={inputCls} />
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving || loading}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg">
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </section>
  )
}
