'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import AltaModal        from './AltaModal'
import { fmtData, calcAge, pad, diasDesde, fmtNum, toTitleCaseNome, ultimoPorTurno } from '@/lib/utils'
import { ALAS, ALAS_MAP, PLANOS, type AlaId } from '@/lib/config'
import { modulosAtivos, type PacienteContext } from '@/lib/modules'
import { montarEvolucaoDiaria } from '@/lib/evolucaoDiaria'
import type { Paciente, Exame, PeriodoBalanco, SinalVital, ExameImagem, DVA, PeriodoHemodinamica, ATB, CuidadosHorizontais, AvaliacaoNeurologica, SuporteVentilatorio, Intercorrencia, PendenciaIntensivista, RegistroIntensivista, ToastData } from '@/types'

const modulos = modulosAtivos()

interface Props {
  paciente: Paciente
  onClose: () => void
  onAltaConcedida: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

function diasInternado(dataInternacao: string, horaInternacao: string): number {
  const inicio = new Date(dataInternacao + 'T' + horaInternacao)
  return Math.max(0, Math.floor((Date.now() - inicio.getTime()) / (24 * 3600 * 1000)))
}

function fmtDataCurta(dataYYYYMMDD: string): string {
  const [y, m, d] = dataYYYYMMDD.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

/** Junta hipóteses digitadas em linhas separadas (Enter na textarea) com " | ". */
function fmtHipoteses(hipoteses: string): string {
  return hipoteses.split('\n').map(h => h.trim()).filter(Boolean).join(' | ')
}

type EditForm = {
  nome: string; data_nascimento: string
  plano: string; planoOu: string
  peso_kg: string; ala_id: AlaId; numero_leito: string
  hipoteses: string
  saps3: string; paliativo: boolean
}

export default function PacienteModal({ paciente, onClose, onAltaConcedida, showToast }: Props) {
  const supabase   = createClient()
  const [moduloId, setModuloId] = useState(modulos[0].id)
  const [tab,      setTab]      = useState(modulos[0].tabs[0].id)
  const moduloAtivo = modulos.find(m => m.id === moduloId) ?? modulos[0]
  const [exames,        setExames]        = useState<Exame[]>([])
  const [periodos,      setPeriodos]      = useState<PeriodoBalanco[]>([])
  const [sinais,        setSinais]        = useState<SinalVital[]>([])
  const [examesImagem,  setExamesImagem]  = useState<ExameImagem[]>([])
  const [dvas,          setDvas]          = useState<DVA[]>([])
  const [periodosHemo,  setPeriodosHemo]  = useState<PeriodoHemodinamica[]>([])
  const [atbs,          setAtbs]          = useState<ATB[]>([])
  const [cuidados,      setCuidados]      = useState<CuidadosHorizontais | null>(null)
  const [neuroHistorico, setNeuroHistorico] = useState<AvaliacaoNeurologica[]>([])
  const [ventHistorico,  setVentHistorico]  = useState<SuporteVentilatorio[]>([])
  const [intercorrencias, setIntercorrencias] = useState<Intercorrencia[]>([])
  const [pendencias,    setPendencias]    = useState<PendenciaIntensivista[]>([])
  const [registrosIntensivista, setRegistrosIntensivista] = useState<RegistroIntensivista[]>([])
  const [souMedicoIntensivista, setSouMedicoIntensivista] = useState(false)
  const [loading,       setLoading]       = useState(true)
  const [showAlta,      setShowAlta]      = useState(false)
  const [pac,           setPac]           = useState<Paciente>(paciente)
  const [editing,       setEditing]       = useState(false)

  // AI evaluation state
  const [aiOpen,    setAiOpen]    = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiText,    setAiText]    = useState<string | null>(null)
  const aiAbortRef = useRef<AbortController | null>(null)

  // Evolução Diária state (determinística, sem IA)
  const [evoOpen,  setEvoOpen]  = useState(false)
  const [evoText,  setEvoText]  = useState('')
  const [evoCopied, setEvoCopied] = useState(false)

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
      saps3: String(p.saps3 ?? ''),
      paliativo: p.paliativo,
    }
  }

  const [editForm,   setEditForm]   = useState<EditForm>(() => makeEditForm(paciente))
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const [saving,     setSaving]     = useState(false)

  // Um loader por tabela — cada assinatura de realtime chama só o seu próprio
  // loader, então uma mudança em 1 tabela não recarrega as outras 10.
  const loadExames = async () => {
    const { data } = await supabase.from('exames').select('*').eq('paciente_id', pac.id).order('created_at')
    if (data) setExames(data as Exame[])
  }
  const loadPeriodos = async () => {
    const { data } = await supabase.from('periodos_balanco').select('*').eq('paciente_id', pac.id).order('inicio')
    if (data) setPeriodos(data as PeriodoBalanco[])
  }
  const loadSinais = async () => {
    const { data } = await supabase.from('sinais_vitais').select('*').eq('paciente_id', pac.id).order('horario')
    if (data) setSinais(data as SinalVital[])
  }
  const loadExamesImagem = async () => {
    const { data } = await supabase.from('exames_imagem').select('*').eq('paciente_id', pac.id).order('created_at', { ascending: false })
    if (data) setExamesImagem(data as ExameImagem[])
  }
  const loadDvas = async () => {
    const { data } = await supabase.from('dvas').select('*').eq('paciente_id', pac.id).order('created_at')
    if (data) setDvas(data as DVA[])
  }
  const loadPeriodosHemo = async () => {
    const { data } = await supabase.from('periodos_hemodinamica').select('*').eq('paciente_id', pac.id).order('criado_em')
    if (data) setPeriodosHemo(data as PeriodoHemodinamica[])
  }
  const loadAtbs = async () => {
    const { data } = await supabase.from('atbs').select('*').eq('paciente_id', pac.id).order('data_inicio')
    if (data) setAtbs(data as ATB[])
  }
  const loadCuidados = async () => {
    const { data } = await supabase.from('cuidados_horizontais').select('*').eq('paciente_id', pac.id).maybeSingle()
    setCuidados((data as CuidadosHorizontais | null) ?? null)
  }
  const loadNeuro = async () => {
    const { data } = await supabase.from('avaliacoes_neurologicas').select('*').eq('paciente_id', pac.id).order('data')
    if (data) setNeuroHistorico(data as AvaliacaoNeurologica[])
  }
  const loadVentilatorio = async () => {
    const { data } = await supabase.from('suportes_ventilatorios').select('*').eq('paciente_id', pac.id).order('data')
    if (data) setVentHistorico(data as SuporteVentilatorio[])
  }
  const loadIntercorrencias = async () => {
    const { data } = await supabase.from('intercorrencias').select('*').eq('paciente_id', pac.id).order('horario', { ascending: false })
    if (data) setIntercorrencias(data as Intercorrencia[])
  }
  const loadPendencias = async () => {
    const { data } = await supabase.from('pendencias_intensivista').select('*').eq('paciente_id', pac.id).order('criado_em')
    if (data) setPendencias(data as PendenciaIntensivista[])
  }
  const loadRegistrosIntensivista = async () => {
    const { data } = await supabase.from('registros_intensivista').select('*').eq('paciente_id', pac.id).order('data')
    if (data) setRegistrosIntensivista(data as RegistroIntensivista[])
  }

  const loadData = async () => {
    setLoading(true)
    await Promise.all([
      loadExames(), loadPeriodos(), loadSinais(), loadExamesImagem(), loadDvas(),
      loadPeriodosHemo(), loadAtbs(), loadCuidados(), loadNeuro(), loadVentilatorio(),
      loadIntercorrencias(), loadPendencias(), loadRegistrosIntensivista(),
    ])
    setLoading(false)
  }

  // Cargo do usuário na escala (módulo Escalas) decide quem pode editar a
  // aba do Médico Intensivista: cargo "chefe" em qualquer unidade edita
  // tudo; sem cadastro em nenhuma unidade cai no comportamento padrão
  // (só edita a aba do Médico Plantonista).
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      supabase.from('staff').select('id').eq('user_id', data.user.id).eq('role', 'chefe').eq('active', true).limit(1)
        .then(({ data: rows }) => setSouMedicoIntensivista((rows?.length ?? 0) > 0))
    })
  }, [])

  useEffect(() => {
    loadData()
    const channel = supabase
      .channel(`modal-${pac.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exames',                filter: `paciente_id=eq.${pac.id}` }, () => loadExames())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'periodos_balanco',       filter: `paciente_id=eq.${pac.id}` }, () => loadPeriodos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sinais_vitais',          filter: `paciente_id=eq.${pac.id}` }, () => loadSinais())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exames_imagem',          filter: `paciente_id=eq.${pac.id}` }, () => loadExamesImagem())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dvas',                   filter: `paciente_id=eq.${pac.id}` }, () => loadDvas())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'periodos_hemodinamica',  filter: `paciente_id=eq.${pac.id}` }, () => loadPeriodosHemo())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'atbs',                   filter: `paciente_id=eq.${pac.id}` }, () => loadAtbs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuidados_horizontais',   filter: `paciente_id=eq.${pac.id}` }, () => loadCuidados())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'avaliacoes_neurologicas', filter: `paciente_id=eq.${pac.id}` }, () => loadNeuro())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suportes_ventilatorios', filter: `paciente_id=eq.${pac.id}` }, () => loadVentilatorio())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'intercorrencias',        filter: `paciente_id=eq.${pac.id}` }, () => loadIntercorrencias())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pendencias_intensivista', filter: `paciente_id=eq.${pac.id}` }, () => loadPendencias())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registros_intensivista', filter: `paciente_id=eq.${pac.id}` }, () => loadRegistrosIntensivista())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pacientes',              filter: `id=eq.${pac.id}` },
        (payload) => { if (payload.new && payload.eventType !== 'DELETE') setPac(payload.new as Paciente) })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [pac.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (aiOpen) { setAiOpen(false); return }
        if (evoOpen) { setEvoOpen(false); return }
        if (!editing) onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editing, aiOpen, evoOpen])

  const neuroAtual = ultimoPorTurno(neuroHistorico)
  const ventAtual  = ultimoPorTurno(ventHistorico)

  const handleAbrirEvolucao = () => {
    setEvoText(montarEvolucaoDiaria({
      paciente: pac, sinais, dvas, periodosHemo, periodos, atbs,
      neuro: neuroAtual, ventilatorio: ventAtual, intercorrencias,
    }))
    setEvoOpen(true)
  }

  const handlePrintEvolucao = () => {
    const win = window.open('', '_blank', 'width=800,height=700')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>Evolução — ${pac.nome}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;padding:20mm 15mm;color:#000;white-space:pre-wrap;line-height:1.6;}
      </style></head><body>${evoText.replace(/&/g, '&amp;').replace(/</g, '&lt;')}
      <script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>
      </body></html>`)
    win.document.close()
  }

  const handleAvaliarIA = async () => {
    aiAbortRef.current?.abort()
    aiAbortRef.current = new AbortController()
    setAiOpen(true)
    setAiLoading(true)
    setAiText(null)
    try {
      const res = await fetch('/api/avaliacao-clinica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: aiAbortRef.current.signal,
        body: JSON.stringify({
          paciente: pac,
          exames,
          sinais,
          examesImagem,
          periodos,
          dvas,
          periodosHemo,
          atbs,
          cuidados,
          neuro: neuroAtual,
          ventilatorio: ventAtual,
          pendencias,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAiText(data.texto)
    } catch (e: any) {
      if (e.name === 'AbortError') return
      showToast('Erro na avaliação com IA: ' + e.message, 'error')
      setAiOpen(false)
    } finally {
      setAiLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    const errs: Record<string, string> = {}
    if (!editForm.nome.trim()) errs.nome = 'Nome obrigatório'
    if (!editForm.data_nascimento) errs.data_nascimento = 'Obrigatório'
    else if (editForm.data_nascimento > hoje) errs.data_nascimento = 'Não pode ser futura'
    if (!editForm.plano) errs.plano = 'Selecione um plano'
    if (editForm.plano === 'Outros' && !editForm.planoOu.trim()) errs.planoOu = 'Informe o plano'
    const novoLeito = parseInt(editForm.numero_leito, 10)
    const alaInfo = ALAS.find(a => a.id === editForm.ala_id)
    if (!alaInfo || !alaInfo.leitos.includes(novoLeito)) {
      errs.numero_leito = `Leito inválido para ${alaInfo?.nome ?? 'UTI selecionada'}`
    }
    const pesoNum = editForm.peso_kg ? parseFloat(editForm.peso_kg) : null
    if (pesoNum !== null && (pesoNum < 1 || pesoNum > 300)) errs.peso_kg = 'Peso inválido (1–300 Kg)'
    const saps3Num = editForm.saps3 ? parseFloat(editForm.saps3) : null
    if (saps3Num !== null && (saps3Num < 0 || saps3Num > 300)) errs.saps3 = 'SAPS-3 inválido'
    setEditErrors(errs)
    if (Object.keys(errs).length > 0) return

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
      nome: toTitleCaseNome(editForm.nome),
      data_nascimento: editForm.data_nascimento,
      plano_saude: planoFinal,
      peso_kg: pesoNum,
      ala_id: editForm.ala_id,
      numero_leito: novoLeito,
      hipoteses: editForm.hipoteses.trim() || null,
      saps3: saps3Num,
      paliativo: editForm.paliativo,
    }
    const { error } = await supabase.from('pacientes').update(updates).eq('id', pac.id)
    setSaving(false)
    if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return }
    setPac(p => ({ ...p, ...updates }))
    setEditing(false)
    setEditErrors({})
    showToast('Dados do paciente atualizados!')
  }

  const moduleCtx: PacienteContext = {
    paciente: pac,
    exames, periodos, sinais, examesImagem, dvas, periodosHemo, atbs, cuidados,
    neuroHistorico, ventHistorico, intercorrencias, pendencias, registrosIntensivista,
    souMedicoIntensivista,
    onRefresh: loadData,
    showToast,
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 flex items-start justify-center p-4 overflow-y-auto"
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1300px] my-2 flex flex-col" style={{maxHeight:'97vh'}}>

          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white px-6 py-4 rounded-t-2xl flex-shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold truncate">{pac.nome}</h2>
                  {pac.paliativo && (
                    <span className="bg-slate-900/60 border border-slate-300/40 text-slate-100 text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                      🕊️ Paliativo
                    </span>
                  )}
                  {ventAtual?.modalidade === 'ventilacao_mecanica' && (
                    <span className="bg-sky-900/60 border border-sky-300/40 text-sky-100 text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                      🫁 VM{ventAtual.vm_via ? ` · ${ventAtual.vm_via}` : ''}{ventAtual.vm_data_inicio ? ` · ${diasDesde(ventAtual.vm_data_inicio)}d` : ''}
                    </span>
                  )}
                </div>
                <p className="text-indigo-200 text-sm mt-1">
                  📅 {fmtData(pac.data_nascimento)} ({calcAge(pac.data_nascimento)}) &nbsp;·&nbsp;
                  🏥 {pac.plano_saude} &nbsp;·&nbsp;
                  🛏️ {ALAS_MAP[pac.ala_id]} — Leito {pad(pac.numero_leito)}
                </p>
                <p className="text-indigo-200 text-xs mt-0.5">
                  🗓️ Internado em {fmtDataCurta(pac.data_internacao)}, às {pac.hora_internacao.substring(0, 5)}
                  &nbsp;·&nbsp; {diasInternado(pac.data_internacao, pac.hora_internacao)} dia(s) de internação
                  {pac.saps3 != null && <> &nbsp;·&nbsp; 📊 SAPS-3: <span className="font-bold">{pac.saps3}</span></>}
                  {pac.peso_kg && <> &nbsp;·&nbsp; ⚖️ {pac.peso_kg % 1 === 0 ? pac.peso_kg : fmtNum(pac.peso_kg, 1)} Kg</>}
                </p>
                {pac.hipoteses && (
                  <p className="text-indigo-300 text-xs mt-1 italic">🩺 {fmtHipoteses(pac.hipoteses)}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={handleAbrirEvolucao} disabled={loading}
                  title={loading ? 'Aguarde o carregamento dos dados do paciente' : 'Evolução diária compilada dos resumos de cada aba (sem IA)'}
                  className="bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                  📝 Evolução do Dia
                </button>
                <button onClick={handleAvaliarIA} disabled={aiLoading || loading}
                  title={loading ? 'Aguarde o carregamento dos dados do paciente' : 'Avaliação clínica completa com IA'}
                  className="bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                  🧠 Avaliar com IA
                </button>
                <button onClick={() => setEditing(e => !e)} title="Editar dados do paciente"
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${editing ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/20'}`}>
                  ✏️ Editar
                </button>
                <button onClick={() => setShowAlta(true)} disabled={loading}
                  title={loading ? 'Aguarde o carregamento dos dados do paciente' : undefined}
                  className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
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
                  <EF label="SAPS-3" error={editErrors.saps3}>
                    <EInput type="number" step="1" min="0" max="300" value={editForm.saps3}
                      onChange={e => setEditForm(f => ({...f, saps3: e.target.value}))}/>
                  </EF>
                  <EF label="UTI">
                    <ESelect value={editForm.ala_id}
                      onChange={e => setEditForm(f => ({...f, ala_id: e.target.value as AlaId, numero_leito: ''}))}>
                      {ALAS.map(a => <option key={a.id} value={a.id} className="text-slate-800">{a.nome}</option>)}
                    </ESelect>
                  </EF>
                  <EF label="Leito" error={editErrors.numero_leito}>
                    <ESelect value={editForm.numero_leito}
                      onChange={e => setEditForm(f => ({...f, numero_leito: e.target.value}))}>
                      <option value="" className="text-slate-800">Selecione...</option>
                      {(ALAS.find(a => a.id === editForm.ala_id)?.leitos ?? []).map(l => (
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
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={editForm.paliativo}
                        onChange={e => setEditForm(f => ({...f, paliativo: e.target.checked}))}
                        className="w-4 h-4 accent-white"/>
                      <span className="text-xs text-white/80 font-medium">🕊️ Paciente em cuidados paliativos</span>
                    </label>
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

            {/* Seletor de módulo (só na nova estrutura, com 2+ módulos) */}
            {modulos.length > 1 && (
              <div className="flex gap-0 mt-4 bg-white/10 rounded-xl p-1 w-fit">
                {modulos.map(m => (
                  <button key={m.id}
                    onClick={() => { setModuloId(m.id); setTab(m.tabs[0].id) }}
                    className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                      moduloId === m.id ? 'bg-white text-indigo-700 shadow' : 'text-indigo-200 hover:text-white'
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            {/* Abas do módulo ativo */}
            <div className="flex gap-1 mt-3 flex-wrap">
              {moduloAtivo.tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    tab === t.id ? 'bg-white text-indigo-700' : 'text-indigo-200 hover:text-white hover:bg-white/10'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 p-6 relative">

            {/* Evolução Diária overlay (determinística, sem IA) */}
            {evoOpen && (
              <div className="absolute inset-0 z-10 bg-white rounded-b-2xl flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📝</span>
                    <span className="font-bold text-slate-800">Evolução do Dia</span>
                    <span className="text-xs text-slate-400">{pac.nome}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => navigator.clipboard.writeText(evoText).then(() => { setEvoCopied(true); setTimeout(() => setEvoCopied(false), 2000) })}
                      className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                        evoCopied ? 'bg-teal-600 text-white border-teal-600' : 'text-teal-600 hover:text-teal-800 border-teal-200 hover:border-teal-400'
                      }`}>
                      {evoCopied ? '✓ Copiado' : '📋 Copiar'}
                    </button>
                    <button onClick={handlePrintEvolucao}
                      className="text-xs text-teal-600 hover:text-teal-800 border border-teal-200 hover:border-teal-400 px-2.5 py-1.5 rounded-lg transition-colors">
                      🖨️ Imprimir
                    </button>
                    <button onClick={() => setEvoOpen(false)}
                      className="text-slate-400 hover:text-slate-700 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100">
                      ✕
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{evoText}</pre>
                </div>
              </div>
            )}

            {/* AI evaluation overlay */}
            {aiOpen && (
              <div className="absolute inset-0 z-10 bg-white rounded-b-2xl flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🧠</span>
                    <span className="font-bold text-slate-800">Avaliação Clínica com IA</span>
                    <span className="text-xs text-slate-400">{pac.nome}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!aiLoading && aiText && (
                      <button onClick={() => navigator.clipboard.writeText(aiText).then(() => showToast('Copiado!'))}
                        className="text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-400 px-2.5 py-1.5 rounded-lg transition-colors">
                        📋 Copiar
                      </button>
                    )}
                    {!aiLoading && aiText && (
                      <button onClick={handleAvaliarIA}
                        className="text-xs text-violet-600 hover:text-violet-800 border border-violet-200 hover:border-violet-400 px-2.5 py-1.5 rounded-lg transition-colors">
                        🔄 Reanalisar
                      </button>
                    )}
                    <button onClick={() => setAiOpen(false)}
                      className="text-slate-400 hover:text-slate-700 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100">
                      ✕
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  {aiLoading ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-4">
                      <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-slate-500 text-sm">Analisando dados clínicos...</p>
                    </div>
                  ) : aiText ? (
                    <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{aiText}</pre>
                  ) : null}
                </div>
              </div>
            )}

            {!loading && pendencias.some(p => !p.resolvida) && (
              <div className="mb-4 bg-amber-50 border-2 border-amber-300 rounded-xl p-3 flex items-start gap-2">
                <span className="text-lg flex-shrink-0">📝</span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Pendências em aberto</p>
                  <ul className="text-sm text-amber-900 mt-0.5 space-y-0.5">
                    {pendencias.filter(p => !p.resolvida).map(p => (
                      <li key={p.id}>• {p.texto}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              moduloAtivo.tabs.find(t => t.id === tab)?.render(moduleCtx)
            )}
          </div>
        </div>
      </div>

      {showAlta && (
        <AltaModal
          paciente={pac}
          exames={exames}
          periodos={periodos}
          sinais={sinais}
          examesImagem={examesImagem}
          dvas={dvas}
          atbs={atbs}
          cuidados={cuidados}
          neuro={neuroAtual}
          ventilatorio={ventAtual}
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
