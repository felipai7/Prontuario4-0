'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginForm() {
  const router = useRouter()
  const supabase = createClient()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('E-mail ou senha incorretos.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          required placeholder="seu@email.com"
          className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Senha</label>
        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          required placeholder="••••••••"
          className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit" disabled={loading}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50
                   text-white font-semibold py-3 rounded-lg transition-colors text-sm"
      >
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  )
}
