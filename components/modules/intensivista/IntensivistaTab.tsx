'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData, diaAtualATB } from '@/lib/utils'
import { ATBS_SUGERIDOS, FOCOS_INFECCIOSOS } from '@/lib/config'
import Combobox from '@/components/ui/Combobox'
import type { Paciente, ATB, CuidadosHorizontais, ViaIBP, ViaAnticoag, Objetivo, DrogaAnticoag, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  atbs: ATB[]
  cuidados: CuidadosHorizontais | null
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const VIAS_IBP: ViaIBP[] = ['Oral', 'Endovenoso']
const VIAS_ANTICOAG: ViaAnticoag[] = ['Subcutâneo', 'Endovenoso', 'Oral']
const DROGAS_ANTICOAG: DrogaAnticoag[] = ['Enoxaparina', 'Heparina Não Fracionada', 'Apixabana', 'Rivaroxabana', 'Outro']
const UNIDADES_DOSE = ['mg', 'mg/kg', 'UI', 'UI/h', 'UI/kg/h']

function atbEmAlerta(atb: ATB): boolean {
  const dia = diaAtualATB(atb)
  if (atb.dias_previstos != null) return dia >= atb.dias_previstos
  return dia > 7
}

function noScrollInput(e: React.WheelEvent<HTMLInputElement>) { e.currentTarget.blur() }
function noArrowInput(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault()
}

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400'
const labelCls = 'text-xs text-slate-500 font-medium block mb-1'

export default function IntensivistaTab({ paciente, atbs, cuidados, onRefresh, showToast }: Props) {
  const supabase = createClient()

  // ── ATB form ─────────────────────────────────────────────────────────────
  const [atbFormOpen,   setAtbFormOpen]   = useState(false)
  const [atbDroga,      setAtbDroga]      = useState('')
  const [atbInicio,     setAtbInicio]     = useState(() => new Date().toISOString().split('T')[0])
  const [atbDiaInicial, setAtbDiaInicial] = useState<0 | 1>(0)
  const [atbDias,       setAtbDias]       = useState('')
  const [atbFoco,       setAtbFoco]       = useState('')
  const [atbSaving,     setAtbSaving]     = useState(false)
  const [atbRemoving,   setAtbRemoving]   = useState<string | null>(null)
  const [historyOpen,   setHistoryOpen]   = useState(false)

  const ativosATB = atbs.filter(a => a.ativo)
  const historicoATB = atbs.filter(a => !a.ativo)

  const handleSaveATB = async () => {
    if (!atbDroga.trim()) { showToast('Informe o nome do ATB', 'error'); return }
    if (!atbInicio) { showToast('Informe a data de início', 'error'); return }
    setAtbSaving(true)
    const { error } = await supabase.from('atbs').insert({
      paciente_id:    paciente.id,
      droga:          atbDroga.trim(),
      data_inicio:    atbInicio,
      dia_inicial:    atbDiaInicial,
      dias_previstos: atbDias ? parseFloat(atbDias) : null,
      foco:           atbFoco.trim() || null,
      ativo:          true,
    })
    setAtbSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('ATB registrado!')
    setAtbFormOpen(false); setAtbDroga(''); setAtbDias(''); setAtbFoco(''); setAtbDiaInicial(0)
    setAtbInicio(new Date().toISOString().split('T')[0])
    onRefresh()
  }

  const handleEncerrarATB = async (id: string) => {
    if (!confirm('Encerrar este ATB?')) return
    setAtbRemoving(id)
    const { error } = await supabase.from('atbs').update({ ativo: false }).eq('id', id)
    setAtbRemoving(null)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('ATB encerrado'); onRefresh()
  }

  // ── Cuidados horizontais (estado atual, upsert) ────────────────────────────
  const [previsaoAlta, setPrevisaoAlta] = useState(cuidados?.previsao_alta ?? '')

  const [ibpEmUso,      setIbpEmUso]      = useState(cuidados?.ibp_em_uso ?? false)
  const [ibpVia,        setIbpVia]        = useState<ViaIBP | ''>(cuidados?.ibp_via ?? '')
  const [ibpDoseValor,  setIbpDoseValor]  = useState(cuidados?.ibp_dose_valor != null ? String(cuidados.ibp_dose_valor) : '')
  const [ibpDoseUnid,   setIbpDoseUnid]   = useState(cuidados?.ibp_dose_unidade ?? 'mg')
  const [ibpObjetivo,   setIbpObjetivo]   = useState<Objetivo | ''>(cuidados?.ibp_objetivo ?? '')

  const [anticoagEmUso,     setAnticoagEmUso]     = useState(cuidados?.anticoag_em_uso ?? false)
  const [anticoagDroga,     setAnticoagDroga]     = useState<DrogaAnticoag | ''>(cuidados?.anticoag_droga ?? '')
  const [anticoagOutro,     setAnticoagOutro]     = useState(cuidados?.anticoag_droga_outro ?? '')
  const [anticoagVia,       setAnticoagVia]       = useState<ViaAnticoag | ''>(cuidados?.anticoag_via ?? '')
  const [anticoagDoseValor, setAnticoagDoseValor] = useState(cuidados?.anticoag_dose_valor != null ? String(cuidados.anticoag_dose_valor) : '')
  const [anticoagDoseUnid,  setAnticoagDoseUnid]  = useState(cuidados?.anticoag_dose_unidade ?? 'mg')
  const [anticoagObjetivo,  setAnticoagObjetivo]  = useState<Objetivo | ''>(cuidados?.anticoag_objetivo ?? '')

  const [pendencias, setPendencias] = useState(cuidados?.pendencias ?? '')
  const [savingCuidados, setSavingCuidados] = useState(false)

  // Re-sync local state whenever the underlying record changes (realtime / reload)
  useEffect(() => {
    setPrevisaoAlta(cuidados?.previsao_alta ?? '')
    setIbpEmUso(cuidados?.ibp_em_uso ?? false)
    setIbpVia(cuidados?.ibp_via ?? '')
    setIbpDoseValor(cuidados?.ibp_dose_valor != null ? String(cuidados.ibp_dose_valor) : '')
    setIbpDoseUnid(cuidados?.ibp_dose_unidade ?? 'mg')
    setIbpObjetivo(cuidados?.ibp_objetivo ?? '')
    setAnticoagEmUso(cuidados?.anticoag_em_uso ?? false)
    setAnticoagDroga(cuidados?.anticoag_droga ?? '')
    setAnticoagOutro(cuidados?.anticoag_droga_outro ?? '')
    setAnticoagVia(cuidados?.anticoag_via ?? '')
    setAnticoagDoseValor(cuidados?.anticoag_dose_valor != null ? String(cuidados.anticoag_dose_valor) : '')
    setAnticoagDoseUnid(cuidados?.anticoag_dose_unidade ?? 'mg')
    setAnticoagObjetivo(cuidados?.anticoag_objetivo ?? '')
    setPendencias(cuidados?.pendencias ?? '')
  }, [cuidados?.updated_at])

  const handleSaveCuidados = async () => {
    setSavingCuidados(true)
    const payload = {
      paciente_id:           paciente.id,
      previsao_alta:         previsaoAlta || null,
      ibp_em_uso:            ibpEmUso,
      ibp_via:               ibpEmUso ? (ibpVia || null) : null,
      ibp_dose_valor:        ibpEmUso && ibpDoseValor ? parseFloat(ibpDoseValor) : null,
      ibp_dose_unidade:      ibpEmUso ? ibpDoseUnid : null,
      ibp_objetivo:          ibpEmUso ? (ibpObjetivo || null) : null,
      anticoag_em_uso:       anticoagEmUso,
      anticoag_droga:        anticoagEmUso ? (anticoagDroga || null) : null,
      anticoag_droga_outro:  anticoagEmUso && anticoagDroga === 'Outro' ? (anticoagOutro.trim() || null) : null,
      anticoag_via:          anticoagEmUso ? (anticoagVia || null) : null,
      anticoag_dose_valor:   anticoagEmUso && anticoagDoseValor ? parseFloat(anticoagDoseValor) : null,
      anticoag_dose_unidade: anticoagEmUso ? anticoagDoseUnid : null,
      anticoag_objetivo:     anticoagEmUso ? (anticoagObjetivo || null) : null,
      pendencias:            pendencias.trim() || null,
    }
    const { error } = await supabase.from('cuidados_horizontais').upsert(payload, { onConflict: 'paciente_id' })
    setSavingCuidados(false)
    if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return }
    showToast('Cuidados atualizados!')
    onRefresh()
  }

  return (
    <div className="space-y-6">

      {/* Previsão de alta */}
      <section className="border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold text-slate-700 mb-3">📅 Previsão de Alta</h3>
        <input type="date" value={previsaoAlta} onChange={e => setPrevisaoAlta(e.target.value)}
          className={`${inputCls} max-w-xs`} />
      </section>

      {/* ATBs */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">💊 Antibioticoterapia ({ativosATB.length} ativo(s))</h3>
          <div className="flex gap-2">
            {historicoATB.length > 0 && (
              <button onClick={() => setHistoryOpen(h => !h)} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">
                {historyOpen ? '▲' : '▼'} Histórico ({historicoATB.length})
              </button>
            )}
            <button onClick={() => setAtbFormOpen(o => !o)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
              {atbFormOpen ? '✕ Cancelar' : '+ Novo ATB'}
            </button>
          </div>
        </div>

        {ativosATB.length === 0 && !atbFormOpen && (
          <p className="text-slate-400 text-sm italic text-center py-4">Nenhum ATB ativo</p>
        )}

        {ativosATB.map(atb => {
          const dia   = diaAtualATB(atb)
          const alert = atbEmAlerta(atb)
          return (
            <div key={atb.id} className={`border rounded-lg p-3 flex items-start justify-between gap-3 ${
              alert ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'
            }`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-slate-800">{atb.droga}</p>
                  {alert && <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-semibold">⚠️ D{dia}</span>}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Início: {fmtData(atb.data_inicio)} ({atb.dia_inicial === 1 ? 'D1' : 'D0'}) · D{dia}
                  {atb.dias_previstos != null && ` / D${atb.dias_previstos} previsto`}
                  {atb.foco && ` · foco: ${atb.foco}`}
                </p>
              </div>
              <button onClick={() => handleEncerrarATB(atb.id)} disabled={atbRemoving === atb.id}
                className="text-xs text-red-400 hover:text-red-700 border border-red-100 hover:border-red-300 px-2 py-1.5 rounded-lg transition-colors flex-shrink-0">
                {atbRemoving === atb.id ? '⏳' : '⏹ Encerrar'}
              </button>
            </div>
          )
        })}

        {atbFormOpen && (
          <div className="border-2 border-indigo-200 rounded-xl bg-indigo-50 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Droga *</label>
                <Combobox value={atbDroga} onChange={setAtbDroga} options={ATBS_SUGERIDOS}
                  placeholder="ex: Piperacilina + Tazobactam" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Data de início *</label>
                <div className="flex gap-2">
                  <input type="date" value={atbInicio} onChange={e => setAtbInicio(e.target.value)} className={inputCls} />
                  <div className="flex rounded-lg overflow-hidden border border-slate-300 flex-shrink-0">
                    <button type="button" onClick={() => setAtbDiaInicial(0)}
                      title="Dose não completada no 1º dia — conta como D0"
                      className={`px-3 text-sm font-semibold transition-colors ${atbDiaInicial === 0 ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                      D0
                    </button>
                    <button type="button" onClick={() => setAtbDiaInicial(1)}
                      title="Dose completa desde o início — conta como D1"
                      className={`px-3 text-sm font-semibold transition-colors ${atbDiaInicial === 1 ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                      D1
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <label className={labelCls}>Dias totais previstos</label>
                <input type="number" min="1" step="1" value={atbDias} onChange={e => setAtbDias(e.target.value)}
                  onWheel={noScrollInput} onKeyDown={noArrowInput} placeholder="ex: 7" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Foco / indicação</label>
                <Combobox value={atbFoco} onChange={setAtbFoco} options={FOCOS_INFECCIOSOS}
                  placeholder="ex: Pulmonar (ou digite outro)" className={inputCls} />
              </div>
            </div>
            <button onClick={handleSaveATB} disabled={atbSaving}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
              {atbSaving ? 'Salvando...' : '+ Registrar ATB'}
            </button>
          </div>
        )}

        {historyOpen && historicoATB.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-200">
            {historicoATB.map(atb => (
              <div key={atb.id} className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2">
                <span className="font-semibold text-slate-700">{atb.droga}</span> — {fmtData(atb.data_inicio)}
                {atb.dias_previstos != null && ` · previsto: ${atb.dias_previstos}d`}
                {atb.foco && ` · foco: ${atb.foco}`}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* IBP */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={ibpEmUso} onChange={e => setIbpEmUso(e.target.checked)}
            className="w-4 h-4 accent-indigo-600" />
          <span className="font-semibold text-slate-700">💊 Em uso de IBP</span>
        </label>

        {ibpEmUso && (
          <div className="grid grid-cols-3 gap-3 pl-6">
            <div>
              <label className={labelCls}>Via</label>
              <select value={ibpVia} onChange={e => setIbpVia(e.target.value as ViaIBP)} className={inputCls}>
                <option value="">Selecione...</option>
                {VIAS_IBP.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Dose</label>
              <div className="flex gap-1">
                <input type="number" step="0.1" min="0" value={ibpDoseValor} onChange={e => setIbpDoseValor(e.target.value)}
                  onWheel={noScrollInput} onKeyDown={noArrowInput} className={inputCls} />
                <select value={ibpDoseUnid} onChange={e => setIbpDoseUnid(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  {UNIDADES_DOSE.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Objetivo</label>
              <select value={ibpObjetivo} onChange={e => setIbpObjetivo(e.target.value as Objetivo)} className={inputCls}>
                <option value="">Selecione...</option>
                <option value="profilatico">Profilático</option>
                <option value="terapeutico">Terapêutico</option>
              </select>
            </div>
          </div>
        )}
      </section>

      {/* Anticoagulante */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={anticoagEmUso} onChange={e => setAnticoagEmUso(e.target.checked)}
            className="w-4 h-4 accent-indigo-600" />
          <span className="font-semibold text-slate-700">🩸 Em uso de Anticoagulante</span>
        </label>

        {anticoagEmUso && (
          <div className="pl-6 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Droga</label>
                <select value={anticoagDroga} onChange={e => setAnticoagDroga(e.target.value as DrogaAnticoag)} className={inputCls}>
                  <option value="">Selecione...</option>
                  {DROGAS_ANTICOAG.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Via</label>
                <select value={anticoagVia} onChange={e => setAnticoagVia(e.target.value as ViaAnticoag)} className={inputCls}>
                  <option value="">Selecione...</option>
                  {VIAS_ANTICOAG.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Objetivo</label>
                <select value={anticoagObjetivo} onChange={e => setAnticoagObjetivo(e.target.value as Objetivo)} className={inputCls}>
                  <option value="">Selecione...</option>
                  <option value="profilatico">Profilático</option>
                  <option value="terapeutico">Terapêutico</option>
                </select>
              </div>
            </div>
            {anticoagDroga === 'Outro' && (
              <div>
                <label className={labelCls}>Especifique a droga</label>
                <input value={anticoagOutro} onChange={e => setAnticoagOutro(e.target.value)} className={inputCls} />
              </div>
            )}
            <div className="max-w-xs">
              <label className={labelCls}>Dose</label>
              <div className="flex gap-1">
                <input type="number" step="0.1" min="0" value={anticoagDoseValor} onChange={e => setAnticoagDoseValor(e.target.value)}
                  onWheel={noScrollInput} onKeyDown={noArrowInput} className={inputCls} />
                <select value={anticoagDoseUnid} onChange={e => setAnticoagDoseUnid(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  {UNIDADES_DOSE.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Pendências */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-2">
        <h3 className="font-semibold text-slate-700">📝 Pendências e Programações</h3>
        <textarea value={pendencias} onChange={e => setPendencias(e.target.value)} rows={4}
          placeholder="Ex: Solicitar TC de tórax amanhã, aguardar hemocultura, discutir com família..."
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400" />
      </section>

      <button onClick={handleSaveCuidados} disabled={savingCuidados}
        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
        {savingCuidados ? 'Salvando...' : '💾 Salvar Cuidados Horizontais'}
      </button>
    </div>
  )
}
