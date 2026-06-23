'use client'
import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getTurno } from '@/lib/utils'
import type { Paciente, SinalVital, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  sinais: SinalVital[]
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

type SvKey = 'temperatura' | 'pas' | 'pad' | 'pam' | 'fc' | 'fr' | 'sato2' | 'hgt'

const COLS: { key: SvKey; label: string; unit: string; step?: string; min?: number; max?: number }[] = [
  { key: 'temperatura', label: 'Temp',  unit: '°C',   step: '0.1', min: 30,  max: 45  },
  { key: 'pas',         label: 'PAS',   unit: 'mmHg', step: '1',   min: 0              },
  { key: 'pad',         label: 'PAD',   unit: 'mmHg', step: '1',   min: 0              },
  { key: 'pam',         label: 'PAM',   unit: 'mmHg', step: '1',   min: 0              },
  { key: 'fc',          label: 'FC',    unit: 'bpm',  step: '1',   min: 0              },
  { key: 'fr',          label: 'FR',    unit: 'irpm', step: '1',   min: 0              },
  { key: 'sato2',       label: 'SatO₂', unit: '%',    step: '0.1', min: 0,  max: 100  },
  { key: 'hgt',         label: 'HGT',   unit: 'mg/dL',step: '1',   min: 0              },
]

const DIURNO_HOURS  = [7,8,9,10,11,12,13,14,15,16,17,18]
const NOTURNO_HOURS = [19,20,21,22,23,0,1,2,3,4,5,6]

type Alert = 'crit' | 'warn' | 'low' | 'ok' | 'empty'

function alertFor(key: SvKey, v: number | null): Alert {
  if (v === null) return 'empty'
  switch (key) {
    case 'temperatura':
      if (v < 36.0) return 'low'
      if (v >= 38.5) return 'crit'
      if (v >= 37.6) return 'warn'
      return 'ok'
    case 'pas':
      if (v < 90 || v > 180) return 'crit'
      if (v > 140) return 'warn'
      return 'ok'
    case 'pad':
      if (v < 60) return 'low'
      if (v > 100) return 'warn'
      return 'ok'
    case 'pam':
      if (v < 65) return 'crit'
      if (v > 110) return 'warn'
      return 'ok'
    case 'fc':
      if (v < 50 || v > 130) return 'crit'
      if (v < 60 || v > 100) return 'warn'
      return 'ok'
    case 'fr':
      if (v > 30) return 'crit'
      if (v < 12 || v > 20) return 'warn'
      return 'ok'
    case 'sato2':
      if (v < 90) return 'crit'
      if (v < 94) return 'warn'
      return 'ok'
    case 'hgt':
      if (v < 70 || v > 300) return 'crit'
      if (v < 80 || v > 180) return 'warn'
      return 'ok'
    default: return 'ok'
  }
}

function alertBg(a: Alert) {
  if (a === 'crit')  return 'bg-red-50 text-red-700 font-bold'
  if (a === 'warn')  return 'bg-orange-50 text-orange-700 font-semibold'
  if (a === 'low')   return 'bg-sky-50 text-sky-700 font-semibold'
  if (a === 'empty') return 'text-slate-200'
  return 'text-slate-700'
}

type RowInput = Record<SvKey, string>

function clampInput(key: SvKey, raw: string): string {
  const col = COLS.find(c => c.key === key)!
  const n = parseFloat(raw)
  if (isNaN(n)) return raw
  if (col.min !== undefined && n < col.min) return String(col.min)
  if (col.max !== undefined && n > col.max) return String(col.max)
  return raw
}

function pamFor(row: RowInput): number | null {
  const pas = parseFloat(row.pas), pad = parseFloat(row.pad)
  if (!isNaN(pas) && !isNaN(pad) && pas >= 0 && pad >= 0) return Math.round((pas + 2 * pad) / 3)
  return null
}

function rowToPayload(pacienteId: string, dateStr: string, hour: number, row: RowInput) {
  const h = hour.toString().padStart(2, '0')
  // For noturno hours 0-6 the date is +1 day
  let d = new Date(dateStr + 'T00:00:00')
  if (hour < 7) d.setDate(d.getDate() + 1)
  const iso = `${d.toISOString().split('T')[0]}T${h}:00:00`
  const horario = new Date(iso)
  const pamManual = row.pam ? parseFloat(row.pam) : null
  const pamAuto   = pamFor(row)
  return {
    paciente_id: pacienteId,
    horario: horario.toISOString(),
    turno: getTurno(horario),
    temperatura: row.temperatura ? parseFloat(row.temperatura) : null,
    pas:  row.pas  ? parseInt(row.pas)  : null,
    pad:  row.pad  ? parseInt(row.pad)  : null,
    pam:  pamManual != null ? pamManual : pamAuto,
    fc:   row.fc   ? parseInt(row.fc)   : null,
    fr:   row.fr   ? parseInt(row.fr)   : null,
    sato2:row.sato2? parseFloat(row.sato2) : null,
    hgt:  row.hgt  ? parseFloat(row.hgt)   : null,
    observacoes: null,
  }
}

function emptyRow(): RowInput {
  return { temperatura:'', pas:'', pad:'', pam:'', fc:'', fr:'', sato2:'', hgt:'' }
}

function todayStr() { return new Date().toISOString().split('T')[0] }

export default function SinaisVitaisTab({ paciente, sinais, onRefresh, showToast }: Props) {
  const supabase = createClient()
  const [formOpen,  setFormOpen]  = useState(false)
  const [formDate,  setFormDate]  = useState(todayStr)
  const [formTurno, setFormTurno] = useState<'diurno' | 'noturno'>(() =>
    getTurno(new Date()) === 'diurno' ? 'diurno' : 'noturno')
  const [rows, setRows] = useState<RowInput[]>(() => DIURNO_HOURS.map(() => emptyRow()))
  const [saving,    setSaving]    = useState(false)
  const [importing, setImporting] = useState(false)

  // Edit individual reading
  const [editSv,     setEditSv]     = useState<SinalVital | null>(null)
  const [editForm,   setEditForm]   = useState<RowInput>(emptyRow())
  const [editSaving, setEditSaving] = useState(false)

  const openEditSv = (sv: SinalVital) => {
    setEditSv(sv)
    setEditForm({
      temperatura: sv.temperatura != null ? String(sv.temperatura) : '',
      pas:  sv.pas  != null ? String(sv.pas)  : '',
      pad:  sv.pad  != null ? String(sv.pad)  : '',
      pam:  sv.pam  != null ? String(sv.pam)  : '',
      fc:   sv.fc   != null ? String(sv.fc)   : '',
      fr:   sv.fr   != null ? String(sv.fr)   : '',
      sato2:sv.sato2 != null ? String(sv.sato2) : '',
      hgt:  sv.hgt  != null ? String(sv.hgt)  : '',
    })
  }

  const handleSaveEditSv = async () => {
    if (!editSv) return
    setEditSaving(true)
    const ef = editForm
    const pasN = parseFloat(ef.pas), padN = parseFloat(ef.pad)
    const pamAuto = !isNaN(pasN) && !isNaN(padN) ? Math.round((pasN + 2 * padN) / 3) : null
    const payload = {
      temperatura: ef.temperatura ? parseFloat(ef.temperatura) : null,
      pas:  ef.pas  ? parseInt(ef.pas)  : null,
      pad:  ef.pad  ? parseInt(ef.pad)  : null,
      pam:  ef.pam  ? parseInt(ef.pam)  : pamAuto,
      fc:   ef.fc   ? parseInt(ef.fc)   : null,
      fr:   ef.fr   ? parseInt(ef.fr)   : null,
      sato2:ef.sato2? parseFloat(ef.sato2): null,
      hgt:  ef.hgt  ? parseFloat(ef.hgt): null,
    }
    const { error } = await supabase.from('sinais_vitais').update(payload).eq('id', editSv.id)
    setEditSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Leitura atualizada!')
    setEditSv(null); onRefresh()
  }

  const handleDeleteSv = async (id: string) => {
    if (!confirm('Excluir esta leitura?')) return
    const { error } = await supabase.from('sinais_vitais').delete().eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Leitura removida')
    if (editSv?.id === id) setEditSv(null)
    onRefresh()
  }

  const hours = formTurno === 'diurno' ? DIURNO_HOURS : NOTURNO_HOURS

  const setRow = (idx: number, key: SvKey, raw: string) => {
    setRows(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [key]: raw }
      return next
    })
  }

  const blurRow = (idx: number, key: SvKey, raw: string) => {
    const clamped = clampInput(key, raw)
    if (clamped !== raw) setRows(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [key]: clamped }
      return next
    })
  }

  const handleTurnoChange = (t: 'diurno' | 'noturno') => {
    setFormTurno(t)
    setRows(t === 'diurno' ? DIURNO_HOURS.map(() => emptyRow()) : NOTURNO_HOURS.map(() => emptyRow()))
  }

  const sorted = useMemo(() =>
    [...sinais].sort((a, b) => new Date(a.horario).getTime() - new Date(b.horario).getTime()),
    [sinais])

  // Determine last 12h period (most recent turno)
  const lastPeriodSinais = useMemo(() => {
    if (!sorted.length) return []
    const lastTurno = sorted[sorted.length - 1].turno
    const lastDate  = sorted[sorted.length - 1].horario.split('T')[0]
    // same turno & same calendar date (approximate)
    return sorted.filter(sv => sv.turno === lastTurno && sv.horario.startsWith(lastDate))
  }, [sorted])

  // Min / max for each column from lastPeriodSinais
  const summaryStats = useMemo(() => {
    const stats: Record<SvKey, { min: number; max: number; minA: Alert; maxA: Alert } | null> = {
      temperatura: null, pas: null, pad: null, pam: null, fc: null, fr: null, sato2: null, hgt: null,
    }
    for (const col of COLS) {
      const vals = lastPeriodSinais.map(sv => sv[col.key] as number | null).filter(v => v !== null) as number[]
      if (!vals.length) continue
      const mn = Math.min(...vals), mx = Math.max(...vals)
      stats[col.key] = { min: mn, max: mx, minA: alertFor(col.key, mn), maxA: alertFor(col.key, mx) }
    }
    return stats
  }, [lastPeriodSinais])

  const periodLabel = useMemo(() => {
    if (!lastPeriodSinais.length) return ''
    const last = lastPeriodSinais[lastPeriodSinais.length - 1]
    return last.turno === 'diurno' ? '☀️ Diurno' : '🌙 Noturno'
  }, [lastPeriodSinais])

  const handleSave = async () => {
    const payloads = rows
      .map((row, idx) => ({ row, hour: hours[idx] }))
      .filter(({ row }) => Object.values(row).some(v => v !== ''))
      .map(({ row, hour }) => rowToPayload(paciente.id, formDate, hour, row))
    if (!payloads.length) { showToast('Nenhum valor preenchido', 'warn'); return }
    setSaving(true)
    const { error } = await supabase.from('sinais_vitais').insert(payloads)
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast(`${payloads.length} leitura${payloads.length > 1 ? 's' : ''} salva${payloads.length > 1 ? 's' : ''}!`)
    setFormOpen(false)
    setRows(hours.map(() => emptyRow()))
    onRefresh()
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setImporting(true)
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader()
        reader.onload = ev => res((ev.target?.result as string).split(',')[1])
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      const resp = await fetch('/api/extract-sinais-vitais', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: b64, mediaType: file.type }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)
      const { leituras, data: dataExtracao } = data
      if (!leituras?.length) { showToast('Nenhuma leitura encontrada', 'warn'); return }
      let dateStr = new Date().toISOString().split('T')[0]
      if (dataExtracao) {
        const [d, mo, y] = (dataExtracao as string).split('/')
        if (d && mo && y) dateStr = `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
      }
      const dbRows = leituras.map((l: any) => {
        const [h, m] = (l.horario ?? '00:00').split(':')
        const horario = new Date(`${dateStr}T${(h||'0').padStart(2,'0')}:${(m||'00').padStart(2,'0')}:00`)
        const sato2 = l.sato2 != null ? Math.min(100, Math.max(0, l.sato2)) : null
        return {
          paciente_id: paciente.id, horario: horario.toISOString(), turno: getTurno(horario),
          temperatura: l.temperatura ?? null,
          pas: l.pas ?? null, pad: l.pad ?? null,
          pam: l.pam ?? (l.pas != null && l.pad != null ? Math.round((l.pas + 2*l.pad)/3) : null),
          fc: l.fc ?? null, fr: l.fr ?? null, sato2, hgt: l.hgt ?? null, observacoes: null,
        }
      })
      const { error } = await supabase.from('sinais_vitais').insert(dbRows)
      if (error) throw error
      showToast(`${dbRows.length} leituras importadas!`)
      onRefresh()
    } catch (err: any) { showToast('Erro: ' + err.message, 'error') }
    setImporting(false); if (e.target) e.target.value = ''
  }

  return (
    <div className="space-y-4">

      {/* Min/max summary cards for last period */}
      {lastPeriodSinais.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 mb-2 font-medium">
            Resumo do último período — {periodLabel}
            <span className="ml-2 text-slate-300">({lastPeriodSinais.length} leituras)</span>
          </p>
          <div className="grid grid-cols-4 gap-2">
            {COLS.map(col => {
              const s = summaryStats[col.key]
              if (!s) return (
                <div key={col.key} className="rounded-xl border border-slate-200 bg-white p-2 text-center">
                  <p className="text-xs text-slate-400">{col.label}</p>
                  <p className="text-base text-slate-200">—</p>
                </div>
              )
              const sameVal = s.min === s.max
              const maxBorder = s.maxA === 'crit' ? 'border-red-300' : s.maxA === 'warn' ? 'border-orange-200' : 'border-slate-200'
              return (
                <div key={col.key} className={`rounded-xl border p-2 text-center bg-white ${maxBorder}`}>
                  <p className="text-xs text-slate-500 mb-1">{col.label} <span className="text-slate-300">{col.unit}</span></p>
                  {sameVal ? (
                    <p className={`text-base font-bold ${alertBg(s.maxA)}`}>{s.max}</p>
                  ) : (
                    <div className="flex items-center justify-center gap-1 text-sm">
                      <span className={`font-semibold ${alertBg(s.minA)}`}>{s.min}</span>
                      <span className="text-slate-300 text-xs">–</span>
                      <span className={`font-semibold ${alertBg(s.maxA)}`}>{s.max}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-700">
          Leituras ({sinais.length})
        </h3>
        <div className="flex gap-2">
          <label className={`cursor-pointer flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors ${importing ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {importing ? '⏳ Importando...' : '📷 Importar foto'}
            <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleImport} disabled={importing}/>
          </label>
          <button onClick={() => setFormOpen(o => !o)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
            {formOpen ? '✕ Fechar' : '+ Novo Período'}
          </button>
        </div>
      </div>

      {/* Bulk grid form */}
      {formOpen && (
        <div className="border-2 border-indigo-200 rounded-xl bg-indigo-50 p-4 space-y-3">
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Data</label>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
            </div>
            <div className="flex rounded-lg overflow-hidden border border-slate-300">
              {(['diurno','noturno'] as const).map(t => (
                <button key={t} onClick={() => handleTurnoChange(t)}
                  className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                    formTurno === t ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}>
                  {t === 'diurno' ? '☀️ Diurno (07–18h)' : '🌙 Noturno (19–06h)'}
                </button>
              ))}
            </div>
          </div>

          {/* Grid table */}
          <div className="overflow-x-auto rounded-lg border border-indigo-200 bg-white">
            <table className="min-w-max w-full text-xs border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-indigo-100 px-3 py-2 text-left font-bold text-indigo-800 border-b-2 border-r-2 border-indigo-200 min-w-[62px]">
                    Hora
                  </th>
                  {COLS.map(col => (
                    <th key={col.key} className="px-2 py-2 bg-indigo-100 border-b-2 border-r border-indigo-200 text-center text-indigo-800 font-bold min-w-[72px] whitespace-nowrap">
                      {col.label}
                      <span className="text-indigo-400 font-normal ml-0.5 text-xs">{col.unit}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hours.map((hour, idx) => {
                  const row = rows[idx]
                  const autoP = pamFor(row)
                  return (
                    <tr key={hour} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="sticky left-0 px-3 py-1.5 font-bold text-slate-700 border-r-2 border-b border-slate-200 text-center"
                        style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                        {hour.toString().padStart(2,'0')}:00
                      </td>
                      {COLS.map(col => {
                        const isPam = col.key === 'pam'
                        const displayVal = isPam && row.pam === '' && autoP !== null ? String(autoP) : row[col.key]
                        const isPamAuto  = isPam && row.pam === '' && autoP !== null
                        return (
                          <td key={col.key} className="px-1 py-1 border-r border-b border-slate-100">
                            <input
                              type="number"
                              step={col.step ?? '1'}
                              min={col.min}
                              max={col.max}
                              value={isPamAuto ? autoP! : row[col.key]}
                              onChange={e => !isPamAuto && setRow(idx, col.key, e.target.value)}
                              onBlur={e => !isPamAuto && blurRow(idx, col.key, e.target.value)}
                              placeholder="—"
                              readOnly={isPamAuto}
                              className={`w-full text-center text-sm font-semibold focus:outline-none rounded px-1 py-0.5
                                ${isPamAuto ? 'text-indigo-400 bg-indigo-50 cursor-default' : 'bg-transparent placeholder-slate-200 focus:bg-indigo-50'}`}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <button onClick={handleSave} disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {saving ? 'Salvando...' : 'Salvar Período'}
          </button>
        </div>
      )}

      {sinais.length === 0 && !formOpen && (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhuma leitura registrada</p>
      )}

      {/* Pivot table — historical view */}
      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
          <table className="min-w-max w-full text-xs border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-100 px-3 py-2.5 text-left font-bold text-slate-700 border-b-2 border-r-2 border-slate-300 min-w-[100px]">
                  Parâmetro
                </th>
                {sorted.map((sv, idx) => {
                  const dt = new Date(sv.horario)
                  const shiftChange = idx > 0 && getTurno(dt) !== getTurno(new Date(sorted[idx-1].horario))
                  const isDiurno = sv.turno === 'diurno'
                  return (
                    <th key={sv.id}
                      className={`px-2 py-1.5 text-center bg-slate-100 border-b-2 border-r border-slate-200 min-w-[60px] whitespace-nowrap ${shiftChange ? 'border-l-2 border-l-indigo-300' : ''}`}>
                      <p className={`font-semibold text-xs ${isDiurno ? 'text-amber-600' : 'text-indigo-600'}`}>
                        {dt.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}
                      </p>
                      <p className="text-slate-400 font-normal text-xs">
                        {dt.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'})}
                      </p>
                      <button onClick={() => openEditSv(sv)}
                        className="text-indigo-300 hover:text-indigo-600 text-xs mt-0.5 px-1">✏️</button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {COLS.map((col, rowIdx) => {
                const rowBg = rowIdx % 2 === 0 ? '#ffffff' : '#f8fafc'
                return (
                  <tr key={col.key}>
                    <td className="sticky left-0 z-10 px-3 py-2 font-semibold text-slate-700 border-r-2 border-b border-slate-200 whitespace-nowrap"
                      style={{ background: rowBg }}>
                      {col.label}
                      <span className="text-slate-300 font-normal ml-1 text-xs">{col.unit}</span>
                    </td>
                    {sorted.map((sv, idx) => {
                      const v = sv[col.key] as number | null
                      const a = alertFor(col.key, v)
                      const shiftChange = idx > 0 && getTurno(new Date(sv.horario)) !== getTurno(new Date(sorted[idx-1].horario))
                      const cls = alertBg(a)
                      const bgOverride = a === 'crit' ? '#fef2f2' : a === 'warn' ? '#fff7ed' : a === 'low' ? '#f0f9ff' : rowBg
                      return (
                        <td key={sv.id}
                          className={`px-2 py-1.5 text-center border-r border-b border-slate-100 text-xs ${cls} ${shiftChange ? 'border-l-2 border-l-indigo-100' : ''}`}
                          style={{ background: bgOverride }}>
                          {v != null ? v : <span className="text-slate-200">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit individual reading modal */}
      {editSv && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setEditSv(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-bold text-slate-800">
                ✏️ Editando leitura — {new Date(editSv.horario).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
                {' '}{editSv.turno === 'diurno' ? '☀️' : '🌙'}
              </p>
              <button onClick={() => setEditSv(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {COLS.map(col => {
                const isPam = col.key === 'pam'
                const pasN = parseFloat(editForm.pas), padN = parseFloat(editForm.pad)
                const autoP = !isNaN(pasN) && !isNaN(padN) ? Math.round((pasN + 2*padN)/3) : null
                const isPamAuto = isPam && editForm.pam === '' && autoP !== null
                return (
                  <div key={col.key} className="border border-slate-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-slate-500 mb-1">{col.label} <span className="text-slate-300">{col.unit}</span></p>
                    <input
                      type="number" step={col.step ?? '1'} min={col.min} max={col.max}
                      value={isPamAuto ? autoP! : editForm[col.key]}
                      readOnly={isPamAuto}
                      onChange={e => !isPamAuto && setEditForm(f => ({...f, [col.key]: e.target.value}))}
                      onBlur={e => {
                        if (!isPamAuto) {
                          const c = clampInput(col.key, e.target.value)
                          if (c !== e.target.value) setEditForm(f => ({...f, [col.key]: c}))
                        }
                      }}
                      placeholder="—"
                      className={`w-full text-sm font-semibold focus:outline-none bg-transparent placeholder-slate-200 ${isPamAuto ? 'text-indigo-400' : ''}`}
                    />
                  </div>
                )
              })}
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleDeleteSv(editSv.id)}
                className="px-4 py-2 text-sm text-red-500 hover:text-red-700 border border-red-100 hover:border-red-300 rounded-lg transition-colors">
                🗑️ Excluir
              </button>
              <button onClick={() => setEditSv(null)} className="flex-1 border border-slate-300 text-slate-600 text-sm font-semibold py-2 rounded-lg hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleSaveEditSv} disabled={editSaving}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg">
                {editSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300"/>Crítico</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-200"/>Atenção</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-100 border border-sky-200"/>Baixo</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 border-l-2 border-indigo-300"/>Mudança de turno</span>
          <span className="flex items-center gap-1 text-indigo-400">PAM calculado automaticamente (PAS+2×PAD)/3</span>
        </div>
      )}
    </div>
  )
}
