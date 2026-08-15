'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PacienteModal  from '@/components/paciente/PacienteModal'
import CadastroForm   from '@/components/paciente/CadastroForm'
import FinalizarAdmissaoModal from '@/components/paciente/FinalizarAdmissaoModal'
import ToastContainer, { useToast } from '@/components/ui/Toast'
import { pad, fmtData, calcAge, normalizarNome } from '@/lib/utils'
import { ehIntensivista, apenasMedicos } from '@/lib/cargos'
import { PLANOS_PADRAO } from '@/lib/config'
import SeletorUnidade from './SeletorUnidade'
import { nomeDaAla, compararLeitos, type Unidade } from '@/lib/unidade'
import type { Paciente, Unit } from '@/types'

interface Props {
  initialPacientes: Paciente[]
  userEmail: string
  /** Planta da unidade, vinda do banco. Null = usuário sem vínculo ativo em `staff`. */
  unidade: Unidade | null
  /** Só vem preenchida para quem atende mais de uma unidade. */
  unidades: Unit[]
}

export default function UTIGrid({ initialPacientes, userEmail, unidade, unidades }: Props) {
  const router           = useRouter()
  const supabase         = createClient()
  const { toasts, showToast, removeToast } = useToast()

  const [pacientes,       setPacientes]       = useState<Paciente[]>(initialPacientes)
  const [selectedPac,     setSelectedPac]     = useState<Paciente | null>(null)
  const [showCadastro,    setShowCadastro]    = useState(false)
  const [selectedLeito,   setSelectedLeito]   = useState<{ alaId: string; numero: string } | null>(null)
  const [busca,           setBusca]           = useState('')
  // Leito na ala rotativo: clicar (ou soltar um paciente de lá num leito
  // normal) abre "Finalizar Admissão" em vez da ficha/move silencioso —
  // é a ação que corrige data/hora e cobra o SAPS-3 de novo.
  const [finalizarTarget, setFinalizarTarget] = useState<{ paciente: Paciente; alaInicial?: string; leitoInicial?: string } | null>(null)

  // Catálogo de planos de saúde: único pro app inteiro (UTI e Hospital sempre
  // aceitaram os mesmos convênios) — carregado uma vez, não por unidade.
  const [planosSaude, setPlanosSaude] = useState<string[]>(PLANOS_PADRAO)
  useEffect(() => {
    supabase.from('planos_saude').select('nome').order('created_at')
      .then(({ data }) => { if (data) setPlanosSaude(data.map(p => p.nome)) })
  }, [])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('pacientes-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pacientes' }, () => {
        router.refresh()
        // Re-fetch active patients
        supabase.from('pacientes').select('*').eq('ativo', true).order('numero_leito')
          .then(({ data }) => { if (data) setPacientes(data as Paciente[]) })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Trocas de plantão pendentes aguardando a resposta do usuário logado —
  // mostradas como badge no botão Escalas, atualizado em tempo real.
  const [trocasPendentes, setTrocasPendentes] = useState(0)
  // Só o chefe (Médico Intensivista) vê o atalho de Indicadores — dado de gestão.
  const [souChefe, setSouChefe] = useState(false)
  useEffect(() => {
    let meusStaffIds: string[] = []

    const contar = async () => {
      if (!meusStaffIds.length) { setTrocasPendentes(0); return }
      const { count } = await supabase
        .from('swap_requests')
        .select('id', { count: 'exact', head: true })
        .in('target_staff_id', meusStaffIds)
        .eq('status', 'pending')
      setTrocasPendentes(count ?? 0)
    }

    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: staffRows } = await supabase
        .from('staff').select('id, profissao, nivel').eq('user_id', data.user.id).eq('active', true)
      // Só médicos entram na escala, então o badge de trocas só faz sentido para eles.
      meusStaffIds = apenasMedicos(staffRows ?? []).map(s => s.id)
      setSouChefe((staffRows ?? []).some(ehIntensivista))
      contar()
    })

    const channel = supabase
      .channel('swaps-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'swap_requests' }, () => contar())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Pacientes com swab de vigilância pendente — badge no card do leito, visível
  // sem precisar abrir o prontuário. Mesma ideia do alerta no Painel do Plantão,
  // só que aqui aparece pra equipe inteira, todo dia, até alguém marcar o
  // resultado (ver EnfermagemTab.tsx).
  const [swabsPendentesIds, setSwabsPendentesIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    const carregar = async () => {
      const { data } = await supabase.from('swabs_vigilancia').select('paciente_id').eq('resultado_disponivel', false)
      setSwabsPendentesIds(new Set((data ?? []).map(s => s.paciente_id as string)))
    }
    carregar()
    const channel = supabase
      .channel('swabs-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'swabs_vigilancia' }, () => carregar())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Keep modal in sync after external updates
  useEffect(() => {
    if (selectedPac) {
      const updated = pacientes.find(p => p.id === selectedPac.id)
      if (updated) setSelectedPac(updated)
    }
  }, [pacientes])

  const getPaciente = (alaId: string, leito: string) =>
    pacientes.find(p => p.ala_id === alaId && p.numero_leito === leito && p.ativo)

  const handleLeitoClick = (alaId: string, numero: string, pac: Paciente | undefined) => {
    const ala = alas.find(a => a.id === alaId)
    if (pac && ala?.rotativo) { setFinalizarTarget({ paciente: pac }) }
    else if (pac)             { setSelectedPac(pac) }
    else                      { setSelectedLeito({ alaId, numero }); setShowCadastro(true) }
  }

  // Arrastar o card de um paciente até um leito vazio transfere na hora — o
  // mesmo caminho do lápis de editar em PacienteModal, só que sem abrir o
  // formulário. dragOverAlvo destaca só o card exato sob o cursor.
  const [dragOverAlvo, setDragOverAlvo] = useState<string | null>(null)

  const moverPaciente = async (pacienteId: string, novaAlaId: string, novoLeito: string) => {
    const pacienteAtual = pacientes.find(p => p.id === pacienteId)
    if (!pacienteAtual) return
    if (pacienteAtual.ala_id === novaAlaId && pacienteAtual.numero_leito === novoLeito) return

    // Saindo da ala de trânsito pra um leito normal: não é um move silencioso,
    // é a admissão de verdade — abre o formulário que corrige data/hora e
    // cobra o SAPS-3, já com o leito solto pré-preenchido.
    if (alas.find(a => a.id === pacienteAtual.ala_id)?.rotativo) {
      setFinalizarTarget({ paciente: pacienteAtual, alaInicial: novaAlaId, leitoInicial: novoLeito })
      return
    }

    const { data: ocupante } = await supabase.from('pacientes')
      .select('id, nome').eq('ala_id', novaAlaId).eq('numero_leito', novoLeito).eq('ativo', true).maybeSingle()
    if (ocupante && ocupante.id !== pacienteId) {
      showToast(`Leito ${pad(novoLeito)} já está ocupado por ${ocupante.nome}`, 'error'); return
    }

    const { error } = await supabase.from('pacientes')
      .update({ ala_id: novaAlaId, numero_leito: novoLeito }).eq('id', pacienteId)
    if (error) { showToast('Erro ao transferir: ' + error.message, 'error'); return }
    await refreshPacientes()
    showToast(`${pacienteAtual.nome.split(' ')[0]} transferido para o leito ${pad(novoLeito)}.`)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    // Recarregamento completo, e não router.push: sem isso o nome/e-mail e as
    // permissões da conta anterior podiam sobreviver em memória (estado do
    // React, singletons de módulo) até o próximo login trazer dados novos por
    // cima — mesma causa do troca-de-unidade em SeletorUnidade.tsx.
    window.location.assign('/login')
  }

  const refreshPacientes = useCallback(async () => {
    const { data } = await supabase.from('pacientes').select('*').eq('ativo', true).order('numero_leito')
    if (data) setPacientes(data as Paciente[])
  }, [])

  const alas = unidade?.alas ?? []

  // Leitos válidos = os que existem na planta desta unidade. Antes vinha de uma
  // constante no código; agora do banco, então uma UTI com outra numeração
  // funciona sem tocar em nada aqui.
  const validLeitos = new Set(alas.flatMap(a => a.leitos))
  const pacientesVisiveis  = pacientes.filter(p => validLeitos.has(p.numero_leito))
  const pacientesFantasmas = pacientes.filter(p => !validLeitos.has(p.numero_leito))
  // Ala de trânsito fica fora da ocupação exibida — mesmo critério do
  // denominador (unidade.leitosAtivos, lib/unidade.ts), senão "ocupados"
  // podia passar de "total" com alguém temporariamente no rotativo.
  const alasRotativoIds = new Set(alas.filter(a => a.rotativo).map(a => a.id))
  const ocupados = pacientesVisiveis.filter(p => !alasRotativoIds.has(p.ala_id)).length
  const total    = unidade?.leitosAtivos ?? 0

  // Setas de leito na ficha do paciente: avançam/retrocedem por número de
  // leito, cruzando alas se precisar — "próximo leito" é sobre a numeração,
  // não sobre em qual ala a pessoa está.
  const pacientesPorLeito = [...pacientesVisiveis].sort((a, b) => compararLeitos(a.numero_leito, b.numero_leito))
  const indexLeitoAtual = selectedPac ? pacientesPorLeito.findIndex(p => p.id === selectedPac.id) : -1
  const navegarLeito = (direcao: -1 | 1) => {
    if (indexLeitoAtual === -1) return
    const novoIndex = indexLeitoAtual + direcao
    if (novoIndex < 0 || novoIndex >= pacientesPorLeito.length) return
    setSelectedPac(pacientesPorLeito[novoIndex])
  }

  const buscaNorm = normalizarNome(busca.trim())
  const resultadosBusca = buscaNorm
    ? pacientes.filter(p => normalizarNome(p.nome).includes(buscaNorm))
    : []

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">🏥 ProMed {unidade?.nome ?? 'UTI'}</h1>
            <p className="text-indigo-200 text-xs mt-0.5">
              {/* Com mais de uma unidade na mesma instalação, saber QUAL UTI está
                  na tela deixa de ser detalhe e vira segurança do paciente.
                  Quem atende só uma vê o nome; quem atende várias, o seletor. */}
              {unidade && unidade.outrasUnidades === 0 && <>{unidade.nome} &nbsp;·&nbsp; </>}
              {ocupados}/{total} leitos ocupados &nbsp;·&nbsp; Tempo real
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-indigo-200 hidden sm:block">{userEmail}</span>
            {unidade && unidade.outrasUnidades > 0 && unidades.length > 1 && (
              <SeletorUnidade unidades={unidades} atual={unidade.unitId} />
            )}
            {souChefe && (
              <>
                <button
                  onClick={() => router.push('/indicadores')}
                  className="bg-white/20 hover:bg-white/30 border border-white/30
                             px-3 py-1.5 rounded-lg text-white text-sm font-medium transition-colors"
                >
                  📊 Indicadores
                </button>
                <button
                  onClick={() => router.push('/unidade')}
                  title="Alas, leitos e cadastro de unidades"
                  className="bg-white/20 hover:bg-white/30 border border-white/30
                             px-3 py-1.5 rounded-lg text-white text-sm font-medium transition-colors"
                >
                  🏗️ Unidade
                </button>
                <button
                  onClick={() => router.push('/auditoria')}
                  title="Todos os pacientes e admissões, de todas as unidades"
                  className="bg-white/20 hover:bg-white/30 border border-white/30
                             px-3 py-1.5 rounded-lg text-white text-sm font-medium transition-colors"
                >
                  🗂️ Auditoria
                </button>
              </>
            )}
            <button
              onClick={() => router.push('/escalas')}
              className="relative bg-white/20 hover:bg-white/30 border border-white/30
                         px-3 py-1.5 rounded-lg text-white text-sm font-medium transition-colors"
            >
              📅 Escalas
              {trocasPendentes > 0 && (
                <span title={`${trocasPendentes} troca(s) de plantão aguardando sua resposta`}
                  className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold
                             min-w-[1.25rem] h-5 px-1 rounded-full flex items-center justify-center shadow">
                  {trocasPendentes}
                </span>
              )}
            </button>
            <button
              onClick={handleLogout}
              className="bg-white/20 hover:bg-white/30 border border-white/30
                         px-3 py-1.5 rounded-lg text-white text-sm font-medium transition-colors"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* Busca por nome */}
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className="relative max-w-md">
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="🔍 Buscar paciente por nome..."
            className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white shadow-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          {buscaNorm && (
            <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
              {resultadosBusca.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-400">Nenhum paciente encontrado.</p>
              ) : resultadosBusca.map(p => (
                <button key={p.id}
                  onClick={() => { setSelectedPac(p); setBusca('') }}
                  className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 transition-colors border-b border-slate-100 last:border-b-0">
                  <span className="text-sm font-medium text-slate-800">{p.nome}</span>
                  <span className="text-xs text-slate-400 ml-2">
                    {nomeDaAla(unidade, p.ala_id)} — Leito {pad(p.numero_leito)} · {calcAge(p.data_nascimento)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ghost patient warning */}
      {pacientesFantasmas.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="text-red-500 text-lg">⚠️</span>
            <div>
              <p className="text-sm font-bold text-red-700">
                {pacientesFantasmas.length} paciente{pacientesFantasmas.length > 1 ? 's' : ''} com leito inválido (não aparece{pacientesFantasmas.length > 1 ? 'm' : ''} no grid)
              </p>
              {pacientesFantasmas.map(p => (
                <p key={p.id} className="text-xs text-red-600 mt-0.5">
                  • {p.nome} — {p.ala_id} Leito {p.numero_leito} (fora do range)
                  &nbsp;
                  <button onClick={() => setSelectedPac(p)}
                    className="underline hover:text-red-800">Corrigir</button>
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {!unidade ? (
          // Sem vínculo em `staff`, o RLS não devolveria paciente nenhum. Dizer
          // isso é muito melhor do que mostrar um mapa vazio, que se leria como
          // "a UTI está sem ninguém internado".
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-6 text-center space-y-1">
            <p className="text-2xl">🔑</p>
            <p className="text-sm font-bold text-amber-800">Seu usuário não está vinculado a nenhuma unidade</p>
            <p className="text-xs text-amber-700">
              Peça ao responsável da UTI para cadastrar você na equipe. Sem o vínculo,
              o sistema não tem como saber quais pacientes são seus.
            </p>
          </div>
        ) : alas.length === 0 ? (
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-6 text-center space-y-1">
            <p className="text-2xl">🛏️</p>
            <p className="text-sm font-bold text-amber-800">A unidade ainda não tem alas e leitos cadastrados</p>
            <p className="text-xs text-amber-700">Cadastre a planta da UTI para o mapa de leitos aparecer.</p>
          </div>
        ) : alas.filter(ala => {
          // Ala de trânsito só aparece com gente nela — vazia, é ruído no
          // dashboard (não é um lugar onde alguém deveria "ficar" de propósito).
          if (!ala.rotativo) return true
          return pacientesVisiveis.some(p => p.ala_id === ala.id)
        }).map(ala => {
          const ocAla = pacientesVisiveis.filter(p => p.ala_id === ala.id).length
          return (
            <section key={ala.id}>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-lg font-bold text-slate-700">
                  {ala.rotativo && '🔁 '}{ala.nome}
                </h2>
                <span className="text-sm text-slate-400">{ocAla}/{ala.leitos.length} ocupados</span>
                {ala.rotativo && (
                  <span className="text-xs text-sky-600">ala de trânsito — leito suspenso</span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {ala.leitos.map(leito => {
                  const pac = getPaciente(ala.id, leito)
                  const alvo = `${ala.id}:${leito}`
                  // Ala de trânsito só recebe por transferir_paciente — arrastar
                  // um paciente pra lá diretamente não é um caminho válido.
                  const aceitaDrop = !pac && !ala.rotativo
                  return (
                    <LeitoCard
                      key={leito}
                      numero={leito}
                      paciente={pac}
                      rotativo={ala.rotativo}
                      requerSaps3={unidade?.requerSaps3 ?? true}
                      swabPendente={!!pac && swabsPendentesIds.has(pac.id)}
                      onClick={() => handleLeitoClick(ala.id, leito, pac)}
                      isDragTarget={dragOverAlvo === alvo}
                      onDragStartPaciente={pac ? (e => e.dataTransfer.setData('text/plain', pac.id)) : undefined}
                      onDragOverVazio={aceitaDrop ? (e => { e.preventDefault(); setDragOverAlvo(alvo) }) : undefined}
                      onDragLeaveVazio={aceitaDrop ? (() => setDragOverAlvo(a => a === alvo ? null : a)) : undefined}
                      onDropVazio={aceitaDrop ? (e => {
                        e.preventDefault()
                        setDragOverAlvo(null)
                        const pacienteId = e.dataTransfer.getData('text/plain')
                        if (pacienteId) moverPaciente(pacienteId, ala.id, leito)
                      }) : undefined}
                    />
                  )
                })}
              </div>
            </section>
          )
        })}
      </main>

      {/* Cadastro modal */}
      {showCadastro && selectedLeito && unidade && (
        <CadastroForm
          alaId={selectedLeito.alaId}
          alaNome={nomeDaAla(unidade, selectedLeito.alaId)}
          unitId={unidade.unitId}
          numeroLeito={selectedLeito.numero}
          planosSaude={planosSaude}
          requerSaps3={unidade.requerSaps3}
          onClose={() => { setShowCadastro(false); setSelectedLeito(null) }}
          onSaved={async () => {
            setShowCadastro(false); setSelectedLeito(null)
            await refreshPacientes()
            showToast('Paciente internado com sucesso!')
          }}
          showToast={showToast}
        />
      )}

      {/* Patient modal */}
      {selectedPac && (
        <PacienteModal
          paciente={selectedPac}
          unidade={unidade}
          pacientesAtivos={pacientes}
          planosSaude={planosSaude}
          onClose={() => setSelectedPac(null)}
          onAltaConcedida={async () => {
            setSelectedPac(null)
            await refreshPacientes()
            showToast('Alta concedida. Resumo arquivado.')
          }}
          showToast={showToast}
          onLeitoAnterior={() => navegarLeito(-1)}
          onProximoLeito={() => navegarLeito(1)}
          temLeitoAnterior={indexLeitoAtual > 0}
          temProximoLeito={indexLeitoAtual !== -1 && indexLeitoAtual < pacientesPorLeito.length - 1}
        />
      )}

      {finalizarTarget && unidade && (
        <FinalizarAdmissaoModal
          paciente={finalizarTarget.paciente}
          unidade={unidade}
          alaInicial={finalizarTarget.alaInicial}
          leitoInicial={finalizarTarget.leitoInicial}
          onClose={() => setFinalizarTarget(null)}
          onFinalizado={async () => {
            setFinalizarTarget(null)
            await refreshPacientes()
            showToast('Admissão finalizada.')
          }}
          showToast={showToast}
        />
      )}

      <ToastContainer toasts={toasts} remove={removeToast} />
    </div>
  )
}

// ── Leito Card ────────────────────────────────────────────────────────────

function LeitoCard({
  numero, paciente, rotativo, requerSaps3, swabPendente, onClick, isDragTarget,
  onDragStartPaciente, onDragOverVazio, onDragLeaveVazio, onDropVazio,
}: {
  numero: string; paciente: Paciente | undefined; requerSaps3: boolean; swabPendente: boolean; onClick: () => void
  /** Leito na ala de trânsito — visual distinto, sem cobrar SAPS-3 (a
   *  admissão de verdade ainda não aconteceu, ver Finalizar Admissão). */
  rotativo?: boolean
  /** true quando um card de paciente está sendo arrastado sobre ESTE leito vazio. */
  isDragTarget?: boolean
  /** Só passado quando há paciente — inicia o arraste (id do paciente no dataTransfer). */
  onDragStartPaciente?: (e: React.DragEvent) => void
  /** Só passados quando o leito está vazio — vira alvo de soltar. */
  onDragOverVazio?: (e: React.DragEvent) => void
  onDragLeaveVazio?: (e: React.DragEvent) => void
  onDropVazio?: (e: React.DragEvent) => void
}) {
  const isEmpty = !paciente

  return (
    <button
      onClick={onClick}
      draggable={!isEmpty}
      onDragStart={onDragStartPaciente}
      onDragOver={onDragOverVazio}
      onDragLeave={onDragLeaveVazio}
      onDrop={onDropVazio}
      title={rotativo && !isEmpty ? 'Clique para finalizar a admissão num leito definitivo'
        : !isEmpty ? 'Arraste para um leito vazio pra transferir' : undefined}
      className={`w-full min-h-[6.75rem] text-left rounded-xl border-2 p-2 transition-all
        ${isEmpty
          ? isDragTarget
            ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-300'
            : rotativo ? 'border-dashed border-sky-200 bg-sky-50/50' : 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-md'
          : rotativo ? 'border-dashed border-sky-400 bg-sky-50 hover:shadow-md hover:border-sky-500'
                     : 'border-indigo-400 bg-indigo-50 hover:shadow-md hover:border-indigo-500 cursor-grab active:cursor-grabbing'
        }`}
    >
      <div className="text-xs font-bold text-slate-400 mb-0.5">Leito {pad(numero)}</div>
      {isEmpty ? (
        <div className={`text-xs italic ${isDragTarget ? 'text-indigo-500 font-semibold not-italic' : 'text-slate-300'}`}>
          {isDragTarget ? 'Soltar aqui' : 'Vazio'}
        </div>
      ) : (
        <>
          <div className="font-semibold text-slate-800 text-sm leading-tight truncate">
            {paciente.nome.split(' ')[0]} {paciente.nome.split(' ')[1] ?? ''}
          </div>
          <div className="text-xs text-slate-500">{calcAge(paciente.data_nascimento)}</div>
          <div className="text-xs text-slate-400 truncate">{paciente.plano_saude}</div>
          {/* Área reservada pros badges (SAPS-3, swab): altura fixa mesmo com 0, 1 ou 2
              badges, senão os cards da mesma linha do grid ficam com alturas diferentes. */}
          <div className="min-h-[2rem] mt-0.5 space-y-0.5">
            {rotativo ? (
              <div className="text-[11px] font-semibold text-sky-600">🔁 aguardando leito</div>
            ) : (
              <>
                {requerSaps3 && paciente.saps3 == null && (
                  <div className="text-[11px] font-semibold text-amber-600"
                    title="SAPS-3 não pontuado — obrigatório para dar saída">
                    ⚠️ SAPS-3
                  </div>
                )}
                {swabPendente && (
                  <div className="text-[11px] font-semibold text-amber-600"
                    title="Swab de vigilância coletado, resultado ainda pendente">
                    🧫 Swab pendente
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </button>
  )
}
