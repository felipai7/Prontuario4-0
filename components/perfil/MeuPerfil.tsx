'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ToastContainer, { useToast } from '@/components/ui/Toast'
import { labelCargo } from '@/lib/cargos'
import type { Profissao, Nivel } from '@/types'

interface MinhaUnidade {
  unitId: string
  unidadeNome: string
  profissao: Profissao
  nivel: Nivel
}

interface Props {
  userEmail: string
  nomeAtual: string
  minhasUnidades: MinhaUnidade[]
}

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400'
const labelCls = 'text-xs text-slate-500 font-medium block mb-1'

export default function MeuPerfil({ userEmail, nomeAtual, minhasUnidades }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const { toasts, showToast, removeToast } = useToast()

  const [nome, setNome] = useState(nomeAtual)
  const [savingNome, setSavingNome] = useState(false)

  const [novaSenha, setNovaSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [savingSenha, setSavingSenha] = useState(false)

  const handleSalvarNome = async () => {
    if (!nome.trim()) { showToast('Informe seu nome completo', 'error'); return }
    setSavingNome(true)
    const { error } = await supabase.rpc('atualizar_meu_nome', { p_full_name: nome.trim() })
    setSavingNome(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Nome atualizado!')
  }

  const handleTrocarSenha = async () => {
    if (novaSenha.length < 6) { showToast('A senha precisa ter pelo menos 6 caracteres', 'error'); return }
    if (novaSenha !== confirmarSenha) { showToast('As senhas não coincidem', 'error'); return }
    setSavingSenha(true)
    const { error } = await supabase.auth.updateUser({ password: novaSenha })
    setSavingSenha(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    setNovaSenha(''); setConfirmarSenha('')
    showToast('Senha alterada!')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <ToastContainer toasts={toasts} remove={removeToast} />

      <header className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-xl font-bold">👤 Meu perfil</h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-indigo-200 hidden sm:block">{userEmail}</span>
            <button onClick={() => router.push('/dashboard')}
              className="bg-white/20 hover:bg-white/30 border border-white/30 px-3 py-1.5 rounded-lg text-white text-sm font-medium transition-colors">
              ← Prontuário
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-slate-700">Nome completo</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={nome} onChange={e => setNome(e.target.value)} className={inputCls} placeholder="Nome completo" />
            <button onClick={handleSalvarNome} disabled={savingNome}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg whitespace-nowrap">
              {savingNome ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Se você atende mais de uma unidade, o nome é atualizado em todas de uma vez.
          </p>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-slate-700">Alterar senha</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Nova senha</label>
              <input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)}
                className={inputCls} placeholder="••••••••" />
            </div>
            <div>
              <label className={labelCls}>Confirmar nova senha</label>
              <input type="password" value={confirmarSenha} onChange={e => setConfirmarSenha(e.target.value)}
                className={inputCls} placeholder="••••••••" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={handleTrocarSenha} disabled={savingSenha}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg">
              {savingSenha ? 'Alterando...' : 'Alterar senha'}
            </button>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
          <h3 className="font-semibold text-slate-700">Suas unidades</h3>
          {minhasUnidades.length === 0 ? (
            <p className="text-sm text-slate-400">Você ainda não está vinculado a nenhuma unidade.</p>
          ) : (
            <ul className="space-y-1">
              {minhasUnidades.map(u => (
                <li key={u.unitId} className="text-sm text-slate-600 flex items-center justify-between border-b border-slate-100 last:border-b-0 py-1.5">
                  <span>{u.unidadeNome}</span>
                  <span className="text-xs text-slate-400">{labelCargo(u)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

      </main>
    </div>
  )
}
