'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseDataParaISO } from '@/lib/utils'
import { MODALIDADES, REGIOES_POR_MODALIDADE, nomeCanonico, type Modalidade } from '@/lib/examesImagem'
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

  const [formOpen,         setFormOpen]         = useState(false)
  // Modalidade + Região no lugar do texto livre de antes — 'outro' é a
  // válvula de escape pro caso raro fora do catálogo (ver lib/examesImagem.ts).
  const [mModalidade,      setMModalidade]      = useState<Modalidade | 'outro' | ''>('')
  const [mModalidadeLivre, setMModalidadeLivre] = useState('')
  const [mRegiao,          setMRegiao]          = useState('')
  const [mRegiaoLivre,     setMRegiaoLivre]     = useState('')
  const [mCritico,         setMCritico]         = useState(false)
  const [mData,            setMData]            = useState('')
  const [mTexto,           setMTexto]           = useState('')
  const [mDataErr,         setMDataErr]         = useState('')
  const [saving,           setSaving]           = useState(false)
  const [expandedId,       setExpandedId]       = useState<string | null>(null)
  const [deleting,         setDeleting]         = useState<string | null>(null)
  const [togglingCritico,  setTogglingCritico]  = useState<string | null>(null)

  const resetForm = () => {
    setMModalidade(''); setMModalidadeLivre(''); setMRegiao(''); setMRegiaoLivre('')
    setMCritico(false); setMData(''); setMTexto(''); setMDataErr('')
  }

  /** Nome canônico a partir da seleção atual, ou null se ainda incompleta —
   *  serve tanto pra validar antes de salvar quanto pra pré-visualizar. */
  const resolverTipoExame = (): string | null => {
    if (mModalidade === 'outro') return mModalidadeLivre.trim() || null
    if (!mModalidade) return null
    if (mRegiao === 'outro') return mRegiaoLivre.trim() ? nomeCanonico(mModalidade, mRegiaoLivre) : null
    if (!mRegiao) return null
    return nomeCanonico(mModalidade, mRegiao)
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
    const tipoExame = resolverTipoExame()
    if (!tipoExame) { showToast('Selecione a modalidade e a região do exame', 'error'); return }
    const dateErr = validateDate(mData)
    if (dateErr) { setMDataErr(dateErr); return }
    if (!mTexto.trim()) { showToast('Cole o texto do laudo', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('exames_imagem').insert({
      paciente_id: paciente.id,
      tipo_exame:  tipoExame,
      data_exame:  mData.trim() || null,
      resumo_ia:   mTexto.trim(),
      achados:     null,
      critico:     mCritico,
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

  // Marca/desmarca a qualquer momento, por qualquer um da equipe — inclusive
  // num laudo já salvo há tempos. Fica visível no Painel/Resumo até alguém
  // desmarcar aqui ou lá (mesmo campo, os dois toggles convergem).
  const handleToggleCritico = async (ex: ExameImagem) => {
    setTogglingCritico(ex.id)
    const { error } = await supabase.from('exames_imagem').update({ critico: !ex.critico }).eq('id', ex.id)
    setTogglingCritico(null)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    onRefresh()
  }

  // Ordena pela data do exame (a data clínica), não por quando foi digitado —
  // um laudo antigo lançado hoje deve aparecer junto dos outros da mesma época,
  // não no topo. Sem data válida, cai para created_at como desempate/fallback.
  const chaveOrdenacao = (ex: ExameImagem): number => {
    const iso = ex.data_exame ? parseDataParaISO(ex.data_exame) : null
    return iso ? new Date(iso + 'T12:00:00').getTime() : new Date(ex.created_at).getTime()
  }
  const sorted = [...examesImagem].sort((a, b) => chaveOrdenacao(b) - chaveOrdenacao(a))

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
                  <label className="text-xs text-slate-500 font-medium block mb-1">Modalidade *</label>
                  <select value={mModalidade}
                    onChange={e => { setMModalidade(e.target.value as Modalidade | 'outro' | ''); setMRegiao(''); setMRegiaoLivre('') }}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="">Selecione...</option>
                    {MODALIDADES.map(m => <option key={m} value={m}>{m}</option>)}
                    <option value="outro">Outro (descrever)</option>
                  </select>
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

              {mModalidade === 'outro' ? (
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Nome do exame *</label>
                  <input value={mModalidadeLivre} onChange={e => setMModalidadeLivre(e.target.value)}
                    placeholder="Ex: Cintilografia óssea"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
                </div>
              ) : mModalidade ? (
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Região *</label>
                  <select value={mRegiao} onChange={e => setMRegiao(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="">Selecione...</option>
                    {REGIOES_POR_MODALIDADE[mModalidade].map(r => <option key={r} value={r}>{r}</option>)}
                    <option value="outro">Outro (descrever)</option>
                  </select>
                  {mRegiao === 'outro' && (
                    <input value={mRegiaoLivre} onChange={e => setMRegiaoLivre(e.target.value)}
                      placeholder="Descreva a região"
                      className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
                  )}
                </div>
              ) : null}

              {resolverTipoExame() && (
                <p className="text-xs text-indigo-600">Vai salvar como: <strong>{resolverTipoExame()}</strong></p>
              )}

              <div>
                <label className="text-xs text-slate-500 font-medium block mb-1">Texto do laudo *</label>
                <textarea value={mTexto} onChange={e => setMTexto(e.target.value)}
                  rows={6} placeholder="Cole aqui o texto completo do laudo..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
              </div>

              <label className="flex items-center gap-2 text-sm text-red-700 font-medium cursor-pointer select-none">
                <input type="checkbox" checked={mCritico} onChange={e => setMCritico(e.target.checked)}
                  className="w-4 h-4 accent-red-600"/>
                ⚠️ Resultado crítico — aparece em destaque no Painel/Resumo
              </label>

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
            <div key={ex.id} className={`border rounded-xl bg-white shadow-sm overflow-hidden ${ex.critico ? 'border-red-300' : 'border-slate-200'}`}>
              <div className={`flex items-start gap-3 p-3 ${ex.critico ? 'bg-red-50/60' : ''}`}>
                <div className={`w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center border text-xl ${ex.critico ? 'bg-red-50 border-red-200' : 'bg-indigo-50 border-indigo-100'}`}>
                  🩻
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800 text-sm flex items-center gap-1.5 flex-wrap">
                        {ex.tipo_exame}
                        {ex.critico && (
                          <span className="bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap">🔴 CRÍTICO</span>
                        )}
                      </p>
                      {ex.data_exame && <p className="text-xs text-slate-400 mt-0.5">📅 {ex.data_exame}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => handleToggleCritico(ex)} disabled={togglingCritico === ex.id}
                        title={ex.critico ? 'Desmarcar como crítico' : 'Marcar como crítico'}
                        className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                          ex.critico ? 'text-red-600 border-red-200 hover:border-red-400' : 'text-slate-400 border-slate-200 hover:border-red-300 hover:text-red-500'}`}>
                        {togglingCritico === ex.id ? '⏳' : ex.critico ? '🔴' : '⚪'}
                      </button>
                      <button onClick={() => handleDelete(ex)} disabled={deleting === ex.id}
                        className="text-xs text-red-400 hover:text-red-700 border border-red-100 hover:border-red-300 px-2 py-1 rounded-lg transition-colors">
                        {deleting === ex.id ? '⏳' : '🗑️'}
                      </button>
                    </div>
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
