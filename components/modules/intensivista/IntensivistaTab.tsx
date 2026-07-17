'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData, diaAtualATB } from '@/lib/utils'
import { ATBS_SUGERIDOS, FOCOS_INFECCIOSOS } from '@/lib/config'
import Combobox from '@/components/ui/Combobox'
import AuditoriaIntensivistaView from './AuditoriaIntensivista'
import type { Paciente, ATB, CuidadosHorizontais, PendenciaIntensivista, RegistroIntensivista, ViaIBP, ViaAnticoag, Objetivo, DrogaAnticoag, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  atbs: ATB[]
  cuidados: CuidadosHorizontais | null
  pendencias: PendenciaIntensivista[]
  registrosIntensivista: RegistroIntensivista[]
  /** Só o Médico Intensivista (chefe da escala) edita esta aba; demais cargos veem em modo leitura. */
  podeEditar: boolean
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const VIAS_IBP: ViaIBP[] = ['Enteral', 'Endovenoso']
const LABEL_VIA: Record<ViaIBP | ViaAnticoag, string> = {
  'Enteral': 'Enteral (Oral/SNE/GTT)',
  'Endovenoso': 'Endovenoso',
  'Subcutâneo': 'Subcutâneo',
}
const DROGAS_ANTICOAG: DrogaAnticoag[] = ['Enoxaparina', 'Heparina Não Fracionada', 'Apixabana', 'Rivaroxabana', 'Outro']
// Vias clinicamente válidas por droga — evita registros como "Enoxaparina VO".
const VIAS_POR_DROGA: Record<DrogaAnticoag, ViaAnticoag[]> = {
  'Enoxaparina': ['Subcutâneo'],
  'Heparina Não Fracionada': ['Subcutâneo', 'Endovenoso'],
  'Apixabana': ['Enteral'],
  'Rivaroxabana': ['Enteral'],
  'Outro': ['Subcutâneo', 'Endovenoso', 'Enteral'],
}
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

export default function IntensivistaTab({ paciente, atbs, cuidados, pendencias, registrosIntensivista, podeEditar, onRefresh, showToast }: Props) {
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

  // Corticoide e opioide: sim/não, sem dose. Alimentam "% disfunção glicêmica +
  // corticoide" e "constipação relacionada a opioides". Guardam o estado atual —
  // o histórico "usou em algum momento do mês" sai da auditoria.
  const [corticoideEmUso, setCorticoideEmUso] = useState(cuidados?.corticoide_em_uso ?? false)
  const [opioideEmUso,    setOpioideEmUso]    = useState(cuidados?.opioide_em_uso ?? false)

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
    setCorticoideEmUso(cuidados?.corticoide_em_uso ?? false)
    setOpioideEmUso(cuidados?.opioide_em_uso ?? false)
  }, [cuidados?.updated_at])

  const viasDisponiveis = anticoagDroga ? VIAS_POR_DROGA[anticoagDroga] : ['Subcutâneo', 'Endovenoso', 'Enteral'] as ViaAnticoag[]

  const handleAnticoagDrogaChange = (droga: DrogaAnticoag) => {
    setAnticoagDroga(droga)
    if (anticoagVia && !VIAS_POR_DROGA[droga].includes(anticoagVia)) setAnticoagVia('')
  }

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
      corticoide_em_uso:     corticoideEmUso,
      opioide_em_uso:        opioideEmUso,
    }
    const { error } = await supabase.from('cuidados_horizontais').upsert(payload, { onConflict: 'paciente_id' })
    setSavingCuidados(false)
    if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return }
    showToast('Cuidados atualizados!')
    onRefresh()
  }

  // ── Pendências (checklist) ─────────────────────────────────────────────────
  const [novaPendencia, setNovaPendencia] = useState('')
  const [addingPendencia, setAddingPendencia] = useState(false)

  const pendenciasOrdenadas = [...pendencias].sort((a, b) => {
    if (a.resolvida !== b.resolvida) return a.resolvida ? 1 : -1
    return new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime()
  })

  const handleAddPendencia = async () => {
    if (!novaPendencia.trim()) return
    setAddingPendencia(true)
    const { error } = await supabase.from('pendencias_intensivista').insert({
      paciente_id: paciente.id, texto: novaPendencia.trim(),
    })
    setAddingPendencia(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    setNovaPendencia(''); onRefresh()
  }

  const handleTogglePendencia = async (p: PendenciaIntensivista) => {
    const { error } = await supabase.from('pendencias_intensivista').update({
      resolvida: !p.resolvida,
      resolvida_em: !p.resolvida ? new Date().toISOString() : null,
    }).eq('id', p.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    onRefresh()
  }

  const handleDeletePendencia = async (id: string) => {
    if (!confirm('Excluir esta pendência?')) return
    const { error } = await supabase.from('pendencias_intensivista').delete().eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    onRefresh()
  }

  // ── Orientações e Condutas (histórico por data) ────────────────────────────
  const [orientFormMode, setOrientFormMode]     = useState<'add' | 'edit' | null>(null)
  const [orientEditing,  setOrientEditing]      = useState<RegistroIntensivista | null>(null)
  const [orientDate,     setOrientDate]         = useState(() => new Date().toISOString().split('T')[0])
  const [orientTexto,    setOrientTexto]        = useState('')
  const [orientSaving,   setOrientSaving]       = useState(false)
  const [orientHistoryOpen, setOrientHistoryOpen] = useState(false)

  const sortedRegistros = [...registrosIntensivista].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
  const ultimoRegistro = sortedRegistros[0] ?? null

  const duplicadoData = orientFormMode === 'add'
    ? registrosIntensivista.find(r => r.data === orientDate)
    : undefined

  const openOrientAdd = () => {
    setOrientDate(new Date().toISOString().split('T')[0])
    setOrientTexto('')
    setOrientFormMode('add')
  }
  const startOrientEdit = (r: RegistroIntensivista) => {
    setOrientEditing(r); setOrientDate(r.data); setOrientTexto(r.orientacoes_condutas)
    setOrientFormMode('edit')
  }
  const cancelOrient = () => { setOrientFormMode(null); setOrientEditing(null); setOrientTexto('') }

  const handleSaveOrient = async () => {
    if (!orientTexto.trim()) { showToast('Escreva as orientações e condutas', 'error'); return }
    if (orientFormMode === 'add' && duplicadoData) {
      showToast('Já existe um registro para essa data — edite-o em vez de duplicar', 'error'); return
    }
    setOrientSaving(true)
    if (orientFormMode === 'add') {
      const { error } = await supabase.from('registros_intensivista').insert({
        paciente_id: paciente.id, data: orientDate, orientacoes_condutas: orientTexto.trim(),
      })
      setOrientSaving(false)
      if (error) { showToast('Erro: ' + error.message, 'error'); return }
      showToast('Registro criado!')
    } else if (orientEditing) {
      const { error } = await supabase.from('registros_intensivista')
        .update({ orientacoes_condutas: orientTexto.trim() }).eq('id', orientEditing.id)
      setOrientSaving(false)
      if (error) { showToast('Erro: ' + error.message, 'error'); return }
      showToast('Registro atualizado!')
    }
    cancelOrient(); onRefresh()
  }

  return (
    <div className="space-y-6">

      {/* Previsão de alta */}
      <section className="border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold text-slate-700 mb-3">📅 Previsão de Alta</h3>
        <input type="date" value={previsaoAlta} onChange={e => setPrevisaoAlta(e.target.value)} disabled={!podeEditar}
          className={`${inputCls} max-w-xs disabled:opacity-60 disabled:cursor-not-allowed`} />
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
            {podeEditar && (
              <button onClick={() => setAtbFormOpen(o => !o)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                {atbFormOpen ? '✕ Cancelar' : '+ Novo ATB'}
              </button>
            )}
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
              {podeEditar && (
                <button onClick={() => handleEncerrarATB(atb.id)} disabled={atbRemoving === atb.id}
                  className="text-xs text-red-400 hover:text-red-700 border border-red-100 hover:border-red-300 px-2 py-1.5 rounded-lg transition-colors flex-shrink-0">
                  {atbRemoving === atb.id ? '⏳' : '⏹ Encerrar'}
                </button>
              )}
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
          <input type="checkbox" checked={ibpEmUso} onChange={e => setIbpEmUso(e.target.checked)} disabled={!podeEditar}
            className="w-4 h-4 accent-indigo-600 disabled:cursor-not-allowed" />
          <span className="font-semibold text-slate-700">💊 Em uso de Pantoprazol (IBP)</span>
        </label>

        {ibpEmUso && (
          <fieldset disabled={!podeEditar} className="grid grid-cols-3 gap-3 pl-6 disabled:opacity-60">
            <div>
              <label className={labelCls}>Via</label>
              <select value={ibpVia} onChange={e => setIbpVia(e.target.value as ViaIBP)} className={inputCls}>
                <option value="">Selecione...</option>
                {VIAS_IBP.map(v => <option key={v} value={v}>{LABEL_VIA[v]}</option>)}
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
          </fieldset>
        )}
      </section>

      {/* Anticoagulante */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={anticoagEmUso} onChange={e => setAnticoagEmUso(e.target.checked)} disabled={!podeEditar}
            className="w-4 h-4 accent-indigo-600 disabled:cursor-not-allowed" />
          <span className="font-semibold text-slate-700">🩸 Em uso de Anticoagulante</span>
        </label>

        {anticoagEmUso && (
          <fieldset disabled={!podeEditar} className="pl-6 space-y-3 disabled:opacity-60">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Droga</label>
                <select value={anticoagDroga} onChange={e => handleAnticoagDrogaChange(e.target.value as DrogaAnticoag)} className={inputCls}>
                  <option value="">Selecione...</option>
                  {DROGAS_ANTICOAG.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Via</label>
                <select value={anticoagVia} onChange={e => setAnticoagVia(e.target.value as ViaAnticoag)} className={inputCls}>
                  <option value="">Selecione...</option>
                  {viasDisponiveis.map(v => <option key={v} value={v}>{LABEL_VIA[v]}</option>)}
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
          </fieldset>
        )}
      </section>

      {/* Corticoide e opioide: só sim/não — a dose não entra em nenhum indicador. */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={corticoideEmUso} onChange={e => setCorticoideEmUso(e.target.checked)}
            disabled={!podeEditar} className="w-4 h-4 accent-emerald-600 disabled:opacity-50" />
          <span className="font-semibold text-slate-700">💊 Em uso de corticoide</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={opioideEmUso} onChange={e => setOpioideEmUso(e.target.checked)}
            disabled={!podeEditar} className="w-4 h-4 accent-emerald-600 disabled:opacity-50" />
          <span className="font-semibold text-slate-700">💊 Em uso de opioide</span>
        </label>
      </section>

      {podeEditar && (
        <button onClick={handleSaveCuidados} disabled={savingCuidados}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
          {savingCuidados ? 'Salvando...' : '💾 Salvar Cuidados Horizontais'}
        </button>
      )}

      {/* Pendências (checklist) */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-slate-700">📝 Pendências ({pendenciasOrdenadas.filter(p => !p.resolvida).length} em aberto)</h3>

        {pendenciasOrdenadas.length === 0 && (
          <p className="text-slate-400 text-sm italic text-center py-4">Nenhuma pendência registrada</p>
        )}

        <div className="space-y-1.5">
          {pendenciasOrdenadas.map(p => (
            <div key={p.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${p.resolvida ? 'bg-slate-50 border-slate-200' : 'bg-amber-50 border-amber-200'}`}>
              <input type="checkbox" checked={p.resolvida} onChange={() => handleTogglePendencia(p)}
                className="w-4 h-4 accent-emerald-600 flex-shrink-0" />
              <span className={`text-sm flex-1 ${p.resolvida ? 'line-through text-slate-400' : 'text-amber-900'}`}>{p.texto}</span>
              {podeEditar && (
                <button onClick={() => handleDeletePendencia(p.id)} title="Excluir"
                  className="text-slate-300 hover:text-red-500 flex-shrink-0 text-sm transition-colors">
                  🗑️
                </button>
              )}
            </div>
          ))}
        </div>

        {podeEditar && (
          <div className="flex gap-2">
            <input value={novaPendencia} onChange={e => setNovaPendencia(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddPendencia() }}
              placeholder="Ex: Solicitar TC de tórax, aguardar hemocultura..."
              className={inputCls} />
            <button onClick={handleAddPendencia} disabled={addingPendencia || !novaPendencia.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex-shrink-0">
              + Adicionar
            </button>
          </div>
        )}
      </section>

      {/* Orientações e Condutas (histórico por data) */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">🗒️ Orientações e Condutas ({registrosIntensivista.length})</h3>
          <div className="flex gap-2">
            {sortedRegistros.length > 1 && (
              <button onClick={() => setOrientHistoryOpen(h => !h)} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">
                {orientHistoryOpen ? '▲' : '▼'} Histórico ({sortedRegistros.length - 1})
              </button>
            )}
            {podeEditar && (orientFormMode === null ? (
              <button onClick={openOrientAdd}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                + Novo Registro
              </button>
            ) : (
              <button onClick={cancelOrient}
                className="text-slate-500 hover:text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                ✕ Cancelar
              </button>
            ))}
          </div>
        </div>

        {orientFormMode === null && ultimoRegistro && (
          <div className="border border-indigo-200 bg-indigo-50 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-bold text-indigo-700">{fmtData(ultimoRegistro.data)} (mais recente)</p>
              {podeEditar && (
                <button onClick={() => startOrientEdit(ultimoRegistro)}
                  className="text-xs text-indigo-500 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-400 px-2.5 py-1 rounded-lg transition-colors">
                  ✏️ Editar
                </button>
              )}
            </div>
            <p className="text-sm text-indigo-900 whitespace-pre-wrap">{ultimoRegistro.orientacoes_condutas}</p>
          </div>
        )}

        {!ultimoRegistro && orientFormMode === null && (
          <p className="text-slate-400 text-sm italic text-center py-4">Nenhum registro ainda</p>
        )}

        {orientFormMode !== null && (
          <div className="border-2 border-indigo-200 rounded-xl bg-indigo-50 p-4 space-y-3">
            {orientFormMode === 'add' ? (
              <div>
                <label className="text-xs text-slate-500 block mb-1">Data</label>
                <input type="date" value={orientDate} onChange={e => setOrientDate(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
                {duplicadoData && (
                  <p className="text-xs text-red-600 font-semibold mt-1">⚠️ Já existe registro para essa data — edite-o no histórico</p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="font-semibold text-indigo-900 text-sm">{orientEditing && fmtData(orientEditing.data)}</p>
                <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded-full">✏️ Editando</span>
              </div>
            )}
            <textarea value={orientTexto} onChange={e => setOrientTexto(e.target.value)} rows={4}
              placeholder="Ex: Manter conduta atual, discutir desmame de sedação, aguardar parecer da cirurgia..."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            <button onClick={handleSaveOrient} disabled={orientSaving || (orientFormMode === 'add' && !!duplicadoData)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
              {orientSaving ? 'Salvando...' : orientFormMode === 'add' ? '+ Registrar' : '💾 Salvar Alterações'}
            </button>
          </div>
        )}

        {orientHistoryOpen && sortedRegistros.length > 1 && (
          <div className="space-y-2 pt-2 border-t border-slate-200">
            {sortedRegistros.slice(1).map(r => (
              <div key={r.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-600">{fmtData(r.data)}</span>
                  {podeEditar && (
                    <button onClick={() => startOrientEdit(r)}
                      className="text-xs text-indigo-400 hover:text-indigo-700 border border-indigo-100 hover:border-indigo-300 px-2 py-1 rounded-lg transition-colors">
                      ✏️ Editar
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-600 whitespace-pre-wrap">{r.orientacoes_condutas}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Auditoria — quem alterou o quê nesta aba */}
      <AuditoriaIntensivistaView pacienteId={paciente.id} showToast={showToast} />
    </div>
  )
}
