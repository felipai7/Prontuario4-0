'use client'
import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData } from '@/lib/utils'
import type {
  Paciente, IrasEvento, IrasSepseChoque, TipoIras,
  SuporteVentilatorio, Dispositivo, ToastData,
} from '@/types'

interface Props {
  paciente: Paciente
  eventos: IrasEvento[]
  sepse: IrasSepseChoque | null
  /** Para o cruzamento de qualidade: PAV precisa de VM, ITU de SVD, IPCS de CVC. */
  ventHistorico: SuporteVentilatorio[]
  dispositivos: Dispositivo[]
  podeEditar: boolean
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const TIPOS: { id: TipoIras; label: string }[] = [
  { id: 'pav',          label: 'PAV — pneumonia associada à VM' },
  { id: 'itu_svd',      label: 'ITU associada a SVD' },
  { id: 'ipcs_lab',     label: 'IPCS laboratorial (hemocultura +)' },
  { id: 'ipcs_clinica', label: 'IPCS clínica (sem confirmação)' },
  { id: 'pneumonia',    label: 'Pneumonia nosocomial (não-VM)' },
  { id: 'traqueite',    label: 'Traqueíte nosocomial' },
  { id: 'flebite',      label: 'Flebite' },
  { id: 'colite_pseudomembranosa', label: 'Colite pseudomembranosa (C. difficile)' },
  { id: 'isc',          label: 'Infecção de sítio cirúrgico' },
  { id: 'outra',        label: 'Outra IRAS' },
]
const LABEL: Record<TipoIras, string> = Object.fromEntries(TIPOS.map(t => [t.id, t.label])) as Record<TipoIras, string>

const hojeISO = () => new Date().toISOString().split('T')[0]

export default function IrasTab({
  paciente, eventos, sepse, ventHistorico, dispositivos, podeEditar, onRefresh, showToast,
}: Props) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [tipo, setTipo] = useState<TipoIras | ''>('')
  const [data, setData] = useState(hojeISO)
  const [observacao, setObservacao] = useState('')

  const ordenados = useMemo(
    () => [...eventos].sort((a, b) => b.data.localeCompare(a.data)), [eventos])

  // ── Cruzamento de qualidade ─────────────────────────────────────────────
  // Uma IRAS de dispositivo num paciente sem o dispositivo registrado é sinal
  // de erro — de classificação, ou de dispositivo não lançado. Só AVISA (decisão
  // do Dr. Felipe): pode ser o dado de dispositivo que falta, não a IRAS errada.
  const teveVM = useMemo(
    () => ventHistorico.some(v => v.modalidade === 'ventilacao_mecanica'), [ventHistorico])
  const teveDispositivo = (t: 'CVC' | 'SVD') => dispositivos.some(d => d.tipo === t)

  const avisoCruzamento = (t: TipoIras): string | null => {
    if (t === 'pav' && !teveVM)
      return 'PAV sem nenhum registro de ventilação mecânica neste paciente. Confira o Ventilatório.'
    if (t === 'itu_svd' && !teveDispositivo('SVD'))
      return 'ITU-SVD sem sonda vesical registrada. Confira Dispositivos (Enfermagem).'
    if ((t === 'ipcs_lab' || t === 'ipcs_clinica') && !teveDispositivo('CVC'))
      return 'IPCS sem cateter central registrado. Confira Dispositivos (Enfermagem).'
    return null
  }

  const avisoAtual = tipo ? avisoCruzamento(tipo) : null

  const registrarEvento = async () => {
    if (!tipo) { showToast('Selecione o tipo de IRAS', 'error'); return }
    setSaving(true)
    const { data: user } = await supabase.auth.getUser()
    const { error } = await supabase.from('iras_eventos').insert({
      paciente_id: paciente.id, tipo, data, observacao: observacao.trim() || null,
      criado_por: user.user?.id ?? null,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('IRAS registrada!')
    setTipo(''); setData(hojeISO()); setObservacao(''); onRefresh()
  }

  const excluirEvento = async (id: string) => {
    const { error } = await supabase.from('iras_eventos').delete().eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('IRAS excluída'); onRefresh()
  }

  const toggleSepse = async () => {
    const { data: user } = await supabase.auth.getUser()
    if (sepse) {
      const { error } = await supabase.from('iras_sepse_choque').delete().eq('id', sepse.id)
      if (error) { showToast('Erro: ' + error.message, 'error'); return }
      showToast('Sepse/choque removido')
    } else {
      const { error } = await supabase.from('iras_sepse_choque').insert({
        paciente_id: paciente.id, data: hojeISO(), criado_por: user.user?.id ?? null,
      })
      if (error) { showToast('Erro: ' + error.message, 'error'); return }
      showToast('Sepse/choque registrado')
    }
    onRefresh()
  }

  return (
    <div className="space-y-4">
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-slate-700">🦠 IRAS e vigilância</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Classificação de vigilância — só o que atende os critérios de IRAS, não toda
            infecção tratada.
          </p>
        </div>

        {podeEditar && (
          <div className="space-y-2 border-b border-slate-100 pb-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de IRAS</label>
              <select value={tipo} onChange={e => setTipo(e.target.value as TipoIras)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                <option value="">Selecione...</option>
                {TIPOS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>

            {avisoAtual && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠️ {avisoAtual} Você ainda pode registrar.
              </p>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Data</label>
                <input type="date" value={data} max={hojeISO()} onChange={e => setData(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <input type="text" value={observacao} onChange={e => setObservacao(e.target.value)}
                placeholder="Observação (opcional)"
                className="flex-1 min-w-[12rem] px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              <button onClick={registrarEvento} disabled={saving || !tipo}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm">
                {saving ? 'Salvando...' : 'Registrar'}
              </button>
            </div>
          </div>
        )}

        {ordenados.length === 0 ? (
          <p className="text-sm text-slate-400 italic text-center py-2">Nenhuma IRAS registrada</p>
        ) : (
          <ul className="space-y-1.5">
            {ordenados.map(e => (
              <li key={e.id} className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700">{LABEL[e.tipo]}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {fmtData(e.data)}{e.observacao ? ` · ${e.observacao}` : ''}
                  </p>
                </div>
                {podeEditar && (
                  <button onClick={() => excluirEvento(e.id)} title="Excluir"
                    className="text-slate-300 hover:text-red-500 text-sm flex-shrink-0">🗑️</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sepse/choque: não é IRAS, é gravidade. Flag por paciente. */}
      <section className="border border-slate-200 rounded-xl p-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!sepse} disabled={!podeEditar}
            onChange={toggleSepse}
            className="w-4 h-4 accent-rose-600 disabled:opacity-50" />
          <span className="font-semibold text-slate-700">🩸 Teve sepse ou choque séptico na internação</span>
        </label>
        <p className="text-[11px] text-slate-400 ml-6 mt-0.5">
          Alimenta a taxa de sepse/choque por 100 admissões. Independe de ser IRAS —
          pode ser comunitária.
        </p>
      </section>
    </div>
  )
}
