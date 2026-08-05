'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Paciente, ExameImagem, ToastData } from '@/types'

// A ANÁLISE POR IA SAIU DAQUI EM 04/08/2026.
//
// Ela lia o laudo enviado como arquivo e devolvia resumo + achados separados
// por tópico. Na prática ninguém usava esse caminho: o uso real é digitar qual
// exame foi feito, quando, e colar o texto do laudo que o radiologista já
// escreveu — pedido do Felipe, a partir do uso na UTI.
//
// Resumir com IA um laudo que já vem escrito por um médico não acrescenta
// informação; só interpreta de novo o que já estava dito, e mandava o laudo do
// paciente para fora. Some junto a rota /api/extract-imagem, que existia só
// para isto. Os laudos já gravados com resumo da IA continuam intactos e
// aparecem como sempre — nada no banco foi tocado.

interface Props {
  paciente: Paciente
  examesImagem: ExameImagem[]
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

export default function ExamesImagemTab({ paciente, examesImagem, onRefresh, showToast }: Props) {
  const supabase = createClient()

  const [formOpen,   setFormOpen]   = useState(false)
  const [mTipo,      setMTipo]      = useState('')
  const [mData,      setMData]      = useState('')
  const [mTexto,     setMTexto]     = useState('')
  const [mDataErr,   setMDataErr]   = useState('')
  const [saving,     setSaving]     = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleting,   setDeleting]   = useState<string | null>(null)

  const resetForm = () => {
    setMTipo(''); setMData(''); setMTexto(''); setMDataErr('')
  }

  const maskDate = (val: string): string => {
    const d = val.replace(/\D/g, '').slice(0, 8)
    if (d.length > 4) return d.slice(0,2) + '/' + d.slice(2,4) + '/' + d.slice(4)
    if (d.length > 2) return d.slice(0,2) + '/' + d.slice(2)
    return d
  }

  const validateDate = (s: string): string => {
    if (!s.trim()) return 'Data obrigatória'
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (!m) return 'Formato inválido — use DD/MM/AAAA'
    const day = parseInt(m[1]), month = parseInt(m[2]), year = parseInt(m[3])
    if (month < 1 || month > 12) return 'Mês inválido'
    if (day < 1 || day > 31) return 'Dia inválido'
    if (year < 1900 || year > new Date().getFullYear() + 1) return 'Ano inválido'
    const date = new Date(year, month - 1, day)
    if (date.getDate() !== day || date.getMonth() !== month - 1) return 'Data não existe'
    return ''
  }


  const handleSaveManual = async () => {
    if (!mTipo.trim()) { showToast('Informe o tipo de exame', 'error'); return }
    const dateErr = validateDate(mData)
    if (dateErr) { setMDataErr(dateErr); return }
    if (!mTexto.trim()) { showToast('Cole o texto do laudo', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('exames_imagem').insert({
      paciente_id: paciente.id,
      tipo_exame:  mTipo.trim(),
      data_exame:  mData.trim() || null,
      resumo_ia:   mTexto.trim(),
      achados:     null,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Laudo salvo!')
    resetForm(); setFormOpen(false); onRefresh()
  }

  const handleDelete = async (ex: ExameImagem) => {
    if (!confirm(`Excluir "${ex.tipo_exame}"?`)) return
    setDeleting(ex.id)
    const { error } = await supabase.from('exames_imagem').delete().eq('id', ex.id)
    setDeleting(null)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Laudo removido')
    onRefresh()
  }

  const sorted = [...examesImagem].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">Laudos de Imagem ({examesImagem.length})</h3>
        <button onClick={() => { setFormOpen(o => !o); resetForm() }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
          {formOpen ? '✕ Cancelar' : '+ Adicionar Laudo'}
        </button>
      </div>

      {/* Form */}
      {formOpen && (
        <div className="border-2 border-indigo-200 rounded-xl bg-indigo-50 p-4 space-y-3">
          {/* Caminho único: tipo, data e o texto do laudo. */}
          <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Tipo de exame *</label>
                  <input value={mTipo} onChange={e => setMTipo(e.target.value)}
                    placeholder="ex: Radiografia de Tórax"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Data *</label>
                  <input value={mData}
                    onChange={e => { setMData(maskDate(e.target.value)); setMDataErr('') }}
                    onBlur={e => setMDataErr(validateDate(e.target.value))}
                    placeholder="DD/MM/AAAA"
                    className={`w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 ${mDataErr ? 'border-red-400' : 'border-slate-300'}`}/>
                  {mDataErr && <p className="text-xs text-red-500 mt-0.5">{mDataErr}</p>}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 font-medium block mb-1">Texto do laudo *</label>
                <textarea value={mTexto} onChange={e => setMTexto(e.target.value)}
                  rows={6} placeholder="Cole aqui o texto completo do laudo..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
              </div>
              <button onClick={handleSaveManual} disabled={saving}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg">
                {saving ? '⏳ Salvando...' : '💾 Salvar Laudo'}
              </button>
          </div>
        </div>
      )}

      {examesImagem.length === 0 && !formOpen && (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhum laudo de imagem registrado</p>
      )}

      {/* List */}
      <div className="space-y-3">
        {sorted.map(ex => {
          const isExp   = expandedId === ex.id
          const achados = ex.achados ?? {}
          const hasAchados = Object.keys(achados).length > 0

          return (
            <div key={ex.id} className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
              <div className="flex items-start gap-3 p-3">
                <div className="w-10 h-10 rounded-lg flex-shrink-0 bg-indigo-50 flex items-center justify-center border border-indigo-100 text-xl">
                  🩻
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800 text-sm">{ex.tipo_exame}</p>
                      {ex.data_exame && <p className="text-xs text-slate-400 mt-0.5">📅 {ex.data_exame}</p>}
                    </div>
                    <button onClick={() => handleDelete(ex)} disabled={deleting === ex.id}
                      className="text-xs text-red-400 hover:text-red-700 border border-red-100 hover:border-red-300 px-2 py-1 rounded-lg transition-colors flex-shrink-0">
                      {deleting === ex.id ? '⏳' : '🗑️'}
                    </button>
                  </div>

                  {ex.resumo_ia && (
                    // whitespace-pre-wrap preserva os parágrafos do laudo colado;
                    // line-clamp-2 ainda recorta para 2 linhas enquanto fechado.
                    <p className={`text-xs text-slate-600 mt-1.5 leading-relaxed whitespace-pre-wrap ${!isExp ? 'line-clamp-2' : ''}`}>
                      {ex.resumo_ia}
                    </p>
                  )}

                  {hasAchados && (
                    <button onClick={() => setExpandedId(isExp ? null : ex.id)}
                      className="mt-1.5 text-xs text-indigo-500 hover:text-indigo-700 font-semibold">
                      {isExp ? '▲ Ocultar detalhes' : `▼ Ver ${Object.keys(achados).length} achado(s)`}
                    </button>
                  )}
                  {!hasAchados && ex.resumo_ia && ex.resumo_ia.length > 120 && (
                    <button onClick={() => setExpandedId(isExp ? null : ex.id)}
                      className="mt-1.5 text-xs text-indigo-500 hover:text-indigo-700 font-semibold">
                      {isExp ? '▲ Ocultar' : '▼ Ver texto completo'}
                    </button>
                  )}
                </div>
              </div>

              {isExp && hasAchados && (
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-1.5">
                  {Object.entries(achados).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-xs">
                      <span className="font-semibold text-slate-600 whitespace-nowrap min-w-[120px]">{k}:</span>
                      <span className="text-slate-700">{v as string}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
