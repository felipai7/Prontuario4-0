'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData } from '@/lib/utils'
import type { AuditoriaIntensivista, ToastData } from '@/types'

interface Props {
  pacienteId: string
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

// Labels legíveis dos campos de cuidados_horizontais que valem a pena mostrar.
const CAMPOS_CUIDADOS: Record<string, string> = {
  previsao_alta: 'Previsão de alta',
  ibp_em_uso: 'Pantoprazol (IBP)',
  ibp_via: 'Via do IBP',
  ibp_dose_valor: 'Dose do IBP',
  ibp_dose_unidade: 'Unidade da dose do IBP',
  ibp_objetivo: 'Objetivo do IBP',
  anticoag_em_uso: 'Anticoagulante',
  anticoag_droga: 'Droga anticoagulante',
  anticoag_droga_outro: 'Outra droga anticoagulante',
  anticoag_via: 'Via do anticoagulante',
  anticoag_dose_valor: 'Dose do anticoagulante',
  anticoag_dose_unidade: 'Unidade da dose do anticoagulante',
  anticoag_objetivo: 'Objetivo do anticoagulante',
}

function fmtValor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (v === true) return 'sim'
  if (v === false) return 'não'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtData(v)
  return String(v)
}

/** Descrição legível de uma entrada de auditoria, sem expor o jsonb cru. */
function descrever(a: AuditoriaIntensivista): string {
  const antigo = a.dados_antigos ?? {}
  const novo = a.dados_novos ?? {}

  if (a.tabela === 'atbs') {
    const droga = (novo.droga ?? antigo.droga) as string ?? '?'
    if (a.acao === 'INSERT') return `ATB registrado: ${droga}`
    if (a.acao === 'DELETE') return `ATB excluído: ${droga}`
    if (antigo.ativo === true && novo.ativo === false) return `ATB encerrado: ${droga}`
    return `ATB alterado: ${droga}`
  }

  if (a.tabela === 'pendencias_intensivista') {
    const texto = (novo.texto ?? antigo.texto) as string ?? '?'
    if (a.acao === 'INSERT') return `Pendência criada: "${texto}"`
    if (a.acao === 'DELETE') return `Pendência excluída: "${texto}"`
    if (antigo.resolvida === false && novo.resolvida === true) return `Pendência resolvida: "${texto}"`
    if (antigo.resolvida === true && novo.resolvida === false) return `Pendência reaberta: "${texto}"`
    return `Pendência alterada: "${texto}"`
  }

  if (a.tabela === 'registros_intensivista') {
    const data = (novo.data ?? antigo.data) as string | undefined
    const quando = data ? ` de ${fmtData(data)}` : ''
    if (a.acao === 'INSERT') return `Orientações e condutas registradas${quando}`
    if (a.acao === 'DELETE') return `Orientações e condutas excluídas${quando}`
    return `Orientações e condutas editadas${quando}`
  }

  // cuidados_horizontais: lista só os campos que mudaram
  const mudancas: string[] = []
  for (const campo of Object.keys(CAMPOS_CUIDADOS)) {
    const va = antigo[campo], vn = novo[campo]
    if (a.acao === 'INSERT' ? (vn !== null && vn !== undefined && vn !== false && vn !== '') : va !== vn) {
      mudancas.push(a.acao === 'INSERT'
        ? `${CAMPOS_CUIDADOS[campo]}: ${fmtValor(vn)}`
        : `${CAMPOS_CUIDADOS[campo]}: ${fmtValor(va)} → ${fmtValor(vn)}`)
    }
  }
  if (!mudancas.length) return 'Cuidados horizontais salvos (sem mudança nos campos monitorados)'
  return `Cuidados horizontais: ${mudancas.join('; ')}`
}

export default function AuditoriaIntensivistaView({ pacienteId, showToast }: Props) {
  const supabase = createClient()
  const [aberto, setAberto] = useState(false)
  const [entradas, setEntradas] = useState<AuditoriaIntensivista[]>([])
  const [loading, setLoading] = useState(false)

  const carregar = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('auditoria_intensivista')
      .select('*')
      .eq('paciente_id', pacienteId)
      .order('changed_at', { ascending: false })
      .limit(80)
    setLoading(false)
    if (error) { showToast('Erro ao carregar histórico: ' + error.message, 'error'); return }
    setEntradas((data as AuditoriaIntensivista[]) ?? [])
  }

  const handleToggle = () => {
    setAberto(o => !o)
    if (!aberto) carregar()
  }

  return (
    <section className="border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">📜 Histórico de Alterações</h3>
        <button onClick={handleToggle}
          className="text-xs font-medium text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1">
          {aberto ? 'Ocultar' : 'Ver histórico'}
        </button>
      </div>

      {aberto && (
        loading ? (
          <p className="text-sm text-slate-400">Carregando...</p>
        ) : entradas.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma alteração registrada ainda.</p>
        ) : (
          <ul className="space-y-1.5 max-h-80 overflow-y-auto">
            {entradas.map(a => (
              <li key={a.id} className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <p className="text-slate-700">{descrever(a)}</p>
                <p className="text-slate-400 mt-0.5">
                  {new Date(a.changed_at).toLocaleString('pt-BR')}
                  {a.changed_by_email && <> · ✍️ {a.changed_by_email}</>}
                </p>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  )
}
