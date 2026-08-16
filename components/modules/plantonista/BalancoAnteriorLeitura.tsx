'use client'
import { useState } from 'react'
import { calcBalanco, colorParcial, fmtTurno } from '@/lib/utils'
import type { PeriodoBalanco } from '@/types'

interface Props {
  periodos: PeriodoBalanco[]
}

// Balanço de outra unidade (o paciente transitou, ex.: UTI → Hospital) —
// só leitura, sem editar/excluir e sem acumulado: misturar o acumulado
// corrido de duas unidades diferentes não faz sentido clínico, cada uma já
// mostra o próprio na tabela principal. Cada linha aqui é autossuficiente
// (calcBalanco por período), então serve tanto pra registros por turno
// (UTI) quanto por dia (Hospital).
export default function BalancoAnteriorLeitura({ periodos }: Props) {
  const [aberto, setAberto] = useState(false)
  if (periodos.length === 0) return null

  const ordenado = [...periodos].sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={() => setAberto(a => !a)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
        <span>👁️ Ver balanço de unidade anterior — somente leitura ({periodos.length} registro{periodos.length > 1 ? 's' : ''})</span>
        <span className="text-xs">{aberto ? '▲' : '▼'}</span>
      </button>
      {aberto && (
        <div className="border-t border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {ordenado.map(p => {
            const { ganhos, perdas, parcial } = calcBalanco(p)
            return (
              <div key={p.id} className="px-4 py-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-700">{fmtTurno(p.turno, p.inicio)}</span>
                  <span className={colorParcial(parcial)}>{parcial > 0 ? '+' : ''}{parcial.toFixed(0)} mL</span>
                </div>
                <p className="text-slate-400 mt-0.5">
                  Ganhos {ganhos.toFixed(0)} · Perdas {perdas.toFixed(0)} · Diurese {p.diurese.toFixed(0)}
                  {p.dialise > 0 && <> · UF {p.dialise.toFixed(0)}</>}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
