'use client'
import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ToastContainer, { useToast } from '@/components/ui/Toast'
import type { Unit, Staff, StaffRole } from '@/types'

interface Props {
  units: Unit[]
  myStaff: Staff[]
  userEmail: string
}

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400'
const labelCls = 'text-xs text-slate-500 font-medium block mb-1'

export default function EscalasHome({ units, myStaff, userEmail }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const { toasts, showToast, removeToast } = useToast()

  const souChefeDeAlgumaUnidade = myStaff.some(s => s.role === 'chefe' && s.active)

  const [selectedUnitId, setSelectedUnitId] = useState<string>(() => {
    const minhaUnidade = myStaff.find(s => s.active)?.unit_id
    return minhaUnidade ?? units[0]?.id ?? ''
  })

  const souChefeDaSelecionada = myStaff.some(s => s.unit_id === selectedUnitId && s.role === 'chefe' && s.active)

  // ── Staff da unidade selecionada ──────────────────────────────────────────
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [loadingStaff, setLoadingStaff] = useState(false)

  const loadStaff = async (unitId: string) => {
    if (!unitId) { setStaffList([]); return }
    setLoadingStaff(true)
    const { data, error } = await supabase.from('staff').select('*').eq('unit_id', unitId).order('full_name')
    setLoadingStaff(false)
    if (error) { showToast('Erro ao carregar equipe: ' + error.message, 'error'); return }
    setStaffList((data as Staff[]) ?? [])
  }

  useEffect(() => { loadStaff(selectedUnitId) }, [selectedUnitId])

  // ── Nova unidade ───────────────────────────────────────────────────────────
  const [novaUnidadeNome, setNovaUnidadeNome] = useState('')
  const [savingUnidade, setSavingUnidade] = useState(false)
  const [unitsState, setUnitsState] = useState(units)

  const handleCreateUnit = async () => {
    if (!novaUnidadeNome.trim()) { showToast('Informe o nome da unidade', 'error'); return }
    setSavingUnidade(true)
    const { data, error } = await supabase.from('units').insert({ name: novaUnidadeNome.trim() }).select().single()
    setSavingUnidade(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    setUnitsState(prev => [...prev, data as Unit].sort((a, b) => a.name.localeCompare(b.name)))
    setNovaUnidadeNome('')
    showToast('Unidade criada!')
  }

  // ── Novo membro da equipe ─────────────────────────────────────────────────
  const [novoEmail, setNovoEmail] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [novoRole, setNovoRole] = useState<StaffRole>('intensivista')
  const [savingStaff, setSavingStaff] = useState(false)

  const handleAddStaff = async () => {
    if (!novoEmail.trim() || !novoNome.trim()) { showToast('Informe e-mail e nome', 'error'); return }
    setSavingStaff(true)
    const { data: userId, error: lookupError } = await supabase.rpc('find_user_id_by_email', { p_email: novoEmail.trim() })
    if (lookupError) { setSavingStaff(false); showToast('Erro: ' + lookupError.message, 'error'); return }
    if (!userId) { setSavingStaff(false); showToast('Não existe conta com esse e-mail no sistema.', 'error'); return }

    const { error } = await supabase.from('staff').insert({
      user_id: userId, unit_id: selectedUnitId, full_name: novoNome.trim(), role: novoRole,
    })
    setSavingStaff(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Membro adicionado!')
    setNovoEmail(''); setNovoNome(''); setNovoRole('intensivista')
    loadStaff(selectedUnitId)
  }

  const handleToggleActive = async (s: Staff) => {
    const { error } = await supabase.from('staff').update({ active: !s.active }).eq('id', s.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    loadStaff(selectedUnitId)
  }

  const handleRemoveStaff = async (s: Staff) => {
    if (!confirm(`Remover ${s.full_name} da equipe desta unidade?`)) return
    const { error } = await supabase.from('staff').delete().eq('id', s.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Membro removido')
    loadStaff(selectedUnitId)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <ToastContainer toasts={toasts} remove={removeToast} />

      <header className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">📅 Escalas de Plantão</h1>
            <p className="text-indigo-200 text-xs mt-0.5">Módulo em construção — Fase 0 (unidades e equipe)</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-indigo-200 hidden sm:block">{userEmail}</span>
            <button onClick={() => router.push('/dashboard')}
              className="bg-white/20 hover:bg-white/30 border border-white/30 px-3 py-1.5 rounded-lg text-white text-sm font-medium transition-colors">
              ← Prontuário
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {unitsState.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma unidade cadastrada ainda.</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <label className={labelCls}>Unidade</label>
            <select value={selectedUnitId} onChange={e => setSelectedUnitId(e.target.value)} className={inputCls}>
              {unitsState.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}

        {!souChefeDeAlgumaUnidade && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            Você ainda não é chefe de nenhuma unidade, então não pode administrar escalas por aqui.
            {myStaff.length === 0 && ' Peça para um chefe te adicionar à equipe de uma unidade.'}
          </div>
        )}

        {souChefeDeAlgumaUnidade && (
          <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-slate-700">🏥 Nova unidade</h3>
            <div className="flex gap-2">
              <input value={novaUnidadeNome} onChange={e => setNovaUnidadeNome(e.target.value)}
                placeholder="Ex: UTI Pediátrica" className={inputCls} />
              <button onClick={handleCreateUnit} disabled={savingUnidade}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg whitespace-nowrap">
                {savingUnidade ? 'Criando...' : '+ Criar'}
              </button>
            </div>
          </section>
        )}

        {selectedUnitId && (
          <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
            <h3 className="font-semibold text-slate-700">👥 Equipe da unidade</h3>

            {loadingStaff ? (
              <p className="text-sm text-slate-400">Carregando...</p>
            ) : staffList.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum membro cadastrado nesta unidade.</p>
            ) : (
              <ul className="space-y-2">
                {staffList.map(s => (
                  <li key={s.id} className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg p-3">
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${s.active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{s.full_name}</p>
                      <p className="text-xs text-slate-400">{s.role === 'chefe' ? '👑 Chefe' : '🩺 Intensivista'}</p>
                    </div>
                    {souChefeDaSelecionada && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => handleToggleActive(s)}
                          className="text-xs font-medium text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1">
                          {s.active ? 'Desativar' : 'Reativar'}
                        </button>
                        <button onClick={() => handleRemoveStaff(s)} title="Remover"
                          className="text-slate-300 hover:text-red-500 text-sm">🗑️</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {souChefeDaSelecionada && (
              <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Adicionar membro</p>
                <p className="text-xs text-slate-400">A pessoa precisa já ter uma conta no sistema (mesmo login do prontuário).</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input value={novoEmail} onChange={e => setNovoEmail(e.target.value)}
                    placeholder="E-mail da conta" className={inputCls} />
                  <input value={novoNome} onChange={e => setNovoNome(e.target.value)}
                    placeholder="Nome completo" className={inputCls} />
                  <select value={novoRole} onChange={e => setNovoRole(e.target.value as StaffRole)} className={inputCls}>
                    <option value="intensivista">Intensivista</option>
                    <option value="chefe">Chefe</option>
                  </select>
                </div>
                <div className="flex justify-end">
                  <button onClick={handleAddStaff} disabled={savingStaff}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg">
                    {savingStaff ? 'Adicionando...' : '+ Adicionar'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

      </main>
    </div>
  )
}
