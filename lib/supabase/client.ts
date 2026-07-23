'use client'
import { createBrowserClient } from '@supabase/ssr'
import { COOKIE_UNIDADE } from '@/lib/unidade'

/** Lê um cookie do documento. Devolve null fora do navegador. */
function lerCookie(nome: string): string | null {
  if (typeof document === 'undefined') return null
  const achado = document.cookie
    .split('; ')
    .find(c => c.startsWith(nome + '='))
  return achado ? decodeURIComponent(achado.slice(nome.length + 1)) : null
}

export function createClient() {
  // Mesmo cabeçalho que o client do servidor manda: o RLS estreita o que esta
  // pessoa vê para a unidade escolhida. Sem isso, o mapa de leitos (que se
  // atualiza pelo navegador, em tempo real) voltaria a misturar as unidades
  // logo depois que o servidor entregasse a página já filtrada.
  const unidade = lerCookie(COOKIE_UNIDADE)

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    unidade ? { global: { headers: { 'x-unidade-ativa': unidade } } } : undefined,
  )
}
