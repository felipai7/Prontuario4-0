'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData, calcAge } from '@/lib/utils'
import type { Paciente, Exame, PeriodoBalanco, SinalVital, ExameImagem, DVA, ATB, CuidadosHorizontais, AvaliacaoNeurologica, SuporteVentilatorio, TipoSaida, ToastData } from '@/types'

// O tipo de saída é o que sustenta todo o bloco de mortalidade dos indicadores.
// Transferência entra em "saídas" no denominador, conforme definição do Dr. Flaubert.
const TIPOS_SAIDA: { id: TipoSaida; label: string; emoji: string }[] = [
  { id: 'alta',          label: 'Alta hospitalar', emoji: '🏠' },
  { id: 'obito',         label: 'Óbito',           emoji: '🕯️' },
  { id: 'transferencia', label: 'Transferência',   emoji: '🚑' },
]

interface Props {
  paciente: Paciente
  exames: Exame[]
  periodos: PeriodoBalanco[]
  sinais: SinalVital[]
  examesImagem: ExameImagem[]
  dvas: DVA[]
  atbs: ATB[]
  cuidados: CuidadosHorizontais | null
  neuro: AvaliacaoNeurologica | null
  ventilatorio: SuporteVentilatorio | null
  onClose: () => void
  onAltaConcedida: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

type Step = 'confirm' | 'discharging' | 'alta_ok' | 'generating' | 'review'

export default function AltaModal({ paciente, exames, periodos, sinais, examesImagem, dvas, atbs, cuidados, neuro, ventilatorio, onClose, onAltaConcedida, showToast }: Props) {
  const supabase             = createClient()
  const [step,               setStep]             = useState<Step>('confirm')
  const [resumo,             setResumo]           = useState<string | null>(null)
  const [resumoAltaId,       setResumoAltaId]     = useState<string | null>(null)
  const [alreadyDischarged,  setAlreadyDischarged] = useState(false)

  // Data/hora da saída: pré-preenchida com agora, mas editável — o registro é
  // muitas vezes feito depois do fato, e a hora define o corte de óbito <24h.
  const [tipoSaida, setTipoSaida] = useState<TipoSaida | ''>('')
  const [dataSaida, setDataSaida] = useState(() => new Date().toISOString().split('T')[0])
  const [horaSaida, setHoraSaida] = useState(() => new Date().toTimeString().slice(0, 5))

  /** Instante da saída em ISO, a partir dos campos locais. */
  const saidaISO = () => new Date(`${dataSaida}T${horaSaida}:00`).toISOString()

  /** Campos de saída comuns aos dois caminhos de alta (direto e com resumo). */
  const camposSaida = () => ({
    paciente_id: paciente.id,
    tipo_saida:  tipoSaida || null,
    data_alta:   saidaISO(),
  })
  const [busy,               setBusy]             = useState(false)

  // Flow A: discharge immediately, no AI required
  const handleAltaDireta = async () => {
    setBusy(true)
    setStep('discharging')
    const { data } = await supabase.from('resumos_alta').insert({
      paciente_nome:         paciente.nome,
      data_internacao:       paciente.data_internacao,
      paciente_snapshot:     paciente,
      exames_snapshot:       exames,
      balanco_snapshot:      periodos,
      neuro_snapshot:        neuro,
      ventilatorio_snapshot: ventilatorio,
      texto_resumo:          null,
      ...camposSaida(),
    }).select('id').single()
    setResumoAltaId(data?.id ?? null)
    await supabase.from('pacientes').update({ ativo: false }).eq('id', paciente.id)
    onAltaConcedida()
    setAlreadyDischarged(true)
    setBusy(false)
    setStep('alta_ok')
  }

  // Flow B: generate AI summary first, then confirm discharge
  const handleGenerateFirst = async () => {
    setStep('generating')
    try {
      const res  = await fetch('/api/gerar-resumo-alta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paciente, exames, periodos, sinais, examesImagem, dvas, atbs, cuidados, neuro, ventilatorio }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResumo(data.texto)
      setStep('review')
    } catch (e: any) {
      showToast('Erro ao gerar resumo: ' + e.message, 'error')
      setStep('confirm')
    }
  }

  // Optional post-discharge: generate AI report and update archive record
  const handleGeneratePostAlta = async () => {
    setStep('generating')
    try {
      const res  = await fetch('/api/gerar-resumo-alta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paciente, exames, periodos, sinais, examesImagem, dvas, atbs, cuidados, neuro, ventilatorio }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResumo(data.texto)
      if (resumoAltaId) {
        await supabase.from('resumos_alta').update({ texto_resumo: data.texto }).eq('id', resumoAltaId)
      }
      setStep('review')
    } catch (e: any) {
      showToast('Erro ao gerar relatório: ' + e.message, 'error')
      setStep('alta_ok')
    }
  }

  // Confirm discharge WITH summary (Flow B — patient not yet discharged)
  const handleConfirmAltaComResumo = async () => {
    setBusy(true)
    await supabase.from('resumos_alta').insert({
      paciente_nome:         paciente.nome,
      data_internacao:       paciente.data_internacao,
      paciente_snapshot:     paciente,
      exames_snapshot:       exames,
      balanco_snapshot:      periodos,
      neuro_snapshot:        neuro,
      ventilatorio_snapshot: ventilatorio,
      texto_resumo:          resumo,
      ...camposSaida(),
    })
    await supabase.from('pacientes').update({ ativo: false }).eq('id', paciente.id)
    onAltaConcedida()
    setBusy(false)
    onClose()
  }

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=800,height=700')
    if (!win) return
    const now = new Date().toLocaleString('pt-BR')
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>Resumo de Alta — ${paciente.nome}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;padding:20mm 15mm;color:#000;}
        h1{font-size:16px;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:16px;}
        .info{background:#f5f5f5;border:1px solid #ddd;padding:12px;border-radius:4px;margin-bottom:16px;}
        .info p{margin:4px 0;font-size:12px;}
        .resumo{white-space:pre-wrap;line-height:1.7;font-size:12px;}
        .footer{margin-top:20px;padding-top:10px;border-top:1px solid #ddd;font-size:10px;color:#888;text-align:center;}
      </style></head><body>
      <h1>🏥 Resumo de Alta — UTI</h1>
      <div class="info">
        <p><strong>Nome:</strong> ${paciente.nome}</p>
        <p><strong>Data de Nascimento:</strong> ${fmtData(paciente.data_nascimento)} (${calcAge(paciente.data_nascimento)})</p>
        <p><strong>Plano:</strong> ${paciente.plano_saude}</p>
        <p><strong>Internação:</strong> ${fmtData(paciente.data_internacao)} às ${paciente.hora_internacao}</p>
        ${paciente.hipoteses ? `<p><strong>Hipóteses:</strong> ${paciente.hipoteses}</p>` : ''}
      </div>
      <div class="resumo">${resumo?.replace(/\n/g, '<br/>') ?? ''}</div>
      <div class="footer">Alta concedida em: ${now} — Sistema UTI</div>
      <script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>
      </body></html>`)
    win.document.close()
  }

  const canClose = step !== 'discharging' && step !== 'generating'

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-500 to-rose-600 text-white px-6 py-4 rounded-t-2xl flex justify-between items-center flex-shrink-0">
          <div>
            <h2 className="font-bold text-lg">Registrar Saída</h2>
            <p className="text-red-100 text-sm">{paciente.nome}</p>
          </div>
          {canClose && (
            <button onClick={onClose} className="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20">✕</button>
          )}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">

          {/* Step: confirm */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm space-y-1">
                <p><strong>Paciente:</strong> {paciente.nome}</p>
                <p><strong>Internado em:</strong> {fmtData(paciente.data_internacao)}</p>
                <p><strong>Exames registrados:</strong> {exames.length}</p>
                <p><strong>Turnos de BH:</strong> {periodos.length}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Tipo de saída *</p>
                <div className="grid grid-cols-3 gap-2">
                  {TIPOS_SAIDA.map(t => (
                    <button key={t.id} type="button" onClick={() => setTipoSaida(t.id)}
                      className={`border rounded-xl px-2 py-3 text-xs font-semibold transition-colors ${
                        tipoSaida === t.id
                          ? 'border-red-500 bg-red-50 text-red-700 ring-2 ring-red-200'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}>
                      <span className="block text-lg mb-0.5">{t.emoji}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Data da saída *</label>
                  <input type="date" value={dataSaida} onChange={e => setDataSaida(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Hora da saída *</label>
                  <input type="time" value={horaSaida} onChange={e => setHoraSaida(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
                </div>
              </div>

              <button onClick={handleAltaDireta} disabled={!tipoSaida}
                className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed
                           text-white font-bold py-3 rounded-xl transition-colors">
                ✅ Registrar Saída Agora
              </button>

              <div className="relative flex items-center">
                <div className="flex-1 border-t border-slate-200" />
                <span className="px-3 text-xs text-slate-400">ou</span>
                <div className="flex-1 border-t border-slate-200" />
              </div>

              <button onClick={handleGenerateFirst} disabled={!tipoSaida}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed
                           text-white font-semibold py-3 rounded-xl transition-colors text-sm">
                🤖 Gerar Resumo com IA e Registrar Saída
              </button>
            </div>
          )}

          {/* Step: discharging */}
          {step === 'discharging' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-600 font-medium">Concedendo alta...</p>
            </div>
          )}

          {/* Step: alta_ok — discharged, optional AI report */}
          {step === 'alta_ok' && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                <p className="text-3xl mb-2">✅</p>
                <p className="font-bold text-emerald-800">Alta concedida com sucesso</p>
                <p className="text-emerald-700 text-sm mt-1">{paciente.nome} foi removido da UTI</p>
              </div>

              <button onClick={handleGeneratePostAlta}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition-colors text-sm">
                🤖 Gerar Relatório de Alta com IA
              </button>

              <button onClick={onClose}
                className="w-full border border-slate-300 text-slate-600 font-medium py-2.5 rounded-xl hover:bg-slate-50 text-sm transition-colors">
                Fechar sem relatório
              </button>
            </div>
          )}

          {/* Step: generating */}
          {step === 'generating' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-600 font-medium">Gerando resumo clínico...</p>
              <p className="text-slate-400 text-sm">A IA está analisando exames e balanço hídrico</p>
            </div>
          )}

          {/* Step: review */}
          {step === 'review' && resumo && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <p className="font-bold text-emerald-800 mb-3">📋 Resumo Clínico Gerado</p>
                <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{resumo}</pre>
              </div>

              {!alreadyDischarged && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-800 text-sm">
                  <p className="font-semibold mb-1">⚠️ Confirmação de Alta</p>
                  <p>O paciente <strong>{paciente.nome}</strong> será removido da UTI. O resumo ficará arquivado.</p>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={handlePrint}
                  className="flex-1 border border-slate-300 text-slate-700 font-semibold py-2.5 rounded-xl hover:bg-slate-50 text-sm">
                  🖨️ Imprimir Resumo
                </button>
                {alreadyDischarged ? (
                  <button onClick={onClose}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                    Fechar
                  </button>
                ) : (
                  <button onClick={handleConfirmAltaComResumo} disabled={busy}
                    className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                    {busy ? 'Processando...' : '✅ Confirmar Alta'}
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
