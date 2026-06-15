'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isDateFuture } from '@/lib/utils'
import type { ToastData } from '@/types'

const PLANOS = ['IPASGO', 'Unimed', 'Particular', 'Bradesco', 'Outros']

interface Props {
  alaId: string
  numeroLeito: number
  onClose: () => void
  onSaved: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

export default function CadastroForm({ alaId, numeroLeito, onClose, onSaved, showToast }: Props) {
  const supabase = createClient()
  const hoje     = new Date().toISOString().split('T')[0]
  const agoraH   = new Date().toTimeString().slice(0, 5)

  const [nome,      setNome]      = useState('')
  const [dataNasc,  setDataNasc]  = useState('')
  const [plano,     setPlano]     = useState('')
  const [planoOu,   setPlanoOu]   = useState('')
  const [dataInt,   setDataInt]   = useState(hoje)
  const [horaInt,   setHoraInt]   = useState(agoraH)
  const [pesoKg,    setPesoKg]    = useState('')
  const [hipoteses, setHipoteses] = useState('')
  const [errors,    setErrors]    = useState<Record<string, string>>({})
  const [saving,    setSaving]    = useState(false)

  const validate = () => {
    const e: Record<string, string> = {}
    if (!nome.trim())  e.nome     = 'Nome obrigatório'
    if (!dataNasc)     e.dataNasc = 'Obrigatório'
    else if (isDateFuture(dataNasc)) e.dataNasc = 'Não pode ser futura'
    if (!plano)        e.plano    = 'Selecione um plano'
    if (!dataInt)      e.dataInt  = 'Obrigatório'
    else if (isDateFuture(dataInt)) e.dataInt = 'Não pode ser futura'
    if (!horaInt)      e.horaInt  = 'Obrigatório'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)

    const planoFinal = plano === 'Outros' ? (planoOu.trim() || 'Outros') : plano

    const { error } = await supabase.from('pacientes').insert({
      nome: nome.trim(),
      data_nascimento: dataNasc,
      plano_saude:     planoFinal,
      data_internacao: dataInt,
      hora_internacao: horaInt,
      peso_kg:         pesoKg ? parseFloat(pesoKg) : null,
      hipoteses:       hipoteses.trim() || null,
      ala_id:          alaId,
      numero_leito:    numeroLeito,
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
            <p className="text-indigo-200 text-xs">{alaId === 'uti-01' ? 'UTI 01' : 'UTI 02'} — Leito {String(numeroLeito).padStart(2,'0')}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <Field label="Nome Completo *" error={errors.nome}>
            <input type="text" value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Nome do paciente" className={input(errors.nome)} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Data de Nascimento *" error={errors.dataNasc}>
              <input type="date" value={dataNasc} max={hoje}
                onChange={e => setDataNasc(e.target.value)} className={input(errors.dataNasc)} />
            </Field>
            <Field label="Peso (Kg)">
              <input type="number" value={pesoKg} onChange={e => setPesoKg(e.target.value)}
                placeholder="Ex: 70" min="1" max="300" step="0.1" className={input()} />
            </Field>
          </div>

          <Field label="Plano de Saúde *" error={errors.plano}>
            <select value={plano} onChange={e => { setPlano(e.target.value); setPlanoOu('') }} className={input(errors.plano)}>
              <option value="">Selecione...</option>
              {PLANOS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {plano === 'Outros' && (
              <input type="text" value={planoOu} onChange={e => setPlanoOu(e.target.value)}
                placeholder="Nome do plano" className={`${input()} mt-2`} />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Data de Internação *" error={errors.dataInt}>
              <input type="date" value={dataInt} max={hoje}
                onChange={e => setDataInt(e.target.value)} className={input(errors.dataInt)} />
            </Field>
            <Field label="Hora de Admissão *" error={errors.horaInt}>
              <input type="time" value={horaInt}
                onChange={e => setHoraInt(e.target.value)} className={input(errors.horaInt)} />
            </Field>
          </div>

          <Field label="Hipóteses Diagnósticas">
            <textarea value={hipoteses} onChange={e => setHipoteses(e.target.value)}
              placeholder="Ex: Insuficiência respiratória aguda, Sepse..."
              rows={3} className={input()} style={{resize:'vertical'}} />
          </Field>

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
