'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isDateFuture, toTitleCaseNome, normalizarNome, fmtDataHora, parseDataParaISO, hojeISO } from '@/lib/utils'
import type { Paciente, ToastData } from '@/types'

interface Props {
  alaId: string
  /** Nome de exibição da ala, vindo do banco (antes era um if 'uti-01' ? ... : ...). */
  alaNome: string
  unitId: string
  numeroLeito: string
  /** Planos cadastrados pelo chefe em /unidade — "Outros" é acrescentado aqui embaixo, sempre por último. */
  planosSaude: string[]
  onClose: () => void
  onSaved: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

/** Alta anterior do mesmo paciente, detectada pelo app. */
interface AltaAnterior {
  id: string
  nome: string
  dataAlta: string
  horasAtras: number
  /** Null no caso raro de um resumo órfão — sem isso não dá pra desfazer a alta nem importar dados. */
  pacienteId: string | null
  snapshot: Paciente | null
}

/** Abaixo disso, a alta pode ter sido um clique errado — vale perguntar antes de contar como reinternação de verdade. */
const HORAS_LIMITE_ACIDENTAL = 12

function descreverIntervalo(horas: number): string {
  if (horas < 1)  return `${Math.max(1, Math.round(horas * 60))} min`
  if (horas < 48) return `${Math.round(horas)}h`
  return `${Math.round(horas / 24)} dias`
}

export default function CadastroForm({ alaId, alaNome, unitId, numeroLeito, planosSaude, onClose, onSaved, showToast }: Props) {
  const supabase = createClient()
  const hoje     = hojeISO()
  const agoraH   = new Date().toTimeString().slice(0, 5)
  const opcoesPlanos = [...planosSaude, 'Outros']

  const [nome,      setNome]      = useState('')
  const [dataNasc,  setDataNasc]  = useState('')
  const [plano,     setPlano]     = useState('')
  const [planoOu,   setPlanoOu]   = useState('')
  const [dataInt,   setDataInt]   = useState(hoje)
  const [horaInt,   setHoraInt]   = useState(agoraH)
  const [pesoKg,    setPesoKg]    = useState('')
  const [hipoteses, setHipoteses] = useState('')
  const [oncologico, setOncologico] = useState(false)
  const [saps3,     setSaps3]     = useState('')
  const [errors,    setErrors]    = useState<Record<string, string>>({})
  const [saving,    setSaving]    = useState(false)

  // Reinternação: o app procura uma alta anterior do mesmo paciente e calcula o
  // intervalo. Quem admite confirma — nunca digita "<48h" ou "<30 dias" à mão.
  const [altaAnterior,  setAltaAnterior]  = useState<AltaAnterior | null>(null)
  const [confirmouReint, setConfirmouReint] = useState(false)
  // null = ainda não respondeu. Só é perguntado quando a readmissão é < 12h.
  const [acidental,     setAcidental]     = useState<boolean | null>(null)
  const [desfazendo,    setDesfazendo]    = useState(false)

  useEffect(() => {
    if (!nome.trim() || !dataNasc) { setAltaAnterior(null); return }
    let cancelado = false

    const buscar = async () => {
      // Filtra pela data de nascimento no banco (índice do jsonb) e confere o
      // nome no cliente, normalizado — nomes vêm com acentuação inconsistente.
      // Traz paciente_id + paciente_snapshot também: são a base de "desfazer
      // alta" (reativar o registro original) e "importar dados anteriores".
      const { data } = await supabase
        .from('resumos_alta')
        .select('id, paciente_nome, data_alta, paciente_id, paciente_snapshot')
        .eq('paciente_snapshot->>data_nascimento', dataNasc)
        .order('data_alta', { ascending: false })
        .limit(10)
      if (cancelado || !data?.length) { setAltaAnterior(null); return }

      const alvo = normalizarNome(nome.trim())
      const match = data.find(r => normalizarNome(r.paciente_nome) === alvo)
      if (!match) { setAltaAnterior(null); return }

      const horas = (Date.now() - new Date(match.data_alta).getTime()) / 3_600_000
      setAltaAnterior({
        id: match.id, nome: match.paciente_nome, dataAlta: match.data_alta, horasAtras: horas,
        pacienteId: match.paciente_id ?? null,
        snapshot: (match.paciente_snapshot as Paciente) ?? null,
      })
    }

    const t = setTimeout(buscar, 400)
    return () => { cancelado = true; clearTimeout(t) }
  }, [nome, dataNasc, supabase])

  // Se o paciente detectado mudar, as respostas anteriores não valem mais.
  useEffect(() => { setConfirmouReint(false); setAcidental(null) }, [altaAnterior?.id])

  /** Pré-preenche com o que estava valendo na internação anterior — só campos deste formulário. */
  const importarDadosAnteriores = () => {
    const snap = altaAnterior?.snapshot
    if (!snap) return
    if (opcoesPlanos.includes(snap.plano_saude)) { setPlano(snap.plano_saude); setPlanoOu('') }
    else { setPlano('Outros'); setPlanoOu(snap.plano_saude) }
    setHipoteses(snap.hipoteses ?? '')
    setPesoKg(snap.peso_kg != null ? String(snap.peso_kg) : '')
    setOncologico(snap.oncologico)
    showToast('Dados importados da internação anterior — confira antes de salvar.')
  }

  /** A alta foi um clique errado: em vez de uma nova internação, reativa o
   *  registro original no leito que a equipe está tentando usar agora e apaga
   *  o resumo de alta — como se a alta nunca tivesse acontecido. Sem isso, a
   *  correção manual criava uma admissão+alta fantasma que inflava não só o
   *  indicador de reinternação, como admissões/altas/permanência do mês. */
  const handleDesfazerAlta = async () => {
    if (!altaAnterior?.pacienteId) return
    setDesfazendo(true)
    const { error: errAtivar } = await supabase.from('pacientes')
      .update({ ativo: true, ala_id: alaId, numero_leito: numeroLeito, unit_id: unitId })
      .eq('id', altaAnterior.pacienteId)
    if (errAtivar) {
      showToast('Erro ao reativar o paciente: ' + errAtivar.message, 'error')
      setDesfazendo(false)
      return
    }
    const { error: errDel } = await supabase.from('resumos_alta').delete().eq('id', altaAnterior.id)
    setDesfazendo(false)
    if (errDel) {
      showToast('Paciente reativado, mas não consegui apagar o resumo de alta — apague manualmente depois: ' + errDel.message, 'error')
    } else {
      showToast('Alta desfeita — paciente reativado.')
    }
    onSaved()
  }

  const podeSerAcidental = !!altaAnterior && altaAnterior.horasAtras < HORAS_LIMITE_ACIDENTAL

  const validate = () => {
    const e: Record<string, string> = {}
    if (!nome.trim())  e.nome     = 'Nome obrigatório'
    if (!dataNasc)     e.dataNasc = 'Obrigatório'
    else if (isDateFuture(dataNasc)) e.dataNasc = 'Não pode ser futura'
    if (!plano)        e.plano    = 'Selecione um plano'
    if (!dataInt)      e.dataInt  = 'Obrigatório'
    else if (isDateFuture(dataInt)) e.dataInt = 'Não pode ser futura'
    if (!horaInt)      e.horaInt  = 'Obrigatório'
    if (saps3) {
      const n = parseFloat(saps3)
      if (Number.isNaN(n) || n < 0 || n > 300) e.saps3 = 'SAPS-3 inválido'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)

    const planoFinal = plano === 'Outros' ? (planoOu.trim() || 'Outros') : plano

    const { error } = await supabase.from('pacientes').insert({
      nome: toTitleCaseNome(nome),
      data_nascimento: dataNasc,
      plano_saude:     planoFinal,
      data_internacao: dataInt,
      hora_internacao: horaInt,
      peso_kg:         pesoKg ? parseFloat(pesoKg) : null,
      hipoteses:       hipoteses.trim() || null,
      ala_id:          alaId,
      unit_id:         unitId,
      numero_leito:    numeroLeito,
      oncologico,
      readmissao_de:   confirmouReint && altaAnterior ? altaAnterior.id : null,
      saps3:              saps3 ? parseFloat(saps3) : null,
      saps3_calculado_em: saps3 ? new Date().toISOString() : null,
    })

    setSaving(false)
    if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-4">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white px-6 py-4 rounded-t-2xl flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold">Novo Paciente</h2>
            <p className="text-indigo-200 text-xs">{alaNome} — Leito {String(numeroLeito).padStart(2,'0')}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <Field label="Nome Completo *" error={errors.nome}>
            <input type="text" value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Nome do paciente" className={input(errors.nome)} />
          </Field>

          {/* Campos de data precisam de largura para o seletor nativo do celular
              mostrar dd/mm/aaaa — em meia tela ficam cortados. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Data de Nascimento *" error={errors.dataNasc}>
              {/* onPaste: um <input type="date"> não aceita texto colado sozinho.
                  Aqui interceptamos a colagem do prontuário (ex.: "12/05/1970") e
                  convertemos para o formato ISO que o campo entende. */}
              <input type="date" value={dataNasc} max={hoje}
                onPaste={e => {
                  const iso = parseDataParaISO(e.clipboardData.getData('text'))
                  if (iso) { e.preventDefault(); setDataNasc(iso) }
                }}
                onChange={e => setDataNasc(e.target.value)} className={input(errors.dataNasc)} />
            </Field>
            <Field label="Peso (Kg)">
              <input type="number" value={pesoKg} onChange={e => setPesoKg(e.target.value)}
                placeholder="Ex: 70" min="1" max="300" step="0.1" className={input()} />
            </Field>
          </div>

          {/* Readmissão < 12h: pergunta se a alta foi acidental antes de tratar
              como uma reinternação de verdade — sem isso, uma alta dada por
              engano e corrigida na hora infla o indicador de reinternação
              (e, com o fluxo antigo, também admissões/altas/permanência). */}
          {altaAnterior && podeSerAcidental && acidental === null && (
            <div className="border border-red-300 bg-red-50 rounded-lg p-3">
              <p className="text-sm text-red-900">
                🚨 <span className="font-semibold">{altaAnterior.nome}</span> teve alta há{' '}
                <span className="font-semibold">{descreverIntervalo(altaAnterior.horasAtras)}</span>{' '}
                ({fmtDataHora(altaAnterior.dataAlta)}).
              </p>
              <p className="text-sm font-medium text-red-900 mt-2">A alta foi acidental (deu saída sem querer)?</p>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => setAcidental(true)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border border-red-400 bg-white text-red-700 hover:bg-red-100 transition-colors">
                  Sim, foi acidental
                </button>
                <button type="button" onClick={() => setAcidental(false)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 transition-colors">
                  Não, é uma nova internação
                </button>
              </div>
            </div>
          )}

          {altaAnterior && acidental === true && (
            <div className="border border-red-300 bg-red-50 rounded-lg p-4 space-y-3">
              <p className="text-sm text-red-900">
                Vamos desfazer a alta de <span className="font-semibold">{altaAnterior.nome}</span> e
                reativar o cadastro direto no <span className="font-semibold">{alaNome} — Leito {String(numeroLeito).padStart(2,'0')}</span>,
                com todo o histórico anterior intacto. Nenhuma internação nova fica registrada.
              </p>
              {!altaAnterior.pacienteId && (
                <p className="text-sm font-semibold text-red-700">
                  ⚠️ Não encontrei o cadastro original pra reativar — volte e siga com um cadastro normal.
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setAcidental(null)}
                  className="flex-1 border border-slate-300 text-slate-600 font-semibold py-2 rounded-lg hover:bg-slate-50 text-sm transition-colors">
                  Voltar
                </button>
                <button type="button" onClick={handleDesfazerAlta} disabled={desfazendo || !altaAnterior.pacienteId}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
                  {desfazendo ? 'Desfazendo...' : '↩️ Desfazer alta e reativar'}
                </button>
              </div>
            </div>
          )}

          {altaAnterior && (!podeSerAcidental || acidental === false) && (
            <div className="border border-amber-300 bg-amber-50 rounded-lg p-3">
              <p className="text-sm text-amber-900">
                ⚠️ <span className="font-semibold">{altaAnterior.nome}</span> teve alta em{' '}
                <span className="font-semibold">{fmtDataHora(altaAnterior.dataAlta)}</span> — reinternação em{' '}
                <span className="font-semibold">{descreverIntervalo(altaAnterior.horasAtras)}</span>.
              </p>
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input type="checkbox" checked={confirmouReint}
                  onChange={e => setConfirmouReint(e.target.checked)}
                  className="w-4 h-4 accent-amber-600" />
                <span className="text-xs font-medium text-amber-900">
                  Confirmo que é o mesmo paciente (registra como reinternação)
                </span>
              </label>
              {confirmouReint && altaAnterior.snapshot && (
                <button type="button" onClick={importarDadosAnteriores}
                  className="mt-2 text-xs font-semibold text-amber-800 border border-amber-400 bg-white hover:bg-amber-100 px-3 py-1.5 rounded-lg transition-colors">
                  📋 Importar dados anteriores
                </button>
              )}
            </div>
          )}

          {!(altaAnterior && acidental === true) && <>
          <Field label="Plano de Saúde *" error={errors.plano}>
            <select value={plano} onChange={e => { setPlano(e.target.value); setPlanoOu('') }} className={input(errors.plano)}>
              <option value="">Selecione...</option>
              {opcoesPlanos.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {plano === 'Outros' && (
              <input type="text" value={planoOu} onChange={e => setPlanoOu(e.target.value)}
                placeholder="Nome do plano" className={`${input()} mt-2`} />
            )}
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Data de Internação *" error={errors.dataInt}>
              <input type="date" value={dataInt} max={hoje}
                onChange={e => setDataInt(e.target.value)} className={input(errors.dataInt)} />
            </Field>
            <Field label="Hora de Admissão *" error={errors.horaInt}>
              <input type="time" value={horaInt}
                onChange={e => setHoraInt(e.target.value)} className={input(errors.horaInt)} />
            </Field>
          </div>

          <Field label="SAPS-3" error={errors.saps3}>
            <input type="number" value={saps3} onChange={e => setSaps3(e.target.value)}
              placeholder="Escore" min="0" max="300" step="1" className={input(errors.saps3)} />
            <p className="text-xs text-slate-400 mt-1">
              {saps3
                ? 'Pontuado na admissão — é aqui que o escore vale.'
                : 'Pode ficar para depois, mas será cobrado até a saída. O escore usa os dados da primeira hora.'}
            </p>
          </Field>

          <Field label="Hipóteses Diagnósticas">
            <textarea value={hipoteses} onChange={e => setHipoteses(e.target.value)}
              placeholder="Ex: Insuficiência respiratória aguda, Sepse..."
              rows={3} className={input()} style={{resize:'vertical'}} />
          </Field>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={oncologico}
              onChange={e => setOncologico(e.target.checked)}
              className="w-4 h-4 accent-indigo-600" />
            <span className="text-sm font-medium text-slate-700">🎗️ Paciente oncológico</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-slate-300 text-slate-700 font-semibold py-2.5 rounded-lg hover:bg-slate-50 text-sm">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50
                         text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
              {saving ? 'Salvando...' : 'Internar Paciente'}
            </button>
          </div>
          </>}
        </form>
      </div>
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">❌ {error}</p>}
    </div>
  )
}

function input(error?: string) {
  return `w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
    ${error ? 'border-red-400 bg-red-50' : 'border-slate-300'}`
}
