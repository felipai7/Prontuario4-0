'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Exame, Paciente, ResultadoExame, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  exames: Exame[]
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

type AddMode = 'ia' | 'texto' | 'manual'
type ManualResultado = {
  nome: string; valor: string; unidade: string; referencia: string
  alterado: boolean; direcao: 'alto' | 'baixo' | 'normal' | 'qualitativo'
}
const emptyResultado = (): ManualResultado => ({
  nome: '', valor: '', unidade: '', referencia: '', alterado: false, direcao: 'normal'
})

// ── Name normalisation ────────────────────────────────────────────────────────
const ALIASES: Array<[RegExp, string]> = [
  // _Gasometria suffix — must come before generic aliases to take precedence
  [/^na[_\s]*gasometria.*$/i,              'Sódio (gaso.)'],
  [/^k[_\s]*gasometria.*$/i,               'Potássio (gaso.)'],
  [/^hct[_\s]*gasometria.*$/i,             'Hematócrito (gaso.)'],
  [/^be[_\s]*gasometria.*$/i,              'BE'],
  [/^o2sat[_\s]*gasometria.*$/i,           'SatO2 (%)'],
  [/^hco3[_\s]*gasometria.*$/i,            'HCO3'],
  [/^co2\s*total[_\s]*gasometria.*$/i,     'CO2 Total'],
  [/^glicose[_\s]*gasometria.*$/i,         'Glicose (gaso.)'],
  [/^gap\s*co2[_\s]*gasometria.*$/i,       'GAP CO2'],
  [/^lactato[_\s]*gasometria.*$/i,         'Lactato'],
  [/^ph[_\s]*gasometria.*$/i,              'pH'],
  [/^pco2[_\s]*gasometria.*$/i,            'PCO2'],
  [/^po2[_\s]*gasometria.*$/i,             'PO2'],
  // Hemograma
  [/^hematócrit[oa]?$|^hct$/i,                                 'Hematócrito'],
  [/^hemoglob[ia]n[ao]?s?$/i,                                  'Hemoglobina'],
  [/^hemácias?$/i,                                             'Hemácias'],
  [/^rdw(\s*[-–]?\s*(cv|sd))?(\s*%)?$/i,                      'RDW'],
  [/^vcm$|^volume\s+corpuscular\s+médio$|^v\.?c\.?m\.?$/i,    'VCM'],
  [/^hcm$|^hemoglobina\s+corpuscular\s+média$/i,               'HCM'],
  [/^chcm$|^concentração\s+de\s+hemoglob/i,                    'CHCM'],
  [/^segmentados?\s*(\(?\s*(%|abs)\s*\)?)?$/i,                 'Segmentados (%)'],
  [/^neutrófilos?\s+segmentados?(\s*\(abs\))?$/i,               'Segmentados (%)'],
  [/^bastonetes?\s*(\(?\s*(%|abs)\s*\)?)?$/i,                  'Bastonetes (%)'],
  [/^linfócitos?\s*(típicos?)?\s*(\(?\s*(%|abs)\s*\)?)?$/i,    'Linfócitos (%)'],
  [/^monócitos?\s*(\(?\s*(%|abs)\s*\)?)?$/i,                   'Monócitos (%)'],
  [/^eosinófilos?\s*(\(?\s*(%|abs)\s*\)?)?$/i,                 'Eosinófilos (%)'],
  [/^basófilos?\s*(\(?\s*(%|abs)\s*\)?)?$/i,                   'Basófilos (%)'],
  [/^linf[ao]?\.?\s*atí?picos?\s*(\(abs\))?$/i,               'Linfócitos Atípicos'],
  [/^neutr[oó]?\.?\s*totais?\s*(\(abs\))?$/i,                  'Neutrófilos Totais'],
  [/^blastos?\s*(\(%\)|\(abs\)|%)?$/i,                         'Blastos (%)'],
  [/^promielócitos?\s*(\(%\)|\(abs\)|%)?$/i,                   'Promielócitos (%)'],
  [/^mielócitos?\s*(\(%\)|\(abs\)|%)?$/i,                      'Mielócitos (%)'],
  [/^metamielócitos?\s*(\(%\)|\(abs\)|%)?$/i,                  'Metamielócitos (%)'],
  [/^plasmócitos?\s*(\(%\)|\(abs\)|%)?$/i,                     'Plasmócitos (%)'],
  [/^mpv$|^volume\s+plaquetário\s+médio$/i,                    'MPV'],
  [/^plaquetas?$/i,                                            'Plaquetas'],
  [/^leucócitos?(\s+totais?)?$/i,                              'Leucócitos'],
  // Eletrólitos
  [/^magnésio(\s+sérico)?$/i,                                  'Magnésio'],
  [/^na$|^sódio(\s+sérico)?$/i,                                'Sódio'],
  [/^k$|^potássio(\s+sérico)?$/i,                              'Potássio'],
  [/^fósforo(\s+sérico)?$/i,                                   'Fósforo'],
  // Renal
  [/^ur[eé]ia(\s+sérica)?$/i,                                  'Ureia'],
  [/^creatinin[ao]?(\s+sérica?)?$/i,                           'Creatinina'],
  [/^taxa\s+(de\s+)?filtração\s+glomerular(\s+\w+)?$|etfg$/i,  'TFG'],
  // Metabólico
  [/^glicose(\s+\(gasometria.*\))?$/i,                         'Glicose'],
  // Gasometria (contextual, no suffix)
  [/^be$|^base\s*excess$/i,                                    'BE'],
  [/^o2sat$|^sat(uração)?\s*(de\s+)?o\.?2\s*(%)?$/i,          'SatO2 (%)'],
  [/^hco3(\s*[\(/]bicarbonato\)?)?$|^bicarbonato(\s+padrão)?$/i, 'HCO3'],
  [/^gap\s+co2(\s*\(.+\))?$/i,                                 'GAP CO2'],
  // Inflamatório
  [/^proteína\s+c\s+reativa(\s*\(?pcr\)?)?$/i,                 'PCR'],
  // Coagulação
  [/^(rni|inr)$/i,                                              'INR/RNI'],
  // Abdome — hepático/pancreático/canalicular
  [/^tgo$|^ast$|^ast\s*[/]\s*tgo$/i,                          'TGO/AST'],
  [/^tgp$|^alt$|^alt\s*[/]\s*tgp$/i,                          'TGP/ALT'],
  [/^(dhl|ldh|desidrogenase\s+lática?)$/i,                     'LDH'],
  [/^gama[\s-]?gt$|^γ[\s-]?gt$/i,                              'Gama-GT'],
  [/^fosfatase\s+alcalina$/i,                                   'Fosfatase Alcalina'],
  // Cardíaco — CK, Troponina, BNP
  [/^ck[\s-]?mb(\s*[-–]?\s*(massa|atividade))?(\s*\(.*\))?$/i, 'CK-MB'],
  [/^(ck|cpk)(\s+total)?$|^creatino(fosfo)?quinase$/i,         'CK Total'],
  [/^troponin[ao]?\s*[IiTt]?(\s*\(.*\))?$/i,                  'Troponina'],
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
  {
    label: '🩸 Hemograma',
    // Exclude (gaso.) suffix so HCT/Hematócrito from gasometry goes to Gasometria
    test: n => /hemácia|hemoglob|hematócrit(?!\s*\(gaso)|vcm|hcm|chcm|rdw|plaqueta|leucócit|neutrófi|segmentad|bastonet|linfócit|monócit|eosinófi|basófi|metamielo|mielócit|promielócit|blastos|plasmócit|mpv/i.test(n),
  },
  {
    label: '⚡ Eletrólitos',
    // Includes (gaso.) variants for Na and K
    test: n => /^sódio(\s*\(gaso\.\))?$|^potássio(\s*\(gaso\.\))?$|^cálcio|^magnésio$|^fósforo$|^cloro$/i.test(n),
  },
  {
    label: '🍬 Metabólico',
    // ^glicose$ excludes 'Glicose (gaso.)' which goes to Gasometria
    test: n => /^glicose$|hba1c|insulina/i.test(n),
  },
  { label: '🫘 Renal',          test: n => /^ureia$|creatinin|^tfg$|filtração|ácido úrico/i.test(n) },
  { label: '🧪 Inflamatório',   test: n => /^pcr$|procalcitonin|ferritin|\bvhs\b/i.test(n) },
  { label: '🩻 Coagulação',     test: n => /tap\b|inr|rni|ttpa|fibrinogên|d[\s-]?dímero/i.test(n) },
  {
    label: '🏥 Abdome',
    test: n => /tgo|tgp|fosfatase|ggt|bilirrubina|ldh|amilase|lipase|albumina|proteínas totais/i.test(n),
  },
  {
    label: '🫀 Cardíaco',
    test: n => /troponin|\bbnp\b|^ck total$|^ck-mb$/i.test(n),
  },
  {
    label: '💨 Gasometria',
    // Also catches (gaso.) suffix for Glicose (gaso.), Hematócrito (gaso.) etc.
    test: n => /\bph\b|po2|pco2|hco3|\bbe\b|sato2|lactato|\bco2\b|gap co2|gaso\./i.test(n),
  },
  { label: '⚗️ Hormônios',      test: n => /^tsh$|^t4l?$|^t3$|cortisol/i.test(n) },
  { label: '🦠 Microbiologia',  test: n => /swab|cultura|urocultura|hemocultura|micror?organism|bactéria\s+isolada|contagem\s+(de\s+)?col[oô]n|antibiograma|amicacina|amoxicil|ampicil|sulbactam|aztreonam|cefalexin|cefepim|cefotaxim|cefoxitin|ceftazidim|cefurox|ceftriaxon|ciprofloxacin|cloranfenic|ertapenem|gentamicin|imipenem|levofloxacin|linezolid|meropenem|piperacilin|pip.*tazo|polimixin|tigeciclina|tobramicin|trimetoprim|trimet.*sulfa|sulfa.*trimet|vancomicin|colistin|fosfomicin/i.test(n) },
  { label: '🔬 EAS/Urina',      test: n => /^cor$|^aspecto$|densidade|cetonas|^nitrito$|urobilinogênio|células\s+epiteliais|células\s+trans|células\s+tubulares|escamosas|cilindros|cristais|bacteriúria|^muco$|leveduras|^proteínas$|\(química\)|\(microscopia\)|\(sedimento\)|\(urin/i.test(n) },
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
  const [rawText,    setRawText]    = useState('')
  const [pastedImgs, setPastedImgs] = useState<{ base64: string; mediaType: string; preview: string }[]>([])

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

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editExame,  setEditExame]  = useState<{ id: string; tipo: string; data: string; obs: string } | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  const handleDeleteExame = async (id: string) => {
    if (!confirm('Excluir este exame? Esta ação não pode ser desfeita.')) return
    setDeletingId(id)
    const { error } = await supabase.from('exames').delete().eq('id', id)
    setDeletingId(null)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Exame removido'); onRefresh()
  }

  const handleSaveEditExame = async () => {
    if (!editExame) return
    setEditSaving(true)
    const { error } = await supabase.from('exames').update({
      tipo_exame: editExame.tipo.trim(),
      data_exame: editExame.data.trim() || null,
      observacoes: editExame.obs.trim() || null,
    }).eq('id', editExame.id)
    setEditSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Exame atualizado')
    setEditExame(null); onRefresh()
  }

  const CRITICO_RE = /klebsiella|acinetobacter|pseudomonas|enterococcus|staphylococcus|candida|clostridioides|clostridium difficile|mrsa|esbl|kpc|vre|cre/i
  const MICRO_EXAM_RE = /cultura|swab|microbiologia|antibiograma|urocultura|hemocultura/i
  let germeAlert: null | { tipo: 'critico' | 'identificado'; nome: string; exame: string } = null
  for (const ex of exames) {
    if (!MICRO_EXAM_RE.test(ex.tipo_exame)) continue
    for (const r of (ex.resultados || [])) {
      if (r.alterado) {
        if (CRITICO_RE.test(r.valor) || CRITICO_RE.test(r.nome)) {
          germeAlert = { tipo: 'critico', nome: r.valor, exame: ex.tipo_exame }; break
        }
        if (/identificação|bactéria\s+isolada|germe|organismo/i.test(r.nome)) {
          germeAlert = germeAlert ?? { tipo: 'identificado', nome: r.valor, exame: ex.tipo_exame }
        }
      }
    }
    if (germeAlert?.tipo === 'critico') break
  }

  // ── Clipboard paste (image) ───────────────────────────────────────────────
  const handleGlobalPaste = useCallback((e: ClipboardEvent) => {
    if (!adding) return
    const items = Array.from(e.clipboardData?.items ?? [])
    const imgItem = items.find(i => i.type.startsWith('image/'))
    if (!imgItem) return
    e.preventDefault()
    const blob = imgItem.getAsFile()
    if (!blob) return
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      const [header, b64] = dataUrl.split(',')
      const mt = header.match(/data:([^;]+)/)?.[1] ?? 'image/png'
      setPastedImgs(prev => [...prev, { base64: b64, mediaType: mt, preview: dataUrl }])
      setAddMode('ia')
      setFile(null); setPreview(null)
      setLocalErr(null)
    }
    reader.readAsDataURL(blob)
  }, [adding])

  useEffect(() => {
    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [handleGlobalPaste])

  const handleExtractPasted = async () => {
    if (!pastedImgs.length) return
    setExtracting(true); setLocalErr(null)
    try {
      const resp = await fetch('/api/extract-exam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: pastedImgs.map(i => ({ base64: i.base64, mediaType: i.mediaType })) }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)
      await supabase.from('exames').insert({
        paciente_id: paciente.id, tipo_exame: data.tipo_exame,
        data_exame: data.data_exame, resultados: data.resultados,
        observacoes: data.observacoes, raw_text: data.raw_text, nome_arquivo: 'print-colado',
      })
      resetAdding(); onRefresh(); showToast('Exame extraído e salvo!')
    } catch (e: any) { setLocalErr(e.message) }
    setExtracting(false)
  }

  const handleExtractText = async () => {
    if (!rawText.trim()) { setLocalErr('Cole o texto do laudo no campo acima'); return }
    setExtracting(true); setLocalErr(null)
    try {
      const resp = await fetch('/api/extract-exam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: rawText.trim() }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)
      await supabase.from('exames').insert({
        paciente_id: paciente.id, tipo_exame: data.tipo_exame,
        data_exame: data.data_exame, resultados: data.resultados,
        observacoes: data.observacoes, raw_text: data.raw_text, nome_arquivo: null,
      })
      resetAdding(); onRefresh(); showToast('Exame extraído e salvo!')
    } catch (e: any) { setLocalErr(e.message) }
    setExtracting(false)
  }

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
    setPastedImgs([]); setRawText('')
    if (fileRef.current) fileRef.current.value = ''
    setMTipo(''); setMData(''); setMObs(''); setMRows([emptyResultado()])
  }

  const updateRow = (i: number, p: Partial<ManualResultado>) =>
    setMRows(rows => rows.map((r, idx) => idx === i ? { ...r, ...p } : r))

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">Exames ({exames.length})</h3>
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
              className={`flex-1 py-2 text-xs font-semibold transition-colors ${addMode === 'ia' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}>
              📁 PDF / Imagem
            </button>
            <button onClick={() => { setAddMode('texto'); setLocalErr(null) }}
              className={`flex-1 py-2 text-xs font-semibold transition-colors ${addMode === 'texto' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}>
              📋 Colar texto
            </button>
            <button onClick={() => { setAddMode('manual'); setLocalErr(null) }}
              className={`flex-1 py-2 text-xs font-semibold transition-colors ${addMode === 'manual' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}>
              ✏️ Manual
            </button>
          </div>

          {addMode === 'ia' && (
            <>
              {/* Clipboard paste hint */}
              {pastedImgs.length === 0 && !file && (
                <div className="flex items-center gap-2 rounded-lg bg-indigo-100 border border-indigo-200 px-3 py-2 text-xs text-indigo-700">
                  <span className="text-base">💡</span>
                  <span>Cole prints com <kbd className="bg-white border border-indigo-200 rounded px-1 py-0.5 font-mono">Ctrl+V</kbd> — pode colar quantos precisar antes de extrair</span>
                </div>
              )}

              {/* Pasted images grid */}
              {pastedImgs.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-indigo-700">
                      📋 {pastedImgs.length} print{pastedImgs.length > 1 ? 's' : ''} colado{pastedImgs.length > 1 ? 's' : ''} — cole mais com <kbd className="bg-indigo-50 border border-indigo-200 rounded px-1 font-mono">Ctrl+V</kbd>
                    </p>
                    <button onClick={() => setPastedImgs([])}
                      className="text-xs text-red-400 hover:text-red-600">Limpar tudo</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {pastedImgs.map((img, idx) => (
                      <div key={idx} className="relative">
                        <img src={img.preview} alt={`print ${idx + 1}`} className="w-full h-28 rounded-lg border object-contain bg-slate-50"/>
                        <button onClick={() => setPastedImgs(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute top-1 right-1 bg-white/90 hover:bg-white text-slate-500 hover:text-red-600 rounded-full w-5 h-5 flex items-center justify-center text-xs border border-slate-200 shadow-sm">✕</button>
                        <span className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded">{idx + 1}</span>
                      </div>
                    ))}
                  </div>
                  {localErr && <p className="text-red-600 text-sm">❌ {localErr}</p>}
                  <button onClick={handleExtractPasted} disabled={extracting}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
                    {extracting ? `⏳ Extraindo ${pastedImgs.length} imagens com IA...` : `🤖 Extrair ${pastedImgs.length} print${pastedImgs.length > 1 ? 's' : ''} e Salvar`}
                  </button>
                </div>
              )}

              {/* File picker */}
              {pastedImgs.length === 0 && (
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
            </>
          )}

          {addMode === 'texto' && (
            <>
              <div className="bg-indigo-100 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700 flex items-start gap-2">
                <span className="text-base mt-0.5">💡</span>
                <span>Abra o resultado no site do laboratório ou em qualquer PDF, pressione <kbd className="bg-white border border-indigo-200 rounded px-1 py-0.5 font-mono">Ctrl+A</kbd> para selecionar tudo e <kbd className="bg-white border border-indigo-200 rounded px-1 py-0.5 font-mono">Ctrl+C</kbd> para copiar. Cole abaixo.</span>
              </div>
              <textarea
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder="Cole aqui o texto completo do resultado laboratorial..."
                rows={8}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono"
              />
              {localErr && <p className="text-red-600 text-sm">❌ {localErr}</p>}
              <button onClick={handleExtractText} disabled={extracting || !rawText.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
                {extracting ? '⏳ Extraindo com IA...' : '🤖 Extrair e Salvar'}
              </button>
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

      {germeAlert && (
        <div className={`rounded-lg px-4 py-2.5 text-sm font-semibold flex items-start gap-2 ${
          germeAlert.tipo === 'critico'
            ? 'bg-red-100 border border-red-400 text-red-800'
            : 'bg-orange-50 border border-orange-300 text-orange-800'
        }`}>
          <span className="text-lg">{germeAlert.tipo === 'critico' ? '🚨' : '🦠'}</span>
          <div>
            <p className="font-bold">{germeAlert.tipo === 'critico' ? 'Germe crítico / MDR identificado' : 'Germe identificado'}</p>
            <p className="font-normal text-xs mt-0.5">{germeAlert.nome} — {germeAlert.exame}</p>
          </div>
        </div>
      )}

      {exames.length === 0 && !adding && (
        <p className="text-slate-400 text-sm italic text-center py-8">Nenhum exame registrado</p>
      )}

      {/* Pivot table */}
      {comRes.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
          <table className="min-w-max w-full text-xs border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-100 px-3 py-2.5 text-left font-bold text-slate-700 border-b-2 border-r-2 border-slate-300 min-w-[170px]">
                  Parâmetro
                </th>
                {comRes.map((ex, idx) => {
                  const parts = ex.data_exame?.split(' ')
                  const datePart = parts?.[0] ?? null
                  const timePart = parts?.[1] ?? null
                  return (
                    <th key={ex.id} className="px-2 py-2 text-center bg-slate-100 border-b-2 border-r border-slate-200 font-semibold min-w-[80px] whitespace-nowrap">
                      <p className="text-slate-700 font-semibold text-xs leading-tight">{datePart ?? `Exame ${idx + 1}`}</p>
                      {timePart && <p className="text-slate-400 font-normal text-xs mt-0.5">{timePart}</p>}
                      <div className="flex justify-center gap-1 mt-1">
                        <button onClick={() => setEditExame({ id: ex.id, tipo: ex.tipo_exame, data: ex.data_exame ?? '', obs: ex.observacoes ?? '' })}
                          title="Editar" className="text-indigo-300 hover:text-indigo-600 text-xs px-1">✏️</button>
                        <button onClick={() => handleDeleteExame(ex.id)} disabled={deletingId === ex.id}
                          title="Excluir" className="text-red-200 hover:text-red-500 text-xs px-1">
                          {deletingId === ex.id ? '⏳' : '✕'}
                        </button>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rowIdx) => {
                if (row.kind === 'header') {
                  return (
                    <tr key={`hdr-${row.label}`}>
                      <td colSpan={comRes.length + 1}
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
                    <td className={`sticky left-0 z-10 px-3 py-2 font-medium border-r-2 border-b border-slate-200 whitespace-nowrap ${hasAlt ? 'text-red-700' : 'text-slate-700'}`}
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
              <div className="flex items-center justify-between mb-1 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-slate-800 text-sm truncate">{ex.tipo_exame}</span>
                  {ex.data_exame && <span className="text-slate-400 text-xs flex-shrink-0">{ex.data_exame}</span>}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => setEditExame({ id: ex.id, tipo: ex.tipo_exame, data: ex.data_exame ?? '', obs: ex.observacoes ?? '' })}
                    className="text-xs text-indigo-400 hover:text-indigo-700 border border-indigo-100 hover:border-indigo-300 px-2 py-0.5 rounded-lg transition-colors">
                    ✏️ Editar
                  </button>
                  <button onClick={() => handleDeleteExame(ex.id)} disabled={deletingId === ex.id}
                    className="text-xs text-red-400 hover:text-red-700 border border-red-100 hover:border-red-300 px-2 py-0.5 rounded-lg transition-colors">
                    {deletingId === ex.id ? '⏳' : '🗑️ Excluir'}
                  </button>
                </div>
              </div>
              {ex.raw_text && <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono mt-2">{ex.raw_text}</pre>}
              {ex.observacoes && <p className="text-xs text-slate-500 italic mt-2">💬 {ex.observacoes}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Edit exam modal */}
      {editExame && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setEditExame(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-bold text-slate-800">✏️ Editar exame</p>
              <button onClick={() => setEditExame(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Tipo de exame</label>
              <input value={editExame.tipo} onChange={e => setEditExame(x => x && ({...x, tipo: e.target.value}))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Data do exame</label>
              <input value={editExame.data} onChange={e => setEditExame(x => x && ({...x, data: e.target.value}))}
                placeholder="DD/MM/AAAA ou DD/MM/AAAA HH:MM"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Observações</label>
              <textarea value={editExame.obs} onChange={e => setEditExame(x => x && ({...x, obs: e.target.value}))}
                rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditExame(null)} className="flex-1 border border-slate-300 text-slate-600 text-sm font-semibold py-2 rounded-lg hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleSaveEditExame} disabled={editSaving}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg">
                {editSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
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
