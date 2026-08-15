'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { soDigitos, hojeISO } from '@/lib/utils'
import type { Paciente, ToastData } from '@/types'
import type { Unidade } from '@/lib/unidade'

interface Props {
  paciente: Paciente
  /** Unidade ATUAL do paciente (ele já está lá, na ala rotativo) — dá a
   *  lista de alas de destino e se essa unidade exige SAPS-3. */
  unidade: Unidade
  /** Pré-preenche ala/leito quando já se sabe o destino (ex.: soltou o
   *  card do paciente num leito específico no dashboard). */
  alaInicial?: string
  leitoInicial?: string
  onClose: () => void
  onFinalizado: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

/**
 * Move o paciente da ala de trânsito (rotativo) pra um leito definitivo NA
 * MESMA unidade — via finalizar_admissao (registro_unico_transferencia.sql).
 * É a "admissão de verdade" daquela unidade: corrige data/hora (o paciente
 * chegou com o horário de admissão da unidade anterior) e cobra o SAPS-3 de
 * novo se a unidade exigir, exatamente como uma internação nova.
 */
export default function FinalizarAdmissaoModal({ paciente, unidade, alaInicial, leitoInicial, onClose, onFinalizado, showToast }: Props) {
  const supabase = createClient()
  const alasDestino = unidade.alas.filter(a => !a.rotativo)

  const [alaId,   setAlaId]   = useState(alaInicial ?? '')
  const [leito,   setLeito]   = useState(leitoInicial ?? '')
  const [data,    setData]    = useState(() => hojeISO())
  const [hora,    setHora]    = useState(() => new Date().toTimeString().slice(0, 5))
  const [saps3,   setSaps3]   = useState('')
  const [cienteSemSaps3, setCienteSemSaps3] = useState(false)
  const [busy,    setBusy]    = useState(false)

  const semSaps3 = unidade.requerSaps3 && !saps3 && !cienteSemSaps3
  const podeConfirmar = !!alaId && !!leito.trim() && !!data && !!hora && !semSaps3

  const confirmar = async () => {
    if (!podeConfirmar) return
    setBusy(true)
    const { error } = await supabase.rpc('finalizar_admissao', {
      p_paciente_id: paciente.id,
      p_ala_destino: alaId,
      p_numero_leito: leito.trim(),
      p_data_internacao: data,
      p_hora_internacao: hora,
      p_saps3: saps3 ? parseInt(saps3, 10) : null,
    })
    setBusy(false)
    if (error) { showToast('Erro ao finalizar admissão: ' + error.message, 'error'); return }
    showToast(`Admissão de ${paciente.nome} finalizada — leito ${leito.trim()}.`)
    onFinalizado()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800 text-lg">🛏️ Finalizar admissão</h2>
          <button onClick={onClose} disabled={busy} className="text-slate-400 hover:text-slate-700 text-lg disabled:opacity-40">✕</button>
        </div>
        <p className="text-sm text-slate-600">
          <strong>{paciente.nome}</strong> está na ala de trânsito. Escolha o leito definitivo
          e confirme a data/hora de admissão aqui na unidade — é isso que fecha a internação
          de verdade, com os dados certos.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Ala *</label>
            <select value={alaId} onChange={e => { setAlaId(e.target.value); setLeito('') }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="">Selecione...</option>
              {alasDestino.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Leito *</label>
            <input value={leito} onChange={e => setLeito(e.target.value)}
              disabled={!alaId} list="leitos-disponiveis"
              placeholder="Ex.: 05"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:opacity-50" />
            <datalist id="leitos-disponiveis">
              {alasDestino.find(a => a.id === alaId)?.leitos.map(l => <option key={l} value={l} />)}
            </datalist>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Data de admissão *</label>
            <input type="date" value={data} max={hojeISO()} onChange={e => setData(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Hora de admissão *</label>
            <input type="time" value={hora} onChange={e => setHora(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>

        {unidade.requerSaps3 && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              SAPS-3 — pontuação (escore), não a mortalidade predita
            </label>
            <input type="text" inputMode="numeric" value={saps3}
              onChange={e => setSaps3(soDigitos(e.target.value))}
              placeholder="Ex: 45 (escore, entre 0 e 300)"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />

            {!saps3 && (
              <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 mt-2">
                <p className="text-sm font-semibold text-amber-900">⚠️ SAPS-3 não preenchido</p>
                <p className="text-xs text-amber-800 mt-1">
                  Pontue agora, nesta admissão — é quando o escore vale. Deixar para depois
                  derruba a qualidade do indicador de mortalidade esperada da unidade.
                </p>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input type="checkbox" checked={cienteSemSaps3}
                    onChange={e => setCienteSemSaps3(e.target.checked)}
                    className="w-4 h-4 accent-amber-600" />
                  <span className="text-xs font-medium text-amber-900">
                    Estou ciente que deveria inserir o SAPS-3 agora e vou prosseguir sem preenchê-lo
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy}
            className="flex-1 border border-slate-300 text-slate-600 font-semibold py-2.5 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-40 transition-colors">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={busy || !podeConfirmar}
            title={semSaps3 ? 'Pontue o SAPS-3 ou confirme que está ciente da ausência dele' : undefined}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {busy ? 'Salvando...' : 'Finalizar admissão'}
          </button>
        </div>
      </div>
    </div>
  )
}
