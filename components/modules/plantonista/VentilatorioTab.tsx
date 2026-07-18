'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData, diasDesde, fmtTurno, sugerirProximoTurno } from '@/lib/utils'
import type { Paciente, SuporteVentilatorio, ModalidadeVentilatoria, DispositivoO2, ViaAereaVM, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  historico: SuporteVentilatorio[]
  /** Registro é da fisioterapia; os demais veem em modo leitura. */
  podeEditar: boolean
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const MODALIDADES: { id: ModalidadeVentilatoria; label: string }[] = [
  { id: 'ar_ambiente',         label: '🌬️ Ar ambiente' },
  { id: 'o2_suplementar',      label: '💨 O₂ suplementar' },
  { id: 'ventilacao_mecanica', label: '🫁 Ventilação mecânica' },
]
const DISPOSITIVOS_O2: DispositivoO2[] = ['Cateter nasal', 'Máscara facial', 'Máscara com reservatório', 'CNAF', 'VNI', 'Outro']
const VIAS_VM: ViaAereaVM[] = ['TOT', 'TQT']

const labelCls = 'text-xs text-slate-500 font-medium block mb-1'
const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400'

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
        selected
          ? 'bg-indigo-600 border-indigo-600 text-white'
          : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-600'
      }`}>
      {children}
    </button>
  )
}

type FormState = {
  modalidade: ModalidadeVentilatoria | null
  dispositivo: DispositivoO2 | null
  fluxo: string
  vmVia: ViaAereaVM | null
  vmDataInicio: string
}

function emptyForm(): FormState {
  return { modalidade: null, dispositivo: null, fluxo: '', vmVia: null, vmDataInicio: '' }
}

function formFromRegistro(v: SuporteVentilatorio): FormState {
  return {
    modalidade: v.modalidade, dispositivo: v.o2_dispositivo,
    fluxo: v.o2_fluxo_l_min != null ? String(v.o2_fluxo_l_min) : '',
    vmVia: v.vm_via, vmDataInicio: v.vm_data_inicio ?? '',
  }
}

function resumoLinha(v: SuporteVentilatorio): string {
  if (!v.modalidade) return 'Não avaliado'
  if (v.modalidade === 'ar_ambiente') return 'Ar ambiente'
  if (v.modalidade === 'o2_suplementar') return `O₂ suplementar${v.o2_dispositivo ? ` por ${v.o2_dispositivo}` : ''}${v.o2_fluxo_l_min != null ? ` a ${v.o2_fluxo_l_min} L/min` : ''}`
  return `Ventilação mecânica${v.vm_via ? ` via ${v.vm_via}` : ''}`
}

export default function VentilatorioTab({ paciente, historico, podeEditar, onRefresh, showToast }: Props) {
  const supabase = createClient()
  const hoje = new Date().toISOString().split('T')[0]

  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null)
  const [editingRegistro, setEditingRegistro] = useState<SuporteVentilatorio | null>(null)
  const [formDate,  setFormDate]  = useState(() => sugerirProximoTurno(historico).data)
  const [formTurno, setFormTurno] = useState<'diurno' | 'noturno'>(() => sugerirProximoTurno(historico).turno)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const sorted = [...historico].sort((a, b) =>
    new Date(b.data + 'T00:00:00').getTime() - new Date(a.data + 'T00:00:00').getTime() || b.turno.localeCompare(a.turno)
  )
  const ultimo = sorted[0] ?? null

  const duplicado = formMode === 'add'
    ? historico.find(h => h.data === formDate && h.turno === formTurno)
    : undefined

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  const selecionarModalidade = (m: ModalidadeVentilatoria) => {
    setField('modalidade', m)
    if (m === 'ventilacao_mecanica' && !form.vmDataInicio) setField('vmDataInicio', hoje)
  }

  const openAdd = () => {
    const sugestao = sugerirProximoTurno(historico)
    setFormDate(sugestao.data); setFormTurno(sugestao.turno)
    setForm(emptyForm())
    setFormMode('add')
  }

  const startEdit = (v: SuporteVentilatorio) => {
    setEditingRegistro(v)
    setForm(formFromRegistro(v))
    setFormMode('edit')
  }

  const cancelForm = () => { setFormMode(null); setEditingRegistro(null); setForm(emptyForm()) }

  const handleSave = async () => {
    if (!form.modalidade) { showToast('Selecione a modalidade', 'error'); return }
    if (formMode === 'add' && duplicado) {
      showToast('Já existe um registro para esse turno — edite-o em vez de duplicar', 'error'); return
    }
    setSaving(true)
    const payload = {
      modalidade: form.modalidade,
      o2_dispositivo: form.dispositivo,
      o2_fluxo_l_min: form.fluxo ? parseFloat(form.fluxo) : null,
      vm_via: form.vmVia,
      vm_data_inicio: form.vmDataInicio || null,
    }

    if (formMode === 'add') {
      const { error } = await supabase.from('suportes_ventilatorios').insert({
        paciente_id: paciente.id, data: formDate, turno: formTurno, ...payload,
      })
      setSaving(false)
      if (error) { showToast('Erro: ' + error.message, 'error'); return }
      showToast('Suporte ventilatório registrado!')
    } else if (editingRegistro) {
      const { error } = await supabase.from('suportes_ventilatorios').update(payload).eq('id', editingRegistro.id)
      setSaving(false)
      if (error) { showToast('Erro: ' + error.message, 'error'); return }
      showToast('Suporte ventilatório atualizado!')
    }
    cancelForm(); onRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">🫁 Suporte Ventilatório ({historico.length})</h3>
        <div className="flex gap-2">
          {sorted.length > 1 && (
            <button onClick={() => setHistoryOpen(h => !h)} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">
              {historyOpen ? '▲' : '▼'} Histórico ({sorted.length - 1})
            </button>
          )}
          {!podeEditar ? null : formMode === null ? (
            <button onClick={openAdd}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
              + Novo Registro
            </button>
          ) : (
            <button onClick={cancelForm}
              className="text-slate-500 hover:text-slate-700 text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
              ✕ Cancelar
            </button>
          )}
        </div>
      </div>

      {formMode === null && ultimo && (
        <div className="border border-indigo-200 bg-indigo-50 rounded-xl p-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-indigo-700">{fmtTurno(ultimo.turno, ultimo.data + 'T12:00:00')} (mais recente)</p>
            <p className="text-sm text-indigo-900 mt-0.5">
              {resumoLinha(ultimo)}
              {ultimo.modalidade === 'ventilacao_mecanica' && ultimo.vm_data_inicio && (
                <span className="font-bold"> — {diasDesde(ultimo.vm_data_inicio)} dia(s) de VM (desde {fmtData(ultimo.vm_data_inicio)})</span>
              )}
            </p>
          </div>
          {podeEditar && (
            <button onClick={() => startEdit(ultimo)}
              className="text-xs text-indigo-500 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-400 px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0">
              ✏️ Editar
            </button>
          )}
        </div>
      )}

      {!podeEditar && (
        <p className="text-xs text-slate-400">
          Registrado pela fisioterapia. Você vê o histórico, mas não edita.
        </p>
      )}

      {!ultimo && formMode === null && (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhum suporte ventilatório registrado</p>
      )}

      {formMode !== null && (
        <div className="border-2 border-indigo-200 rounded-xl p-4 bg-indigo-50 space-y-4">
          {formMode === 'add' ? (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Data</label>
                <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
              </div>
              <div className="flex rounded-lg overflow-hidden border border-slate-300">
                {(['diurno','noturno'] as const).map(t => (
                  <button key={t} onClick={() => setFormTurno(t)}
                    className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                      formTurno === t ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}>
                    {t === 'diurno' ? '☀️ Diurno (07–18h)' : '🌙 Noturno (19–06h)'}
                  </button>
                ))}
              </div>
              {duplicado && (
                <p className="text-xs text-red-600 font-semibold">⚠️ Já existe registro para este turno — edite-o no histórico</p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="font-semibold text-indigo-900 text-sm">{editingRegistro && fmtTurno(editingRegistro.turno, editingRegistro.data + 'T12:00:00')}</p>
              <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded-full">✏️ Editando</span>
            </div>
          )}

          <div>
            <label className={labelCls}>Modalidade</label>
            <div className="flex gap-2 flex-wrap">
              {MODALIDADES.map(m => (
                <Chip key={m.id} selected={form.modalidade === m.id} onClick={() => selecionarModalidade(m.id)}>{m.label}</Chip>
              ))}
            </div>
          </div>

          {form.modalidade === 'o2_suplementar' && (
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Dispositivo</label>
                <div className="flex gap-1.5 flex-wrap">
                  {DISPOSITIVOS_O2.map(d => (
                    <Chip key={d} selected={form.dispositivo === d} onClick={() => setField('dispositivo', form.dispositivo === d ? null : d)}>{d}</Chip>
                  ))}
                </div>
                {form.dispositivo === 'VNI' && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">
                    ⚠️ VNI é <strong>intermitente</strong>: marcar aqui significa que o paciente
                    fez sessões neste turno, não que ficou em VNI o turno inteiro. O episódio
                    (com objetivo e desfecho) é registrado na aba Fisioterapia Respiratória.
                  </p>
                )}
              </div>
              <div>
                <label className={labelCls}>Fluxo (L/min) — opcional</label>
                <input type="number" step="0.5" min="0" max="80" value={form.fluxo}
                  onChange={e => setField('fluxo', e.target.value)} className={`${inputCls} max-w-[10rem]`} />
              </div>
            </div>
          )}

          {form.modalidade === 'ventilacao_mecanica' && (
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Via aérea</label>
                <div className="flex gap-2">
                  {VIAS_VM.map(v => (
                    <Chip key={v} selected={form.vmVia === v} onClick={() => setField('vmVia', form.vmVia === v ? null : v)}>{v}</Chip>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Data de início da VM</label>
                <input type="date" value={form.vmDataInicio} max={hoje}
                  onChange={e => setField('vmDataInicio', e.target.value)} className={`${inputCls} max-w-[12rem]`} />
                {form.vmDataInicio && (
                  <p className="text-sm font-bold text-indigo-700 mt-2">
                    ⏱️ {diasDesde(form.vmDataInicio)} dia(s) de VM (desde {fmtData(form.vmDataInicio)})
                  </p>
                )}
              </div>
            </div>
          )}

          <button onClick={handleSave} disabled={saving || (formMode === 'add' && !!duplicado)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {saving ? 'Salvando...' : formMode === 'add' ? '+ Registrar Suporte' : '💾 Salvar Alterações'}
          </button>
        </div>
      )}

      {historyOpen && sorted.length > 1 && (
        <div className="space-y-2 pt-2 border-t border-slate-200">
          {sorted.slice(1).map(v => (
            <div key={v.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-600">{fmtTurno(v.turno, v.data + 'T12:00:00')}</p>
                <p className="text-xs text-slate-500 mt-0.5">{resumoLinha(v)}</p>
              </div>
              {podeEditar && (
                <button onClick={() => startEdit(v)}
                  className="text-xs text-indigo-400 hover:text-indigo-700 border border-indigo-100 hover:border-indigo-300 px-2 py-1.5 rounded-lg transition-colors flex-shrink-0">
                  ✏️ Editar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
