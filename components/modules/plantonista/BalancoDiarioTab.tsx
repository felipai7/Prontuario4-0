'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  calcDiurese24h, fmtTurno, fmtNum, hojeISO, boundaryStart,
  balancoDaUnidade, balancoDeOutrasUnidades,
} from '@/lib/utils'
import TabelaRolavel from '@/components/ui/TabelaRolavel'
import BalancoAnteriorLeitura from './BalancoAnteriorLeitura'
import { evalMath, temPontoInvalido, ExprField } from './balancoCampos'
import type { Paciente, PeriodoBalanco, ToastData } from '@/types'

// Balanço do Hospital: 1 lançamento por DIA (não por turno de 12h como a
// UTI), tipicamente retroativo — hoje anota o de ontem. Sem água endógena,
// perdas insensíveis, saldo acumulado nem "saldo do dia": nem todo ganho é
// quantificado no Hospital (diferente da UTI), então um saldo calculado
// sairia falsamente negativo. A tabela mostra só os valores lançados; o
// destaque é a diurese das últimas 24h, com os mesmos selos de
// anúria/oligúria da UTI (continuam válidos por dia).

interface Props {
  paciente: Paciente
  periodos: PeriodoBalanco[]
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

type RowType = 'gain' | 'loss'
type RowDef  = { key: string; label: string; type: RowType }

const ROWS: RowDef[] = [
  { key: 'venoso',       label: 'Venoso',                  type: 'gain' },
  { key: 'oral_enteral', label: 'Oral/Enteral',             type: 'gain' },
  { key: 'diurese',      label: 'Diurese',                  type: 'loss' },
  { key: 'dialise',      label: 'Ultrafiltração Efetiva',   type: 'loss' },
  { key: 'evacuacao',    label: 'Evacuação',                type: 'loss' },
  { key: 'febre',        label: 'Febre',                    type: 'loss' },
  { key: 'dreno',        label: 'Dreno',                    type: 'loss' },
  { key: 'vomitos',      label: 'Vômitos',                  type: 'loss' },
  { key: 'sne_sng',      label: 'SNG/SNE',                  type: 'loss' },
  { key: 'ostomia',      label: 'Ostomia',                  type: 'loss' },
  { key: 'outros',       label: 'Outros',                   type: 'loss' },
]
const SEPARATOR_AFTER = 'oral_enteral'

function cellCls(type: RowType): string {
  return type === 'gain' ? 'text-emerald-700' : 'text-red-600'
}
function fmtVal(value: number): string {
  return value === 0 ? '0' : value.toFixed(0)
}

type FormState = {
  venoso: string; oral_enteral: string;
  diurese: string; dialise: string; evacuacao: string; febre: string;
  dreno: string; vomitos: string; sne_sng: string; ostomia: string;
  outros: string; outros_nome: string;
}
function emptyForm(): FormState {
  return { venoso:'0', oral_enteral:'0', diurese:'0', dialise:'0', evacuacao:'0',
           febre:'0', dreno:'0', vomitos:'0', sne_sng:'0', ostomia:'0',
           outros:'0', outros_nome:'' }
}
const CAMPOS_GANHO = ['venoso','oral_enteral'] as const
const CAMPOS_PERDA = ['diurese','dialise','evacuacao','febre','dreno','vomitos','sne_sng','ostomia','outros'] as const
const LABELS: Record<string, string> = {
  venoso:'Venoso', oral_enteral:'Oral/Enteral',
  diurese:'Diurese', dialise:'Ultrafiltração Efetiva', evacuacao:'Evacuação', febre:'Febre',
  dreno:'Dreno', vomitos:'Vômitos', sne_sng:'SNG/SNE', ostomia:'Ostomia', outros:'Outros',
}

// Dia como período de 24h: das 07:00 de hoje às 07:00 de amanhã — mesmo
// horário de corte da UTI (equivalente a um turno diurno + um noturno
// seguidos), não meia-noite a meia-noite. Reaproveita boundaryStart, que já
// calcula esse mesmo horário de início pro turno diurno da UTI.
function diaParaPeriodo(dataStr: string): { inicio: Date; fim: Date } {
  const inicio = boundaryStart(dataStr, 'diurno')
  return { inicio, fim: new Date(inicio.getTime() + 24 * 3_600_000) }
}

export default function BalancoDiarioTab({ paciente, periodos: periodosTodos, onRefresh, showToast }: Props) {
  const supabase = createClient()

  // Balanço não se mistura entre unidades — mesma regra do BalancoTab (UTI).
  const periodos = balancoDaUnidade(periodosTodos, paciente.unit_id)
  const periodosOutrasUnidades = balancoDeOutrasUnidades(periodosTodos, paciente.unit_id)

  const [formMode,       setFormMode]       = useState<'add' | 'edit' | null>(null)
  const [editingPeriodo, setEditingPeriodo]  = useState<PeriodoBalanco | null>(null)
  const [form,           setForm]           = useState<FormState>(emptyForm())
  const [saving,         setSaving]         = useState(false)
  const [diarreica,      setDiarreica]      = useState(false)
  const [formDate,       setFormDate]       = useState(hojeISO)

  const setField = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }))

  const camposComPontoInvalido = (): string[] =>
    [...CAMPOS_GANHO, ...CAMPOS_PERDA].filter(k => temPontoInvalido(form[k as keyof FormState]))

  const sorted     = [...periodos].sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime())
  const sortedDesc = [...sorted].reverse()

  const { horas: duHoras, total: duTotal } = calcDiurese24h(periodos)
  const lastEvac    = [...sorted].reverse().find(p => p.evacuacao > 0)
  const lastDialise = [...sorted].reverse().find(p => p.dialise > 0)

  // Sugestão: o dia seguinte ao último lançado (capado em hoje) — ou hoje,
  // se ainda não há nenhum registro.
  const sugeridoStr = (() => {
    if (sorted.length === 0) return hojeISO()
    const ultimo = new Date(sorted[sorted.length - 1].inicio)
    const proximo = hojeISO(new Date(ultimo.getTime() + 24 * 3_600_000))
    return proximo > hojeISO() ? hojeISO() : proximo
  })()

  const diaDuplicado = formMode === 'add' && !!formDate &&
    sorted.some(p => hojeISO(new Date(p.inicio)) === formDate)
  const diaFuturo = formMode === 'add' && !!formDate && formDate > hojeISO()

  const peso = paciente.peso_kg ?? 70

  const abrirNovoDia = () => {
    setFormDate(sugeridoStr)
    setFormMode('add')
  }

  const handleSave = async () => {
    if (!formDate) return
    if (diaDuplicado) { showToast('Já existe um registro para esse dia — edite-o em vez de duplicar', 'error'); return }
    if (diaFuturo) { showToast('Esse dia ainda não chegou — não dá pra lançar balanço de um dia futuro', 'error'); return }
    const comPonto = camposComPontoInvalido()
    if (comPonto.length > 0) {
      showToast(`Use vírgula, não ponto, em: ${comPonto.map(k => LABELS[k]).join(', ')}`, 'error'); return
    }
    setSaving(true)
    const { inicio, fim } = diaParaPeriodo(formDate)
    const { error } = await supabase.from('periodos_balanco').insert({
      paciente_id: paciente.id,
      unit_id: paciente.unit_id,
      inicio: inicio.toISOString(), fim: fim.toISOString(),
      turno: 'diario', horas_periodo: 24,
      venoso: evalMath(form.venoso), oral_enteral: evalMath(form.oral_enteral),
      agua_endogena: 0,
      diurese: evalMath(form.diurese), dialise: evalMath(form.dialise),
      febre: evalMath(form.febre), evacuacao: evalMath(form.evacuacao),
      dreno: evalMath(form.dreno), vomitos: evalMath(form.vomitos),
      sne_sng: evalMath(form.sne_sng), ostomia: evalMath(form.ostomia),
      outros: evalMath(form.outros),
      outros_nome: evalMath(form.outros) > 0 ? (form.outros_nome.trim() || null) : null,
      perdas_insensiveis: 0,
      diarreica_medico: evalMath(form.evacuacao) > 0 ? diarreica : null,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    cancelForm(); onRefresh(); showToast('Balanço do dia registrado!')
  }

  const startEdit = (p: PeriodoBalanco) => {
    setEditingPeriodo(p)
    setDiarreica(p.diarreica_medico ?? false)
    setFormDate(hojeISO(new Date(p.inicio)))
    setForm({
      venoso: String(p.venoso), oral_enteral: String(p.oral_enteral),
      diurese: String(p.diurese), dialise: String(p.dialise),
      febre: String(p.febre), evacuacao: String(p.evacuacao),
      dreno: String(p.dreno), vomitos: String(p.vomitos),
      sne_sng: String(p.sne_sng), ostomia: String(p.ostomia),
      outros: String(p.outros), outros_nome: p.outros_nome ?? '',
    })
    setFormMode('edit')
  }

  const handleUpdate = async () => {
    if (!editingPeriodo) return
    const comPonto = camposComPontoInvalido()
    if (comPonto.length > 0) {
      showToast(`Use vírgula, não ponto, em: ${comPonto.map(k => LABELS[k]).join(', ')}`, 'error'); return
    }
    setSaving(true)
    const { error } = await supabase.from('periodos_balanco').update({
      venoso: evalMath(form.venoso), oral_enteral: evalMath(form.oral_enteral),
      diurese: evalMath(form.diurese), dialise: evalMath(form.dialise),
      febre: evalMath(form.febre), evacuacao: evalMath(form.evacuacao),
      dreno: evalMath(form.dreno), vomitos: evalMath(form.vomitos),
      sne_sng: evalMath(form.sne_sng), ostomia: evalMath(form.ostomia),
      outros: evalMath(form.outros),
      outros_nome: evalMath(form.outros) > 0 ? (form.outros_nome.trim() || null) : null,
      diarreica_medico: evalMath(form.evacuacao) > 0 ? diarreica : null,
    }).eq('id', editingPeriodo.id)
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    cancelForm(); onRefresh(); showToast('Balanço do dia atualizado!')
  }

  const cancelForm = () => {
    setFormMode(null); setEditingPeriodo(null); setForm(emptyForm()); setDiarreica(false)
  }

  const handleDeletePeriodo = async (p: PeriodoBalanco) => {
    if (!confirm(`Excluir o balanço de ${fmtTurno(p.turno, p.inicio)} por completo? Isso apaga o registro inteiro (não dá pra desfazer).`)) return
    const { error } = await supabase.from('periodos_balanco').delete().eq('id', p.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    if (formMode === 'edit' && editingPeriodo?.id === p.id) cancelForm()
    onRefresh()
    showToast('Registro excluído.')
  }

  const formSpec = formMode === 'edit' && editingPeriodo
    ? { label: fmtTurno(editingPeriodo.turno, editingPeriodo.inicio), sub: 'Editando registro existente' }
    : formDate
      ? { label: fmtTurno('diario', diaParaPeriodo(formDate).inicio.toISOString()), sub: '24h — 07:00 de hoje às 07:00 de amanhã' }
      : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Diurese 24h — mesmo destaque/selos da UTI, sem o card de saldo do
            dia (ver comentário no topo do arquivo). */}
        {(() => {
          const duMlKgH = duHoras > 0 ? duTotal / peso / duHoras : null
          const isAnuria   = duMlKgH !== null && duMlKgH < 0.1
          const isOliguria = duMlKgH !== null && duMlKgH >= 0.1 && duMlKgH < 0.5
          const cardCls  = isAnuria ? 'bg-red-50 border-red-400' : isOliguria ? 'bg-orange-50 border-orange-300' : 'bg-sky-50 border-sky-200'
          const labelCls = isAnuria ? 'text-red-600' : isOliguria ? 'text-orange-600' : 'text-sky-600'
          const valueCls = isAnuria ? 'text-red-800' : isOliguria ? 'text-orange-700' : 'text-sky-800'
          return (
            <div className={`rounded-xl p-3 border ${cardCls}`}>
              <p className={`text-xs font-semibold mb-1 ${labelCls}`}>💧 Diurese (24h)</p>
              <p className={`text-2xl font-black ${valueCls}`}>{periodos.length ? `${duTotal.toFixed(0)} mL` : '—'}</p>
              {duMlKgH !== null && (
                <p className={`text-xs font-bold mt-1 ${valueCls}`}>
                  {fmtNum(duMlKgH, 2)} mL/Kg/h
                  {isAnuria   && <span className="ml-1.5 bg-red-600 text-white text-xs font-black px-1.5 py-0.5 rounded-full">🚨 ANÚRIA</span>}
                  {isOliguria && <span className="ml-1.5 bg-orange-500 text-white text-xs font-black px-1.5 py-0.5 rounded-full">⚠️ OLIGÚRIA</span>}
                </p>
              )}
              {!paciente.peso_kg && duMlKgH !== null && (
                <p className="text-xs text-slate-400 mt-0.5">Usando 70 Kg (peso não cadastrado)</p>
              )}
            </div>
          )
        })()}

        <div className={`rounded-xl p-3 border ${lastEvac ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
          <p className={`text-xs font-semibold mb-1 ${lastEvac ? 'text-amber-600' : 'text-slate-500'}`}>🚽 Última Evacuação</p>
          {lastEvac ? (
            <>
              <p className="text-2xl font-black text-amber-800">{lastEvac.evacuacao.toFixed(0)} mL</p>
              <p className="text-xs text-amber-600 mt-0.5">{fmtTurno(lastEvac.turno, lastEvac.inicio)}</p>
            </>
          ) : <p className="text-sm font-semibold text-slate-500">Ausente desde admissão</p>}
        </div>

        {lastDialise && (
          <div className="rounded-xl p-3 border bg-cyan-50 border-cyan-200">
            <p className="text-xs font-semibold mb-1 text-cyan-600">🩸 Última Diálise (UF)</p>
            <p className="text-2xl font-black text-cyan-800">{lastDialise.dialise.toFixed(0)} mL</p>
            <p className="text-xs text-cyan-600 mt-0.5">{fmtTurno(lastDialise.turno, lastDialise.inicio)}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">Registros ({periodos.length} dia{periodos.length !== 1 ? 's' : ''})</h3>
        {formMode === null ? (
          <button onClick={abrirNovoDia}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
            + Novo Dia
          </button>
        ) : (
          <button onClick={cancelForm}
            className="text-slate-500 hover:text-slate-700 text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
            ✕ Cancelar
          </button>
        )}
      </div>

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

          {formMode === 'add' && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Dia</label>
                <input type="date" value={formDate} max={hojeISO()} onChange={e => setFormDate(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
              </div>
              {diaDuplicado && (
                <p className="text-xs text-red-600 font-semibold">⚠️ Já existe registro para este dia — edite-o na tabela abaixo</p>
              )}
              {!diaDuplicado && diaFuturo && (
                <p className="text-xs text-red-600 font-semibold">⚠️ Esse dia ainda não chegou</p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-1">🟢 Ganhos (mL)</p>
            <p className="text-xs text-slate-400 mb-2 italic">Aceita expressões: ex. 200+100+50 = 350 · deixe em branco/0 se não foi quantificado</p>
            <div className="grid grid-cols-2 gap-2">
              {CAMPOS_GANHO.map(k => (
                <ExprField key={k} label={LABELS[k]} value={form[k as keyof FormState]}
                  onChange={v => setField(k as keyof FormState, v)} />
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-red-600 uppercase tracking-wide mb-2">🔴 Perdas (mL)</p>
            <div className="grid grid-cols-2 gap-2">
              {CAMPOS_PERDA.map(k => (
                <ExprField key={k} label={LABELS[k]} value={form[k as keyof FormState]}
                  onChange={v => setField(k as keyof FormState, v)} />
              ))}
            </div>
          </div>

          {evalMath(form.outros) > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
              <label className="text-xs text-slate-500 block mb-1">O que é essa perda &quot;Outros&quot;?</label>
              <input type="text" value={form.outros_nome}
                onChange={e => setField('outros_nome', e.target.value)}
                placeholder="Ex.: drenagem torácica, paracentese..."
                className="w-full text-base font-medium focus:outline-none bg-transparent" />
            </div>
          )}

          {evalMath(form.evacuacao) > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg px-3 py-2.5">
              <p className="text-sm font-medium text-amber-900 mb-1.5">A evacuação foi diarreica?</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setDiarreica(true)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    diarreica ? 'border-amber-500 bg-amber-100 text-amber-800' : 'border-slate-300 bg-white text-slate-600'}`}>
                  Sim
                </button>
                <button type="button" onClick={() => setDiarreica(false)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    !diarreica ? 'border-slate-500 bg-slate-100 text-slate-800' : 'border-slate-300 bg-white text-slate-600'}`}>
                  Não
                </button>
              </div>
              <p className="text-[11px] text-amber-700 mt-1.5">Fezes líquidas (Bristol 6–7).</p>
            </div>
          )}

          <button onClick={formMode === 'add' ? handleSave : handleUpdate}
            disabled={saving || (formMode === 'add' && (diaDuplicado || diaFuturo)) || camposComPontoInvalido().length > 0}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {saving ? 'Salvando...' : formMode === 'add' ? 'Registrar Balanço do Dia' : 'Atualizar Balanço'}
          </button>
        </div>
      )}

      {periodos.length === 0 && formMode === null && (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhum balanço registrado — opcional para este paciente.</p>
      )}

      {sorted.length > 0 && (
        <TabelaRolavel className="rounded-xl border border-slate-200 shadow-sm">
          <table className="min-w-max w-full text-xs border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-100 px-3 py-2.5 text-left font-bold text-slate-700 border-b-2 border-r-2 border-slate-300 min-w-[150px]">
                  Componente
                </th>
                {sortedDesc.map(p => (
                  <th key={p.id} className="px-2 py-2 bg-slate-100 border-b-2 border-r border-slate-200 text-center min-w-[80px]">
                    <p className="font-bold text-slate-800 text-xs whitespace-nowrap">{fmtTurno(p.turno, p.inicio)}</p>
                    <div className="mt-1 flex items-center justify-center gap-1.5">
                      <button onClick={() => startEdit(p)} title="Editar este dia"
                        className={`text-xs transition-colors ${formMode === 'edit' && editingPeriodo?.id === p.id ? 'text-amber-500' : 'text-indigo-300 hover:text-indigo-600'}`}>
                        ✏️
                      </button>
                      <button onClick={() => handleDeletePeriodo(p)} title="Excluir este dia inteiro"
                        className="text-xs text-red-300 hover:text-red-600 transition-colors">
                        🗑️
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, rowIdx) => {
                const isSep = row.key === SEPARATOR_AFTER
                const rowBg = rowIdx % 2 === 0 ? '#fff' : '#f8fafc'
                const labelCls = row.type === 'gain' ? 'text-emerald-700' : 'text-red-600'
                return (
                  <tr key={row.key} className={isSep ? 'border-b-2 border-slate-300' : ''}>
                    <td className={`sticky left-0 z-10 px-3 py-2 border-r-2 border-b border-slate-200 whitespace-nowrap font-medium ${labelCls}`}
                      style={{ background: rowBg }}>
                      {row.label}
                    </td>
                    {sortedDesc.map(p => {
                      const v = (p as unknown as Record<string, number>)[row.key] ?? 0
                      const isEditing = formMode === 'edit' && editingPeriodo?.id === p.id
                      const title = row.key === 'outros' && p.outros_nome ? p.outros_nome : undefined
                      return (
                        <td key={p.id} title={title}
                          className={`px-2 py-2 text-center border-r border-b border-slate-100 text-xs ${cellCls(row.type)} ${isEditing ? 'ring-1 ring-inset ring-amber-300' : ''}`}
                          style={{ background: rowBg }}>
                          {fmtVal(v)}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TabelaRolavel>
      )}

      <BalancoAnteriorLeitura periodos={periodosOutrasUnidades} />
    </div>
  )
}
