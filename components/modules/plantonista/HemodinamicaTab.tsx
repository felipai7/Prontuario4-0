'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData, fmtTurno, fmtNum, boundaryStart, sugerirProximoTurno } from '@/lib/utils'
import {
  DROGAS, getBlockReason, getDrogaConfig, calcDoseForDVA, doseAlert,
  buildSummaryText, filtrarAtivasNoPeriodo, sinaisNoPeriodo, calcRanges,
} from '@/lib/hemodinamica'
import type { Paciente, DVA, PeriodoHemodinamica, SinalVital, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  dvas: DVA[]
  periodos: PeriodoHemodinamica[]
  sinais: SinalVital[]
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

function noScrollInput(e: React.WheelEvent<HTMLInputElement>) { e.currentTarget.blur() }
function noArrowInput(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault()
}

export default function HemodinamicaTab({ paciente, dvas, periodos, sinais, onRefresh, showToast }: Props) {
  const supabase = createClient()
  const peso = paciente.peso_kg

  // ── Turnos ordenados; o mais recente sempre alimenta o banner-resumo ──────
  const sortedPeriodos = [...periodos].sort((a, b) =>
    boundaryStart(b.data, b.turno).getTime() - boundaryStart(a.data, a.turno).getTime()
  )
  const ultimoPeriodo = sortedPeriodos[0] ?? null

  const [selectedPeriodoId, setSelectedPeriodoId] = useState<string | null>(null)
  const selectedPeriodo = sortedPeriodos.find(p => p.id === selectedPeriodoId) ?? ultimoPeriodo

  const dvasDoUltimo = filtrarAtivasNoPeriodo(dvas, ultimoPeriodo)
  const periodSinaisUltimo = sinaisNoPeriodo(sinais, ultimoPeriodo)
  const { fcRange, paRange } = calcRanges(periodSinaisUltimo)
  const summary  = buildSummaryText(dvasDoUltimo, peso, fcRange, paRange)
  const emUsoDVA = dvasDoUltimo.length > 0

  const dvasDoSelecionado = selectedPeriodo ? dvas.filter(d => d.ativo && d.periodo_id === selectedPeriodo.id) : []
  const activeDrogaNomes = dvasDoSelecionado.map(d => d.droga)

  const [copied, setCopied] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  // ── Novo turno ─────────────────────────────────────────────────────────────
  const [novoTurnoOpen, setNovoTurnoOpen] = useState(false)
  const [formDate,  setFormDate]  = useState(() => sugerirProximoTurno(periodos).data)
  const [formTurno, setFormTurno] = useState<'diurno' | 'noturno'>(() => sugerirProximoTurno(periodos).turno)
  const [duplicarDVAs, setDuplicarDVAs] = useState(true)
  const [turnoSaving, setTurnoSaving] = useState(false)

  const duplicadoTurno = periodos.find(p => p.data === formDate && p.turno === formTurno)
  const naoContiguo = !duplicadoTurno && ultimoPeriodo && ultimoPeriodo.fim &&
    new Date(ultimoPeriodo.fim).getTime() !== boundaryStart(formDate, formTurno).getTime()

  const openNovoTurno = () => {
    const sugestao = sugerirProximoTurno(periodos)
    setFormDate(sugestao.data); setFormTurno(sugestao.turno)
    setDuplicarDVAs(true)
    setNovoTurnoOpen(true)
  }

  const handleCriarTurno = async () => {
    if (duplicadoTurno) { showToast('Já existe um registro para esse turno — edite-o no histórico', 'error'); return }
    setTurnoSaving(true)
    const inicio = boundaryStart(formDate, formTurno)
    const fim = new Date(inicio.getTime() + 12 * 3_600_000)

    const { data: newPeriodo, error } = await supabase
      .from('periodos_hemodinamica')
      .insert({ paciente_id: paciente.id, turno: formTurno, data: formDate, inicio: inicio.toISOString(), fim: fim.toISOString() })
      .select('id').single()

    if (error || !newPeriodo) {
      showToast('Erro ao criar turno: ' + (error?.message ?? ''), 'error'); setTurnoSaving(false); return
    }

    if (duplicarDVAs && ultimoPeriodo) {
      const dvasParaDuplicar = dvas.filter(d => d.ativo && d.periodo_id === ultimoPeriodo.id)
      if (dvasParaDuplicar.length > 0) {
        const { error: errDup } = await supabase.from('dvas').insert(
          dvasParaDuplicar.map(d => ({
            paciente_id:          d.paciente_id,
            droga:                d.droga,
            concentracao_valor:   d.concentracao_valor,
            concentracao_unidade: d.concentracao_unidade,
            concentracao_label:   d.concentracao_label,
            fluxo_ml_h:           d.fluxo_ml_h,
            ativo:                true,
            periodo_id:           newPeriodo.id,
          }))
        )
        if (errDup) showToast('Turno criado, mas falha ao duplicar DVAs: ' + errDup.message, 'error')
      }
    }

    showToast('Turno registrado!')
    setSelectedPeriodoId(newPeriodo.id)
    setNovoTurnoOpen(false); setTurnoSaving(false); onRefresh()
  }

  // ── DVA form (sempre relativo ao turno selecionado) ────────────────────────
  const [dvaFormOpen, setDvaFormOpen] = useState(false)
  const [selDroga,  setSelDroga]  = useState(DROGAS[0].nome)
  const [selVar,    setSelVar]    = useState(0)
  const [fluxo,     setFluxo]     = useState('')
  const [saving,    setSaving]    = useState(false)
  const [removing,  setRemoving]  = useState<string | null>(null)
  const [editId,    setEditId]    = useState<string | null>(null)
  const [editFluxo, setEditFluxo] = useState('')
  const [editVarIdx,setEditVarIdx]= useState(0)
  const [editSaving,setEditSaving]= useState(false)

  const drogaConfig    = getDrogaConfig(selDroga)!
  const varianteConfig = drogaConfig.variantes[selVar] ?? drogaConfig.variantes[0]
  const fluxoNum       = parseFloat(fluxo)
  const dosePreview    = !isNaN(fluxoNum) && fluxoNum > 0 && (drogaConfig.usaPeso ? !!peso : true)
    ? drogaConfig.calcDose(fluxoNum, varianteConfig.valor, peso ?? 1) : null
  const selBlockReason = getBlockReason(selDroga, activeDrogaNomes)

  const handleOpenDvaForm = () => {
    const first = DROGAS.find(d => !getBlockReason(d.nome, activeDrogaNomes))
    setSelDroga(first?.nome ?? DROGAS[0].nome)
    setSelVar(0); setFluxo('')
    setDvaFormOpen(true)
  }

  const handleDrogaChange = (nome: string) => { setSelDroga(nome); setSelVar(0); setFluxo('') }

  const handleSaveDva = async () => {
    if (!selectedPeriodo) return
    if (selBlockReason) { showToast(selBlockReason, 'error'); return }
    if (!fluxo || isNaN(fluxoNum) || fluxoNum <= 0) { showToast('Informe o fluxo em mL/h', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('dvas').insert({
      paciente_id:          paciente.id,
      droga:                selDroga,
      concentracao_valor:   varianteConfig.valor,
      concentracao_unidade: varianteConfig.unidade_conc,
      concentracao_label:   varianteConfig.label,
      fluxo_ml_h:           fluxoNum,
      ativo:                true,
      periodo_id:           selectedPeriodo.id,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('DVA registrada!')
    setDvaFormOpen(false); setFluxo(''); onRefresh()
  }

  const startEdit = (dva: DVA) => {
    const cfg = getDrogaConfig(dva.droga)
    const varIdx = cfg?.variantes.findIndex(v => v.valor === dva.concentracao_valor) ?? 0
    setEditId(dva.id); setEditFluxo(String(dva.fluxo_ml_h)); setEditVarIdx(varIdx >= 0 ? varIdx : 0)
  }
  const cancelEdit = () => { setEditId(null); setEditFluxo(''); setEditVarIdx(0) }

  const handleSaveEdit = async (dva: DVA) => {
    const f = parseFloat(editFluxo)
    if (isNaN(f) || f <= 0) { showToast('Fluxo inválido', 'error'); return }
    const cfg = getDrogaConfig(dva.droga)!
    const variante = cfg.variantes[editVarIdx] ?? cfg.variantes[0]
    setEditSaving(true)
    const { error } = await supabase.from('dvas').update({
      fluxo_ml_h:           f,
      concentracao_valor:   variante.valor,
      concentracao_unidade: variante.unidade_conc,
      concentracao_label:   variante.label,
    }).eq('id', dva.id)
    setEditSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('DVA atualizada!'); cancelEdit(); onRefresh()
  }

  const handleRemove = async (id: string) => {
    if (!confirm('Encerrar uso desta DVA?')) return
    setRemoving(id)
    const { error } = await supabase.from('dvas').update({ ativo: false }).eq('id', id)
    setRemoving(null)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('DVA encerrada'); onRefresh()
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(summary).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-4">

      {/* Banner de resumo hemodinâmico — sempre do turno mais recente */}
      <div className={`rounded-xl p-4 border flex items-start justify-between gap-3 ${
        emUsoDVA ? 'bg-amber-50 border-amber-300' : 'bg-green-50 border-green-300'
      }`}>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold leading-relaxed ${emUsoDVA ? 'text-amber-800' : 'text-green-800'}`}>
            {emUsoDVA ? '⚠️' : '✅'} {summary}
          </p>
          {emUsoDVA && !peso && (
            <p className="text-xs text-amber-600 mt-1">⚠️ Peso não cadastrado — doses em mL/h (sem conversão)</p>
          )}
        </div>
        <button onClick={handleCopy}
          className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
            copied
              ? 'bg-green-600 text-white border-green-600'
              : emUsoDVA
                ? 'bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200'
                : 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200'
          }`}>
          {copied ? '✓ Copiado' : '📋 Copiar'}
        </button>
      </div>

      {/* Cabeçalho de turnos */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">
          💊 Turnos Hemodinâmicos ({periodos.length})
        </h3>
        <div className="flex gap-2">
          {sortedPeriodos.length > 1 && (
            <button onClick={() => setHistoryOpen(h => !h)} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">
              {historyOpen ? '▲' : '▼'} Histórico ({sortedPeriodos.length - 1})
            </button>
          )}
          {novoTurnoOpen ? (
            <button onClick={() => setNovoTurnoOpen(false)}
              className="text-slate-500 hover:text-slate-700 text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
              ✕ Cancelar
            </button>
          ) : (
            <button onClick={openNovoTurno}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
              🔄 Novo Turno
            </button>
          )}
        </div>
      </div>

      {!ultimoPeriodo && !novoTurnoOpen && (
        <p className="text-slate-400 text-sm italic text-center py-6">Nenhum turno registrado</p>
      )}

      {/* Form: Novo Turno */}
      {novoTurnoOpen && (
        <div className="border-2 border-emerald-200 rounded-xl p-4 bg-emerald-50 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Data</label>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"/>
            </div>
            <div className="flex rounded-lg overflow-hidden border border-slate-300">
              {(['diurno','noturno'] as const).map(t => (
                <button key={t} onClick={() => setFormTurno(t)}
                  className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                    formTurno === t ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}>
                  {t === 'diurno' ? '☀️ Diurno (07–18h)' : '🌙 Noturno (19–06h)'}
                </button>
              ))}
            </div>
          </div>
          {duplicadoTurno && (
            <p className="text-xs text-red-600 font-semibold">⚠️ Já existe registro para este turno — edite-o no histórico</p>
          )}
          {!duplicadoTurno && naoContiguo && ultimoPeriodo?.fim && (
            <p className="text-xs text-amber-600 font-semibold">
              ⚠️ Turno não é contíguo ao último registrado (encerrado em {fmtData(ultimoPeriodo.fim.slice(0,10))} {new Date(ultimoPeriodo.fim).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})})
            </p>
          )}
          {dvasDoUltimo.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
              <input type="checkbox" checked={duplicarDVAs} onChange={e => setDuplicarDVAs(e.target.checked)}
                className="w-4 h-4 accent-emerald-600" />
              Duplicar DVAs do último turno ({dvasDoUltimo.length}): {dvasDoUltimo.map(d => `${d.droga} ${d.fluxo_ml_h} mL/h`).join(', ')}
            </label>
          )}
          <button onClick={handleCriarTurno} disabled={turnoSaving || !!duplicadoTurno}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {turnoSaving ? 'Salvando...' : '+ Registrar Turno'}
          </button>
        </div>
      )}

      {/* Gerenciamento de DVAs do turno selecionado */}
      {selectedPeriodo && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              Gerenciando DVAs — {fmtTurno(selectedPeriodo.turno, selectedPeriodo.data + 'T12:00:00')}
              {selectedPeriodo.id === ultimoPeriodo?.id && <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">Turno atual</span>}
            </p>
            <button onClick={dvaFormOpen ? () => setDvaFormOpen(false) : handleOpenDvaForm}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
              {dvaFormOpen ? '✕ Cancelar' : '+ Adicionar DVA'}
            </button>
          </div>

          {dvasDoSelecionado.length === 0 && !dvaFormOpen && (
            <p className="text-slate-400 text-sm italic text-center py-6">Nenhuma DVA neste turno</p>
          )}

          {dvasDoSelecionado.map(dva => {
            const cfg       = getDrogaConfig(dva.droga)
            const dose      = calcDoseForDVA(dva, peso)
            const alrt      = dose && cfg ? doseAlert(dose, cfg) : 'ok'
            const isEditing = editId === dva.id
            const editCfg   = isEditing ? getDrogaConfig(dva.droga) : undefined
            const editVar   = editCfg?.variantes[editVarIdx] ?? editCfg?.variantes[0]
            const editFNum  = parseFloat(editFluxo)
            const editDosePreview = isEditing && editVar && !isNaN(editFNum) && editFNum > 0
              ? editCfg && (editCfg.usaPeso ? !!peso : true)
                ? editCfg.calcDose(editFNum, editVar.valor, peso ?? 1) : null
              : null
            const fluxoStr = dva.fluxo_ml_h % 1 === 0 ? String(dva.fluxo_ml_h) : fmtNum(dva.fluxo_ml_h, 1)

            return (
              <div key={dva.id} className={`border rounded-xl p-4 space-y-2 ${
                alrt === 'crit' ? 'bg-red-50 border-red-300' :
                alrt === 'warn' ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'
              }`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-slate-800">{dva.droga}</p>
                      <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{dva.concentracao_label}</span>
                    </div>
                    {!isEditing && (
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-sm font-semibold text-indigo-700">{fluxoStr} mL/h</span>
                        {dose !== null && cfg ? (
                          <span className={`text-sm font-bold ${
                            alrt === 'crit' ? 'text-red-700' : alrt === 'warn' ? 'text-amber-700' : 'text-slate-700'
                          }`}>
                            {cfg.formatDose(dose)} {cfg.dose_unidade}
                            {alrt !== 'ok' && <span className="ml-1 text-xs">{alrt === 'crit' ? '⚠️ fora do alvo' : '⬆️ acima do alvo'}</span>}
                          </span>
                        ) : cfg?.usaPeso && !peso ? (
                          <span className="text-xs text-slate-400">cadastre o peso para calcular dose</span>
                        ) : null}
                        {cfg && <span className="text-xs text-slate-400">alvo: {cfg.dose_alvo_label}</span>}
                      </div>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => startEdit(dva)}
                        className="text-xs text-indigo-400 hover:text-indigo-700 border border-indigo-100 hover:border-indigo-300 px-2 py-1.5 rounded-lg transition-colors">
                        ✏️ Editar
                      </button>
                      <button onClick={() => handleRemove(dva.id)} disabled={removing === dva.id}
                        className="text-xs text-red-400 hover:text-red-700 border border-red-100 hover:border-red-300 px-2 py-1.5 rounded-lg transition-colors">
                        {removing === dva.id ? '⏳' : '⏹ Encerrar'}
                      </button>
                    </div>
                  )}
                </div>

                {isEditing && editCfg && (
                  <div className="space-y-2 pt-1 border-t border-slate-200">
                    {editCfg.variantes.length > 1 && (
                      <div className="flex rounded-lg overflow-hidden border border-slate-300">
                        {editCfg.variantes.map((v, i) => (
                          <button key={i} onClick={() => setEditVarIdx(i)}
                            className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${
                              editVarIdx === i ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                            }`}>
                            {v.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-slate-500 font-medium block mb-1">Fluxo (mL/h)</label>
                        <input type="number" step="0.1" min="0" value={editFluxo}
                          onChange={e => setEditFluxo(e.target.value)}
                          onWheel={noScrollInput} onKeyDown={noArrowInput}
                          className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
                      </div>
                      {editDosePreview !== null && editCfg && (
                        <div className={`rounded-lg px-3 py-1.5 border text-xs mt-4 ${
                          doseAlert(editDosePreview, editCfg) === 'crit' ? 'bg-red-50 border-red-300 text-red-800' :
                          doseAlert(editDosePreview, editCfg) === 'warn' ? 'bg-amber-50 border-amber-300 text-amber-800' :
                                                                            'bg-green-50 border-green-300 text-green-800'
                        }`}>
                          <span className="font-bold">{editCfg.formatDose(editDosePreview)}</span>
                          <span className="ml-1 opacity-70">{editCfg.dose_unidade}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={cancelEdit}
                        className="flex-1 border border-slate-300 text-slate-600 text-xs font-semibold py-1.5 rounded-lg hover:bg-slate-50">
                        Cancelar
                      </button>
                      <button onClick={() => handleSaveEdit(dva)} disabled={editSaving}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold py-1.5 rounded-lg">
                        {editSaving ? 'Salvando...' : '💾 Salvar'}
                      </button>
                      <button onClick={() => handleRemove(dva.id)} disabled={removing === dva.id}
                        className="text-xs text-red-400 hover:text-red-700 border border-red-100 hover:border-red-300 px-3 py-1.5 rounded-lg transition-colors">
                        {removing === dva.id ? '⏳' : '⏹ Encerrar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Formulário de nova DVA */}
          {dvaFormOpen && (
            <div className="border-2 border-indigo-200 rounded-xl bg-indigo-50 p-4 space-y-3">
              <p className="text-sm font-bold text-indigo-900">Nova DVA</p>
              <div>
                <label className="text-xs text-slate-500 font-medium block mb-1">Droga *</label>
                <select value={selDroga} onChange={e => handleDrogaChange(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  {DROGAS.map(d => {
                    const reason = getBlockReason(d.nome, activeDrogaNomes)
                    return (
                      <option key={d.nome} value={d.nome} disabled={!!reason}>
                        {d.nome}{reason ? ` — ${reason}` : ''}
                      </option>
                    )
                  })}
                </select>
                {selBlockReason && <p className="text-xs text-red-600 mt-1">⚠️ {selBlockReason}</p>}
              </div>
              {!selBlockReason && (
                <>
                  {drogaConfig.variantes.length > 1 && (
                    <div>
                      <label className="text-xs text-slate-500 font-medium block mb-1">Concentração *</label>
                      <div className="flex rounded-lg overflow-hidden border border-slate-300">
                        {drogaConfig.variantes.map((v, i) => (
                          <button key={i} onClick={() => setSelVar(i)}
                            className={`flex-1 py-2 text-sm font-semibold transition-colors ${
                              selVar === i ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                            }`}>
                            {v.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {drogaConfig.variantes.length === 1 && (
                    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500">
                      Concentração: <span className="font-semibold text-slate-700">{varianteConfig.label}</span>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-slate-500 font-medium block mb-1">Fluxo (mL/h) *</label>
                    <input type="number" step="0.1" min="0" value={fluxo}
                      onChange={e => setFluxo(e.target.value)}
                      onWheel={noScrollInput} onKeyDown={noArrowInput}
                      placeholder="ex: 5.5"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
                  </div>
                  {dosePreview !== null && (
                    <div className={`rounded-lg px-4 py-3 border text-sm ${
                      doseAlert(dosePreview, drogaConfig) === 'crit' ? 'bg-red-50 border-red-300 text-red-800' :
                      doseAlert(dosePreview, drogaConfig) === 'warn' ? 'bg-amber-50 border-amber-300 text-amber-800' :
                                                                        'bg-green-50 border-green-300 text-green-800'
                    }`}>
                      <span className="font-bold">{drogaConfig.formatDose(dosePreview)} {drogaConfig.dose_unidade}</span>
                      <span className="ml-2 text-xs opacity-70">(alvo: {drogaConfig.dose_alvo_label})</span>
                    </div>
                  )}
                  {drogaConfig.usaPeso && !peso && (
                    <p className="text-xs text-amber-600">⚠️ Cadastre o peso do paciente para calcular a dose em {drogaConfig.dose_unidade}</p>
                  )}
                  <button onClick={handleSaveDva} disabled={saving || !!selBlockReason}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
                    {saving ? 'Salvando...' : '+ Registrar DVA'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Histórico de turnos */}
      {historyOpen && sortedPeriodos.length > 1 && (
        <div className="mt-2 space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Histórico de Turnos</p>
          {sortedPeriodos.filter(p => p.id !== selectedPeriodo?.id).map(p => {
            const pDVAs    = dvas.filter(d => d.periodo_id === p.id && d.ativo)
            const pSummary = buildSummaryText(pDVAs, peso, null, null)
            return (
              <div key={p.id} className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-700">
                    {fmtTurno(p.turno, p.data + 'T12:00:00')}
                    {p.id === ultimoPeriodo?.id && <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-bold">atual</span>}
                  </span>
                  <button onClick={() => setSelectedPeriodoId(p.id)}
                    className="text-xs text-indigo-500 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-400 px-2 py-1 rounded-lg transition-colors">
                    ✏️ Editar DVAs
                  </button>
                </div>
                <p className="text-xs text-slate-600 italic">{pSummary}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
