'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import ExamesTab  from './ExamesTab'
import BalancoTab from './BalancoTab'
import AltaModal  from './AltaModal'
import { fmtData, calcAge, pad } from '@/lib/utils'
import type { Paciente, Exame, PeriodoBalanco, ToastData } from '@/types'

type Tab = 'exames' | 'balanco'

interface Props {
  paciente: Paciente
  onClose: () => void
  onAltaConcedida: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const ALAS_INFO = [
  { id: 'uti-01' as const, nome: 'UTI 01', leitos: Array.from({length: 9},  (_, i) => i + 1)  },
  { id: 'uti-02' as const, nome: 'UTI 02', leitos: Array.from({length: 10}, (_, i) => i + 10) },
]
const ALAS_MAP: Record<string, string> = { 'uti-01': 'UTI 01', 'uti-02': 'UTI 02' }
const PLANOS = ['IPASGO', 'Unimed', 'Particular', 'Bradesco', 'Outros']

type EditForm = {
  nome: string; data_nascimento: string
  plano: string; planoOu: string
  peso_kg: string; ala_id: 'uti-01' | 'uti-02'; numero_leito: string
  hipoteses: string
}

export default function PacienteModal({ paciente, onClose, onAltaConcedida, showToast }: Props) {
  const supabase   = createClient()
  const [tab,      setTab]      = useState<Tab>('exames')
  const [exames,   setExames]   = useState<Exame[]>([])
  const [periodos, setPeriodos] = useState<PeriodoBalanco[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showAlta, setShowAlta] = useState(false)
  const [pac,      setPac]      = useState<Paciente>(paciente)
  const [editing,  setEditing]  = useState(false)
  const hoje = new Date().toISOString().split('T')[0]

  function makeEditForm(p: Paciente): EditForm {
    const knownPlano = PLANOS.includes(p.plano_saude) ? p.plano_saude : 'Outros'
    return {
      nome: p.nome,
      data_nascimento: p.data_nascimento,
      plano: knownPlano,
      planoOu: knownPlano === 'Outros' ? p.plano_saude : '',
      peso_kg: String(p.peso_kg ?? ''),
      ala_id: p.ala_id,
      numero_leito: String(p.numero_leito),
      hipoteses: p.hipoteses ?? '',
    }
  }

  const [editForm,   setEditForm]   = useState<EditForm>(() => makeEditForm(paciente))
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const [saving,     setSaving]     = useState(false)

  const loadData = async () => {
    setLoading(true)
    const [exRes, bhRes] = await Promise.all([
      supabase.from('exames').select('*').eq('paciente_id', pac.id).order('created_at'),
      supabase.from('periodos_balanco').select('*').eq('paciente_id', pac.id).order('inicio'),
    ])
    if (exRes.data) setExames(exRes.data as Exame[])
    if (bhRes.data) setPeriodos(bhRes.data as PeriodoBalanco[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [pac.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editing])

  const handleSaveEdit = async () => {
    const errs: Record<string, string> = {}
    if (!editForm.nome.trim()) errs.nome = 'Nome obrigatório'
    if (!editForm.data_nascimento) errs.data_nascimento = 'Obrigatório'
    else if (editForm.data_nascimento > hoje) errs.data_nascimento = 'Não pode ser futura'
    if (!editForm.plano) errs.plano = 'Selecione um plano'
    if (editForm.plano === 'Outros' && !editForm.planoOu.trim()) errs.planoOu = 'Informe o plano'
    const novoLeito = parseInt(editForm.numero_leito, 10)
    const alaInfo = ALAS_INFO.find(a => a.id === editForm.ala_id)
    if (!alaInfo || !alaInfo.leitos.includes(novoLeito)) {
      errs.numero_leito = `Leito inválido para ${alaInfo?.nome ?? 'UTI selecionada'}`
    }
    const pesoNum = editForm.peso_kg ? parseFloat(editForm.peso_kg) : null
    if (pesoNum !== null && (pesoNum < 1 || pesoNum > 300)) errs.peso_kg = 'Peso inválido (1–300 Kg)'
    setEditErrors(errs)
    if (Object.keys(errs).length > 0) return

    // Check target bed not occupied by another patient
    if (novoLeito !== pac.numero_leito || editForm.ala_id !== pac.ala_id) {
      const { data: ocupante } = await supabase.from('pacientes')
        .select('id, nome').eq('ala_id', editForm.ala_id).eq('numero_leito', novoLeito).eq('ativo', true).single()
      if (ocupante && ocupante.id !== pac.id) {
        setEditErrors(e => ({ ...e, numero_leito: `Leito ocupado por ${ocupante.nome}` }))
        return
      }
    }

    setSaving(true)
    const planoFinal = editForm.plano === 'Outros' ? (editForm.planoOu.trim() || 'Outros') : editForm.plano
    const updates = {
      nome: editForm.nome.trim(),
      data_nascimento: editForm.data_nascimento,
      plano_saude: planoFinal,
      peso_kg: pesoNum,
      ala_id: editForm.ala_id,
      numero_leito: novoLeito,
      hipoteses: editForm.hipoteses.trim() || null,
    }
    const { error } = await supabase.from('pacientes').update(updates).eq('id', pac.id)
    setSaving(false)
    if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return }
    setPac(p => ({ ...p, ...updates }))
    setEditing(false)
    setEditErrors({})
    showToast('Dados do paciente atualizados!')
  }

  const totalAlt = exames.reduce((acc, ex) => acc + (ex.resultados?.filter(r => r.alterado).length ?? 0), 0)

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 flex items-start justify-center p-4 overflow-y-auto"
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1300px] my-2 flex flex-col" style={{maxHeight:'97vh'}}>

          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white px-6 py-4 rounded-t-2xl flex-shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold truncate">{pac.nome}</h2>
                <p className="text-indigo-200 text-sm mt-1">
                  📅 {fmtData(pac.data_nascimento)} ({calcAge(pac.data_nascimento)}) &nbsp;·&nbsp;
                  🏥 {pac.plano_saude} &nbsp;·&nbsp;
                  🛏️ {ALAS_MAP[pac.ala_id]} — Leito {pad(pac.numero_leito)}
                </p>
                {pac.hipoteses && (
                  <p className="text-indigo-300 text-xs mt-1 italic">🩺 {pac.hipoteses}</p>
                )}
                {pac.peso_kg && (
                  <p className="text-indigo-200 text-xs mt-0.5">⚖️ {pac.peso_kg} Kg</p>
                )}
                {totalAlt > 0 && (
                  <span className="inline-block mt-1.5 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    ⚠️ {totalAlt} resultado{totalAlt > 1 ? 's' : ''} alterado{totalAlt > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => setEditing(e => !e)} title="Editar dados do paciente"
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${editing ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/20'}`}>
                  ✏️ Editar
                </button>
                <button onClick={() => setShowAlta(true)}
                  className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                  Alta
                </button>
                <button onClick={onClose}
                  className="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 text-lg">
                  ✕
                </button>
              </div>
            </div>

            {/* Inline edit form */}
            {editing && (
              <div className="mt-4 bg-white/10 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-white/80 uppercase tracking-wide">Editar dados do paciente</p>
                <div className="grid grid-cols-2 gap-2">
                  <EF label="Nome completo" error={editErrors.nome}>
                    <EInput value={editForm.nome} onChange={e => setEditForm(f => ({...f, nome: e.target.value}))}/>
                  </EF>
                  <EF label="Data de nascimento" error={editErrors.data_nascimento}>
                    <EInput type="date" value={editForm.data_nascimento} max={hoje}
                      onChange={e => setEditForm(f => ({...f, data_nascimento: e.target.value}))}/>
                  </EF>
                  <EF label="Plano de saúde" error={editErrors.plano ?? editErrors.planoOu}>
                    <ESelect value={editForm.plano} onChange={e => setEditForm(f => ({...f, plano: e.target.value, planoOu: ''}))}>
                      <option value="" className="text-slate-800">Selecione...</option>
                      {PLANOS.map(p => <option key={p} value={p} className="text-slate-800">{p}</option>)}
                    </ESelect>
                    {editForm.plano === 'Outros' && (
                      <EInput value={editForm.planoOu} onChange={e => setEditForm(f => ({...f, planoOu: e.target.value}))}
                        placeholder="Nome do plano" className="mt-1"/>
                    )}
                  </EF>
                  <EF label="Peso (Kg)" error={editErrors.peso_kg}>
                    <EInput type="number" step="0.1" min="1" max="300" value={editForm.peso_kg}
                      onChange={e => setEditForm(f => ({...f, peso_kg: e.target.value}))}/>
                  </EF>
                  <EF label="UTI">
                    <ESelect value={editForm.ala_id}
                      onChange={e => setEditForm(f => ({...f, ala_id: e.target.value as 'uti-01'|'uti-02', numero_leito: ''}))}>
                      {ALAS_INFO.map(a => <option key={a.id} value={a.id} className="text-slate-800">{a.nome}</option>)}
                    </ESelect>
                  </EF>
                  <EF label="Leito" error={editErrors.numero_leito}>
                    <ESelect value={editForm.numero_leito}
                      onChange={e => setEditForm(f => ({...f, numero_leito: e.target.value}))}>
                      <option value="" className="text-slate-800">Selecione...</option>
                      {(ALAS_INFO.find(a => a.id === editForm.ala_id)?.leitos ?? []).map(l => (
                        <option key={l} value={String(l)} className="text-slate-800">Leito {String(l).padStart(2,'0')}</option>
                      ))}
                    </ESelect>
                  </EF>
                  <div className="col-span-2">
                    <EF label="Hipóteses diagnósticas">
                      <textarea value={editForm.hipoteses} onChange={e => setEditForm(f => ({...f, hipoteses: e.target.value}))}
                        rows={2} placeholder="Ex: Insuficiência respiratória aguda, Sepse..."
                        className="w-full bg-white/20 text-white placeholder-white/40 border border-white/30 rounded-lg px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-white/50"/>
                    </EF>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setEditing(false); setEditErrors({}); setEditForm(makeEditForm(pac)) }}
                    className="px-4 py-1.5 text-sm text-white/70 hover:text-white border border-white/30 rounded-lg transition-colors">
                    Cancelar
                  </button>
                  <button onClick={handleSaveEdit} disabled={saving}
                    className="px-4 py-1.5 text-sm bg-white text-indigo-700 font-bold rounded-lg hover:bg-indigo-50 disabled:opacity-50 transition-colors">
                    {saving ? 'Salvando...' : 'Salvar alterações'}
                  </button>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 mt-4">
              {([['exames','🔬 Exames'],['balanco','💧 Balanço Hídrico']] as [Tab, string][]).map(([t, label]) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    tab === t ? 'bg-white text-indigo-700' : 'text-indigo-200 hover:text-white hover:bg-white/10'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 p-6">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : tab === 'exames' ? (
              <ExamesTab paciente={pac} exames={exames} onRefresh={loadData} showToast={showToast} />
            ) : (
              <BalancoTab paciente={pac} periodos={periodos} onRefresh={loadData} showToast={showToast} />
            )}
          </div>
        </div>
      </div>

      {showAlta && (
        <AltaModal
          paciente={pac}
          exames={exames}
          periodos={periodos}
          onClose={() => setShowAlta(false)}
          onAltaConcedida={onAltaConcedida}
          showToast={showToast}
        />
      )}
    </>
  )
}

const efCls = 'w-full bg-white/20 text-white placeholder-white/40 border border-white/30 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/50'

function EF({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-indigo-200 font-medium block mb-1">{label}</label>
      {children}
      {error && <p className="text-red-300 text-xs mt-0.5">❌ {error}</p>}
    </div>
  )
}
function EInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${efCls} ${props.className ?? ''}`}/>
}
function ESelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${efCls} ${props.className ?? ''}`}/>
}
