import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { COOKIE_UNIDADE } from '@/lib/unidade'

export async function createClient() {
  const cookieStore = await cookies()

  // A unidade escolhida viaja como cabeçalho até o Postgres, onde o RLS a usa
  // para estreitar o que esta pessoa vê (supabase/multiunidade_5_unidade_ativa.sql).
  // É o que impede que quem chefia duas UTIs veja os indicadores das duas
  // somados. Só estreita: cabeçalho ausente ou de uma unidade que não é dela é
  // simplesmente ignorado, então isto não é um mecanismo de acesso.
  const unidade = cookieStore.get(COOKIE_UNIDADE)?.value

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: unidade ? { headers: { 'x-unidade-ativa': unidade } } : undefined,
      cookies: {
        getAll()               { return cookieStore.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch { /* Server Components cannot set cookies */ }
        },
      },
    }
  )
}
