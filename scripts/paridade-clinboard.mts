#!/usr/bin/env node
// =============================================================================
// paridade-clinboard.mts — F9. Roda o extrator NOVO e o clinBoard sobre o mesmo
// corpus real e classifica TODA divergência.
//
// A comparação é ponta a ponta: cada sistema com a sua própria camada de texto,
// porque é assim que o usuário os experimenta. A diferença de texto puro já foi
// medida na F2 (486 linhas, todas de espaçamento, zero de conteúdo).
//
// Três categorias, e nenhuma divergência fica sem uma:
//   correcaoIntencional  — o novo mudou de propósito, com motivo registrado
//   regressao            — o clinBoard extrai e o novo não. CORRIGIR ANTES DE
//                          SEGUIR: é perda de dado clínico, não melhoria
//   diferencaDeForma     — mesmo conteúdo clínico, representação diferente
//   naoClassificada      — exige olho humano
//
//   FIXTURES_EXAMES=~/clinboard/fixtures CLINBOARD_HTML=~/clinboard/clinboard.html \
//   npx tsx scripts/paridade-clinboard.mts
//
// Saída: RELATORIO-PARIDADE.md na raiz. Nunca entra no CI (depende do corpus).
// =============================================================================
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { extrairExames } from '../lib/exames/extracao'

const require_ = createRequire(import.meta.url)
const expandir = (p: string) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p)

const FIXTURES = expandir(process.env.FIXTURES_EXAMES ?? '')
const CLINBOARD = expandir(process.env.CLINBOARD_HTML ?? '')
if (!FIXTURES || !existsSync(FIXTURES) || !CLINBOARD || !existsSync(CLINBOARD)) {
  console.error('FIXTURES_EXAMES e CLINBOARD_HTML são obrigatórias. Veja o cabeçalho.')
  process.exit(2)
}

function carregarDoador() {
  const h = readFileSync(CLINBOARD, 'utf8').split('\n')
  const ini = h.findIndex(l => l.includes('async function extractPDFText(file)'))
  const fimMarca = h.findIndex((l, i) => i > ini && l.includes('function getCultureType('))
  let fim = -1
  for (let i = fimMarca + 1; i < h.length; i++) if (h[i] === '}') { fim = i; break }
  const fabrica = new Function('pdfjsLib', 'toast', `
    ${h.slice(ini, fim + 1).join('\n')}
    return { extractPDFText, parsePDFText, LabRegistry };
  `)
  return fabrica(require_('pdfjs-dist/legacy/build/pdf.js'), () => {})
}
const D = carregarDoador()

function pdfsDe(dir: string): string[] {
  const o: string[] = []
  for (const e of readdirSync(dir)) {
    const c = join(dir, e)
    if (statSync(c).isDirectory()) o.push(...pdfsDe(c))
    else if (e.toLowerCase().endsWith('.pdf')) o.push(c)
  }
  return o
}

const chave = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

interface Divergencia {
  arquivo: string
  exame: string
  categoria: 'correcaoIntencional' | 'regressao' | 'diferencaDeForma' | 'naoClassificada'
  motivo: string
  clinboard: string
  novo: string
}

// ── Regras de classificação ─────────────────────────────────────────────────
// Cada regra corresponde a uma decisão tomada e registrada em alguma fase. O
// que nenhuma regra explicar fica como `naoClassificada` — de propósito.
const REGRAS: { motivo: string; aplica: (a: any, b: any) => boolean }[] = [
  {
    motivo: 'R5 · valor censurado carrega o operador; o doador colapsava ≤ em < e ≥ em >',
    aplica: (a, b) => Boolean(a?.censoring) || (b?.value?.censoring && b.value.censoring !== 'none'),
  },
  {
    motivo: 'D5 · "MENOR N" vira upperBound sem inventar mínimo zero (o doador devolvia refMin: 0)',
    aplica: (a, b) => a?.refMin === 0 && b?.reference?.kind === 'upperBound',
  },
  {
    motivo: 'Decisão clínica 31/07 · cálcio iônico venoso padronizado com parênteses',
    aplica: (a, b) => /calcio ionico/.test(chave(a?.name ?? '')) || /calcio ionico/.test(chave(b?.canonicalName ?? '')),
  },
  {
    motivo: 'Decisão clínica 31/07 · cor e aspecto do líquor são texto, não resultado alterado',
    aplica: (a, b) => /aspecto|cor |coagulo|limpido|turvo|xantocromico|incolor/.test(chave(a?.name ?? b?.canonicalName ?? '')),
  },
  {
    motivo: 'Decisão clínica 31/07 · resultado de imunidade não é importado (fica em discarded)',
    aplica: a => /imune/.test(chave(String(a?.value ?? ''))),
  },
  {
    motivo: 'R3 · status/alterado não atravessa a fronteira; comparação só de valor',
    aplica: a => a?.status !== undefined && a?.value === undefined,
  },
  {
    motivo: 'F2 · hora de coleta recuperada pela largura medida (o doador cola data e hora)',
    aplica: (a, b) => Boolean(b?.collectedAt?.hasTime) && !/\d{2}:\d{2}/.test(String(a?.date ?? '')),
  },
]

function classificar(doador: any, novo: any): { categoria: Divergencia['categoria']; motivo: string } {
  for (const r of REGRAS) {
    try { if (r.aplica(doador, novo)) return { categoria: 'correcaoIntencional', motivo: r.motivo } }
    catch { /* regra que não se aplica a este formato */ }
  }
  // Mesmo número, representação diferente (string vs número, unidade grafada
  // de outro jeito): forma, não conteúdo.
  const va = Number(String(doador?.value ?? '').replace(',', '.'))
  const vb = novo?.value?.kind === 'numeric' ? novo.value.value : NaN
  if (Number.isFinite(va) && Number.isFinite(vb) && Math.abs(va - vb) < 1e-9) {
    return { categoria: 'diferencaDeForma', motivo: 'mesmo valor, representação diferente' }
  }
  return { categoria: 'naoClassificada', motivo: 'exige revisão clínica' }
}

// ── Execução ────────────────────────────────────────────────────────────────
const arquivos = pdfsDe(FIXTURES).filter(p => !p.includes('/imaging/')).sort()
const divergencias: Divergencia[] = []
let paresIguais = 0
let soDoador = 0
let soNovo = 0

for (const arquivo of arquivos) {
  const rotulo = arquivo.replace(FIXTURES, '').replace(/^\//, '')
  const bytes = new Uint8Array(readFileSync(arquivo))

  let doador: any[] = []
  try {
    const texto: string = await D.extractPDFText({
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    })
    const saida = D.LabRegistry.run ? D.LabRegistry.run(texto).results : D.parsePDFText(texto)
    doador = Array.isArray(saida) ? saida : []
  } catch { doador = [] }

  const novo = await extrairExames({ document: { bytes, filename: null }, hints: null, options: null })

  const porNomeDoador = new Map<string, any>()
  for (const e of doador) if (e?.name) porNomeDoador.set(chave(e.name), e)
  const porNomeNovo = new Map<string, any>()
  for (const o of novo.observations) if (o.canonicalName) porNomeNovo.set(chave(o.canonicalName), o)

  for (const [k, a] of porNomeDoador) {
    const b = porNomeNovo.get(k)
    if (!b) {
      soDoador++
      const { categoria, motivo } = classificar(a, null)
      // Ausência no novo é PERDA DE DADO CLÍNICO, e não uma divergência a
      // discutir: o clinBoard entrega o exame e o novo não. Só não conta como
      // regressão quando alguma decisão explicou a saída (imunidade não
      // importada, por exemplo).
      divergencias.push({
        arquivo: rotulo, exame: a.name,
        categoria: categoria === 'correcaoIntencional' ? categoria : 'regressao',
        motivo: categoria === 'correcaoIntencional' ? motivo : 'o clinBoard extrai este exame e o novo não',
        clinboard: `${a.value ?? '—'} ${a.unit ?? ''}`.trim(), novo: '— ausente —',
      })
      continue
    }
    const va = Number(String(a.value ?? '').replace(',', '.'))
    const vb = b.value?.kind === 'numeric' ? b.value.value : NaN
    const iguais = Number.isFinite(va) && Number.isFinite(vb) && Math.abs(va - vb) < 1e-9
    const censuraNova = b.value?.kind === 'numeric' && b.value.censoring !== 'none'
    if (iguais && !censuraNova) { paresIguais++; continue }
    const { categoria, motivo } = classificar(a, b)
    divergencias.push({
      arquivo: rotulo, exame: a.name, categoria, motivo,
      clinboard: `${a.value ?? '—'} ${a.unit ?? ''}`.trim(),
      novo: b.value?.kind === 'numeric'
        ? `${b.value.censoring !== 'none' ? b.value.censoring + ' ' : ''}${b.value.value} ${b.unit?.canonical ?? ''}`.trim()
        : `${b.value?.kind}:${b.value?.raw ?? ''}`,
    })
  }

  for (const [k, b] of porNomeNovo) {
    if (porNomeDoador.has(k)) continue
    soNovo++
    const { categoria, motivo } = classificar(null, b)
    divergencias.push({
      arquivo: rotulo, exame: b.canonicalName ?? b.rawName, categoria,
      motivo: categoria === 'naoClassificada' ? 'extração NOVA: o clinBoard não pega este exame' : motivo,
      clinboard: '— ausente —',
      novo: b.value?.kind === 'numeric' ? String(b.value.value) : String(b.value?.kind),
    })
  }
}

// ── Relatório ───────────────────────────────────────────────────────────────
const porCategoria = (c: Divergencia['categoria']) => divergencias.filter(d => d.categoria === c)
const intencionais = porCategoria('correcaoIntencional')
const regressoes = porCategoria('regressao')
const forma = porCategoria('diferencaDeForma')
const abertas = porCategoria('naoClassificada')

let md = `# Relatório de paridade — extrator novo × clinBoard\n\n`
md += `Gerado por \`scripts/paridade-clinboard.mts\` sobre ${arquivos.length} laudos do corpus real.\n`
md += `Nenhum dado de paciente aparece aqui: só nome de exame, valor e unidade.\n\n`
md += `| Métrica | Valor |\n|---|---|\n`
md += `| Exames com valor idêntico | ${paresIguais} |\n`
md += `| Divergências | ${divergencias.length} |\n`
md += `| — correção intencional | ${intencionais.length} |\n`
md += `| — **REGRESSÃO** | **${regressoes.length}** |\n`
md += `| — diferença de forma | ${forma.length} |\n`
md += `| — **não classificada** | **${abertas.length}** |\n`
md += `| Só no clinBoard | ${soDoador} |\n`
md += `| Só no novo | ${soNovo} |\n\n`

function tabela(titulo: string, itens: Divergencia[], limite = 60) {
  if (itens.length === 0) return ''
  let t = `## ${titulo} (${itens.length})\n\n`
  t += `| Laudo | Exame | clinBoard | novo | motivo |\n|---|---|---|---|---|\n`
  for (const d of itens.slice(0, limite)) {
    t += `| ${d.arquivo} | ${d.exame} | ${d.clinboard} | ${d.novo} | ${d.motivo} |\n`
  }
  if (itens.length > limite) t += `\n_… e mais ${itens.length - limite}._\n`
  return t + `\n`
}

// Concentração das regressões por laudo: é o que diz por onde começar.
const porLaudo = new Map<string, number>()
for (const r of regressoes) porLaudo.set(r.arquivo, (porLaudo.get(r.arquivo) ?? 0) + 1)
if (porLaudo.size) {
  md += `## Regressões por laudo\n\n| Laudo | Exames perdidos |\n|---|---|\n`
  for (const [l, n] of [...porLaudo].sort((a, b) => b[1] - a[1])) md += `| ${l} | ${n} |\n`
  md += `\n`
}

md += tabela('REGRESSÕES — corrigir antes de seguir', regressoes, 40)
md += tabela('Não classificadas — exigem revisão clínica', abertas, 80)
md += tabela('Correções intencionais', intencionais)
md += tabela('Diferenças de forma', forma, 20)

writeFileSync(join(process.cwd(), 'RELATORIO-PARIDADE.md'), md, 'utf8')

console.log(`laudos:                 ${arquivos.length}`)
console.log(`valores idênticos:      ${paresIguais}`)
console.log(`divergências:           ${divergencias.length}`)
console.log(`  correção intencional: ${intencionais.length}`)
console.log(`  REGRESSÃO:            ${regressoes.length}`)
console.log(`  diferença de forma:   ${forma.length}`)
console.log(`  NÃO CLASSIFICADAS:    ${abertas.length}`)
console.log(`\nRELATORIO-PARIDADE.md gerado.`)
