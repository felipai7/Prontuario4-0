'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  calcAguaEndogena, calcPerdasInsensiveis, calcBalanco,
  calcAcumuladoTotal, calcAcumuladoMovel, calcFirstPeriod, calcNextPeriod,
  fmtTurno, colorParcial, pad
} from '@/lib/utils'
import type { Paciente, PeriodoBalanco, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  periodos: PeriodoBalanco[]
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const CAMPOS_GANHO  = ['venoso','oral_enteral'] as const
const CAMPOS_PERDA  = ['diurese','dialise','febre','evacuacao','dreno','vomitos','sne_sng','ostomia'] as const
const LABELS: Record<string, string> = {
  venoso:'Venoso', oral_enteral:'Oral/Enteral', agua_endogena:'Água Endógena (auto)',
  diurese:'Diurese', dialise:'UF Diálise', febre:'Febre', evacuacao:'Evacuação',
  dreno:'Dreno', vomitos:'Vômitos', sne_sng:'SNE/SNG', ostomia:'Ostomia',
  perdas_insensiveis:'Perdas Insensíveis (auto)',
}

type FormState = {
  venoso: string; oral_enteral: string;
  diurese: string; dialise: string; febre: string; evacuacao: string;
  dreno: string; vomitos: string; sne_sng: string; ostomia: string;
}

function emptyForm(): FormState {
  return { venoso:'0', oral_enteral:'0', diurese:'0', dialise:'0', febre:'0', evacuacao:'0', dreno:'0', vomitos:'0', sne_sng:'0', ostomia:'0' }
}

export default function BalancoTab({ paciente, periodos, onRefresh, showToast }: Props) {
  const supabase  = createClient()
  const [adding,  setAdding]  = useState(false)
  const [form,    setForm]    = useState<FormState>(emptyForm())
  const [saving,  setSaving]  = useState(false)

  // Determine next period spec
  // Normalise to HH:MM before appending :00 — avoids "T12:00:00:00" if stored with seconds
  const horaHHMM    = (paciente.hora_internacao ?? '12:00').substring(0, 5)
  const admissionISO = `${paciente.data_internacao}T${horaHHMM}:00`
  const isFirstPeriod = periodos.length === 0
  const periodSpec = isFirstPeriod
    ? calcFirstPeriod(admissionISO)
    : calcNextPeriod(periodos[periodos.length - 1].fim)

  const peso    = paciente.peso_kg ?? 70
  const aguaEnd = calcAguaEndogena(periodSpec.horas)
  const perdIns = calcPerdasInsensiveis(peso, periodSpec.horas)

  const setField = (k: keyof FormState, v: string) =>
    setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    const toNum = (v: string) => parseFloat(v) || 0
    const { error } = await supabase.from('periodos_balanco').insert({
      paciente_id:        paciente.id,
      inicio:             periodSpec.inicio.toISOString(),
      fim:                periodSpec.fim.toISOString(),
      turno:              periodSpec.turno,
      horas_periodo:      periodSpec.horas,
      venoso:             toNum(form.venoso),
      oral_enteral:       toNum(form.oral_enteral),
      agua_endogena:      aguaEnd,
      diurese:            toNum(form.diurese),
      dialise:            toNum(form.dialise),
      febre:              toNum(form.febre),
      evacuacao:          toNum(form.evacuacao),
      dreno:              toNum(form.dreno),
      vomitos:            toNum(form.vomitos),
      sne_sng:            toNum(form.sne_sng),
      ostomia:            toNum(form.ostomia),
      perdas_insensiveis: perdIns,
    })
    setSaving(false)
    if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return }
    setAdding(false); setForm(emptyForm()); onRefresh()
    showToast('Balanço registrado!')
  }

  const acTotal = calcAcumuladoTotal(periodos)
  const acMovel = calcAcumuladoMovel(periodos)

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          label="Balanço Parcial"
          value={periodos.length > 0 ? calcBalanco(periodos[periodos.length-1]).parcial : null}
          sub="Último turno"
        />
        <SummaryCard label="Acumulado Total" value={periodos.length > 0 ? acTotal : null} sub="Desde admissão" />
        <SummaryCard label="Acumulado Móvel" value={periodos.length > 0 ? acMovel : null} sub="Últimos 10 turnos (5 dias)" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">Registros ({periodos.length} turnos)</h3>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
            + Novo Turno
          </button>
        )}
      </div>

      {/* Add form */}
      {adding && (
        <div className="border-2 border-indigo-200 rounded-xl p-4 bg-indigo-50 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-indigo-900 text-sm">
                {fmtTurno(periodSpec.turno, periodSpec.inicio.toISOString())}
              </p>
              <p className="text-xs text-indigo-600">{periodSpec.horas.toFixed(1)}h de duração</p>
            </div>
            <button onClick={() => { setAdding(false); setForm(emptyForm()) }}
              className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
          </div>

          {/* Ganhos */}
          <div>
            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-2">🟢 Ganhos (mL)</p>
            <div className="grid grid-cols-2 gap-2">
              {CAMPOS_GANHO.map(k => (
                <FormField key={k} label={LABELS[k]} value={form[k as keyof FormState]}
                  onChange={v => setField(k as keyof FormState, v)} />
              ))}
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <p className="text-xs text-emerald-700 font-medium">{LABELS.agua_endogena}</p>
                <p className="font-bold text-emerald-800">{aguaEnd.toFixed(1)}</p>
              </div>
            </div>
          </div>

          {/* Perdas */}
          <div>
            <p className="text-xs font-bold text-red-600 uppercase tracking-wide mb-2">🔴 Perdas (mL)</p>
            <div className="grid grid-cols-2 gap-2">
              {CAMPOS_PERDA.map(k => (
                <FormField key={k} label={LABELS[k]} value={form[k as keyof FormState]}
                  onChange={v => setField(k as keyof FormState, v)} />
              ))}
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <p className="text-xs text-red-600 font-medium">{LABELS.perdas_insensiveis}</p>
                <p className="font-bold text-red-700">{perdIns.toFixed(1)}</p>
                {!paciente.peso_kg && <p className="text-xs text-red-400">Peso não registrado (usando 70 Kg)</p>}
              </div>
            </div>
          </div>

          <button onClick={handleSave} disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {saving ? 'Salvando...' : 'Registrar Balanço'}
          </button>
        </div>
      )}

      {/* Periods table */}
      {periodos.length === 0 && !adding ? (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhum balanço registrado</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Turno</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-emerald-700">Ganhos</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-red-600">Perdas</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Parcial</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...periodos].reverse().map((p, i) => {
                const { ganhos, perdas, parcial } = calcBalanco(p)
                return (
                  <tr key={p.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="text-xs">{fmtTurno(p.turno, p.inicio)}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-700 font-medium">+{ganhos.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right text-red-600 font-medium">-{perdas.toFixed(0)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${colorParcial(parcial)}`}>
                      {parcial > 0 ? '+' : ''}{parcial.toFixed(0)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-slate-100 border-t-2 border-slate-300">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-xs font-bold text-slate-600">Acumulado Total</td>
                <td className={`px-3 py-2 text-right font-bold ${colorParcial(acTotal)}`}>
                  {acTotal > 0 ? '+' : ''}{acTotal.toFixed(0)} mL
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="px-3 py-2 text-xs font-bold text-slate-600">Acumulado Móvel (10 turnos)</td>
                <td className={`px-3 py-2 text-right font-bold ${colorParcial(acMovel)}`}>
                  {acMovel > 0 ? '+' : ''}{acMovel.toFixed(0)} mL
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, sub }: { label: string; value: number | null; sub: string }) {
  const cls = value == null ? 'text-slate-300' : colorParcial(value)
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-xl font-black ${cls}`}>
        {value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(0)}`}
      </p>
      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
    </div>
  )
}

function FormField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <input
        type="number" value={value} onChange={e => onChange(e.target.value)}
        min="0" step="1"
        className="w-full text-sm font-semibold focus:outline-none bg-transparent"
      />
    </div>
  )
}
