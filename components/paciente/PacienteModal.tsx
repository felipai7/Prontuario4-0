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

const ALAS: Record<string, string> = { 'uti-01': 'UTI 01', 'uti-02': 'UTI 02' }

export default function PacienteModal({ paciente, onClose, onAltaConcedida, showToast }: Props) {
  const supabase   = createClient()
  const [tab,      setTab]      = useState<Tab>('exames')
  const [exames,   setExames]   = useState<Exame[]>([])
  const [periodos, setPeriodos] = useState<PeriodoBalanco[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showAlta, setShowAlta] = useState(false)

  const loadData = async () => {
    setLoading(true)
    const [exRes, bhRes] = await Promise.all([
      supabase.from('exames').select('*').eq('paciente_id', paciente.id).order('created_at'),
      supabase.from('periodos_balanco').select('*').eq('paciente_id', paciente.id).order('inicio'),
    ])
    if (exRes.data) setExames(exRes.data as Exame[])
    if (bhRes.data) setPeriodos(bhRes.data as PeriodoBalanco[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [paciente.id])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const totalAlt = exames.reduce((acc, ex) => acc + (ex.resultados?.filter(r => r.alterado).length ?? 0), 0)

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 flex items-start justify-center p-4 overflow-y-auto"
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4 flex flex-col" style={{maxHeight:'90vh'}}>

          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white px-6 py-4 rounded-t-2xl flex-shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-bold truncate">{paciente.nome}</h2>
                <p className="text-indigo-200 text-sm mt-1">
                  📅 {fmtData(paciente.data_nascimento)} ({calcAge(paciente.data_nascimento)}) &nbsp;·&nbsp;
                  🏥 {paciente.plano_saude} &nbsp;·&nbsp;
                  🛏️ {ALAS[paciente.ala_id]} — Leito {pad(paciente.numero_leito)}
                </p>
                {paciente.hipoteses && (
                  <p className="text-indigo-300 text-xs mt-1 italic">🩺 {paciente.hipoteses}</p>
                )}
                {paciente.peso_kg && (
                  <p className="text-indigo-200 text-xs mt-0.5">⚖️ {paciente.peso_kg} Kg</p>
                )}
                {totalAlt > 0 && (
                  <span className="inline-block mt-1.5 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    ⚠️ {totalAlt} resultado{totalAlt > 1 ? 's' : ''} alterado{totalAlt > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
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
              <ExamesTab paciente={paciente} exames={exames} onRefresh={loadData} showToast={showToast} />
            ) : (
              <BalancoTab paciente={paciente} periodos={periodos} onRefresh={loadData} showToast={showToast} />
            )}
          </div>
        </div>
      </div>

      {showAlta && (
        <AltaModal
          paciente={paciente}
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
