'use client'
import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ToastContainer, { useToast } from '@/components/ui/Toast'
import ShiftTypesAdmin from './ShiftTypesAdmin'
import PaySettingsAdmin from './PaySettingsAdmin'
import MonthScheduleView from './MonthScheduleView'
import TemplateEditor from './TemplateEditor'
import SwapRequests from './SwapRequests'
import FinanceiroPlantonista from './FinanceiroPlantonista'
import FinanceiroChefe from './FinanceiroChefe'
import ComparativoView from './ComparativoView'
import { labelCargo, apenasMedicos, PROFISSOES } from '@/lib/cargos'
import type { Unit, Staff, Profissao, Nivel, ShiftType } from '@/types'

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

  const souChefeDeAlgumaUnidade = myStaff.some(s => s.nivel === 'chefe' && s.profissao === 'medico' && s.active)

  const [selectedUnitId, setSelectedUnitId] = useState<string>(() => {
    const minhaUnidade = myStaff.find(s => s.active)?.unit_id
    return minhaUnidade ?? units[0]?.id ?? ''
  })

  const souChefeDaSelecionada = myStaff.some(s => s.unit_id === selectedUnitId && s.nivel === 'chefe' && s.profissao === 'medico' && s.active)
  const meuStaffId = myStaff.find(s => s.unit_id === selectedUnitId && s.active)?.id ?? null

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

  // A equipe da unidade inclui enfermeiros, fisios e nutricionistas, mas a
  // ESCALA hoje é só dos médicos. Sem este recorte, eles apareceriam como
  // opção de plantonista nos seletores de turno.
  const medicos = useMemo(() => apenasMedicos(staffList), [staffList])

  // ── Tipos de turno da unidade selecionada (para exibir nomes na escala) ────
  const [shiftTypesList, setShiftTypesList] = useState<ShiftType[]>([])

  const loadShiftTypes = async (unitId: string) => {
    if (!unitId) { setShiftTypesList([]); return }
    const { data, error } = await supabase.from('shift_types').select('*').eq('unit_id', unitId)
    if (error) { showToast('Erro ao carregar tipos de turno: ' + error.message, 'error'); return }
    setShiftTypesList((data as ShiftType[]) ?? [])
  }

  useEffect(() => { loadShiftTypes(selectedUnitId) }, [selectedUnitId])

  // ── Novo membro da equipe ─────────────────────────────────────────────────
  const [novoEmail, setNovoEmail] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [novaProfissao, setNovaProfissao] = useState<Profissao>('medico')
  const [novoNivel, setNovoNivel] = useState<Nivel>('plantonista')
  const [savingStaff, setSavingStaff] = useState(false)

  const handleAddStaff = async () => {
    if (!novoEmail.trim() || !novoNome.trim()) { showToast('Informe e-mail e nome', 'error'); return }
    setSavingStaff(true)
    const { data: userId, error: lookupError } = await supabase.rpc('find_user_id_by_email', { p_email: novoEmail.trim() })
    if (lookupError) { setSavingStaff(false); showToast('Erro: ' + lookupError.message, 'error'); return }
    if (!userId) { setSavingStaff(false); showToast('Não existe conta com esse e-mail no sistema.', 'error'); return }

    const { error } = await supabase.from('staff').insert({
      user_id: userId, unit_id: selectedUnitId, full_name: novoNome.trim(),
      profissao: novaProfissao, nivel: novoNivel,
    })
    setSavingStaff(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Membro adicionado!')
    setNovoEmail(''); setNovoNome(''); setNovaProfissao('medico'); setNovoNivel('plantonista')
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

        {units.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma unidade cadastrada ainda. Peça para configurarem uma.</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <label className={labelCls}>Unidade</label>
            <select value={selectedUnitId} onChange={e => setSelectedUnitId(e.target.value)} className={inputCls}>
              {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}

        {!souChefeDeAlgumaUnidade && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            Você ainda não é chefe de nenhuma unidade, então não pode administrar escalas por aqui.
            {myStaff.length === 0 && ' Peça para um chefe te adicionar à equipe de uma unidade.'}
          </div>
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
                      <p className="text-xs text-slate-400">{labelCargo(s)}</p>
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
                  <select value={novaProfissao} className={inputCls}
                    onChange={e => {
                      const p = e.target.value as Profissao
                      setNovaProfissao(p)
                      // Só médico tem chefe por enquanto; ver supabase/cargos.sql.
                      if (p !== 'medico') setNovoNivel('plantonista')
                    }}>
                    {PROFISSOES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                  {novaProfissao === 'medico' && (
                    <select value={novoNivel} onChange={e => setNovoNivel(e.target.value as Nivel)} className={inputCls}>
                      <option value="plantonista">Médico Plantonista</option>
                      <option value="chefe">Médico Intensivista (chefe)</option>
                    </select>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  Só médicos entram na escala. Enfermeiro, fisioterapeuta e nutricionista veem
                  o prontuário inteiro e editam apenas a própria aba.
                </p>
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

        {selectedUnitId && (
          <MonthScheduleView unitId={selectedUnitId} staffList={medicos} shiftTypesList={shiftTypesList}
            souChefe={souChefeDaSelecionada} showToast={showToast} />
        )}

        {selectedUnitId && (
          <TemplateEditor unitId={selectedUnitId} staffList={medicos} shiftTypesList={shiftTypesList}
            souChefe={souChefeDaSelecionada} showToast={showToast} />
        )}

        {selectedUnitId && (
          <SwapRequests unitId={selectedUnitId} staffList={medicos} shiftTypesList={shiftTypesList}
            meuStaffId={meuStaffId} souChefe={souChefeDaSelecionada} showToast={showToast} />
        )}

        {selectedUnitId && (
          <ComparativoView unitId={selectedUnitId} staffList={medicos} shiftTypesList={shiftTypesList} showToast={showToast} />
        )}

        {selectedUnitId && (
          <FinanceiroPlantonista unitId={selectedUnitId} meuStaffId={meuStaffId} shiftTypesList={shiftTypesList} showToast={showToast} />
        )}

        {selectedUnitId && souChefeDaSelecionada && (
          <FinanceiroChefe unitId={selectedUnitId} staffList={medicos} shiftTypesList={shiftTypesList} showToast={showToast} />
        )}

        {selectedUnitId && (
          <ShiftTypesAdmin unitId={selectedUnitId} showToast={showToast} />
        )}

        {selectedUnitId && (
          <PaySettingsAdmin unitId={selectedUnitId} souChefe={souChefeDaSelecionada} showToast={showToast} />
        )}

      </main>
    </div>
  )
}
