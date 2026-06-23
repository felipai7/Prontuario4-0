'use client'
import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Paciente, ExameImagem, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  examesImagem: ExameImagem[]
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

interface AiResult {
  tipo_exame: string
  data_exame: string | null
  resumo: string
  achados: Record<string, string>
  conclusao: string | null
}

export default function ExamesImagemTab({ paciente, examesImagem, onRefresh, showToast }: Props) {
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)

  const [uploading,   setUploading]  = useState(false)
  const [aiResult,    setAiResult]   = useState<AiResult | null>(null)
  const [tipoEdit,    setTipoEdit]   = useState('')
  const [dataEdit,    setDataEdit]   = useState('')
  const [saving,      setSaving]     = useState(false)
  const [expandedId,  setExpandedId] = useState<string | null>(null)
  const [deleting,    setDeleting]   = useState<string | null>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploading(true); setAiResult(null)
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader()
        reader.onload = ev => res((ev.target?.result as string).split(',')[1])
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      const resp = await fetch('/api/extract-imagem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: b64, mediaType: file.type }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)
      setAiResult(data)
      setTipoEdit(data.tipo_exame ?? '')
      setDataEdit(data.data_exame ?? '')
    } catch (err: any) { showToast('Erro: ' + err.message, 'error'); resetForm() }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const resetForm = () => {
    setAiResult(null); setTipoEdit(''); setDataEdit('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSave = async () => {
    if (!aiResult) return
    if (!tipoEdit.trim()) { showToast('Informe o tipo de exame', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('exames_imagem').insert({
      paciente_id: paciente.id,
      tipo_exame:  tipoEdit.trim(),
      data_exame:  dataEdit.trim() || null,
      resumo_ia:   aiResult.resumo,
      achados: { ...aiResult.achados, ...(aiResult.conclusao ? { '📋 Conclusão': aiResult.conclusao } : {}) },
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Laudo salvo!')
    resetForm(); onRefresh()
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

      {/* Upload trigger */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">Laudos de Imagem ({examesImagem.length})</h3>
        <label className={`cursor-pointer flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
          {uploading ? '⏳ Analisando...' : '+ Adicionar Laudo'}
          <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileChange} disabled={uploading}/>
        </label>
      </div>

      {/* AI result preview / save form */}
      {aiResult && (
        <div className="border-2 border-indigo-200 rounded-xl bg-indigo-50 p-4 space-y-3">
          <div className="flex items-start justify-between">
            <p className="text-sm font-bold text-indigo-900">🤖 IA extraiu os seguintes dados</p>
            <button onClick={resetForm} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Tipo de exame *</label>
              <input value={tipoEdit} onChange={e => setTipoEdit(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Data do exame</label>
              <input value={dataEdit} onChange={e => setDataEdit(e.target.value)} placeholder="DD/MM/AAAA"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
            </div>
          </div>

          <div className="bg-white border border-indigo-100 rounded-lg p-3">
            <p className="text-xs font-bold text-indigo-700 mb-1.5">Resumo</p>
            <p className="text-sm text-slate-700 leading-relaxed">{aiResult.resumo}</p>
          </div>

          {Object.keys(aiResult.achados).length > 0 && (
            <div className="bg-white border border-indigo-100 rounded-lg p-3 space-y-1.5">
              <p className="text-xs font-bold text-indigo-700 mb-2">Achados</p>
              {Object.entries(aiResult.achados).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs">
                  <span className="font-semibold text-slate-600 whitespace-nowrap min-w-[110px]">{k}:</span>
                  <span className="text-slate-700">{v as string}</span>
                </div>
              ))}
              {aiResult.conclusao && (
                <div className="mt-2 pt-2 border-t border-indigo-100">
                  <p className="text-xs font-bold text-indigo-700">Conclusão:</p>
                  <p className="text-xs text-slate-700 mt-0.5">{aiResult.conclusao}</p>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={resetForm} className="flex-1 border border-slate-300 text-slate-600 text-sm font-semibold py-2 rounded-lg hover:bg-slate-50">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg">
              {saving ? '⏳ Salvando...' : '💾 Salvar Laudo'}
            </button>
          </div>
        </div>
      )}

      {examesImagem.length === 0 && !aiResult && (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhum laudo de imagem registrado</p>
      )}

      {/* List */}
      <div className="space-y-3">
        {sorted.map(ex => {
          const isExp   = expandedId === ex.id
          const achados = ex.achados ?? {}

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
                    <p className="text-xs text-slate-600 mt-1.5 leading-relaxed line-clamp-2">{ex.resumo_ia}</p>
                  )}

                  {Object.keys(achados).length > 0 && (
                    <button onClick={() => setExpandedId(isExp ? null : ex.id)}
                      className="mt-1.5 text-xs text-indigo-500 hover:text-indigo-700 font-semibold">
                      {isExp ? '▲ Ocultar detalhes' : `▼ Ver ${Object.keys(achados).length} achado(s)`}
                    </button>
                  )}
                </div>
              </div>

              {isExp && (
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
