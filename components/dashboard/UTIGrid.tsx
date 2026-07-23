'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PacienteModal  from '@/components/paciente/PacienteModal'
import CadastroForm   from '@/components/paciente/CadastroForm'
import ToastContainer, { useToast } from '@/components/ui/Toast'
import { pad, fmtData, calcAge, normalizarNome } from '@/lib/utils'
import { ehIntensivista, apenasMedicos } from '@/lib/cargos'
import SeletorUnidade from './SeletorUnidade'
import { nomeDaAla, type Unidade } from '@/lib/unidade'
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
  const [selectedLeito,   setSelectedLeito]   = useState<{ alaId: string; numero: number } | null>(null)
  const [busca,           setBusca]           = useState('')

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

  // Keep modal in sync after external updates
  useEffect(() => {
    if (selectedPac) {
      const updated = pacientes.find(p => p.id === selectedPac.id)
      if (updated) setSelectedPac(updated)
    }
  }, [pacientes])

  const getPaciente = (alaId: string, leito: number) =>
    pacientes.find(p => p.ala_id === alaId && p.numero_leito === leito && p.ativo)

  const handleLeitoClick = (alaId: string, numero: number, pac: Paciente | undefined) => {
    if (pac) { setSelectedPac(pac) }
    else     { setSelectedLeito({ alaId, numero }); setShowCadastro(true) }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
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
  const ocupados = pacientesVisiveis.length
  const total    = unidade?.leitosAtivos ?? 0

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
            <h1 className="text-xl font-bold">🏥 ProMed UTI</h1>
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
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
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
        ) : alas.map(ala => {
          const ocAla = pacientesVisiveis.filter(p => p.ala_id === ala.id).length
          return (
            <section key={ala.id}>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-lg font-bold text-slate-700">{ala.nome}</h2>
                <span className="text-sm text-slate-400">{ocAla}/{ala.leitos.length} ocupados</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {ala.leitos.map(leito => {
                  const pac = getPaciente(ala.id, leito)
                  return (
                    <LeitoCard
                      key={leito}
                      numero={leito}
                      paciente={pac}
                      onClick={() => handleLeitoClick(ala.id, leito, pac)}
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
          onClose={() => setSelectedPac(null)}
          onAltaConcedida={async () => {
            setSelectedPac(null)
            await refreshPacientes()
            showToast('Alta concedida. Resumo arquivado.')
          }}
          showToast={showToast}
        />
      )}

      <ToastContainer toasts={toasts} remove={removeToast} />
    </div>
  )
}

// ── Leito Card ────────────────────────────────────────────────────────────

function LeitoCard({ numero, paciente, onClick }: {
  numero: number; paciente: Paciente | undefined; onClick: () => void
}) {
  const isEmpty = !paciente

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border-2 p-3 transition-all
        ${isEmpty
          ? 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-md'
          : 'border-indigo-400 bg-indigo-50 hover:shadow-md hover:border-indigo-500'
        }`}
    >
      <div className="text-xs font-bold text-slate-400 mb-1">Leito {pad(numero)}</div>
      {isEmpty ? (
        <div className="text-slate-300 text-xs italic">Vazio</div>
      ) : (
        <>
          <div className="font-semibold text-slate-800 text-sm leading-tight truncate">
            {paciente.nome.split(' ')[0]} {paciente.nome.split(' ').slice(-1)[0]}
          </div>
          <div className="text-xs text-slate-500 mt-1">{calcAge(paciente.data_nascimento)}</div>
          <div className="text-xs text-slate-400 truncate">{paciente.plano_saude}</div>
          {paciente.saps3 == null && (
            <div className="text-[11px] font-semibold text-amber-600 mt-1"
              title="SAPS-3 não pontuado — obrigatório para dar saída">
              ⚠️ SAPS-3
            </div>
          )}
        </>
      )}
    </button>
  )
}
