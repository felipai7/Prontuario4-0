'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ToastContainer, { useToast } from '@/components/ui/Toast'
import { calcularIndicadores, CATEGORIAS, calcularLeitosDia } from '@/lib/indicadores/formulas'
import { gerarCsvDadosMensais, nomeArquivoCsv, baixarCsv, COLUNAS_PREENCHIDAS, COLUNAS_TOTAIS } from '@/lib/indicadores/exportar'
import PainelQualidade from './PainelQualidade'
import { fmtNum } from '@/lib/utils'
import { ALAS } from '@/lib/config'
import type { ContagensMes, Indicador, QualidadeMes } from '@/types'

interface Props { souChefe: boolean; userEmail: string }

const LEITOS_ATIVOS = ALAS.reduce((n, a) => n + a.leitos.length, 0)

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

/** Casas decimais por unidade — razão e dias pedem mais precisão que %. */
function casas(unidade: Indicador['unidade']): number {
  return unidade === 'razão' || unidade === 'saídas/leito' || unidade === 'dias' ? 2 : 1
}

/**
 * O denominador do SMR é uma soma de probabilidades, não uma contagem: com zero
 * casas, "0,479 esperados" vira "0" e o card fica sem sentido.
 */
function casasDenominador(ind: Indicador): number {
  return ind.id === 'smr' ? 2 : 0
}

export default function IndicadoresHome({ souChefe, userEmail }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const { toasts, showToast, removeToast } = useToast()

  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth()) // 0-11
  const [contagens, setContagens] = useState<ContagensMes | null>(null)
  const [qualidade, setQualidade] = useState<QualidadeMes | null>(null)
  const [loading, setLoading] = useState(false)

  const primeiroDia = useMemo(() => new Date(ano, mes, 1), [ano, mes])

  const carregar = useCallback(async () => {
    if (!souChefe) return
    setLoading(true)
    const pMes = `${ano}-${String(mes + 1).padStart(2, '0')}-01`
    const [contRes, qualRes] = await Promise.all([
      supabase.rpc('contagens_mes',  { p_mes: pMes }),
      supabase.rpc('qualidade_mes',  { p_mes: pMes }),
    ])
    setLoading(false)
    if (contRes.error) { showToast('Erro ao carregar indicadores: ' + contRes.error.message, 'error'); return }
    // As funções devolvem uma linha só.
    const uma = <T,>(d: unknown) => (Array.isArray(d) ? d[0] : d) as T ?? null
    setContagens(uma<ContagensMes>(contRes.data))
    // A qualidade é acessório: se falhar, os indicadores ainda valem a visita.
    setQualidade(qualRes.error ? null : uma<QualidadeMes>(qualRes.data))
  }, [ano, mes, souChefe, supabase, showToast])

  useEffect(() => { carregar() }, [carregar])

  const indicadores = useMemo(() => {
    if (!contagens) return []
    return calcularIndicadores({
      contagens,
      leitosDia: calcularLeitosDia(primeiroDia, LEITOS_ATIVOS),
      leitosAtivos: LEITOS_ATIVOS,
    })
  }, [contagens, primeiroDia])

  const vivos = indicadores.filter(i => !i.aguarda).length

  const handleExportar = () => {
    if (!contagens) return
    const leitosDia = calcularLeitosDia(primeiroDia, LEITOS_ATIVOS)
    baixarCsv(
      nomeArquivoCsv(primeiroDia),
      gerarCsvDadosMensais(primeiroDia, { ...contagens, leitos_dia: leitosDia, leitos_ativos: LEITOS_ATIVOS }),
    )
    showToast('CSV baixado — cole a linha na aba "Dados Mensais".')
  }

  if (!souChefe) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md text-center space-y-3">
          <p className="text-4xl">🔒</p>
          <h1 className="text-lg font-bold text-slate-800">Acesso restrito</h1>
          <p className="text-sm text-slate-500">
            Os indicadores da unidade são visíveis apenas para o Médico Intensivista.
          </p>
          <button onClick={() => router.push('/dashboard')}
            className="mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">
            Voltar ao painel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <ToastContainer toasts={toasts} remove={removeToast} />

      <header className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold">📊 Indicadores da UTI</h1>
            <p className="text-indigo-200 text-xs">{userEmail}</p>
          </div>
          <button onClick={() => router.push('/dashboard')}
            className="text-xs font-medium bg-white/15 hover:bg-white/25 border border-white/25 rounded-lg px-3 py-1.5">
            ← Painel
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-5">
        <section className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3 flex-wrap">
          <select value={mes} onChange={e => setMes(Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
            {MESES.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select value={ano} onChange={e => setAno(Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
            {Array.from({ length: 5 }, (_, i) => hoje.getFullYear() - i).map(a =>
              <option key={a} value={a}>{a}</option>)}
          </select>
          <p className="text-xs text-slate-400 ml-auto">
            {vivos} de {indicadores.length} indicadores com dado disponível
          </p>
          <button onClick={handleExportar} disabled={!contagens}
            title={`Baixa a linha do mês no formato da aba "Dados Mensais" — ${COLUNAS_PREENCHIDAS} dos ${COLUNAS_TOTAIS} campos preenchidos`}
            className="text-xs font-medium border border-slate-300 text-slate-600 hover:bg-slate-50
                       disabled:opacity-40 rounded-lg px-3 py-2">
            ⬇️ Exportar para a planilha
          </button>
        </section>

        {!loading && qualidade && (
          <PainelQualidade q={qualidade}
            mesCorrente={ano === hoje.getFullYear() && mes === hoje.getMonth()} />
        )}

        {loading ? (
          <p className="text-sm text-slate-400 text-center py-12">Carregando...</p>
        ) : !contagens ? (
          <p className="text-sm text-slate-400 text-center py-12">Nenhum dado para este mês.</p>
        ) : (
          CATEGORIAS.map(cat => {
            const doGrupo = indicadores.filter(i => i.categoria === cat)
            if (!doGrupo.length) return null
            return (
              <section key={cat} className="space-y-2">
                <h2 className="font-semibold text-slate-700 text-sm">{cat}</h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {doGrupo.map(i => <Card key={i.id} ind={i} />)}
                </div>
              </section>
            )
          })
        )}

        {contagens && (
          <p className="text-xs text-slate-400 pt-1">
            O SMR usa a equação SAPS 3 para América Central e do Sul e ainda não foi validado
            contra casos reais — trate o valor como provisório. Ele considera apenas as saídas
            pontuadas; a cobertura está no painel de qualidade acima.
          </p>
        )}
      </main>
    </div>
  )
}

function Card({ ind }: { ind: Indicador }) {
  if (ind.aguarda) {
    return (
      <div className="bg-white border border-dashed border-slate-200 rounded-xl p-3 opacity-60">
        <p className="text-xs font-medium text-slate-500">{ind.nome}</p>
        <p className="text-lg font-bold text-slate-300 mt-1">—</p>
        <p className="text-[11px] text-slate-400 mt-0.5">aguarda módulo {ind.aguarda}</p>
      </div>
    )
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <p className="text-xs font-medium text-slate-500">{ind.nome}</p>
      <p className="text-lg font-bold text-slate-800 mt-1">
        {ind.valor == null ? '—' : fmtNum(ind.valor, casas(ind.unidade))}
        <span className="text-xs font-normal text-slate-400 ml-1">{ind.unidade}</span>
      </p>
      <p className="text-[11px] text-slate-400 mt-0.5">
        {ind.valor == null
          ? 'sem denominador no período'
          : `${fmtNum(ind.numerador ?? 0, 0)} / ${fmtNum(ind.denominador ?? 0, casasDenominador(ind))}`}
      </p>
    </div>
  )
}
