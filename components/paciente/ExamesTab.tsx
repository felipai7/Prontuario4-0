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

// ── Name normalisation (reduces duplicates across extractions) ────────────────
const ALIASES: Array<[RegExp, string]> = [
  // Hemograma – normalise case/accentuation variations
  [/^hematócrit[oa]?$/i,                                       'Hematócrito'],
  [/^hemoglob[ia]n[ao]?s?$/i,                                  'Hemoglobina'],
  [/^hemácias?$/i,                                             'Hemácias'],
  [/^rdw(\s*[-–]?\s*(cv|sd))?(\s*%)?$/i,                      'RDW'],
  [/^vcm$|^volume\s+corpuscular\s+médio$|^v\.?c\.?m\.?$/i,    'VCM'],
  [/^hcm$|^hemoglobina\s+corpuscular\s+média$/i,               'HCM'],
  [/^chcm$|^concentração\s+de\s+hemoglob/i,                    'CHCM'],
  [/^segmentados?\s*(\(?\s*%\s*\)?)?$/i,                       'Segmentados (%)'],
  [/^neutrófilos?\s+segmentados?$/i,                            'Segmentados (%)'],
  [/^bastonetes?\s*(\(?\s*%\s*\)?)?$/i,                        'Bastonetes (%)'],
  [/^linfócitos?\s*(típicos?)?\s*(\(?\s*%\s*\)?)?$/i,          'Linfócitos (%)'],
  [/^monócitos?\s*(\(?\s*%\s*\)?)?$/i,                         'Monócitos (%)'],
  [/^eosinófilos?\s*(\(?\s*%\s*\)?)?$/i,                       'Eosinófilos (%)'],
  [/^basófilos?\s*(\(?\s*%\s*\)?)?$/i,                         'Basófilos (%)'],
  [/^linf[ao]?\.?\s*atípicos?$/i,                              'Linfócitos Atípicos'],
  [/^neutr[oó]?\.?\s*totais?$/i,                               'Neutrófilos Totais'],
  [/^blastos?(\s*%)?$/i,                                       'Blastos (%)'],
  [/^promielócitos?(\s*%)?$/i,                                  'Promielócitos (%)'],
  [/^mielócitos?(\s*%)?$/i,                                    'Mielócitos (%)'],
  [/^metamielócitos?(\s*%)?$/i,                                 'Metamielócitos (%)'],
  [/^plasmócitos?(\s*%)?$/i,                                   'Plasmócitos (%)'],
  [/^mpv$|^volume\s+plaquetário\s+médio$/i,                    'MPV'],
  [/^plaquetas?$/i,                                            'Plaquetas'],
  [/^leucócitos?(\s+totais?)?$/i,                              'Leucócitos'],
  // Eletrólitos
  [/^magnésio(\s+sérico)?$/i,                                  'Magnésio'],
  [/^sódio(\s+sérico)?$/i,                                     'Sódio'],
  [/^potássio(\s+sérico)?$/i,                                  'Potássio'],
  [/^fósforo(\s+sérico)?$/i,                                   'Fósforo'],
  // Renal
  [/^ur[eé]ia(\s+sérica)?$/i,                                  'Ureia'],
  [/^creatinin[ao]?(\s+sérica?)?$/i,                           'Creatinina'],
  [/^taxa\s+(de\s+)?filtração\s+glomerular(\s+\w+)?$/i,        'TFG'],
  // Gasometria – parametros medidos no aparelho junto com gases
  [/^na\s*\(gasometria.*\)$/i,                                 'Na (Gasometria)'],
  [/^k\s*\(gasometria.*\)$/i,                                  'K (Gasometria)'],
  [/^glicose\s*\(gasometria.*\)$/i,                            'Glicose (Gasometria)'],
  [/^hct\s*\(gasometria.*\)$/i,                                'Htc (Gasometria)'],
  [/^be$|^base\s*excess$/i,                                    'BE'],
  [/^o2sat$|^sat(uração)?\s*(de\s+)?o\.?2\s*(%)?$/i,          'SatO2 (%)'],
  [/^hco3(\s*[\(/]bicarbonato\)?)?$|^bicarbonato(\s+padrão)?$/i, 'HCO3'],
  [/^gap\s+co2(\s*\(.+\))?$/i,                                 'GAP CO2'],
  // Inflamatório
  [/^proteína\s+c\s+reativa$/i,                                'PCR'],
  // Coagulação
  [/^(rni|inr)$/i,                                              'INR/RNI'],
  // Enzimas/Hepático
  [/^tgo$|^ast$|^ast\s*[/]\s*tgo$/i,                          'TGO/AST'],
  [/^tgp$|^alt$|^alt\s*[/]\s*tgp$/i,                          'TGP/ALT'],
  [/^(dhl|ldh|desidrogenase\s+lática?)$/i,                     'LDH'],
  [/^ck[\s-]?mb(\s*[\(/]?\s*atividade\s*\)?)?$/i,              'CK-MB'],
  [/^(ck|cpk)(\s+total)?$/i,                                   'CK Total'],
  [/^gama[\s-]?gt$|^γ[\s-]?gt$/i,                              'Gama-GT'],
  [/^fosfatase\s+alcalina$/i,                                   'Fosfatase Alcalina'],
  // Cardíaco
  [/^(pro[\s-]?)?bnp$/i,                                       'BNP'],
]

function canonicalize(name: string): string {
  const trimmed = name.trim()
  for (const [pattern, canonical] of ALIASES) {
    if (pattern.test(trimmed)) return canonical
  }
  return trimmed
}

// ── Category grouping ─────────────────────────────────────────────────────────
type Category = { label: string; test: (n: string) => boolean }

const CATEGORIES: Category[] = [
  { label: '🩸 Hemograma',       test: n => /hemácia|hemoglob|hematócrit|vcm|hcm|chcm|rdw|plaqueta|leucócit|neutrófi|segmentad|bastonet|linfócit|monócit|eosinófi|basófi|metamielo|mielócit|promielócit|blastos|plasmócit|mpv/i.test(n) },
  { label: '⚡ Eletrólitos',     test: n => /^sódio$|^potássio$|^cálcio|^magnésio$|^fósforo$|^cloro$/i.test(n) },
  { label: '🫘 Renal',           test: n => /^ureia$|creatinin|^tfg$|filtração|ácido úrico/i.test(n) },
  { label: '🧪 Inflamatório',   test: n => /^pcr$|procalcitonin|ferritin|\bvhs\b/i.test(n) },
  { label: '🩻 Coagulação',     test: n => /tap\b|inr|rni|ttpa|fibrinogên|d[\s-]?dímero/i.test(n) },
  { label: '🫀 Enzimas/Hepático', test: n => /tgo|tgp|fosfatase|ggt|bilirrubina|ldh|amilase|lipase|albumina|proteínas totais/i.test(n) },
  { label: '🫀 Cardíaco',       test: n => /troponin|ck[\s-]?(mb|total)|cpk|\bbnp\b/i.test(n) },
  { label: '💨 Gasometria',     test: n => /\bph\b|po2|pco2|hco3|\bbe\b|sato2|lactato|\bco2\b|gap co2|\(gasometria\)/i.test(n) },
  { label: '⚗️ Hormônios',      test: n => /^tsh$|^t4l?$|^t3$|cortisol/i.test(n) },
]

function getCategoryLabel(name: string): string {
  for (const cat of CATEGORIES) {
    if (cat.test(name)) return cat.label
  }
  return '📋 Outros'
}

// ── Pivot table helpers ───────────────────────────────────────────────────────
type TableRow = { kind: 'header'; label: string } | { kind: 'param'; name: string }

function buildTableRows(allParams: string[]): TableRow[] {
  const groupMap = new Map<string, string[]>()
  for (const p of allParams) {
    const cat = getCategoryLabel(p)
    if (!groupMap.has(cat)) groupMap.set(cat, [])
    groupMap.get(cat)!.push(p)
  }
  const rows: TableRow[] = []
  for (const cat of CATEGORIES) {
    const params = groupMap.get(cat.label)
    if (params?.length) {
      rows.push({ kind: 'header', label: cat.label })
      params.forEach(p => rows.push({ kind: 'param', name: p }))
    }
  }
  const outros = groupMap.get('📋 Outros')
  if (outros?.length) {
    rows.push({ kind: 'header', label: '📋 Outros' })
    outros.forEach(p => rows.push({ kind: 'param', name: p }))
  }
  return rows
}

function parseExameDate(ex: Exame): number {
  if (ex.data_exame) {
    const [d, m, y] = ex.data_exame.split('/')
    const ts = new Date(`${y}-${m}-${d}`).getTime()
    if (!isNaN(ts)) return ts
  }
  return new Date(ex.created_at).getTime()
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ExamesTab({ paciente, exames, onRefresh, showToast }: Props) {
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)

  const [adding,     setAdding]     = useState(false)
  const [addMode,    setAddMode]    = useState<AddMode>('ia')
  const [file,       setFile]       = useState<File | null>(null)
  const [preview,    setPreview]    = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [localErr,   setLocalErr]   = useState<string | null>(null)
  const [mTipo,      setMTipo]      = useState('')
  const [mData,      setMData]      = useState('')
  const [mObs,       setMObs]       = useState('')
  const [mRows,      setMRows]      = useState<ManualResultado[]>([emptyResultado()])
  const [savingM,    setSavingM]    = useState(false)
  const [evoLoading, setEvoLoading] = useState(false)
  const [evoText,    setEvoText]    = useState<string | null>(null)

  // ── Pivot table data ─────────────────────────────────────────────────────
  const sorted  = [...exames].sort((a, b) => parseExameDate(a) - parseExameDate(b))
  const comRes  = sorted.filter(ex => ex.resultados && ex.resultados.length > 0)
  const semRes  = sorted.filter(ex => !ex.resultados || ex.resultados.length === 0)

  // Deduplicated canonical params (first-seen order)
  const allParams: string[] = []
  const seenCanonical = new Set<string>()
  comRes.forEach(ex => {
    (ex.resultados || []).forEach(r => {
      const c = canonicalize(r.nome)
      if (!seenCanonical.has(c)) { seenCanonical.add(c); allParams.push(c) }
    })
  })

  // Lookup by canonical name
  const lookup = new Map<string, Map<string, ResultadoExame>>()
  comRes.forEach(ex => {
    const m = new Map<string, ResultadoExame>()
    ;(ex.resultados || []).forEach(r => m.set(canonicalize(r.nome), r))
    lookup.set(ex.id, m)
  })

  const tableRows = buildTableRows(allParams)
  const totalAlt = exames.reduce((s, ex) => s + (ex.resultados?.filter(r => r.alterado).length ?? 0), 0)

  // ── Handlers ─────────────────────────────────────────────────────────────
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: b64, mediaType: file.type }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)
      await supabase.from('exames').insert({
        paciente_id: paciente.id, tipo_exame: data.tipo_exame,
        data_exame: data.data_exame, resultados: data.resultados,
        observacoes: data.observacoes, raw_text: data.raw_text, nome_arquivo: file.name,
      })
      resetAdding(); onRefresh(); showToast('Exame extraído e salvo!')
    } catch (e: any) { setLocalErr(e.message) }
    setExtracting(false)
  }

  const handleManualSave = async () => {
    if (!mTipo.trim()) { setLocalErr('Informe o tipo de exame'); return }
    setSavingM(true); setLocalErr(null)
    const resultados: ResultadoExame[] = mRows
      .filter(r => r.nome.trim() && r.valor.trim())
      .map(r => ({
        nome: r.nome.trim(), valor: r.valor.trim(),
        unidade: r.unidade.trim() || null, referencia: r.referencia.trim() || null,
        alterado: r.alterado, direcao: r.direcao,
      }))
    let dataFmt: string | null = null
    if (mData) { const [y, m, d] = mData.split('-'); dataFmt = `${d}/${m}/${y}` }
    await supabase.from('exames').insert({
      paciente_id: paciente.id, tipo_exame: mTipo.trim(), data_exame: dataFmt,
      resultados: resultados.length > 0 ? resultados : null,
      observacoes: mObs.trim() || null, raw_text: null, nome_arquivo: null,
    })
    resetAdding(); onRefresh(); showToast('Exame salvo!'); setSavingM(false)
  }

  const resetAdding = () => {
    setAdding(false); setAddMode('ia'); setFile(null); setPreview(null); setLocalErr(null)
    if (fileRef.current) fileRef.current.value = ''
    setMTipo(''); setMData(''); setMObs(''); setMRows([emptyResultado()])
  }

  const updateRow = (i: number, p: Partial<ManualResultado>) =>
    setMRows(rows => rows.map((r, idx) => idx === i ? { ...r, ...p } : r))

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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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

  // ── Render ───────────────────────────────────────────────────────────────
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
        <button onClick={() => adding ? resetAdding() : setAdding(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
          {adding ? '✕ Cancelar' : '+ Adicionar Exame'}
        </button>
      </div>

      {/* Add exam panel */}
      {adding && (
        <div className="border-2 border-dashed border-indigo-200 rounded-xl p-4 bg-indigo-50 space-y-3">
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

          {addMode === 'ia' && (
            <>
              <input ref={fileRef} type="file" id="exam-file" accept=".pdf,image/*" onChange={handleFile} className="hidden"/>
              <label htmlFor="exam-file"
                className="flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed border-indigo-300 rounded-lg cursor-pointer hover:border-indigo-500 hover:bg-white text-sm text-indigo-600 font-medium transition-all">
                📁 {file ? file.name : 'Selecionar PDF ou Imagem'}
              </label>
              {preview && preview !== '[PDF]' && <img src={preview} alt="preview" className="max-h-40 mx-auto rounded-lg border object-contain"/>}
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

          {addMode === 'manual' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Tipo de exame *</label>
                  <input value={mTipo} onChange={e => setMTipo(e.target.value)} placeholder="ex: Hemograma"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"/>
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Data do exame</label>
                  <input type="date" value={mData} onChange={e => setMData(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"/>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-500 font-medium">Resultados</label>
                  <button onClick={() => setMRows(r => [...r, emptyResultado()])}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold">+ Linha</button>
                </div>
                <div className="space-y-2">
                  {mRows.map((row, i) => (
                    <div key={i} className="bg-white border border-slate-200 rounded-lg p-2 space-y-2">
                      <div className="grid grid-cols-3 gap-1.5">
                        <input value={row.nome} onChange={e => updateRow(i, { nome: e.target.value })} placeholder="Parâmetro"
                          className="border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"/>
                        <input value={row.valor} onChange={e => updateRow(i, { valor: e.target.value })} placeholder="Valor"
                          className="border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"/>
                        <input value={row.unidade} onChange={e => updateRow(i, { unidade: e.target.value })} placeholder="Unidade"
                          className="border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"/>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input value={row.referencia} onChange={e => updateRow(i, { referencia: e.target.value })} placeholder="Referência"
                          className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"/>
                        <label className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap cursor-pointer">
                          <input type="checkbox" checked={row.alterado} onChange={e => updateRow(i, { alterado: e.target.checked })} className="rounded"/>
                          Alt.
                        </label>
                        {row.alterado && (
                          <select value={row.direcao} onChange={e => updateRow(i, { direcao: e.target.value as ManualResultado['direcao'] })}
                            className="border border-slate-200 rounded px-1.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400">
                            <option value="alto">↑ Alto</option>
                            <option value="baixo">↓ Baixo</option>
                            <option value="qualitativo">! Qualit.</option>
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

      {totalAlt > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-amber-800 text-sm font-medium">
          ⚠️ {totalAlt} resultado{totalAlt > 1 ? 's' : ''} alterado{totalAlt > 1 ? 's' : ''}
        </div>
      )}

      {exames.length === 0 && !adding && (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhum exame registrado</p>
      )}

      {/* ── Pivot table ── */}
      {comRes.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
          <table className="min-w-max w-full text-xs border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-100 px-3 py-2.5 text-left font-bold text-slate-700 border-b-2 border-r-2 border-slate-300 min-w-[170px]">
                  Parâmetro
                </th>
                {comRes.map((ex, idx) => (
                  <th key={ex.id} className="px-2 py-2 text-center bg-slate-100 border-b-2 border-r border-slate-200 font-semibold min-w-[70px] whitespace-nowrap">
                    <p className="text-slate-500 font-normal text-xs leading-tight">{ex.data_exame ?? `Exame ${idx + 1}`}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rowIdx) => {
                if (row.kind === 'header') {
                  return (
                    <tr key={`hdr-${row.label}`}>
                      <td
                        colSpan={comRes.length + 1}
                        className="sticky left-0 z-10 px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 border-b border-t border-indigo-100">
                        {row.label}
                      </td>
                    </tr>
                  )
                }

                const paramName = row.name
                const hasAlt = comRes.some(ex => lookup.get(ex.id)?.get(paramName)?.alterado)
                const rowBg = rowIdx % 2 === 0 ? '#ffffff' : '#f8fafc'

                return (
                  <tr key={`p-${paramName}`}>
                    <td
                      className={`sticky left-0 z-10 px-3 py-2 font-medium border-r-2 border-b border-slate-200 whitespace-nowrap ${hasAlt ? 'text-red-700' : 'text-slate-700'}`}
                      style={{ background: rowBg }}>
                      {paramName}
                    </td>
                    {comRes.map(ex => {
                      const r = lookup.get(ex.id)?.get(paramName)
                      return <PivotCell key={ex.id} r={r} rowBg={rowBg} />
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Raw-text exams */}
      {semRes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Exames sem estruturação</p>
          {semRes.map(ex => (
            <div key={ex.id} className="border border-slate-200 rounded-xl p-3 bg-slate-50">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-slate-800 text-sm">{ex.tipo_exame}</span>
                {ex.data_exame && <span className="text-slate-400 text-xs">{ex.data_exame}</span>}
              </div>
              {ex.raw_text && <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono mt-2">{ex.raw_text}</pre>}
              {ex.observacoes && <p className="text-xs text-slate-500 italic mt-2">💬 {ex.observacoes}</p>}
            </div>
          ))}
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

function PivotCell({ r, rowBg }: { r: ResultadoExame | undefined; rowBg: string }) {
  if (!r) return (
    <td className="px-2 py-2 text-center text-slate-200 border-r border-b border-slate-100 text-xs"
      style={{ background: rowBg }}>—</td>
  )
  const cls =
    r.alterado && r.direcao === 'alto'  ? 'bg-red-50 text-red-700' :
    r.alterado && r.direcao === 'baixo' ? 'bg-sky-50 text-sky-700' :
    r.alterado                          ? 'bg-amber-50 text-amber-700' :
                                          'text-slate-600'
  const arrow = r.direcao === 'alto' ? ' ↑' : r.direcao === 'baixo' ? ' ↓' : r.alterado ? ' !' : ''
  return (
    <td className={`px-2 py-2 text-center border-r border-b border-slate-100 whitespace-nowrap text-xs ${cls}`}
      title={r.referencia ? `Ref: ${r.referencia}` : undefined}>
      <span className="font-semibold">{r.valor}</span>
      {r.unidade && <span className="ml-0.5 opacity-60">{r.unidade}</span>}
      {arrow && <span className="font-black">{arrow}</span>}
    </td>
  )
}
