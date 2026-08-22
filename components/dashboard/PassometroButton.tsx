'use client'
import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { buscarDadosPassometro, agruparPorAla, gerarPlanilhaPassometro, gerarHtmlPassometro, type SecaoPassometro } from '@/lib/passometro'
import {
  buscarDadosPassometroEnfermagem, agruparPorAlaEnfermagem, gerarPlanilhaPassometroEnfermagem,
  gerarHtmlPassometroEnfermagem, type SecaoPassometroEnfermagem,
} from '@/lib/passometroEnfermagem'
import { ehIntensivista } from '@/lib/cargos'
import type { Unidade } from '@/lib/unidade'
import type { Cargo, ToastData } from '@/types'

interface Props {
  unidade: Unidade
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

type TipoDoc = 'medico' | 'enfermagem'

/**
 * Passômetro: planilha de passagem de plantão, leito a leito, agrupada por
 * ala. Visível a qualquer staff da unidade (diferente do GestaoMenu, que é
 * só do chefe): é documento de uso diário, não de gestão. Mesmo padrão de
 * dropdown de SeletorUnidade.tsx/GestaoMenu.tsx.
 *
 * Cada profissão tem o SEU passômetro (colunas bem diferentes — ver
 * lib/passometroEnfermagem.ts pro da Enfermagem). Quem loga já cai no
 * documento da própria profissão; só o Médico Intensivista (o único cargo
 * que hoje edita/vê tudo na unidade) ganha um seletor extra pra imprimir
 * também o de outra equipe, se quiser.
 */
export default function PassometroButton({ unidade, showToast }: Props) {
  const supabase = createClient()
  const [aberto, setAberto] = useState(false)
  const [alaId, setAlaId] = useState('')
  const [gerando, setGerando] = useState(false)
  const [cargo, setCargo] = useState<Cargo | null>(null)
  const [tipoDoc, setTipoDoc] = useState<TipoDoc>('medico')
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.rpc('meu_cargo').then(({ data }) => {
      const c = (Array.isArray(data) ? data[0] : data) as Cargo | undefined
      if (!c) return
      setCargo(c)
      setTipoDoc(c.profissao === 'enfermeiro' ? 'enfermagem' : 'medico')
    })
  }, [])

  const souIntensivista = ehIntensivista(cargo)

  useEffect(() => {
    if (!aberto) return
    const fecharFora = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fecharFora)
    return () => document.removeEventListener('mousedown', fecharFora)
  }, [aberto])

  const buscarSecoesMedico = async (): Promise<SecaoPassometro[]> => {
    const linhas = await buscarDadosPassometro(supabase, unidade.unitId, alaId || undefined)
    const alas = alaId ? unidade.alas.filter(a => a.id === alaId) : unidade.alas
    return agruparPorAla(alas, linhas)
  }
  const buscarSecoesEnfermagem = async (): Promise<SecaoPassometroEnfermagem[]> => {
    const linhas = await buscarDadosPassometroEnfermagem(supabase, unidade.unitId, alaId || undefined)
    const alas = alaId ? unidade.alas.filter(a => a.id === alaId) : unidade.alas
    return agruparPorAlaEnfermagem(alas, linhas)
  }

  // Abre a janela ANTES do fetch assíncrono — depois de um await, o
  // navegador não reconhece mais o clique como o gesto que autorizou o
  // popup e bloqueia window.open silenciosamente.
  const handleImprimir = async () => {
    const janela = window.open('', '_blank')
    if (!janela) {
      showToast('Não foi possível abrir a janela de impressão — verifique o bloqueador de pop-ups do navegador.', 'error')
      return
    }
    setGerando(true)
    try {
      let html: string | null
      if (tipoDoc === 'enfermagem') {
        const secoes = await buscarSecoesEnfermagem()
        html = secoes.every(s => s.linhas.length === 0) ? null : gerarHtmlPassometroEnfermagem(unidade, secoes)
      } else {
        const secoes = await buscarSecoesMedico()
        html = secoes.every(s => s.linhas.length === 0) ? null : gerarHtmlPassometro(unidade, secoes)
      }
      if (!html) {
        janela.close()
        showToast('Nenhum leito cadastrado nessa ala.', 'error')
        return
      }
      // O próprio HTML gerado calcula a escala pra caber numa página e
      // dispara window.print()/fecha a janela sozinho (ver gerarHtmlPassometro)
      // — chamar print() daqui, antes do layout medir a altura real do
      // conteúdo, voltaria a imprimir sem o ajuste de escala.
      janela.document.write(html)
      janela.document.close()
      janela.focus()
      setAberto(false)
    } catch (err) {
      janela.close()
      showToast('Erro ao gerar passômetro: ' + (err instanceof Error ? err.message : String(err)), 'error')
    } finally {
      setGerando(false)
    }
  }

  const handleBaixarXlsx = async () => {
    setGerando(true)
    try {
      let wb: Awaited<ReturnType<typeof gerarPlanilhaPassometro>> | null
      if (tipoDoc === 'enfermagem') {
        const secoes = await buscarSecoesEnfermagem()
        wb = secoes.every(s => s.linhas.length === 0) ? null : gerarPlanilhaPassometroEnfermagem(unidade, secoes)
      } else {
        const secoes = await buscarSecoesMedico()
        wb = secoes.every(s => s.linhas.length === 0) ? null : gerarPlanilhaPassometro(unidade, secoes)
      }
      if (!wb) {
        showToast('Nenhum leito cadastrado nessa ala.', 'error')
        return
      }
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const sufixoAla = alaId ? `_${unidade.alas.find(al => al.id === alaId)?.nome ?? alaId}` : ''
      const sufixoTipo = tipoDoc === 'enfermagem' ? '_enfermagem' : ''
      a.download = `passometro${sufixoTipo}_${unidade.nome}${sufixoAla}_${new Date().toISOString().slice(0, 10)}.xlsx`
        .replace(/\s+/g, '_')
      a.click()
      URL.revokeObjectURL(url)
      setAberto(false)
    } catch (err) {
      showToast('Erro ao gerar passômetro: ' + (err instanceof Error ? err.message : String(err)), 'error')
    } finally {
      setGerando(false)
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        className="bg-white/20 hover:bg-white/30 border border-white/30 rounded-lg px-3 py-1.5
                   text-white text-sm font-medium flex items-center gap-1.5 transition-colors"
      >
        🗒️ Passômetro
        <span className={`text-[10px] transition-transform ${aberto ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {aberto && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-slate-200
                         rounded-lg shadow-lg overflow-hidden z-50 p-3 space-y-3">
          {souIntensivista && (
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Documento</label>
              <select
                value={tipoDoc}
                onChange={e => setTipoDoc(e.target.value as TipoDoc)}
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white text-slate-800
                           focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="medico">🩺 Passômetro do Médico</option>
                <option value="enfermagem">💉 Passômetro da Enfermagem</option>
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-slate-500 font-medium block mb-1">Escopo</label>
            <select
              value={alaId}
              onChange={e => setAlaId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white text-slate-800
                         focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">Unidade inteira (todas as alas)</option>
              {unidade.alas.map(ala => (
                <option key={ala.id} value={ala.id}>{ala.nome}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleImprimir}
            disabled={gerando}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50
                       text-white text-sm font-bold px-3 py-2 rounded-lg transition-colors"
          >
            {gerando ? 'Gerando...' : '🖨️ Imprimir'}
          </button>
          <button
            type="button"
            onClick={handleBaixarXlsx}
            disabled={gerando}
            className="w-full bg-white hover:bg-slate-50 disabled:opacity-50 border border-slate-300
                       text-slate-700 text-sm font-medium px-3 py-2 rounded-lg transition-colors"
          >
            📥 Baixar planilha (.xlsx)
          </button>
        </div>
      )}
    </div>
  )
}
