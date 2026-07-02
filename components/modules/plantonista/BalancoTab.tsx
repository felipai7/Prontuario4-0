'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  calcAguaEndogena, calcPerdasInsensiveis, calcBalanco,
  calcAcumuladoTotal, calcAcumuladoMovel, calcFirstPeriod, calcNextPeriod,
  fmtTurno, colorParcial
} from '@/lib/utils'
import type { Paciente, PeriodoBalanco, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  periodos: PeriodoBalanco[]
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

// ── Arithmetic expression evaluator ──────────────────────────────────────────
function evalMath(expr: string): number {
  const clean = (expr ?? '').trim()
  if (!clean || clean === '0') return 0
  if (!/^[\d\s+\-*/().]+$/.test(clean)) return parseFloat(clean) || 0
  try {
    const result = new Function('return (' + clean + ')')()
    if (typeof result === 'number' && isFinite(result)) return Math.max(0, Math.round(result * 10) / 10)
  } catch {}
  return parseFloat(clean) || 0
}

// ── Row definitions (without subtotal rows) ───────────────────────────────────
type RowType = 'gain' | 'loss' | 'auto' | 'parcial' | 'acum'
type RowDef  = { key: string; label: string; type: RowType }

const ROWS: RowDef[] = [
  { key: 'venoso',             label: 'Venoso',              type: 'gain' },
  { key: 'oral_enteral',       label: 'Oral/Enteral',        type: 'gain' },
  { key: 'agua_endogena',      label: 'Água Endógena',       type: 'auto' },
  { key: 'diurese',            label: 'Diurese',             type: 'loss' },
  { key: 'dialise',            label: 'UF Diálise',          type: 'loss' },
  { key: 'febre',              label: 'Febre',               type: 'loss' },
  { key: 'evacuacao',          label: 'Evacuação',           type: 'loss' },
  { key: 'dreno',              label: 'Dreno',               type: 'loss' },
  { key: 'vomitos',            label: 'Vômitos',             type: 'loss' },
  { key: 'sne_sng',            label: 'SNG/SNE',             type: 'loss' },
  { key: 'ostomia',            label: 'Ostomia',             type: 'loss' },
  { key: 'perdas_insensiveis', label: 'Perdas Insensíveis',  type: 'auto' },
  { key: '__parcial',          label: 'Saldo Parcial',       type: 'parcial' },
  { key: '__acumulado',        label: 'Acumulado',           type: 'acum' },
]

// Separator between gains block and losses block
const SEPARATOR_AFTER = 'agua_endogena'

function getVal(key: string, p: PeriodoBalanco, acum: number): number {
  switch (key) {
    case '__parcial':   return calcBalanco(p).parcial
    case '__acumulado': return acum
    default:            return (p as any)[key] ?? 0
  }
}

function cellCls(type: RowType, value: number): string {
  if (type === 'gain')    return 'text-emerald-700'
  if (type === 'loss')    return 'text-red-600'
  if (type === 'auto')    return 'text-slate-400 italic'
  // parcial / acum
  if (value > 500)  return 'bg-red-50 text-red-700 font-bold'
  if (value > 0)    return 'text-orange-500 font-semibold'
  if (value > -500) return 'text-emerald-600 font-semibold'
  return 'bg-blue-50 text-blue-700 font-bold'
}

function fmtVal(type: RowType, value: number): string {
  if (type === 'parcial' || type === 'acum')
    return `${value > 0 ? '+' : ''}${value.toFixed(0)}`
  return value === 0 ? '0' : value.toFixed(0)
}

// ── Form state ────────────────────────────────────────────────────────────────
type FormState = {
  venoso: string; oral_enteral: string;
  diurese: string; dialise: string; febre: string; evacuacao: string;
  dreno: string; vomitos: string; sne_sng: string; ostomia: string;
}
function emptyForm(): FormState {
  return { venoso:'0', oral_enteral:'0', diurese:'0', dialise:'0', febre:'0',
           evacuacao:'0', dreno:'0', vomitos:'0', sne_sng:'0', ostomia:'0' }
}

const CAMPOS_GANHO = ['venoso','oral_enteral'] as const
const CAMPOS_PERDA = ['diurese','dialise','febre','evacuacao','dreno','vomitos','sne_sng','ostomia'] as const
const LABELS: Record<string, string> = {
  venoso:'Venoso', oral_enteral:'Oral/Enteral',
  diurese:'Diurese', dialise:'UF Diálise', febre:'Febre', evacuacao:'Evacuação',
  dreno:'Dreno', vomitos:'Vômitos', sne_sng:'SNG/SNE', ostomia:'Ostomia',
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function BalancoTab({ paciente, periodos, onRefresh, showToast }: Props) {
  const supabase = createClient()

  const [formMode,       setFormMode]       = useState<'add' | 'edit' | null>(null)
  const [editingPeriodo, setEditingPeriodo] = useState<PeriodoBalanco | null>(null)
  const [form,           setForm]           = useState<FormState>(emptyForm())
  const [saving,         setSaving]         = useState(false)

  const setField = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }))

  const sorted = [...periodos].sort((a, b) =>
    new Date(a.inicio).getTime() - new Date(b.inicio).getTime()
  )

  // Running accumulator
  const acumulados = sorted.reduce<number[]>((acc, p, i) => {
    const prev = i === 0 ? 0 : acc[i - 1]
    return [...acc, prev + calcBalanco(p).parcial]
  }, [])

  // Débito urinário 24h: sum diurese from newest periods covering 24h of horas_periodo
  let duHoras = 0, duTotal = 0
  for (const p of [...sorted].reverse()) {
    if (duHoras >= 24) break
    duHoras += p.horas_periodo
    duTotal  += p.diurese
  }
  const duLabel  = duHoras >= 24
    ? 'Débito Urinário 24h'
    : duHoras > 0 ? `Débito Urinário (últ. ${duHoras.toFixed(0)}h)` : 'Débito Urinário'

  // Última evacuação
  const lastEvac = [...sorted].reverse().find(p => p.evacuacao > 0)

  // Next period spec
  const horaHHMM    = (paciente.hora_internacao ?? '12:00').substring(0, 5)
  const admissionISO = `${paciente.data_internacao}T${horaHHMM}:00`
  let periodSpec: ReturnType<typeof calcFirstPeriod> | null = null
  try {
    periodSpec = periodos.length === 0
      ? calcFirstPeriod(admissionISO)
      : calcNextPeriod(periodos[periodos.length - 1].fim)
  } catch {}

  const peso    = paciente.peso_kg ?? 70
  const horas   = formMode === 'edit' && editingPeriodo ? editingPeriodo.horas_periodo : (periodSpec?.horas ?? 12)
  const aguaEnd = calcAguaEndogena(horas)
  const perdIns = calcPerdasInsensiveis(peso, horas)

  // ── Save new ──
  const handleSave = async () => {
    if (!periodSpec) return
    setSaving(true)
    const { error } = await supabase.from('periodos_balanco').insert({
      paciente_id: paciente.id,
      inicio: periodSpec.inicio.toISOString(), fim: periodSpec.fim.toISOString(),
      turno: periodSpec.turno, horas_periodo: periodSpec.horas,
      venoso: evalMath(form.venoso), oral_enteral: evalMath(form.oral_enteral),
      agua_endogena: aguaEnd,
      diurese: evalMath(form.diurese), dialise: evalMath(form.dialise),
      febre: evalMath(form.febre), evacuacao: evalMath(form.evacuacao),
      dreno: evalMath(form.dreno), vomitos: evalMath(form.vomitos),
      sne_sng: evalMath(form.sne_sng), ostomia: evalMath(form.ostomia),
      perdas_insensiveis: perdIns,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    cancelForm(); onRefresh(); showToast('Balanço registrado!')
  }

  // ── Edit existing ──
  const startEdit = (p: PeriodoBalanco) => {
    setEditingPeriodo(p)
    setForm({
      venoso: String(p.venoso), oral_enteral: String(p.oral_enteral),
      diurese: String(p.diurese), dialise: String(p.dialise),
      febre: String(p.febre), evacuacao: String(p.evacuacao),
      dreno: String(p.dreno), vomitos: String(p.vomitos),
      sne_sng: String(p.sne_sng), ostomia: String(p.ostomia),
    })
    setFormMode('edit')
  }

  const handleUpdate = async () => {
    if (!editingPeriodo) return
    setSaving(true)
    const { error } = await supabase.from('periodos_balanco').update({
      venoso: evalMath(form.venoso), oral_enteral: evalMath(form.oral_enteral),
      agua_endogena: aguaEnd,
      diurese: evalMath(form.diurese), dialise: evalMath(form.dialise),
      febre: evalMath(form.febre), evacuacao: evalMath(form.evacuacao),
      dreno: evalMath(form.dreno), vomitos: evalMath(form.vomitos),
      sne_sng: evalMath(form.sne_sng), ostomia: evalMath(form.ostomia),
      perdas_insensiveis: perdIns,
    }).eq('id', editingPeriodo.id)
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    cancelForm(); onRefresh(); showToast('Balanço atualizado!')
  }

  const cancelForm = () => { setFormMode(null); setEditingPeriodo(null); setForm(emptyForm()) }

  const acTotal = calcAcumuladoTotal(periodos)
  const acMovel = calcAcumuladoMovel(periodos)

  const formSpec = formMode === 'edit' && editingPeriodo
    ? { label: fmtTurno(editingPeriodo.turno, editingPeriodo.inicio), sub: 'Editando registro existente' }
    : periodSpec
      ? { label: fmtTurno(periodSpec.turno, periodSpec.inicio.toISOString()), sub: `${periodSpec.horas.toFixed(1)}h de duração` }
      : null

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Saldo Parcial"    value={periodos.length > 0 ? calcBalanco(periodos[periodos.length-1]).parcial : null} sub="Último turno"/>
        <SummaryCard label="Acumulado Total"  value={periodos.length > 0 ? acTotal : null} sub="Desde admissão"/>
        <SummaryCard label="Acumulado Móvel"  value={periodos.length > 0 ? acMovel : null} sub="Últimos 10 turnos"/>
      </div>

      {/* Highlight metrics */}
      {periodos.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {/* Débito Urinário */}
          {(() => {
            const duMlKgH = duHoras > 0 ? duTotal / peso / duHoras : null
            const isAnuria   = duMlKgH !== null && duMlKgH < 0.1
            const isOliguria = duMlKgH !== null && duMlKgH >= 0.1 && duMlKgH < 0.5
            const cardCls = isAnuria   ? 'bg-red-50 border-red-400' :
                            isOliguria ? 'bg-orange-50 border-orange-300' :
                                         'bg-sky-50 border-sky-200'
            const labelCls = isAnuria   ? 'text-red-600' :
                             isOliguria ? 'text-orange-600' : 'text-sky-600'
            const valueCls = isAnuria   ? 'text-red-800' :
                             isOliguria ? 'text-orange-700' : 'text-sky-800'
            return (
              <div className={`rounded-xl p-3 border ${cardCls}`}>
                <p className={`text-xs font-semibold mb-1 ${labelCls}`}>💧 {duLabel}</p>
                <p className={`text-2xl font-black ${valueCls}`}>{duTotal.toFixed(0)} mL</p>
                {duMlKgH !== null && (
                  <p className={`text-xs font-bold mt-1 ${valueCls}`}>
                    {duMlKgH.toFixed(2)} mL/Kg/h
                    {isAnuria   && <span className="ml-1.5 bg-red-600 text-white text-xs font-black px-1.5 py-0.5 rounded-full">🚨 ANÚRIA</span>}
                    {isOliguria && <span className="ml-1.5 bg-orange-500 text-white text-xs font-black px-1.5 py-0.5 rounded-full">⚠️ OLIGÚRIA</span>}
                  </p>
                )}
                {duHoras < 24 && duHoras > 0 && (
                  <p className={`text-xs mt-0.5 opacity-70 ${labelCls}`}>Dados de {duHoras.toFixed(0)}h disponíveis</p>
                )}
                {!paciente.peso_kg && duMlKgH !== null && (
                  <p className="text-xs text-slate-400 mt-0.5">Usando 70 Kg (peso não cadastrado)</p>
                )}
              </div>
            )
          })()}

          {/* Última Evacuação */}
          <div className={`rounded-xl p-3 border ${lastEvac ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
            <p className={`text-xs font-semibold mb-1 ${lastEvac ? 'text-amber-600' : 'text-slate-500'}`}>🚽 Última Evacuação</p>
            {lastEvac ? (
              <>
                <p className="text-2xl font-black text-amber-800">{lastEvac.evacuacao.toFixed(0)} mL</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  {new Date(lastEvac.fim).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })}
                  {' '}{lastEvac.turno === 'diurno' ? '☀️ Diurno' : '🌙 Noturno'}
                </p>
              </>
            ) : (
              <p className="text-sm font-semibold text-slate-500">Ausente desde admissão</p>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">Registros ({periodos.length} turnos)</h3>
        {formMode === null ? (
          <button
            onClick={() => periodSpec ? setFormMode('add') : showToast('Não foi possível calcular o próximo turno', 'error')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
            + Novo Turno
          </button>
        ) : (
          <button onClick={cancelForm}
            className="text-slate-500 hover:text-slate-700 text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
            ✕ Cancelar
          </button>
        )}
      </div>

      {/* Form */}
      {formMode !== null && formSpec && (
        <div className="border-2 border-indigo-200 rounded-xl p-4 bg-indigo-50 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-indigo-900 text-sm">{formSpec.label}</p>
              <p className="text-xs text-indigo-600">{formSpec.sub}</p>
            </div>
            {formMode === 'edit' && (
              <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded-full">✏️ Editando</span>
            )}
          </div>

          <div>
            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-1">🟢 Ganhos (mL)</p>
            <p className="text-xs text-slate-400 mb-2 italic">Aceita expressões: ex. 200+100+50 = 350</p>
            <div className="grid grid-cols-2 gap-2">
              {CAMPOS_GANHO.map(k => (
                <ExprField key={k} label={LABELS[k]} value={form[k as keyof FormState]}
                  onChange={v => setField(k as keyof FormState, v)} />
              ))}
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <p className="text-xs text-emerald-700 font-medium">Água Endógena (auto)</p>
                <p className="font-bold text-emerald-800">{aguaEnd.toFixed(1)} mL</p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-red-600 uppercase tracking-wide mb-2">🔴 Perdas (mL)</p>
            <div className="grid grid-cols-2 gap-2">
              {CAMPOS_PERDA.map(k => (
                <ExprField key={k} label={LABELS[k]} value={form[k as keyof FormState]}
                  onChange={v => setField(k as keyof FormState, v)} />
              ))}
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <p className="text-xs text-red-600 font-medium">Perdas Insensíveis (auto)</p>
                <p className="font-bold text-red-700">{perdIns.toFixed(1)} mL</p>
                {!paciente.peso_kg && <p className="text-xs text-red-400">Usando 70 Kg</p>}
              </div>
            </div>
          </div>

          <button onClick={formMode === 'add' ? handleSave : handleUpdate} disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {saving ? 'Salvando...' : formMode === 'add' ? 'Registrar Balanço' : 'Atualizar Balanço'}
          </button>
        </div>
      )}

      {periodos.length === 0 && formMode === null && (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhum balanço registrado</p>
      )}

      {/* ── Transposed table ── */}
      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
          <table className="min-w-max w-full text-xs border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-100 px-3 py-2.5 text-left font-bold text-slate-700 border-b-2 border-r-2 border-slate-300 min-w-[150px]">
                  Componente
                </th>
                {sorted.map((p, i) => (
                  <th key={p.id} className="px-2 py-2 bg-slate-100 border-b-2 border-r border-slate-200 text-center min-w-[80px]">
                    <p className="font-bold text-slate-800 text-xs whitespace-nowrap">{fmtTurno(p.turno, p.inicio)}</p>
                    <button onClick={() => startEdit(p)} title="Editar este turno"
                      className={`mt-1 text-xs transition-colors ${formMode === 'edit' && editingPeriodo?.id === p.id ? 'text-amber-500' : 'text-indigo-300 hover:text-indigo-600'}`}>
                      ✏️
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, rowIdx) => {
                const isSep = row.key === SEPARATOR_AFTER
                const isParcial = row.type === 'parcial'
                const isAcum    = row.type === 'acum'
                const rowBg = isParcial ? '' : isAcum ? '' : rowIdx % 2 === 0 ? '#fff' : '#f8fafc'

                const labelCls =
                  isParcial ? 'bg-indigo-50 text-indigo-800 font-bold' :
                  isAcum    ? 'bg-slate-200 text-slate-800 font-bold' :
                  row.type === 'auto' ? 'text-slate-400 italic' :
                  row.type === 'gain' ? 'text-emerald-700' : 'text-red-600'

                return (
                  <tr key={row.key} className={isSep ? 'border-b-2 border-slate-300' : ''}>
                    <td
                      className={`sticky left-0 z-10 px-3 py-2 border-r-2 border-b border-slate-200 whitespace-nowrap font-medium ${labelCls}`}
                      style={{ background: rowBg || undefined }}>
                      {row.label}
                    </td>
                    {sorted.map((p, i) => {
                      const v   = getVal(row.key, p, acumulados[i])
                      const cls = cellCls(row.type, v)
                      const isEditing = formMode === 'edit' && editingPeriodo?.id === p.id
                      return (
                        <td key={p.id}
                          className={`px-2 py-2 text-center border-r border-b border-slate-100 text-xs ${cls} ${isEditing ? 'ring-1 ring-inset ring-amber-300' : ''}`}
                          style={{ background: rowBg || undefined }}>
                          {fmtVal(row.type, v)}
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
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────
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

function ExprField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const preview = evalMath(value)
  const hasExpr = value.trim() !== '' && value.trim() !== '0' && value !== String(preview) && /[+\-*/()]/.test(value)
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="0"
        className="w-full text-sm font-semibold focus:outline-none bg-transparent"/>
      {hasExpr && <p className="text-xs text-indigo-500 mt-0.5">= {preview.toFixed(0)} mL</p>}
    </div>
  )
}
