'use client'
import { useState } from 'react'
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
 */
export default function SeletorUnidade({ unidades, atual }: { unidades: Unit[]; atual: string }) {
  const [trocando, setTrocando] = useState(false)

  const trocar = (id: string) => {
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

  return (
    <select
      value={atual}
      disabled={trocando}
      onChange={e => trocar(e.target.value)}
      title="Trocar a unidade em exibição"
      className="bg-white/20 hover:bg-white/30 border border-white/30 rounded-lg px-2 py-1.5
                 text-white text-sm font-medium disabled:opacity-60"
    >
      {unidades.map(u => (
        <option key={u.id} value={u.id} className="text-slate-800">{u.name}</option>
      ))}
    </select>
  )
}
