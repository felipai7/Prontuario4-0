'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import AltaModal        from './AltaModal'
import { fmtData, calcAge, pad, diasDesde, fmtNum, toTitleCaseNome, ultimoPorTurno, horasDesdeAdmissao, parseDataParaISO, hojeISO, sugerirProximoTurno, boundaryStart } from '@/lib/utils'
import { nomeDaAla, type Unidade } from '@/lib/unidade'
import { modulosAtivos, type PacienteContext } from '@/lib/modules'
import { montarEvolucaoDiaria } from '@/lib/evolucaoDiaria'
import { podeEditarModulo } from '@/lib/cargos'
import type { Paciente, Exame, PeriodoBalanco, SinalVital, ExameImagem, DVA, PeriodoHemodinamica, ATB, CuidadosHorizontais, AvaliacaoNeurologica, SuporteVentilatorio, Intercorrencia, PendenciaIntensivista, RegistroIntensivista, FisioEvento, FisioAvaliacaoDiaria, Dispositivo, LppEvento, NutricaoAvaliacao, NutricaoDia, AuditoriaIntensivista, IrasEvento, IrasSepseChoque, SwabVigilancia, ToastData, Cargo } from '@/types'

const modulos = modulosAtivos()

interface Props {
  paciente: Paciente
  /** Planta da unidade (alas e leitos), lida do banco. */
  unidade: Unidade | null
  /** Catálogo único de planos de saúde do app (sem o "Outros" sentinela). */
  planosSaude: string[]
  onClose: () => void
  onAltaConcedida: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
  /**
   * Navegação entre leitos pelas setas laterais. O modal não desmonta ao
   * trocar de paciente (só troca o conteúdo) — é isso que preserva o
   * módulo/aba selecionados de um leito para o outro.
   */
  onLeitoAnterior?: () => void
  onProximoLeito?: () => void
  temLeitoAnterior?: boolean
  temProximoLeito?: boolean
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
  peso_kg: string; ala_id: string; numero_leito: string
  data_internacao: string; hora_internacao: string
  hipoteses: string
  saps3: string; paliativo: boolean; oncologico: boolean
}

export default function PacienteModal({
  paciente, unidade, planosSaude, onClose, onAltaConcedida, showToast,
  onLeitoAnterior, onProximoLeito, temLeitoAnterior, temProximoLeito,
}: Props) {
  const supabase   = createClient()
  const alas       = unidade?.alas ?? []
  const opcoesPlanos = [...planosSaude, 'Outros']
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
  const [fisioEventos,    setFisioEventos]    = useState<FisioEvento[]>([])
  const [fisioAvaliacoes, setFisioAvaliacoes] = useState<FisioAvaliacaoDiaria[]>([])
  const [dispositivos,    setDispositivos]    = useState<Dispositivo[]>([])
  const [lpps,            setLpps]            = useState<LppEvento[]>([])
  const [swabs,           setSwabs]           = useState<SwabVigilancia[]>([])
  const [nutricaoAvaliacao, setNutricaoAvaliacao] = useState<NutricaoAvaliacao | null>(null)
  const [nutricaoDias,      setNutricaoDias]      = useState<NutricaoDia[]>([])
  const [auditoria,         setAuditoria]         = useState<AuditoriaIntensivista[]>([])
  const [irasEventos,       setIrasEventos]       = useState<IrasEvento[]>([])
  const [irasSepse,         setIrasSepse]         = useState<IrasSepseChoque | null>(null)
  const [cargo, setCargo] = useState<Cargo | null>(null)
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

  const hoje = hojeISO()

  function makeEditForm(p: Paciente): EditForm {
    const knownPlano = opcoesPlanos.includes(p.plano_saude) ? p.plano_saude : 'Outros'
    return {
      nome: p.nome,
      data_nascimento: p.data_nascimento,
      plano: knownPlano,
      planoOu: knownPlano === 'Outros' ? p.plano_saude : '',
      peso_kg: String(p.peso_kg ?? ''),
      ala_id: p.ala_id,
      numero_leito: String(p.numero_leito),
      data_internacao: p.data_internacao,
      // O banco guarda `time` (HH:MM:SS); o input type=time espera HH:MM.
      hora_internacao: (p.hora_internacao ?? '12:00').substring(0, 5),
      hipoteses: p.hipoteses ?? '',
      saps3: String(p.saps3 ?? ''),
      paliativo: p.paliativo,
      oncologico: p.oncologico,
    }
  }

  const [editForm,   setEditForm]   = useState<EditForm>(() => makeEditForm(paciente))
  /** A admissão em edição difere da salva? Dispara o aviso de impacto. */
  const admissaoAlterada =
    editForm.data_internacao !== pac.data_internacao ||
    editForm.hora_internacao !== (pac.hora_internacao ?? '12:00').substring(0, 5)
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const [saving,     setSaving]     = useState(false)

  // Um loader por tabela — cada assinatura de realtime chama só o seu próprio
  // loader, então uma mudança em 1 tabela não recarrega as outras 10.
  const loadExames = async () => {
    const { data } = await supabase.from('exames').select('*').eq('paciente_id', pac.id).order('created_at')
    if (data) setExames(data as Exame[])
  }
  // Um salvamento de balanço dispara DOIS recarregamentos concorrentes (o
  // onRefresh explícito do BalancoTab + o evento de realtime da própria
  // gravação) — sem trava, a resposta do MAIS ANTIGO podia chegar depois da
  // do mais novo e sobrescrever a tela com um valor já superado (turno editado
  // duas vezes em sequência rápida, por exemplo). Reabrir a ficha mascarava o
  // sintoma porque um único load novo ganhava a corrida sozinho — mas o dado
  // errado ficava visível até isso acontecer.
  const periodosReqRef = useRef(0)
  const loadPeriodos = async () => {
    const reqId = ++periodosReqRef.current
    const { data } = await supabase.from('periodos_balanco').select('*').eq('paciente_id', pac.id).order('inicio')
    if (data && reqId === periodosReqRef.current) setPeriodos(data as PeriodoBalanco[])
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
  /**
   * VM é tácita (não pede novo registro a cada turno): se o último registro
   * já é ventilação mecânica e o próximo turno sugerido já venceu, repete o
   * registro sozinho — em loop, pra recuperar vários turnos perdidos de uma
   * vez se a ficha ficar dias sem ser aberta. O indicador de ventilador-dia
   * (indicadores_fase1.sql) continua contando por linha data+turno; isso só
   * tira o clique manual do meio do caminho. A constraint unique
   * (paciente_id, data, turno) evita duplicar se duas sessões carregarem ao
   * mesmo tempo — nesse caso o insert perdedor simplesmente erra e o loop para.
   */
  const preencherVMTacita = async (historicoInicial: SuporteVentilatorio[]): Promise<SuporteVentilatorio[]> => {
    let atual = historicoInicial
    for (let i = 0; i < 60; i++) {
      const ultimo = ultimoPorTurno(atual)
      if (!ultimo || ultimo.modalidade !== 'ventilacao_mecanica') break
      const sugestao = sugerirProximoTurno(atual)
      const fimSugestao = boundaryStart(sugestao.data, sugestao.turno).getTime() + 12 * 3_600_000
      if (fimSugestao > Date.now()) break
      const { data, error } = await supabase.from('suportes_ventilatorios').insert({
        paciente_id: pac.id, data: sugestao.data, turno: sugestao.turno,
        modalidade: 'ventilacao_mecanica', o2_dispositivo: null, o2_fluxo_l_min: null,
        vm_via: ultimo.vm_via, vm_data_inicio: ultimo.vm_data_inicio,
      }).select().single()
      if (error || !data) break
      atual = [...atual, data as SuporteVentilatorio]
    }
    return atual
  }
  const loadVentilatorio = async () => {
    const { data } = await supabase.from('suportes_ventilatorios').select('*').eq('paciente_id', pac.id).order('data')
    if (!data) return
    const historico = pac.ativo ? await preencherVMTacita(data as SuporteVentilatorio[]) : (data as SuporteVentilatorio[])
    setVentHistorico(historico)
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

  const loadFisioEventos = async () => {
    const { data } = await supabase.from('fisio_eventos').select('*').eq('paciente_id', pac.id).order('data')
    if (data) setFisioEventos(data as FisioEvento[])
  }
  const loadFisioAvaliacoes = async () => {
    const { data } = await supabase.from('fisio_avaliacoes_diarias').select('*').eq('paciente_id', pac.id).order('data')
    if (data) setFisioAvaliacoes(data as FisioAvaliacaoDiaria[])
  }

  const loadDispositivos = async () => {
    const { data } = await supabase.from('dispositivos').select('*').eq('paciente_id', pac.id).order('data_insercao')
    if (data) setDispositivos(data as Dispositivo[])
  }
  const loadLpps = async () => {
    const { data } = await supabase.from('lpp_eventos').select('*').eq('paciente_id', pac.id).order('data')
    if (data) setLpps(data as LppEvento[])
  }
  const loadSwabs = async () => {
    const { data } = await supabase.from('swabs_vigilancia').select('*').eq('paciente_id', pac.id).order('data_coleta')
    if (data) setSwabs(data as SwabVigilancia[])
  }

  const loadNutricaoAvaliacao = async () => {
    const { data } = await supabase.from('nutricao_avaliacoes').select('*').eq('paciente_id', pac.id).maybeSingle()
    setNutricaoAvaliacao((data as NutricaoAvaliacao) ?? null)
  }
  const loadNutricaoDias = async () => {
    const { data } = await supabase.from('nutricao_dia').select('*').eq('paciente_id', pac.id).order('data')
    if (data) setNutricaoDias(data as NutricaoDia[])
  }
  // Só as entradas de cuidados_horizontais: é o que a Nutrição usa para datar o
  // opioide. Filtra no banco para não trazer a auditoria inteira.
  const loadAuditoria = async () => {
    const { data } = await supabase.from('auditoria_intensivista').select('*')
      .eq('paciente_id', pac.id).eq('tabela', 'cuidados_horizontais').order('changed_at')
    if (data) setAuditoria(data as AuditoriaIntensivista[])
  }

  const loadIrasEventos = async () => {
    const { data } = await supabase.from('iras_eventos').select('*').eq('paciente_id', pac.id).order('data')
    if (data) setIrasEventos(data as IrasEvento[])
  }
  const loadIrasSepse = async () => {
    const { data } = await supabase.from('iras_sepse_choque').select('*').eq('paciente_id', pac.id).maybeSingle()
    setIrasSepse((data as IrasSepseChoque) ?? null)
  }

  const loadData = async () => {
    setLoading(true)
    await Promise.all([
      loadExames(), loadPeriodos(), loadSinais(), loadExamesImagem(), loadDvas(),
      loadPeriodosHemo(), loadAtbs(), loadCuidados(), loadNeuro(), loadVentilatorio(),
      loadIntercorrencias(), loadPendencias(), loadRegistrosIntensivista(),
      loadFisioEventos(), loadFisioAvaliacoes(), loadDispositivos(), loadLpps(), loadSwabs(),
      loadNutricaoAvaliacao(), loadNutricaoDias(), loadAuditoria(),
      loadIrasEventos(), loadIrasSepse(),
    ])
    setLoading(false)
  }

  // O cargo decide o que a pessoa edita. Todo mundo vê todas as abas; só o dono
  // da profissão escreve na sua, e o Médico Intensivista escreve em todas.
  // Sem cadastro em `staff`, cai em Médico Plantonista (ver lib/cargos.ts).
  useEffect(() => {
    supabase.rpc('meu_cargo').then(({ data }) => {
      const c = Array.isArray(data) ? data[0] : data
      if (c) setCargo(c as Cargo)
    })
  }, [])

  // Navegar de leito troca o paciente sem desmontar o modal — é isso que
  // preserva o módulo/aba selecionados de um leito para o outro. Mas `pac`
  // só nasce do prop na primeira montagem (`useState` ignora atualizações do
  // valor inicial), então este efeito é quem de fato troca de paciente
  // quando o prop muda. Reseta o que é estado do paciente ANTERIOR — seguir
  // com um formulário de edição aberto, ou uma avaliação de IA em
  // andamento, depois de trocar de leito misturaria dado de duas pessoas.
  useEffect(() => {
    setPac(paciente)
    setEditing(false)
    setEditErrors({})
    setEditForm(makeEditForm(paciente))
    setShowAlta(false)
    aiAbortRef.current?.abort()
    setAiOpen(false); setAiText(null); setAiLoading(false)
    setEvoOpen(false); setEvoText(''); setEvoCopied(false)
  }, [paciente.id])

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'swabs_vigilancia',        filter: `paciente_id=eq.${pac.id}` }, () => loadSwabs())
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
    const novoLeito = editForm.numero_leito
    const alaInfo = alas.find(a => a.id === editForm.ala_id)
    if (!alaInfo || !alaInfo.leitos.includes(novoLeito)) {
      errs.numero_leito = `Leito inválido para ${alaInfo?.nome ?? 'UTI selecionada'}`
    }
    // Admissão: valida data E hora juntas. Só a data não basta — admitir "hoje
    // às 23:00" às 14:00 seria uma internação que ainda não aconteceu, e isso
    // contamina pacientes-dia, tempo de permanência e o cálculo do 1º balanço.
    if (!editForm.data_internacao) errs.data_internacao = 'Obrigatória'
    else if (!editForm.hora_internacao) errs.hora_internacao = 'Obrigatória'
    else {
      const admissao = new Date(`${editForm.data_internacao}T${editForm.hora_internacao}:00`)
      if (isNaN(admissao.getTime())) errs.data_internacao = 'Data ou hora inválida'
      else if (admissao.getTime() > Date.now()) errs.data_internacao = 'A admissão não pode estar no futuro'
      else if (editForm.data_nascimento && editForm.data_internacao < editForm.data_nascimento) {
        errs.data_internacao = 'Anterior à data de nascimento'
      }
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
      data_internacao: editForm.data_internacao,
      hora_internacao: editForm.hora_internacao,
      hipoteses: editForm.hipoteses.trim() || null,
      saps3: saps3Num,
      paliativo: editForm.paliativo,
      oncologico: editForm.oncologico,
      // Carimba a hora da PRIMEIRA pontuação e não a sobrescreve depois: é ela
      // que revela se o SAPS 3 foi pontuado na janela certa ou já sabendo o
      // desfecho. Corrigir o escore depois não deve apagar esse rastro.
      saps3_calculado_em: saps3Num === null ? null
        : (pac.saps3_calculado_em ?? new Date().toISOString()),
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
    fisioEventos, fisioAvaliacoes, dispositivos, lpps, swabs, nutricaoAvaliacao, nutricaoDias, auditoria,
    irasEventos, irasSepse,
    cargo,
    podeEditar: podeEditarModulo(cargo, moduloAtivo),
    onRefresh: loadData,
    showToast,
  }

  /**
   * Uma aba pode ter dono próprio, diferente do módulo em que aparece
   * (Ventilatório é da fisio, mas o plantonista a vê no módulo dele). Nesse
   * caso a permissão vem do dono da aba, não do módulo.
   */
  const renderAbaAtiva = () => {
    const aba = moduloAtivo.tabs.find(t => t.id === tab)
    if (!aba) return null
    const ctx = aba.dona
      ? { ...moduleCtx, podeEditar: podeEditarModulo(cargo, aba.dona) }
      : moduleCtx
    return aba.render(ctx)
  }

  return (
    <>
      {/* Sem fechar ao clicar fora: um clique acidental no fundo fechava o modal
          e derrubava um formulário meio preenchido (ex.: o balanço). O fechamento
          é só pelo X ou por ESC (ver o handler de teclado acima). */}
      {/* p-1 no celular: os 16px de cada lado custavam ~9% da largura útil de um
          iPhone, e isso sai justamente do conteúdo. No desktop segue p-4. */}
      <div className="fixed inset-0 bg-black/60 z-40 flex items-start justify-center p-1 sm:p-4 overflow-y-auto">
        {/* Setas de leito: trocam o paciente sem fechar o modal, então o
            módulo/aba que estava aberto continua o mesmo no leito seguinte
            (ex.: balanço hídrico do leito 3 → balanço hídrico do leito 4). */}
        {onLeitoAnterior && temLeitoAnterior && (
          <button onClick={onLeitoAnterior} title="Leito anterior"
            className="fixed left-1 sm:left-3 top-1/2 -translate-y-1/2 z-50 bg-white/90 hover:bg-white text-slate-700 rounded-full w-10 h-10 sm:w-12 sm:h-12 shadow-lg flex items-center justify-center text-2xl font-bold transition-colors">
            ‹
          </button>
        )}
        {onProximoLeito && temProximoLeito && (
          <button onClick={onProximoLeito} title="Próximo leito"
            className="fixed right-1 sm:right-3 top-1/2 -translate-y-1/2 z-50 bg-white/90 hover:bg-white text-slate-700 rounded-full w-10 h-10 sm:w-12 sm:h-12 shadow-lg flex items-center justify-center text-2xl font-bold transition-colors">
            ›
          </button>
        )}
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1300px] my-2 flex flex-col" style={{maxHeight:'97vh'}}>

          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white px-3 sm:px-6 py-4 rounded-t-2xl flex-shrink-0">
            {/* No celular a identificação fica ACIMA dos botões, em vez de ao lado.
                Lado a lado, os botões (flex-shrink-0 + whitespace-nowrap) somam
                ~420px e não cedem, então o bloco do nome era espremido até
                largura ZERO — o texto quebrava letra a letra e o cabeçalho
                passava de 900px, empurrando todo o conteúdo para fora da tela. */}
            <div className="flex flex-col sm:flex-row items-start justify-between gap-2 sm:gap-4">
              <div className="min-w-0 w-full sm:flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold truncate">{pac.nome}</h2>
                  {pac.paliativo && (
                    <span className="bg-slate-900/60 border border-slate-300/40 text-slate-100 text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                      🕊️ Paliativo
                    </span>
                  )}
                  {pac.oncologico && (
                    <span className="bg-slate-900/60 border border-slate-300/40 text-slate-100 text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                      🎗️ Oncológico
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
                  🛏️ {nomeDaAla(unidade, pac.ala_id)} — Leito {pad(pac.numero_leito)}
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
              <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto sm:flex-nowrap sm:flex-shrink-0">
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
                {/* Empilha no celular: "Nome completo" em meia tela de 375px
                    mostra meia dúzia de caracteres. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                      {opcoesPlanos.map(p => <option key={p} value={p} className="text-slate-800">{p}</option>)}
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
                      onChange={e => setEditForm(f => ({...f, ala_id: e.target.value, numero_leito: ''}))}>
                      {alas.map(a => <option key={a.id} value={a.id} className="text-slate-800">{a.nome}</option>)}
                    </ESelect>
                  </EF>
                  <EF label="Leito" error={editErrors.numero_leito}>
                    <ESelect value={editForm.numero_leito}
                      onChange={e => setEditForm(f => ({...f, numero_leito: e.target.value}))}>
                      <option value="" className="text-slate-800">Selecione...</option>
                      {(alas.find(a => a.id === editForm.ala_id)?.leitos ?? []).map(l => (
                        <option key={l} value={String(l)} className="text-slate-800">Leito {String(l).padStart(2,'0')}</option>
                      ))}
                    </ESelect>
                  </EF>
                  <EF label="Data de internação" error={editErrors.data_internacao}>
                    <EInput type="date" value={editForm.data_internacao} max={hoje}
                      onPaste={e => {
                        const iso = parseDataParaISO(e.clipboardData.getData('text'))
                        if (iso) { e.preventDefault(); setEditForm(f => ({...f, data_internacao: iso})) }
                      }}
                      onChange={e => setEditForm(f => ({...f, data_internacao: e.target.value}))}/>
                  </EF>
                  <EF label="Hora de internação" error={editErrors.hora_internacao}>
                    <EInput type="time" value={editForm.hora_internacao}
                      onChange={e => setEditForm(f => ({...f, hora_internacao: e.target.value}))}/>
                  </EF>

                  {/* A admissão não é um dado qualquer: ela é o início da contagem
                      de pacientes-dia, do tempo de permanência e dos turnos de
                      balanço. Corrigir um erro de digitação é legítimo, mas quem
                      mexe precisa saber o que arrasta junto. */}
                  {admissaoAlterada && (
                    <div className="sm:col-span-2 bg-amber-400/20 border border-amber-300/50 rounded-lg px-3 py-2">
                      <p className="text-xs text-amber-100">
                        ⚠️ Alterar a admissão recalcula <strong>tempo de permanência</strong>,{' '}
                        <strong>pacientes-dia</strong> e a <strong>taxa de ocupação</strong> do período.
                        {periodos.length > 0 && ' Os turnos de balanço já lançados não são movidos.'}
                      </p>
                    </div>
                  )}

                  <div className="col-span-2">
                    <EF label="Hipóteses diagnósticas">
                      <textarea value={editForm.hipoteses} onChange={e => setEditForm(f => ({...f, hipoteses: e.target.value}))}
                        rows={2} placeholder="Ex: Insuficiência respiratória aguda, Sepse..."
                        className="w-full bg-white/20 text-white placeholder-white/40 border border-white/30 rounded-lg px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-white/50"/>
                    </EF>
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-x-5 gap-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={editForm.paliativo}
                        onChange={e => setEditForm(f => ({...f, paliativo: e.target.checked}))}
                        className="w-4 h-4 accent-white"/>
                      <span className="text-xs text-white/80 font-medium">🕊️ Paciente em cuidados paliativos</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={editForm.oncologico}
                        onChange={e => setEditForm(f => ({...f, oncologico: e.target.checked}))}
                        className="w-4 h-4 accent-white"/>
                      <span className="text-xs text-white/80 font-medium">🎗️ Paciente oncológico</span>
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

            {/* SAPS 3 pendente: fica acima do seletor de módulo, então plantonista
                e intensivista veem o mesmo aviso. Endurece depois de 24h porque
                é essa a janela em que a pontuação ainda não conhece o desfecho. */}
            {(unidade?.requerSaps3 ?? true) && pac.saps3 == null && (
              <div className={`mt-4 rounded-xl px-3 py-2 border ${
                horasDesdeAdmissao(pac) > 24
                  ? 'bg-red-500/25 border-red-300/50'
                  : 'bg-amber-400/20 border-amber-200/40'
              }`}>
                <p className="text-xs font-semibold text-white">
                  ⚠️ SAPS-3 não pontuado
                  {horasDesdeAdmissao(pac) > 24 && ' — já se passaram mais de 24h da admissão'}
                </p>
                <p className="text-[11px] text-white/70 mt-0.5">
                  Pontue em “✏️ Editar”. É obrigatório para dar saída, e deve usar os dados
                  da primeira hora de internação.
                </p>
              </div>
            )}

            {/* Seletor de módulo (só na nova estrutura, com 2+ módulos) */}
            {/* max-w-full + overflow-x-auto: com w-fit sozinho, os 5 módulos
                estouravam a largura do celular em vez de rolar. */}
            {modulos.length > 1 && (
              <div className="flex gap-0 mt-4 bg-white/10 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
                {modulos.map(m => (
                  <button key={m.id}
                    onClick={() => { setModuloId(m.id); setTab(m.tabs[0].id) }}
                    className={`px-3 sm:px-4 py-1.5 rounded-lg text-sm font-bold transition-colors whitespace-nowrap ${
                      moduloId === m.id ? 'bg-white text-indigo-700 shadow' : 'text-indigo-200 hover:text-white'
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            {/* Abas do módulo ativo. No celular rolam na horizontal, numa linha
                só: quebrando, as 7 abas ocupavam 176px de altura — espaço que o
                cabeçalho (flex-shrink-0) tira direto do conteúdo. */}
            <div className="flex gap-1 mt-3 overflow-x-auto sm:flex-wrap sm:overflow-x-visible pb-1 sm:pb-0">
              {moduloAtivo.tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`px-3 sm:px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap flex-shrink-0 ${
                    tab === t.id ? 'bg-white text-indigo-700' : 'text-indigo-200 hover:text-white hover:bg-white/10'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 p-3 sm:p-6 relative">

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
              renderAbaAtiva()
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
          requerSaps3={unidade?.requerSaps3 ?? true}
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
