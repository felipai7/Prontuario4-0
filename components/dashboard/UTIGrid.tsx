'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PacienteModal  from '@/components/paciente/PacienteModal'
import CadastroForm   from '@/components/paciente/CadastroForm'
import ToastContainer, { useToast } from '@/components/ui/Toast'
import { pad, fmtData, calcAge } from '@/lib/utils'
import type { Paciente } from '@/types'

const ALAS = [
  { id: 'uti-01', nome: 'UTI 01', leitos: Array.from({length: 9},  (_, i) => i + 1)  },
  { id: 'uti-02', nome: 'UTI 02', leitos: Array.from({length: 10}, (_, i) => i + 10) },
]

interface Props { initialPacientes: Paciente[]; userEmail: string }

export default function UTIGrid({ initialPacientes, userEmail }: Props) {
  const router           = useRouter()
  const supabase         = createClient()
  const { toasts, showToast, removeToast } = useToast()

  const [pacientes,       setPacientes]       = useState<Paciente[]>(initialPacientes)
  const [selectedPac,     setSelectedPac]     = useState<Paciente | null>(null)
  const [showCadastro,    setShowCadastro]    = useState(false)
  const [selectedLeito,   setSelectedLeito]   = useState<{ alaId: string; numero: number } | null>(null)

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

  const ocupados = pacientes.length
  const total    = 19

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">🏥 Sistema UTI</h1>
            <p className="text-indigo-200 text-xs mt-0.5">
              {ocupados}/{total} leitos ocupados &nbsp;·&nbsp; Tempo real
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-indigo-200 hidden sm:block">{userEmail}</span>
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

      {/* Grid */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {ALAS.map(ala => {
          const ocAla = pacientes.filter(p => p.ala_id === ala.id).length
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
      {showCadastro && selectedLeito && (
        <CadastroForm
          alaId={selectedLeito.alaId}
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
        </>
      )}
    </button>
  )
}
