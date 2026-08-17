'use client'
import { createBrowserClient, type CookieOptions } from '@supabase/ssr'
import { COOKIE_UNIDADE } from '@/lib/unidade'

/** Lê um cookie do documento. Devolve null fora do navegador. */
function lerCookie(nome: string): string | null {
  if (typeof document === 'undefined') return null
  const achado = document.cookie
    .split('; ')
    .find(c => c.startsWith(nome + '='))
  return achado ? decodeURIComponent(achado.slice(nome.length + 1)) : null
}

function getAllCookies(): { name: string; value: string }[] {
  if (typeof document === 'undefined') return []
  return document.cookie
    .split('; ')
    .filter(Boolean)
    .map(par => {
      const i = par.indexOf('=')
      return { name: par.slice(0, i), value: decodeURIComponent(par.slice(i + 1)) }
    })
}

/**
 * O @supabase/ssr (0.5.x) grava o cookie de sessão sempre com Max-Age de 400
 * dias — ele ignora qualquer `cookieOptions.maxAge` customizado passado a
 * createBrowserClient (sobrescreve por dentro, incondicionalmente). Efeito:
 * fechar o navegador NÃO derruba a sessão, então num computador compartilhado
 * quem abrisse o app em seguida caía direto na conta anterior, sem senha.
 *
 * Como a lib não expõe esse controle, assumimos nós mesmos a escrita do
 * cookie (via `cookies.setAll`, o mesmo ponto de extensão que o client do
 * servidor já usa): ao GRAVAR a sessão, omitimos Max-Age/Expires — vira
 * cookie de sessão, que o navegador apaga sozinho ao fechar de verdade. Ao
 * REMOVER (signOut manda Max-Age 0), mantemos o Max-Age 0, pra o logout
 * explícito continuar limpando o cookie na hora, sem esperar o navegador fechar.
 */
function setAllCookies(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
  if (typeof document === 'undefined') return
  cookiesToSet.forEach(({ name, value, options }) => {
    const partes = [`${name}=${encodeURIComponent(value)}`, `Path=${options?.path ?? '/'}`]
    if (options?.sameSite) partes.push(`SameSite=${options.sameSite}`)
    if (options?.secure) partes.push('Secure')
    if (options?.domain) partes.push(`Domain=${options.domain}`)
    if (typeof options?.maxAge === 'number' && options.maxAge <= 0) partes.push('Max-Age=0')
    document.cookie = partes.join('; ')
  })
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
    {
      ...(unidade ? { global: { headers: { 'x-unidade-ativa': unidade } } } : null),
      cookies: { getAll: getAllCookies, setAll: setAllCookies },
    },
  )
}
