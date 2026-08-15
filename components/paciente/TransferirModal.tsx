'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Paciente, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  onClose: () => void
  /** Chamado após a transferência ter sucesso — o paciente some da unidade
   *  atual, então quem chama fecha a ficha (mesmo padrão de onAltaConcedida). */
  onTransferido: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

interface UnidadeDestino { id: string; nome: string }

/**
 * Botão "🔁 Transferir" na ficha do paciente ativo — move o MESMO registro
 * pra ala de trânsito (rotativo) da unidade destino via transferir_paciente
 * (supabase/registro_unico_transferencia.sql). Continua gerando
 * resumos_alta tipo_saida='transferencia', igual uma alta, mas
 * pacientes.ativo nunca muda: o paciente segue internado, só muda de lugar.
 * Toda transferência passa pelo rotativo primeiro — quem receber decide o
 * leito definitivo depois, em "Finalizar Admissão" (FinalizarAdmissaoModal).
 */
export default function TransferirModal({ paciente, onClose, onTransferido, showToast }: Props) {
  const supabase = createClient()
  const [unidades, setUnidades] = useState<UnidadeDestino[]>([])
  const [unitDestinoId, setUnitDestinoId] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) { setLoading(false); return }
      const { data } = await supabase
        .from('staff')
        .select('unit_id, units(id, name)')
        .eq('user_id', auth.user.id).eq('active', true).neq('unit_id', paciente.unit_id)
      if (cancelado) return
      type Row = { unit_id: string; units: { id: string; name: string } | { id: string; name: string }[] | null }
      const rows = (data ?? []) as Row[]
      const lista = rows.map(r => {
        const u = Array.isArray(r.units) ? r.units[0] : r.units
        return { id: r.unit_id, nome: u?.name ?? 'Unidade' }
      })
      setUnidades(lista)
      if (lista.length === 1) setUnitDestinoId(lista[0].id)
      setLoading(false)
    })()
    return () => { cancelado = true }
  }, [])

  const confirmar = async () => {
    if (!unitDestinoId) return
    setBusy(true)
    const { error } = await supabase.rpc('transferir_paciente', {
      p_paciente_id: paciente.id, p_unit_destino: unitDestinoId,
    })
    setBusy(false)
    if (error) { showToast('Erro ao transferir: ' + error.message, 'error'); return }
    const nome = unidades.find(u => u.id === unitDestinoId)?.nome ?? 'outra unidade'
    showToast(`${paciente.nome} transferido(a) para ${nome} — aguardando alocação de leito definitivo.`)
    onTransferido()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800 text-lg">🔁 Transferir paciente</h2>
          <button onClick={onClose} disabled={busy} className="text-slate-400 hover:text-slate-700 text-lg disabled:opacity-40">✕</button>
        </div>
        <p className="text-sm text-slate-600">
          <strong>{paciente.nome}</strong> continua o mesmo registro, com todo o histórico —
          só muda de unidade. Cai primeiro na ala de trânsito da unidade destino; alguém de
          lá aloca o leito definitivo depois.
        </p>

        {loading ? (
          <p className="text-sm text-slate-400 text-center py-4">Carregando unidades...</p>
        ) : unidades.length === 0 ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Você não tem vínculo de staff em nenhuma outra unidade — peça pro chefe te
            adicionar em Escalas antes de transferir pra lá.
          </p>
        ) : (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Unidade destino</label>
            <select value={unitDestinoId} onChange={e => setUnitDestinoId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="">Selecione...</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy}
            className="flex-1 border border-slate-300 text-slate-600 font-semibold py-2.5 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-40 transition-colors">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={busy || !unitDestinoId}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {busy ? 'Transferindo...' : 'Confirmar transferência'}
          </button>
        </div>
      </div>
    </div>
  )
}
