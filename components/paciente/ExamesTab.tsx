'use client'
import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Exame, Paciente, ResultadoExame, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  exames: Exame[]
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

type AddMode = 'ia' | 'manual'

type ManualResultado = {
  nome: string; valor: string; unidade: string; referencia: string
  alterado: boolean; direcao: 'alto' | 'baixo' | 'normal' | 'qualitativo'
}

const emptyResultado = (): ManualResultado => ({
  nome: '', valor: '', unidade: '', referencia: '', alterado: false, direcao: 'normal'
})

export default function ExamesTab({ paciente, exames, onRefresh, showToast }: Props) {
  const supabase     = createClient()
  const fileRef      = useRef<HTMLInputElement>(null)

  // IA mode state
  const [adding,     setAdding]     = useState(false)
  const [addMode,    setAddMode]    = useState<AddMode>('ia')
  const [file,       setFile]       = useState<File | null>(null)
  const [preview,    setPreview]    = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [localErr,   setLocalErr]   = useState<string | null>(null)

  // Manual mode state
  const [mTipo,      setMTipo]      = useState('')
  const [mData,      setMData]      = useState('')
  const [mObs,       setMObs]       = useState('')
  const [mRows,      setMRows]      = useState<ManualResultado[]>([emptyResultado()])
  const [savingM,    setSavingM]    = useState(false)

  // Exam list state
  const [expanded,   setExpanded]   = useState<string | null>(null)
  const [evoLoading, setEvoLoading] = useState(false)
  const [evoText,    setEvoText]    = useState<string | null>(null)

  // --- IA extraction ---
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    setFile(f); setLocalErr(null)
    const reader = new FileReader()
    reader.onload = ev => setPreview(f.type.startsWith('image/') ? ev.target?.result as string : '[PDF]')
    reader.readAsDataURL(f)
  }

  const handleExtract = async () => {
    if (!file) return
    setExtracting(true); setLocalErr(null)
    try {
      const reader = new FileReader()
      const b64 = await new Promise<string>((res, rej) => {
        reader.onload = e => res((e.target?.result as string).split(',')[1])
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      const resp = await fetch('/api/extract-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: b64, mediaType: file.type }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)

      await supabase.from('exames').insert({
        paciente_id:  paciente.id,
        tipo_exame:   data.tipo_exame,
        data_exame:   data.data_exame,
        resultados:   data.resultados,
        observacoes:  data.observacoes,
        raw_text:     data.raw_text,
        nome_arquivo: file.name,
      })
      resetAdding()
      onRefresh()
      showToast('Exame extraído e salvo!')
    } catch (e: any) {
      setLocalErr(e.message)
    }
    setExtracting(false)
  }

  // --- Manual save ---
  const handleManualSave = async () => {
    if (!mTipo.trim()) { setLocalErr('Informe o tipo de exame'); return }
    setSavingM(true); setLocalErr(null)

    const resultados: ResultadoExame[] = mRows
      .filter(r => r.nome.trim() && r.valor.trim())
      .map(r => ({
        nome:       r.nome.trim(),
        valor:      r.valor.trim(),
        unidade:    r.unidade.trim()    || null,
        referencia: r.referencia.trim() || null,
        alterado:   r.alterado,
        direcao:    r.direcao,
      }))

    // Convert YYYY-MM-DD to DD/MM/AAAA
    let dataFormatada: string | null = null
    if (mData) {
      const [y, m, d] = mData.split('-')
      dataFormatada = `${d}/${m}/${y}`
    }

    await supabase.from('exames').insert({
      paciente_id:  paciente.id,
      tipo_exame:   mTipo.trim(),
      data_exame:   dataFormatada,
      resultados:   resultados.length > 0 ? resultados : null,
      observacoes:  mObs.trim() || null,
      raw_text:     null,
      nome_arquivo: null,
    })

    resetAdding()
    onRefresh()
    showToast('Exame salvo com sucesso!')
    setSavingM(false)
  }

  const resetAdding = () => {
    setAdding(false); setAddMode('ia')
    setFile(null); setPreview(null); setLocalErr(null)
    if (fileRef.current) fileRef.current.value = ''
    setMTipo(''); setMData(''); setMObs('')
    setMRows([emptyResultado()])
  }

  const updateRow = (i: number, patch: Partial<ManualResultado>) =>
    setMRows(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  // --- Evolutionary analysis (Claude) ---
  const handleEvolucao = async () => {
    setEvoLoading(true); setEvoText(null)
    try {
      const resumo = exames.map((ex, i) => {
        const alts = (ex.resultados || []).filter(r => r.alterado)
        const norm = (ex.resultados || []).filter(r => !r.alterado)
        return `Exame ${i+1} — ${ex.tipo_exame} (${ex.data_exame || 'sem data'}):\n` +
          (alts.length ? '  ALTERADOS: ' + alts.map(r => `${r.nome}: ${r.valor} ${r.unidade||''} [${r.direcao?.toUpperCase()}]`).join(', ') + '\n' : '') +
          (norm.length ? '  Normais: '  + norm.map(r => `${r.nome}: ${r.valor} ${r.unidade||''}`).join(', ') : '')
      }).join('\n\n')

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 1000,
          messages: [{ role: 'user', content:
            `Médico assistente: analise evolução dos exames de ${paciente.nome}.\n` +
            `Hipóteses: ${paciente.hipoteses || 'não informadas'}\n\n${resumo}\n\n` +
            `Avaliação evolutiva objetiva: alterações relevantes, tendências, correlações, pontos de atenção.`
          }]
        })
      })
      const data = await res.json()
      setEvoText(data.content?.[0]?.text || 'Sem resposta')
    } catch (e: any) { showToast('Erro: ' + e.message, 'error') }
    setEvoLoading(false)
  }

  const totalAlt = exames.reduce((acc, ex) => acc + (ex.resultados?.filter(r => r.alterado).length ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">
          Exames ({exames.length})
          {totalAlt > 0 && (
            <span className="ml-2 bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
              ⚠️ {totalAlt} alterado{totalAlt > 1 ? 's' : ''}
            </span>
          )}
        </h3>
        <button onClick={() => { if (adding) resetAdding(); else setAdding(true) }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
          {adding ? '✕ Cancelar' : '+ Adicionar Exame'}
        </button>
      </div>

      {/* Add exam panel */}
      {adding && (
        <div className="border-2 border-dashed border-indigo-200 rounded-xl p-4 bg-indigo-50 space-y-3">

          {/* Mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-indigo-200">
            <button onClick={() => { setAddMode('ia'); setLocalErr(null) }}
              className={`flex-1 py-2 text-sm font-semibold transition-colors ${addMode === 'ia' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}>
              🤖 Via IA
            </button>
            <button onClick={() => { setAddMode('manual'); setLocalErr(null) }}
              className={`flex-1 py-2 text-sm font-semibold transition-colors ${addMode === 'manual' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}>
              ✏️ Manual
            </button>
          </div>

          {/* IA mode */}
          {addMode === 'ia' && (
            <>
              <input ref={fileRef} type="file" id="exam-file" accept=".pdf,image/*" onChange={handleFile} className="hidden"/>
              <label htmlFor="exam-file"
                className="flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed border-indigo-300
                           rounded-lg cursor-pointer hover:border-indigo-500 hover:bg-white text-sm text-indigo-600 font-medium transition-all">
                📁 {file ? file.name : 'Selecionar PDF ou Imagem'}
              </label>
              {preview && preview !== '[PDF]' && (
                <img src={preview} alt="preview" className="max-h-40 mx-auto rounded-lg border object-contain" />
              )}
              {preview === '[PDF]' && <p className="text-sm text-slate-500 text-center">📄 {file?.name}</p>}
              {localErr && <p className="text-red-600 text-sm">❌ {localErr}</p>}
              {file && (
                <button onClick={handleExtract} disabled={extracting}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
                  {extracting ? '⏳ Extraindo com IA...' : '🤖 Extrair e Salvar'}
                </button>
              )}
            </>
          )}

          {/* Manual mode */}
          {addMode === 'manual' && (
            <div className="space-y-3">
              {/* Tipo + Data */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Tipo de exame *</label>
                  <input value={mTipo} onChange={e => setMTipo(e.target.value)}
                    placeholder="ex: Hemograma"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"/>
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Data do exame</label>
                  <input type="date" value={mData} onChange={e => setMData(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"/>
                </div>
              </div>

              {/* Resultados */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-500 font-medium">Resultados</label>
                  <button onClick={() => setMRows(r => [...r, emptyResultado()])}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
                    + Adicionar linha
                  </button>
                </div>

                <div className="space-y-2">
                  {mRows.map((row, i) => (
                    <div key={i} className="bg-white border border-slate-200 rounded-lg p-2 space-y-2">
                      {/* Row 1: nome + valor + unidade */}
                      <div className="grid grid-cols-3 gap-1.5">
                        <input value={row.nome} onChange={e => updateRow(i, { nome: e.target.value })}
                          placeholder="Parâmetro"
                          className="border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"/>
                        <input value={row.valor} onChange={e => updateRow(i, { valor: e.target.value })}
                          placeholder="Valor"
                          className="border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"/>
                        <input value={row.unidade} onChange={e => updateRow(i, { unidade: e.target.value })}
                          placeholder="Unidade"
                          className="border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"/>
                      </div>
                      {/* Row 2: referencia + alterado + direcao + remove */}
                      <div className="flex items-center gap-1.5">
                        <input value={row.referencia} onChange={e => updateRow(i, { referencia: e.target.value })}
                          placeholder="Referência (opcional)"
                          className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"/>
                        <label className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap cursor-pointer">
                          <input type="checkbox" checked={row.alterado}
                            onChange={e => updateRow(i, { alterado: e.target.checked })}
                            className="rounded"/>
                          Alterado
                        </label>
                        {row.alterado && (
                          <select value={row.direcao} onChange={e => updateRow(i, { direcao: e.target.value as ManualResultado['direcao'] })}
                            className="border border-slate-200 rounded px-1.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400">
                            <option value="alto">↑ Alto</option>
                            <option value="baixo">↓ Baixo</option>
                            <option value="qualitativo">! Qualitativo</option>
                            <option value="normal">Normal</option>
                          </select>
                        )}
                        {mRows.length > 1 && (
                          <button onClick={() => setMRows(rows => rows.filter((_, idx) => idx !== i))}
                            className="text-red-400 hover:text-red-600 text-xs font-bold px-1">✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Observações */}
              <div>
                <label className="text-xs text-slate-500 font-medium block mb-1">Observações</label>
                <textarea value={mObs} onChange={e => setMObs(e.target.value)} rows={2}
                  placeholder="Observações clínicas (opcional)"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"/>
              </div>

              {localErr && <p className="text-red-600 text-sm">❌ {localErr}</p>}

              <button onClick={handleManualSave} disabled={savingM}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
                {savingM ? '⏳ Salvando...' : '💾 Salvar Exame'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Alert banner */}
      {totalAlt > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-amber-800 text-sm font-medium">
          ⚠️ Este paciente possui {totalAlt} resultado{totalAlt > 1 ? 's' : ''} alterado{totalAlt > 1 ? 's' : ''}
        </div>
      )}

      {/* Exam list */}
      {exames.length === 0 && !adding ? (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhum exame registrado</p>
      ) : (
        <div className="space-y-2">
          {[...exames].reverse().map(ex => {
            const alts = (ex.resultados || []).filter(r => r.alterado)
            const norm = (ex.resultados || []).filter(r => !r.alterado)
            const open = expanded === ex.id
            return (
              <div key={ex.id} className={`border-2 rounded-xl overflow-hidden ${alts.length ? 'border-red-200' : 'border-slate-200'}`}>
                <button className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 text-left"
                  onClick={() => setExpanded(open ? null : ex.id)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 text-sm">{ex.tipo_exame}</span>
                    {ex.data_exame && <span className="text-slate-400 text-xs">{ex.data_exame}</span>}
                    {alts.length > 0 && (
                      <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                        {alts.length} alt.
                      </span>
                    )}
                  </div>
                  <span className="text-slate-400 text-xs ml-2">{open ? '▲' : '▼'}</span>
                </button>
                {open && (
                  <div className="p-4 space-y-3">
                    {ex.resultados ? (
                      <>
                        {alts.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-red-600 uppercase tracking-wide mb-2">⚠ Alterados</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {alts.map((r, i) => <ResultCard key={i} r={r} />)}
                            </div>
                          </div>
                        )}
                        {norm.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-2">✓ Normais</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {norm.map((r, i) => <ResultCard key={i} r={r} />)}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <pre className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg whitespace-pre-wrap font-mono">{ex.raw_text}</pre>
                    )}
                    {ex.observacoes && (
                      <p className="text-xs text-slate-500 italic bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        💬 {ex.observacoes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Evolutionary assessment */}
      {exames.length >= 1 && (
        <div className="pt-2">
          <button onClick={handleEvolucao} disabled={evoLoading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {evoLoading ? '⏳ Analisando...' : '📈 Avaliação Evolutiva com IA'}
          </button>
          {evoText && (
            <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-sm font-bold text-emerald-800 mb-2">📊 Avaliação Evolutiva</p>
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{evoText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultCard({ r }: { r: ResultadoExame }) {
  const cls =
    r.alterado && r.direcao === 'alto'  ? 'bg-red-50   border-red-200   text-red-700' :
    r.alterado && r.direcao === 'baixo' ? 'bg-blue-50  border-blue-200  text-blue-700' :
    r.alterado                          ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                          'bg-slate-50 border-slate-200 text-slate-600'
  const arrow = r.direcao === 'alto' ? '↑' : r.direcao === 'baixo' ? '↓' : r.alterado ? '!' : ''
  return (
    <div className={`border rounded-lg p-2.5 ${cls}`}>
      <p className="text-xs text-current opacity-70 leading-tight">{r.nome}</p>
      <p className="font-bold text-sm mt-0.5">
        {r.valor} <span className="text-xs font-normal">{r.unidade}</span>
        {arrow && <span className="ml-1 font-black">{arrow}</span>}
      </p>
      {r.referencia && <p className="text-xs opacity-60 mt-0.5">Ref: {r.referencia}</p>}
    </div>
  )
}
