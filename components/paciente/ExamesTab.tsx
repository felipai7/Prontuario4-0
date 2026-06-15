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

export default function ExamesTab({ paciente, exames, onRefresh, showToast }: Props) {
  const supabase       = createClient()
  const fileRef        = useRef<HTMLInputElement>(null)
  const [adding,       setAdding]       = useState(false)
  const [file,         setFile]         = useState<File | null>(null)
  const [preview,      setPreview]      = useState<string | null>(null)
  const [extracting,   setExtracting]   = useState(false)
  const [localErr,     setLocalErr]     = useState<string | null>(null)
  const [expanded,     setExpanded]     = useState<string | null>(null)
  const [evoLoading,   setEvoLoading]   = useState(false)
  const [evoText,      setEvoText]      = useState<string | null>(null)

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

      setAdding(false); setFile(null); setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
      onRefresh()
      showToast('Exame extraído e salvo!')
    } catch (e: any) {
      setLocalErr(e.message)
    }
    setExtracting(false)
  }

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
        <button onClick={() => setAdding(a => !a)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
          {adding ? '✕ Cancelar' : '+ Adicionar Exame'}
        </button>
      </div>

      {/* Add exam form */}
      {adding && (
        <div className="border-2 border-dashed border-indigo-200 rounded-xl p-4 bg-indigo-50 space-y-3">
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
