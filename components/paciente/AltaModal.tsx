'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData, calcAge } from '@/lib/utils'
import type { Paciente, Exame, PeriodoBalanco, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  exames: Exame[]
  periodos: PeriodoBalanco[]
  onClose: () => void
  onAltaConcedida: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

type Step = 'confirm' | 'generating' | 'review' | 'done'

export default function AltaModal({ paciente, exames, periodos, onClose, onAltaConcedida, showToast }: Props) {
  const supabase    = createClient()
  const [step,      setStep]      = useState<Step>('confirm')
  const [resumo,    setResumo]    = useState<string | null>(null)
  const [deleting,  setDeleting]  = useState(false)

  const handleGenerate = async () => {
    setStep('generating')
    try {
      const res = await fetch('/api/gerar-resumo-alta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paciente, exames, periodos }),
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

  const handleConfirmAlta = async () => {
    setDeleting(true)
    // Archive summary
    await supabase.from('resumos_alta').insert({
      paciente_nome:     paciente.nome,
      data_internacao:   paciente.data_internacao,
      paciente_snapshot: paciente,
      exames_snapshot:   exames,
      balanco_snapshot:  periodos,
      texto_resumo:      resumo,
    })
    // Soft-delete patient (ativo = false removes from bed, data preserved for archive)
    await supabase.from('pacientes').update({ ativo: false }).eq('id', paciente.id)

    setDeleting(false)
    onAltaConcedida()
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

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-500 to-rose-600 text-white px-6 py-4 rounded-t-2xl flex justify-between items-center flex-shrink-0">
          <div>
            <h2 className="font-bold text-lg">Alta Médica</h2>
            <p className="text-red-100 text-sm">{paciente.nome}</p>
          </div>
          {step !== 'generating' && (
            <button onClick={onClose} className="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20">✕</button>
          )}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800">
                <p className="font-semibold mb-1">⚠️ Antes de dar alta</p>
                <p className="text-sm">Será gerado um resumo clínico com IA baseado em todos os exames e balanço hídrico registrados. O paciente será removido da UTI após a confirmação.</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm space-y-1">
                <p><strong>Paciente:</strong> {paciente.nome}</p>
                <p><strong>Internado em:</strong> {fmtData(paciente.data_internacao)}</p>
                <p><strong>Exames registrados:</strong> {exames.length}</p>
                <p><strong>Turnos de BH:</strong> {periodos.length}</p>
              </div>
              <button onClick={handleGenerate}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-colors">
                🤖 Gerar Resumo de Alta com IA
              </button>
            </div>
          )}

          {step === 'generating' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-600 font-medium">Gerando resumo clínico...</p>
              <p className="text-slate-400 text-sm">A IA está analisando exames e balanço hídrico</p>
            </div>
          )}

          {step === 'review' && resumo && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <p className="font-bold text-emerald-800 mb-3">📋 Resumo Clínico Gerado</p>
                <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{resumo}</pre>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-800 text-sm">
                <p className="font-semibold mb-1">⚠️ Confirmação de Alta</p>
                <p>O paciente <strong>{paciente.nome}</strong> será removido da UTI. O resumo ficará arquivado.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={handlePrint}
                  className="flex-1 border border-slate-300 text-slate-700 font-semibold py-2.5 rounded-xl hover:bg-slate-50 text-sm">
                  🖨️ Imprimir Resumo
                </button>
                <button onClick={handleConfirmAlta} disabled={deleting}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                  {deleting ? 'Processando...' : '✅ Confirmar Alta'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
