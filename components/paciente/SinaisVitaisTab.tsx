'use client'
import { useState } from 'react'
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

const ROWS: { key: SvKey; label: string; unit: string }[] = [
  { key: 'temperatura', label: 'Temperatura', unit: '°C'   },
  { key: 'pas',         label: 'PAS',          unit: 'mmHg' },
  { key: 'pad',         label: 'PAD',          unit: 'mmHg' },
  { key: 'pam',         label: 'PAM',          unit: 'mmHg' },
  { key: 'fc',          label: 'FC',           unit: 'bpm'  },
  { key: 'fr',          label: 'FR',           unit: 'irpm' },
  { key: 'sato2',       label: 'SatO₂',        unit: '%'    },
  { key: 'hgt',         label: 'HGT',          unit: 'mg/dL'},
]

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

function cellCls(alert: Alert): { bg: string; text: string } {
  switch (alert) {
    case 'crit':  return { bg: 'bg-red-50',    text: 'text-red-700 font-bold' }
    case 'warn':  return { bg: 'bg-orange-50', text: 'text-orange-700 font-semibold' }
    case 'low':   return { bg: 'bg-sky-50',    text: 'text-sky-700 font-semibold' }
    case 'empty': return { bg: '',             text: 'text-slate-200' }
    default:      return { bg: '',             text: 'text-slate-700' }
  }
}

type FormState = { data: string; hora: string; obs: string } & Record<SvKey, string>

function emptyForm(): FormState {
  const now = new Date()
  return {
    data: now.toISOString().split('T')[0],
    hora: now.toTimeString().slice(0, 5),
    temperatura: '', pas: '', pad: '', pam: '', fc: '', fr: '', sato2: '', hgt: '',
    obs: '',
  }
}

export default function SinaisVitaisTab({ paciente, sinais, onRefresh, showToast }: Props) {
  const supabase   = createClient()
  const [formOpen, setFormOpen]  = useState(false)
  const [form,     setForm]      = useState<FormState>(emptyForm())
  const [saving,   setSaving]    = useState(false)
  const [editId,   setEditId]    = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const sf = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }))

  const pasN = parseFloat(form.pas), padN = parseFloat(form.pad)
  const pamCalc = !isNaN(pasN) && !isNaN(padN) ? Math.round((pasN + 2 * padN) / 3) : null

  const sorted = [...sinais].sort((a, b) => new Date(a.horario).getTime() - new Date(b.horario).getTime())
  const latest = sorted[sorted.length - 1] ?? null

  const buildPayload = () => {
    const horario = new Date(`${form.data}T${form.hora}:00`)
    return {
      paciente_id: paciente.id,
      horario: horario.toISOString(),
      turno: getTurno(horario),
      temperatura: form.temperatura ? parseFloat(form.temperatura) : null,
      pas:         form.pas         ? parseInt(form.pas)           : null,
      pad:         form.pad         ? parseInt(form.pad)           : null,
      pam:         form.pam         ? parseInt(form.pam)           : (pamCalc ?? null),
      fc:          form.fc          ? parseInt(form.fc)            : null,
      fr:          form.fr          ? parseInt(form.fr)            : null,
      sato2:       form.sato2       ? parseFloat(form.sato2)       : null,
      hgt:         form.hgt         ? parseFloat(form.hgt)         : null,
      observacoes: form.obs.trim() || null,
    }
  }

  const handleSave = async () => {
    setSaving(true)
    const payload = buildPayload()
    const { error } = editId
      ? await supabase.from('sinais_vitais').update(payload).eq('id', editId)
      : await supabase.from('sinais_vitais').insert(payload)
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast(editId ? 'Sinal vital atualizado!' : 'Sinal vital registrado!')
    setFormOpen(false); setEditId(null); setForm(emptyForm()); onRefresh()
  }

  const startEdit = (sv: SinalVital) => {
    const dt = new Date(sv.horario)
    setForm({
      data:        dt.toISOString().split('T')[0],
      hora:        dt.toTimeString().slice(0, 5),
      temperatura: sv.temperatura != null ? String(sv.temperatura) : '',
      pas:         sv.pas  != null ? String(sv.pas)  : '',
      pad:         sv.pad  != null ? String(sv.pad)  : '',
      pam:         sv.pam  != null ? String(sv.pam)  : '',
      fc:          sv.fc   != null ? String(sv.fc)   : '',
      fr:          sv.fr   != null ? String(sv.fr)   : '',
      sato2:       sv.sato2 != null ? String(sv.sato2) : '',
      hgt:         sv.hgt  != null ? String(sv.hgt)  : '',
      obs:         sv.observacoes ?? '',
    })
    setEditId(sv.id); setFormOpen(true)
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

      const rows = leituras.map((l: any) => {
        const [h, m] = (l.horario ?? '00:00').split(':')
        const horario = new Date(`${dateStr}T${(h||'0').padStart(2,'0')}:${(m||'00').padStart(2,'0')}:00`)
        return {
          paciente_id: paciente.id,
          horario: horario.toISOString(),
          turno: getTurno(horario),
          temperatura: l.temperatura ?? null,
          pas: l.pas ?? null, pad: l.pad ?? null, pam: l.pam ?? null,
          fc: l.fc ?? null, fr: l.fr ?? null, sato2: l.sato2 ?? null, hgt: l.hgt ?? null,
          observacoes: null,
        }
      })
      const { error } = await supabase.from('sinais_vitais').insert(rows)
      if (error) throw error
      showToast(`${rows.length} leituras importadas com sucesso!`)
      onRefresh()
    } catch (err: any) { showToast('Erro: ' + err.message, 'error') }
    setImporting(false); if (e.target) e.target.value = ''
  }

  return (
    <div className="space-y-4">

      {/* Summary cards */}
      {latest && (
        <div>
          <p className="text-xs text-slate-400 mb-2">
            Última leitura: {new Date(latest.horario).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}
            {' '}{latest.turno === 'diurno' ? '☀️' : '🌙'}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {ROWS.map(r => {
              const v = latest[r.key] as number | null
              const a = alertFor(r.key, v)
              const cls = cellCls(a)
              const borderCls = a === 'crit' ? 'border-red-300' : a === 'warn' ? 'border-orange-200' : a === 'low' ? 'border-sky-200' : 'border-slate-200'
              return (
                <div key={r.key} className={`rounded-xl border p-2 text-center ${cls.bg || 'bg-white'} ${borderCls}`}>
                  <p className="text-xs text-slate-500 mb-0.5">{r.label}</p>
                  <p className={`text-lg font-black leading-tight ${cls.text}`}>
                    {v != null ? v : '—'}
                  </p>
                  {v != null && <p className="text-xs text-slate-400">{r.unit}</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-700">Leituras ({sinais.length})</h3>
        <div className="flex gap-2">
          <label className={`cursor-pointer flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors ${importing ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {importing ? '⏳ Importando...' : '📷 Importar foto'}
            <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleImport} disabled={importing}/>
          </label>
          <button
            onClick={() => { if (formOpen && !editId) { setFormOpen(false) } else { setFormOpen(true); setEditId(null); setForm(emptyForm()) }}}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
            {formOpen && !editId ? '✕ Cancelar' : '+ Nova Leitura'}
          </button>
        </div>
      </div>

      {/* Form */}
      {formOpen && (
        <div className="border-2 border-indigo-200 rounded-xl p-4 bg-indigo-50 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-indigo-900">{editId ? '✏️ Editando leitura' : 'Nova leitura'}</p>
            <div className="flex gap-2">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Data</label>
                <input type="date" value={form.data} onChange={e => sf('data', e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Hora</label>
                <input type="time" value={form.hora} onChange={e => sf('hora', e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {ROWS.map(r => (
              <div key={r.key} className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                <p className="text-xs text-slate-500 mb-1">{r.label} <span className="text-slate-300">{r.unit}</span></p>
                <input
                  type="number"
                  step={r.key === 'temperatura' || r.key === 'sato2' ? '0.1' : '1'}
                  value={form[r.key]}
                  onChange={e => sf(r.key, e.target.value)}
                  placeholder="—"
                  className="w-full text-sm font-semibold focus:outline-none bg-transparent placeholder-slate-200"/>
                {r.key === 'pam' && pamCalc !== null && !form.pam && (
                  <p className="text-xs text-indigo-400 mt-0.5">≈ {pamCalc} mmHg</p>
                )}
              </div>
            ))}
          </div>

          <div>
            <label className="text-xs text-slate-500 font-medium block mb-1">Observações</label>
            <input value={form.obs} onChange={e => sf('obs', e.target.value)} placeholder="Opcional"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
          </div>

          <button onClick={handleSave} disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {saving ? 'Salvando...' : editId ? 'Atualizar Leitura' : 'Registrar Leitura'}
          </button>
        </div>
      )}

      {sinais.length === 0 && !formOpen && (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhuma leitura registrada</p>
      )}

      {/* Pivot table */}
      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
          <table className="min-w-max w-full text-xs border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-100 px-3 py-2.5 text-left font-bold text-slate-700 border-b-2 border-r-2 border-slate-300 min-w-[120px]">
                  Sinal Vital
                </th>
                {sorted.map((sv, idx) => {
                  const dt = new Date(sv.horario)
                  const shiftChange = idx > 0 && getTurno(dt) !== getTurno(new Date(sorted[idx-1].horario))
                  const isDiurno = getTurno(dt) === 'diurno'
                  return (
                    <th key={sv.id}
                      className={`px-2 py-1.5 text-center bg-slate-100 border-b-2 border-r border-slate-200 min-w-[58px] whitespace-nowrap ${shiftChange ? 'border-l-2 border-l-indigo-300' : ''}`}>
                      <p className={`font-semibold text-xs ${isDiurno ? 'text-amber-600' : 'text-indigo-600'}`}>
                        {dt.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}
                      </p>
                      <p className="text-slate-400 font-normal text-xs">
                        {dt.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'})}
                      </p>
                      <button onClick={() => startEdit(sv)}
                        className="text-indigo-300 hover:text-indigo-600 text-xs mt-0.5">✏️</button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, rowIdx) => {
                const rowBg = rowIdx % 2 === 0 ? '#ffffff' : '#f8fafc'
                return (
                  <tr key={row.key}>
                    <td className="sticky left-0 z-10 px-3 py-2 font-semibold text-slate-700 border-r-2 border-b border-slate-200 whitespace-nowrap"
                      style={{ background: rowBg }}>
                      {row.label}
                      <span className="text-slate-300 font-normal ml-1 text-xs">{row.unit}</span>
                    </td>
                    {sorted.map((sv, idx) => {
                      const v = sv[row.key] as number | null
                      const a = alertFor(row.key, v)
                      const cls = cellCls(a)
                      const shiftChange = idx > 0 && getTurno(new Date(sv.horario)) !== getTurno(new Date(sorted[idx-1].horario))
                      return (
                        <td key={sv.id}
                          className={`px-2 py-2 text-center border-r border-b border-slate-100 text-xs ${cls.bg} ${cls.text} ${shiftChange ? 'border-l-2 border-l-indigo-100' : ''}`}
                          style={{ background: a === 'empty' || !cls.bg ? rowBg : undefined }}>
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

      {/* Legend */}
      {sorted.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300"/>{' '}Crítico (fora da margem segura)</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-200"/>{' '}Atenção</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-100 border border-sky-200"/>{' '}Abaixo do esperado</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 border-l-2 border-indigo-300"/>{' '}Mudança de turno</span>
        </div>
      )}
    </div>
  )
}
