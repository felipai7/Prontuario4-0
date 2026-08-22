'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData, calcAge, hojeISO } from '@/lib/utils'
import type { Paciente, Exame, PeriodoBalanco, SinalVital, ExameImagem, DVA, ATB, CuidadosHorizontais, AvaliacaoNeurologica, SuporteVentilatorio, TipoSaida, ToastData } from '@/types'

// O tipo de saída é o que sustenta todo o bloco de mortalidade dos indicadores.
// Transferência hospitalar entra em "saídas" no denominador, conforme definição
// do Dr. Flaubert; as duas transferências internas (UTI<->Hospital) contam como
// alta — só a direção da 3ª opção muda conforme a unidade atual do paciente.
function tiposSaida(tipoUnidade: 'uti' | 'enfermaria'): { id: TipoSaida; label: string; emoji: string }[] {
  return [
    { id: 'alta_casa',   label: 'Alta Hospitalar para Casa', emoji: '🏠' },
    { id: 'alta_pedido', label: 'Alta a Pedido',             emoji: '📝' },
    tipoUnidade === 'uti'
      ? { id: 'alta_uti_hospital',  label: 'Alta da UTI para o Hospital', emoji: '🔁' }
      : { id: 'alta_hospital_uti',  label: 'Alta do Hospital para a UTI', emoji: '🔁' },
    { id: 'transferencia_hospitalar', label: 'Transferência Hospitalar', emoji: '🚑' },
    { id: 'obito',                    label: 'Óbito',                   emoji: '🕯️' },
  ]
}

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
  /** Se falso, a alta não exige SAPS-3 pontuado (unidade fora da UTI, ex.: Hospital). */
  requerSaps3: boolean
  /** Se falso, esconde o caminho de resumo de alta gerado por IA — não usado
   *  no Hospital por enquanto (ver decisão do plano de ajustes do Hospital).
   *  A saída direta (sem resumo) continua disponível normalmente. */
  permiteResumoIA: boolean
  /** Decide a direção da opção de transferência interna (3ª opção de tiposSaida). */
  tipoUnidade: 'uti' | 'enfermaria'
  onClose: () => void
  onAltaConcedida: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

type Step = 'confirm' | 'discharging' | 'alta_ok' | 'generating' | 'review'

interface UnidadeDestino { id: string; nome: string }

export default function AltaModal({ paciente, exames, periodos, sinais, examesImagem, dvas, atbs, cuidados, neuro, ventilatorio, requerSaps3, permiteResumoIA, tipoUnidade, onClose, onAltaConcedida, showToast }: Props) {
  const supabase             = createClient()
  const [step,               setStep]             = useState<Step>('confirm')
  const [resumo,             setResumo]           = useState<string | null>(null)
  const [resumoAltaId,       setResumoAltaId]     = useState<string | null>(null)
  const [alreadyDischarged,  setAlreadyDischarged] = useState(false)

  // Data/hora da saída: pré-preenchida com agora, mas editável — o registro é
  // muitas vezes feito depois do fato, e a hora define o corte de óbito <24h.
  const [tipoSaida, setTipoSaida] = useState<TipoSaida | ''>('')
  const [dataSaida, setDataSaida] = useState(() => hojeISO())
  const [horaSaida, setHoraSaida] = useState(() => new Date().toTimeString().slice(0, 5))

  // Sem SAPS 3 não há saída: sem ele o paciente fica fora do SMR para sempre,
  // e a alta é a última chance de cobrar. Fora da UTI (unidade sem
  // requerSaps3) essa cobrança não faz sentido — o escore nem existe lá. As
  // transferências internas nunca exigiram SAPS-3 (quem cobra, se a unidade
  // destino exigir, é o Finalizar Admissão de lá).
  const isTransferenciaInterna = tipoSaida === 'alta_uti_hospital' || tipoSaida === 'alta_hospital_uti'
  const semSaps3 = requerSaps3 && paciente.saps3 == null && !isTransferenciaInterna

  // Unidades destino pra transferência interna — mesma busca que existia em
  // TransferirModal.tsx (staff do usuário fora da unidade atual), com o
  // filtro a mais de só trazer unidades do tipo oposto (o alvo de "Alta da
  // UTI para o Hospital" só pode ser um Hospital, e vice-versa).
  const [unidadesDestino, setUnidadesDestino] = useState<UnidadeDestino[]>([])
  const [unitDestinoId,   setUnitDestinoId]   = useState('')
  const [loadingUnidades, setLoadingUnidades] = useState(false)

  useEffect(() => {
    if (!isTransferenciaInterna) return
    let cancelado = false
    const tipoAlvo = tipoSaida === 'alta_uti_hospital' ? 'enfermaria' : 'uti'
    setLoadingUnidades(true)
    ;(async () => {
      // Lista TODAS as unidades ativas do tipo oposto, não só as que a própria
      // pessoa tem vínculo de staff — transferir daqui pra lá não exige ser
      // staff de lá também (é a unidade de ORIGEM que autoriza a ação, e essa
      // já é checada por posso_ver_paciente dentro da RPC). `units` SELECT é
      // restrito a sou_da_unidade(id) (multiunidade_3_units.sql), então uma
      // query direta na tabela ficava sempre vazia pra quem não tinha vínculo
      // na unidade destino — usa a RPC security definer que já existe pra
      // primeiro acesso, que contorna essa RLS de propósito.
      const { data } = await supabase.rpc('listar_unidades_ativas')
      if (cancelado) return
      const lista = ((data ?? []) as { id: string; name: string; tipo_unidade: string }[])
        .filter(u => u.tipo_unidade === tipoAlvo && u.id !== paciente.unit_id)
        .map(u => ({ id: u.id, nome: u.name }))
      setUnidadesDestino(lista)
      setUnitDestinoId(lista.length === 1 ? lista[0].id : '')
      setLoadingUnidades(false)
    })()
    return () => { cancelado = true }
  }, [tipoSaida])

  const handleConfirmarTransferencia = async () => {
    if (!unitDestinoId) return
    setBusy(true)
    const { error } = await supabase.rpc('transferir_paciente', {
      p_paciente_id: paciente.id, p_unit_destino: unitDestinoId,
    })
    setBusy(false)
    if (error) { showToast('Erro ao transferir: ' + error.message, 'error'); return }
    const nome = unidadesDestino.find(u => u.id === unitDestinoId)?.nome ?? 'outra unidade'
    showToast(`${paciente.nome} transferido(a) para ${nome} — aguardando alocação de leito definitivo.`)
    onAltaConcedida()
    onClose()
  }

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
    const { data } = await supabase.from('resumos_alta').insert({
      paciente_nome:         paciente.nome,
      data_internacao:       paciente.data_internacao,
      paciente_snapshot:     paciente,
      exames_snapshot:       exames,
      balanco_snapshot:      periodos,
      neuro_snapshot:        neuro,
      ventilatorio_snapshot: ventilatorio,
      texto_resumo:          resumo,
      ...camposSaida(),
    }).select('id').single()
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

              {semSaps3 && (
                <div className="border border-red-300 bg-red-50 rounded-xl p-4">
                  <p className="text-sm font-bold text-red-800">🚫 SAPS-3 não pontuado</p>
                  <p className="text-xs text-red-700 mt-1">
                    A saída não pode ser registrada sem o SAPS-3. Feche esta janela, use
                    “✏️ Editar” para pontuar e volte aqui.
                  </p>
                  <p className="text-xs text-red-600/80 mt-1.5">
                    Pontue com os dados da <strong>primeira hora</strong> de internação — é assim
                    que o escore é definido, e é o que mantém o SMR da unidade confiável.
                  </p>
                </div>
              )}

              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Tipo de saída *</p>
                <div className="grid grid-cols-3 gap-2">
                  {tiposSaida(tipoUnidade).map(t => (
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

              {isTransferenciaInterna ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unidade destino *</label>
                  {loadingUnidades ? (
                    <p className="text-sm text-slate-400">Carregando unidades...</p>
                  ) : unidadesDestino.length === 0 ? (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      Nenhuma unidade do tipo certo pra receber está cadastrada e ativa —
                      peça pro chefe criar/ativar uma em Unidade antes de transferir.
                    </p>
                  ) : (
                    <select value={unitDestinoId} onChange={e => setUnitDestinoId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                      <option value="">Selecione...</option>
                      {unidadesDestino.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                    </select>
                  )}
                  <p className="text-xs text-slate-400 mt-1">
                    {paciente.nome} continua o mesmo registro, com todo o histórico — cai primeiro na
                    ala de trânsito da unidade destino; alguém de lá aloca o leito definitivo depois.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Data da saída *</label>
                    <input type="date" value={dataSaida} onChange={e => setDataSaida(e.target.value)}
                      max={hojeISO()}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Hora da saída *</label>
                    <input type="time" value={horaSaida} onChange={e => setHoraSaida(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
                  </div>
                </div>
              )}

              {isTransferenciaInterna ? (
                <button onClick={handleConfirmarTransferencia} disabled={!unitDestinoId || busy}
                  className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed
                             text-white font-bold py-3 rounded-xl transition-colors">
                  {busy ? 'Transferindo...' : '🔁 Confirmar transferência'}
                </button>
              ) : (
                <button onClick={handleAltaDireta} disabled={!tipoSaida || semSaps3}
                  className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed
                             text-white font-bold py-3 rounded-xl transition-colors">
                  ✅ Registrar Saída Agora
                </button>
              )}

              {permiteResumoIA && !isTransferenciaInterna && (
                <>
                  <div className="relative flex items-center">
                    <div className="flex-1 border-t border-slate-200" />
                    <span className="px-3 text-xs text-slate-400">ou</span>
                    <div className="flex-1 border-t border-slate-200" />
                  </div>

                  <button onClick={handleGenerateFirst} disabled={!tipoSaida || semSaps3}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed
                               text-white font-semibold py-3 rounded-xl transition-colors text-sm">
                    🤖 Gerar Resumo com IA e Registrar Saída
                  </button>
                </>
              )}
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

              {permiteResumoIA && (
                <button onClick={handleGeneratePostAlta}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition-colors text-sm">
                  🤖 Gerar Relatório de Alta com IA
                </button>
              )}

              <button onClick={onClose}
                className="w-full border border-slate-300 text-slate-600 font-medium py-2.5 rounded-xl hover:bg-slate-50 text-sm transition-colors">
                {permiteResumoIA ? 'Fechar sem relatório' : 'Fechar'}
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
