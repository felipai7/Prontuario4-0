'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtTurno, getTurno, sugerirProximoTurno } from '@/lib/utils'
import type { Paciente, AvaliacaoNeurologica, EscalaNeuro, Sedativo, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  historico: AvaliacaoNeurologica[]
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const RASS_DESCRICOES: Record<number, string> = {
  [-5]: 'Não desperta',
  [-4]: 'Sedação profunda',
  [-3]: 'Sedação moderada',
  [-2]: 'Sedação leve',
  [-1]: 'Sonolento',
  0:    'Alerta e calmo',
  1:    'Inquieto',
  2:    'Agitado',
  3:    'Muito agitado',
  4:    'Combativo',
}
const RASS_VALORES = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4]

const GLASGOW_COMPONENTES = [
  { key: 'ao' as const, label: 'Abertura Ocular (AO)',   valores: [1, 2, 3, 4] },
  { key: 'rv' as const, label: 'Resposta Verbal (RV)',   valores: [1, 2, 3, 4, 5] },
  { key: 'rm' as const, label: 'Resposta Motora (RM)',   valores: [1, 2, 3, 4, 5, 6] },
]

// FOUR (Full Outline of UnResponsiveness): preferida ao Glasgow em paciente
// intubado/sedado — não depende de resposta verbal, e ainda captura reflexo
// de tronco e padrão respiratório. Cada componente vai de 0 a 4 (total 0-16).
const FOUR_COMPONENTES: { key: 'ocular' | 'motor' | 'tronco' | 'respiratorio'; label: string; descricoes: Record<number, string> }[] = [
  {
    key: 'ocular', label: 'Ocular (E)', descricoes: {
      4: 'Abertas, rastreiam ou piscam ao comando',
      3: 'Abertas, sem rastreamento',
      2: 'Fechadas, abrem à voz alta',
      1: 'Fechadas, abrem à dor',
      0: 'Permanecem fechadas à dor',
    },
  },
  {
    key: 'motor', label: 'Motor (M)', descricoes: {
      4: 'Sinal de positivo, punho fechado ou "V" a comando',
      3: 'Localiza a dor',
      2: 'Flexão à dor',
      1: 'Extensão à dor',
      0: 'Sem resposta à dor, ou mioclonia generalizada',
    },
  },
  {
    key: 'tronco', label: 'Tronco (B)', descricoes: {
      4: 'Reflexos pupilar e corneano presentes',
      3: 'Uma pupila fixa e dilatada',
      2: 'Reflexo pupilar ou corneano ausente',
      1: 'Reflexos pupilar e corneano ausentes',
      0: 'Reflexos pupilar, corneano e de tosse ausentes',
    },
  },
  {
    key: 'respiratorio', label: 'Respiratório (R)', descricoes: {
      4: 'Não intubado, padrão regular',
      3: 'Não intubado, padrão Cheyne-Stokes',
      2: 'Não intubado, padrão irregular',
      1: 'Respira acima da frequência do ventilador',
      0: 'Respira na frequência do ventilador, ou apneia',
    },
  },
]

const SEDATIVOS: Sedativo[] = ['Propofol', 'Midazolam', 'Fentanil', 'Dexmedetomidina', 'Cetamina', 'Outro']

const labelCls = 'text-xs text-slate-500 font-medium block mb-1'
const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400'

function Chip({ selected, onClick, children, title }: {
  selected: boolean; onClick: () => void; children: React.ReactNode; title?: string
}) {
  return (
    <button type="button" onClick={onClick} title={title}
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
  escala: EscalaNeuro
  rass: number | null
  ao: number | null; rv: number | null; rm: number | null
  fourOcular: number | null; fourMotor: number | null; fourTronco: number | null; fourRespiratorio: number | null
  sedacao: boolean
  sedativos: Sedativo[]
  sedativoOutro: string
  despertarDiario: boolean | null
}

function emptyForm(): FormState {
  return {
    escala: 'RASS', rass: null, ao: null, rv: null, rm: null,
    fourOcular: null, fourMotor: null, fourTronco: null, fourRespiratorio: null,
    sedacao: false, sedativos: [], sedativoOutro: '', despertarDiario: null,
  }
}

function formFromRegistro(r: AvaliacaoNeurologica): FormState {
  return {
    escala: r.escala ?? 'RASS',
    rass: r.rass, ao: r.glasgow_ao, rv: r.glasgow_rv, rm: r.glasgow_rm,
    fourOcular: r.four_ocular, fourMotor: r.four_motor, fourTronco: r.four_tronco, fourRespiratorio: r.four_respiratorio,
    sedacao: r.sedacao_em_uso, sedativos: r.sedativos ?? [], sedativoOutro: r.sedativo_outro ?? '',
    despertarDiario: r.despertar_diario,
  }
}

function resumoEscala(r: AvaliacaoNeurologica): string {
  if (r.escala === 'GLASGOW' && r.glasgow_ao != null && r.glasgow_rv != null && r.glasgow_rm != null) {
    return `Glasgow ${r.glasgow_ao + r.glasgow_rv + r.glasgow_rm} (AO ${r.glasgow_ao}, RV ${r.glasgow_rv}, RM ${r.glasgow_rm})`
  }
  if (r.escala === 'FOUR' && r.four_ocular != null && r.four_motor != null && r.four_tronco != null && r.four_respiratorio != null) {
    return `FOUR ${r.four_ocular + r.four_motor + r.four_tronco + r.four_respiratorio}/16 (E${r.four_ocular} M${r.four_motor} B${r.four_tronco} R${r.four_respiratorio})`
  }
  if (r.rass != null) return `RASS ${r.rass > 0 ? '+' : ''}${r.rass}: ${RASS_DESCRICOES[r.rass]}`
  return 'Não avaliado'
}

export default function NeurologicoTab({ paciente, historico, onRefresh, showToast }: Props) {
  const supabase = createClient()

  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null)
  const [editingRegistro, setEditingRegistro] = useState<AvaliacaoNeurologica | null>(null)
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

  const glasgowTotal = form.ao != null && form.rv != null && form.rm != null ? form.ao + form.rv + form.rm : null
  const fourTotal = form.fourOcular != null && form.fourMotor != null && form.fourTronco != null && form.fourRespiratorio != null
    ? form.fourOcular + form.fourMotor + form.fourTronco + form.fourRespiratorio : null

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  const toggleSedativo = (s: Sedativo) => {
    setField('sedativos', form.sedativos.includes(s) ? form.sedativos.filter(x => x !== s) : [...form.sedativos, s])
  }

  const openAdd = () => {
    const sugestao = sugerirProximoTurno(historico)
    setFormDate(sugestao.data); setFormTurno(sugestao.turno)
    setForm(emptyForm())
    setFormMode('add')
  }

  const startEdit = (r: AvaliacaoNeurologica) => {
    setEditingRegistro(r)
    setForm(formFromRegistro(r))
    setFormMode('edit')
  }

  const cancelForm = () => { setFormMode(null); setEditingRegistro(null); setForm(emptyForm()) }

  const handleSave = async () => {
    if (form.sedacao && form.sedativos.includes('Outro') && !form.sedativoOutro.trim()) {
      showToast('Especifique o sedativo "Outro"', 'error'); return
    }
    if (formMode === 'add' && duplicado) {
      showToast('Já existe um registro para esse turno — edite-o em vez de duplicar', 'error'); return
    }
    setSaving(true)
    const payload = {
      escala: form.escala,
      rass: form.rass,
      glasgow_ao: form.ao, glasgow_rv: form.rv, glasgow_rm: form.rm,
      four_ocular: form.fourOcular, four_motor: form.fourMotor,
      four_tronco: form.fourTronco, four_respiratorio: form.fourRespiratorio,
      sedacao_em_uso: form.sedacao,
      sedativos: form.sedacao && form.sedativos.length ? form.sedativos : null,
      sedativo_outro: form.sedacao && form.sedativos.includes('Outro') ? (form.sedativoOutro.trim() || null) : null,
      despertar_diario: form.sedacao ? form.despertarDiario : null,
    }

    if (formMode === 'add') {
      const { error } = await supabase.from('avaliacoes_neurologicas').insert({
        paciente_id: paciente.id, data: formDate, turno: formTurno, ...payload,
      })
      setSaving(false)
      if (error) { showToast('Erro: ' + error.message, 'error'); return }
      showToast('Avaliação neurológica registrada!')
    } else if (editingRegistro) {
      const { error } = await supabase.from('avaliacoes_neurologicas').update(payload).eq('id', editingRegistro.id)
      setSaving(false)
      if (error) { showToast('Erro: ' + error.message, 'error'); return }
      showToast('Avaliação neurológica atualizada!')
    }
    cancelForm(); onRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">🧠 Avaliações Neurológicas ({historico.length})</h3>
        <div className="flex gap-2">
          {sorted.length > 1 && (
            <button onClick={() => setHistoryOpen(h => !h)} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">
              {historyOpen ? '▲' : '▼'} Histórico ({sorted.length - 1})
            </button>
          )}
          {formMode === null ? (
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

      {/* Registro mais recente, somente leitura, quando não há formulário aberto */}
      {formMode === null && ultimo && (
        <div className="border border-indigo-200 bg-indigo-50 rounded-xl p-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-indigo-700">{fmtTurno(ultimo.turno, ultimo.data + 'T12:00:00')} (mais recente)</p>
            <p className="text-sm text-indigo-900 mt-0.5">
              {resumoEscala(ultimo)}
              {ultimo.sedacao_em_uso
                ? `, sedado com ${(ultimo.sedativos ?? []).map(s => s === 'Outro' ? (ultimo.sedativo_outro || 'outro') : s).join(' + ') || 'sedativo não especificado'}`
                : ', sem sedação'}
            </p>
          </div>
          <button onClick={() => startEdit(ultimo)}
            className="text-xs text-indigo-500 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-400 px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0">
            ✏️ Editar
          </button>
        </div>
      )}

      {!ultimo && formMode === null && (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhuma avaliação registrada</p>
      )}

      {/* Form */}
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

          {/* Escala */}
          <section className="space-y-3">
            <div>
              <label className={labelCls}>Escala</label>
              <div className="flex gap-2">
                <Chip selected={form.escala === 'RASS'} onClick={() => setField('escala', 'RASS')}>RASS</Chip>
                <Chip selected={form.escala === 'GLASGOW'} onClick={() => setField('escala', 'GLASGOW')}>Glasgow</Chip>
                <Chip selected={form.escala === 'FOUR'} onClick={() => setField('escala', 'FOUR')}>FOUR</Chip>
              </div>
            </div>

            {form.escala === 'RASS' && (
              <div>
                <label className={labelCls}>RASS {form.rass != null && <span className="text-indigo-600 font-bold">— {form.rass > 0 ? '+' : ''}{form.rass}: {RASS_DESCRICOES[form.rass]}</span>}</label>
                <div className="flex gap-1.5 flex-wrap">
                  {RASS_VALORES.map(v => (
                    <Chip key={v} selected={form.rass === v} onClick={() => setField('rass', form.rass === v ? null : v)}
                      title={`${v > 0 ? '+' : ''}${v} — ${RASS_DESCRICOES[v]}`}>
                      {v > 0 ? `+${v}` : v}
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            {form.escala === 'GLASGOW' && (
              <div className="space-y-3">
                {GLASGOW_COMPONENTES.map(comp => {
                  const valor = comp.key === 'ao' ? form.ao : comp.key === 'rv' ? form.rv : form.rm
                  const key: 'ao' | 'rv' | 'rm' = comp.key
                  return (
                    <div key={comp.key}>
                      <label className={labelCls}>{comp.label}</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {comp.valores.map(v => (
                          <Chip key={v} selected={valor === v} onClick={() => setField(key, valor === v ? null : v)}>{v}</Chip>
                        ))}
                      </div>
                    </div>
                  )
                })}
                <div className={`rounded-lg p-3 text-sm font-bold ${glasgowTotal != null ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-50 text-slate-400'}`}>
                  Glasgow total: {glasgowTotal != null ? `${glasgowTotal} / 15` : 'selecione os três componentes'}
                </div>
              </div>
            )}

            {form.escala === 'FOUR' && (
              <div className="space-y-3">
                {FOUR_COMPONENTES.map(comp => {
                  const valor = form[comp.key === 'ocular' ? 'fourOcular' : comp.key === 'motor' ? 'fourMotor' : comp.key === 'tronco' ? 'fourTronco' : 'fourRespiratorio']
                  const key = comp.key === 'ocular' ? 'fourOcular' : comp.key === 'motor' ? 'fourMotor' : comp.key === 'tronco' ? 'fourTronco' : 'fourRespiratorio'
                  return (
                    <div key={comp.key}>
                      <label className={labelCls}>{comp.label} {valor != null && <span className="text-indigo-600 font-bold">— {comp.descricoes[valor]}</span>}</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {[4, 3, 2, 1, 0].map(v => (
                          <Chip key={v} selected={valor === v} onClick={() => setField(key, valor === v ? null : v)} title={comp.descricoes[v]}>
                            {v}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  )
                })}
                <div className={`rounded-lg p-3 text-sm font-bold ${fourTotal != null ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-50 text-slate-400'}`}>
                  FOUR total: {fourTotal != null ? `${fourTotal} / 16` : 'selecione os quatro componentes'}
                </div>
              </div>
            )}
          </section>

          {/* Sedação */}
          <section className="space-y-3 pt-3 border-t border-indigo-200">
            <div>
              <label className={labelCls}>Em uso de sedativos?</label>
              <div className="flex gap-2">
                <Chip selected={form.sedacao} onClick={() => setField('sedacao', true)}>Sim</Chip>
                <Chip selected={!form.sedacao} onClick={() => setForm(f => ({ ...f, sedacao: false, sedativos: [], sedativoOutro: '', despertarDiario: null }))}>Não</Chip>
              </div>
            </div>

            {form.sedacao && (
              <>
                <div>
                  <label className={labelCls}>Quais sedativos (múltipla escolha)</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {SEDATIVOS.map(s => (
                      <Chip key={s} selected={form.sedativos.includes(s)} onClick={() => toggleSedativo(s)}>{s}</Chip>
                    ))}
                  </div>
                  {form.sedativos.includes('Outro') && (
                    <input value={form.sedativoOutro} onChange={e => setField('sedativoOutro', e.target.value)}
                      placeholder="Qual sedativo?" className={`${inputCls} mt-2 max-w-sm`} />
                  )}
                </div>

                <div>
                  <label className={labelCls}>Despertar diário</label>
                  <div className="flex gap-2">
                    <Chip selected={form.despertarDiario === true} onClick={() => setField('despertarDiario', true)}>Sim</Chip>
                    <Chip selected={form.despertarDiario === false} onClick={() => setField('despertarDiario', false)}>Não</Chip>
                  </div>
                </div>
              </>
            )}
          </section>

          <button onClick={handleSave} disabled={saving || (formMode === 'add' && !!duplicado)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {saving ? 'Salvando...' : formMode === 'add' ? '+ Registrar Avaliação' : '💾 Salvar Alterações'}
          </button>
        </div>
      )}

      {/* Histórico */}
      {historyOpen && sorted.length > 1 && (
        <div className="space-y-2 pt-2 border-t border-slate-200">
          {sorted.slice(1).map(r => (
            <div key={r.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-600">{fmtTurno(r.turno, r.data + 'T12:00:00')}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {resumoEscala(r)}
                  {r.sedacao_em_uso ? ', sedado' : ', sem sedação'}
                </p>
              </div>
              <button onClick={() => startEdit(r)}
                className="text-xs text-indigo-400 hover:text-indigo-700 border border-indigo-100 hover:border-indigo-300 px-2 py-1.5 rounded-lg transition-colors flex-shrink-0">
                ✏️ Editar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
