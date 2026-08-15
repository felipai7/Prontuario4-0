'use client'
import { useState, useRef, useEffect } from 'react'
import { COOKIE_UNIDADE } from '@/lib/unidade'
import type { Unit } from '@/types'

/**
 * Troca a unidade em exibição, para quem atende mais de uma.
 *
 * A escolha vai num cookie, e não em estado do React, porque quem precisa dela
 * é o SERVIDOR: o painel e os indicadores buscam os dados antes de o navegador
 * rodar qualquer coisa. Sem o cookie, a pessoa trocaria de unidade e a próxima
 * página voltaria à unidade original.
 *
 * O cookie não dá acesso a nada: carregarUnidade() só o aceita se a pessoa tiver
 * vínculo ativo com aquela unidade, e o RLS decide o resto no banco.
 *
 * Dropdown próprio, não <select> nativo: o painel de opções de um <select> é
 * desenhado pelo navegador/SO, fora do alcance do CSS — os cantos arredondados
 * da caixa fechada nunca se repetiam no painel aberto. Construindo o próprio
 * painel, os dois usam o mesmo rounded-lg.
 */
export default function SeletorUnidade({ unidades, atual }: { unidades: Unit[]; atual: string }) {
  const [trocando, setTrocando] = useState(false)
  const [aberto,   setAberto]   = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fecharFora = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fecharFora)
    return () => document.removeEventListener('mousedown', fecharFora)
  }, [aberto])

  const trocar = (id: string) => {
    setAberto(false)
    if (id === atual) return
    // 1 ano, no site todo. SameSite=Lax para não vazar em requisição de terceiro.
    document.cookie = `${COOKIE_UNIDADE}=${id}; path=/; max-age=31536000; SameSite=Lax`
    setTrocando(true)
    // Recarregamento completo, e não router.refresh(): na prática o refresh não
    // trouxe os dados da unidade nova, e mesmo que trouxesse, a lista de
    // pacientes da unidade anterior sobreviveria no estado do React. Trocar de
    // UTI é raro e deliberado — vale a página inteira, limpa.
    window.location.assign('/dashboard')
  }

  const nomeAtual = unidades.find(u => u.id === atual)?.name ?? 'Unidade'

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        disabled={trocando}
        title="Trocar a unidade em exibição"
        className="bg-white/20 hover:bg-white/30 border border-white/30 rounded-lg px-2 py-1.5
                   text-white text-sm font-medium disabled:opacity-60 flex items-center gap-1.5"
      >
        {nomeAtual}
        <span className={`text-[10px] transition-transform ${aberto ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {aberto && (
        <div className="absolute right-0 mt-1 min-w-full w-max bg-white border border-slate-200
                         rounded-lg shadow-lg overflow-hidden z-50">
          {unidades.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => trocar(u.id)}
              className={`w-full text-left px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                u.id === atual ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-800 hover:bg-indigo-50'
              }`}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
