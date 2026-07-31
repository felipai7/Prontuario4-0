#!/usr/bin/env node
// =============================================================================
// comparar-texto-clinboard.mts — compara a camada de texto NOVA com a do
// clinBoard sobre o corpus real de laudos.
//
// Por que existe: a camada 1 trocou o gap estimado por contagem de caractere
// (CHAR_WIDTH_EST = 4.5) pela largura MEDIDA de cada item. É uma mudança de
// comportamento no ponto mais a montante do módulo — se ela degradar a
// reconstrução de linhas, TODO o resto herda o estrago, e nenhum teste
// sintético pegaria, porque os laudos reais usam fontes que eu não sei imitar.
//
// 10.3 — o corpus NÃO vive neste repositório. Aponte para ele por variável de
// ambiente; sem ela, o script não roda e diz por quê.
//
//   FIXTURES_EXAMES=~/clinboard/fixtures \
//   CLINBOARD_HTML=~/clinboard/clinboard.html \
//   npx tsx scripts/comparar-texto-clinboard.mts
//
// Nunca entra no CI: depende de dado de paciente (7.B-9).
// =============================================================================
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { lerDocumento } from '../lib/exames/extracao/texto/pdf'

const require_ = createRequire(import.meta.url)

function expandir(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p
}

const FIXTURES = expandir(process.env.FIXTURES_EXAMES ?? '')
const CLINBOARD = expandir(process.env.CLINBOARD_HTML ?? '')

if (!FIXTURES || !existsSync(FIXTURES)) {
  console.error('FIXTURES_EXAMES não aponta para um diretório existente.')
  console.error('Este script exige o corpus real, que nunca é versionado. Veja o cabeçalho.')
  process.exit(2)
}
if (!CLINBOARD || !existsSync(CLINBOARD)) {
  console.error('CLINBOARD_HTML não aponta para o clinboard.html do doador.')
  process.exit(2)
}

// ── Extrai o extractPDFText do doador, sem duplicar lógica ──────────────────
// Mesmo recorte que o regression-synthetic.mjs usa (7.B-15 explica por que a
// suíte de lá tem essa forma; aqui é só para a comparação, em caráter temporário).
function carregarDoador() {
  const html = readFileSync(CLINBOARD, 'utf8').split('\n')
  const ini = html.findIndex(l => l.includes('async function extractPDFText(file)'))
  const fimMarca = html.findIndex((l, i) => i > ini && l.includes('function getCultureType('))
  let fim = -1
  for (let i = fimMarca + 1; i < html.length; i++) if (html[i] === '}') { fim = i; break }
  if (ini < 0 || fim < 0) throw new Error('marcadores do clinboard.html não encontrados')
  const slice = html.slice(ini, fim + 1).join('\n')
  const fabrica = new Function('pdfjsLib', 'toast', `${slice}\nreturn { extractPDFText };`)
  return fabrica(require_('pdfjs-dist/legacy/build/pdf.js'), () => {})
}

const doador = carregarDoador()

function pdfsDe(dir: string): string[] {
  const saida: string[] = []
  for (const e of readdirSync(dir)) {
    const c = join(dir, e)
    if (statSync(c).isDirectory()) saida.push(...pdfsDe(c))
    else if (e.toLowerCase().endsWith('.pdf')) saida.push(c)
  }
  return saida
}

function normalizar(t: string): string[] {
  return t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const arquivos = pdfsDe(FIXTURES).sort()
console.log(`Corpus: ${arquivos.length} PDFs\n`)

let iguais = 0
const divergentes: { arquivo: string; soNovo: string[]; soDoador: string[] }[] = []

for (const arquivo of arquivos) {
  const bytes = new Uint8Array(readFileSync(arquivo))
  const novo = normalizar((await lerDocumento(bytes)).lines.map(l => l.text).join('\n'))
  // O doador recebe algo com .arrayBuffer(), como um File do navegador.
  const doadorTexto: string = await doador.extractPDFText({
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })
  const antigo = normalizar(doadorTexto)

  const setNovo = new Set(novo)
  const setAntigo = new Set(antigo)
  const soNovo = novo.filter(l => !setAntigo.has(l))
  const soDoador = antigo.filter(l => !setNovo.has(l))

  const rotulo = arquivo.replace(FIXTURES, '').replace(/^\//, '')
  if (soNovo.length === 0 && soDoador.length === 0) {
    iguais++
  } else {
    divergentes.push({ arquivo: rotulo, soNovo, soDoador })
  }
}

console.log(`Linhas idênticas em ${iguais}/${arquivos.length} documentos.\n`)

// ── Classificação das divergências (10.5) ───────────────────────────────────
// Toda divergência precisa cair numa categoria. "Só espaçamento" = as duas
// versões têm os MESMOS caracteres não-brancos; muda só onde há espaço. Essa é
// a categoria esperada da troca de gap estimado por gap medido.
const semEspaco = (l: string) => l.replace(/\s+/g, '')
let soEspacamento = 0
let conteudoDiferente = 0
const exemplosConteudo: string[] = []

for (const d of divergentes) {
  const chavesDoador = new Set(d.soDoador.map(semEspaco))
  const chavesNovo = new Set(d.soNovo.map(semEspaco))
  const orfasDoador = d.soDoador.filter(l => !chavesNovo.has(semEspaco(l)))
  const orfasNovo = d.soNovo.filter(l => !chavesDoador.has(semEspaco(l)))
  const paresEspacamento = d.soDoador.length - orfasDoador.length
  soEspacamento += paresEspacamento
  conteudoDiferente += orfasDoador.length + orfasNovo.length
  for (const l of orfasDoador) exemplosConteudo.push(`- [${d.arquivo}] só clinBoard: ${l.slice(0, 100)}`)
  for (const l of orfasNovo) exemplosConteudo.push(`+ [${d.arquivo}] só novo:      ${l.slice(0, 100)}`)
}

console.log('── Classificação ──')
console.log(`  Só espaçamento (mesmos caracteres, espaço diferente): ${soEspacamento} linhas`)
console.log(`  Conteúdo genuinamente diferente:                      ${conteudoDiferente} linhas`)
if (exemplosConteudo.length) {
  console.log('\n  ⚠ Estas exigem inspeção manual contra o PDF:')
  exemplosConteudo.slice(0, 30).forEach(l => console.log(`    ${l}`))
  if (exemplosConteudo.length > 30) console.log(`    ... e mais ${exemplosConteudo.length - 30}`)
}

if (process.env.VERBOSE) {
  console.log('\n── Amostra por documento ──\n')
  for (const d of divergentes) {
    console.log(`▸ ${d.arquivo}  (+${d.soNovo.length} / -${d.soDoador.length})`)
    d.soDoador.slice(0, 3).forEach(l => console.log(`   clinBoard: ${l.slice(0, 110)}`))
    d.soNovo.slice(0, 3).forEach(l => console.log(`   novo:      ${l.slice(0, 110)}`))
    console.log()
  }
}

// Nunca falha o processo: é relatório de divergência, não portão.
process.exit(0)
