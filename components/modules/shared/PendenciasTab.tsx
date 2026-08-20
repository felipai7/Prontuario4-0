'use client'
import { fmtData } from '@/lib/utils'
import type { PendenciaIntensivista, RegistroIntensivista } from '@/types'

interface Props {
  pendencias: PendenciaIntensivista[]
  registrosIntensivista: RegistroIntensivista[]
}

/**
 * Pendências e orientações do médico intensivista — escritas na aba Cuidados
 * Horizontais (módulo Médico Intensivista) e, até aqui, só reaparecendo no
 * Painel do Plantão/Resumo (módulo médico). Enfermagem, fisioterapia e
 * nutrição não passam por lá no dia a dia e nunca viam o que ficou pendente
 * — esta aba replica o mesmo conteúdo, só leitura, também nos módulos deles.
 */
export default function PendenciasTab({ pendencias, registrosIntensivista }: Props) {
  const abertas = pendencias.filter(p => !p.resolvida)
  const ultimoRegistro = registrosIntensivista.length
    ? [...registrosIntensivista].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())[0]
    : null

  if (abertas.length === 0 && !ultimoRegistro) {
    return <p className="text-sm text-slate-400">Nenhuma pendência ou orientação do intensivista no momento.</p>
  }

  return (
    <div className="space-y-3">
      {abertas.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1">📝 Pendências em aberto</p>
          <ul className="text-sm text-amber-900 space-y-0.5">
            {abertas.map(p => <li key={p.id}>• {p.texto}</li>)}
          </ul>
        </div>
      )}
      {ultimoRegistro && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide mb-1">
            🗒️ Orientações e Condutas (Médico Intensivista) — {fmtData(ultimoRegistro.data)}
          </p>
          <p className="text-sm text-indigo-900 whitespace-pre-wrap">{ultimoRegistro.orientacoes_condutas}</p>
        </div>
      )}
    </div>
  )
}
