#!/usr/bin/env node
// =============================================================================
// rodar-corpus.mts — roda o extrator sobre o corpus REAL e relata o que saiu.
//
// 10.3 — o corpus não vive neste repositório e nunca vai para o git. Sem a
// variável de ambiente, o script não roda e diz por quê. 7.B-9 — este script
// NÃO entra no CI: a suíte que trava o merge é a sintética.
//
//   FIXTURES_EXAMES=~/clinboard/fixtures npx tsx scripts/rodar-corpus.mts
//   FIXTURES_EXAMES=~/clinboard/fixtures npx tsx scripts/rodar-corpus.mts --calibrar
//
// `--calibrar` varre o fator de separação de coluna e mostra o efeito de cada
// valor sobre o corpus, para o limiar ser escolhido por medição e não por
// palpite.
// =============================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { extrairExames } from '../lib/exames/extracao'
import { lerDocumento } from '../lib/exames/extracao/texto/pdf'
import { separarColunas, limiarDeColuna, FATOR_COLUNA } from '../lib/exames/extracao/extratores/colunas'

function expandir(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p
}
const FIXTURES = expandir(process.env.FIXTURES_EXAMES ?? '')
if (!FIXTURES) {
  console.error('FIXTURES_EXAMES não definida. O corpus real nunca é versionado — veja o cabeçalho.')
  process.exit(2)
}

function pdfsDe(dir: string): string[] {
  const saida: string[] = []
  for (const e of readdirSync(dir)) {
    const c = join(dir, e)
    if (statSync(c).isDirectory()) saida.push(...pdfsDe(c))
    else if (e.toLowerCase().endsWith('.pdf')) saida.push(c)
  }
  return saida
}

// Só os laboratoriais: a pasta imaging é da F7.
const arquivos = pdfsDe(FIXTURES).filter(p => !p.includes('/imaging/')).sort()

if (process.argv.includes('--calibrar')) {
  // ── Varredura do fator de separação de coluna ───────────────────────────
  // Um fator baixo demais parte a referência ("0,60 - 1,30" vira três campos);
  // alto demais cola valor e unidade. O alvo é o platô entre os dois.
  console.log('fator  linhas  colunas/linha  lin. com >=3 colunas')
  for (const fator of [1.0, 1.4, 1.8, 2.2, 2.6, 3.0, 4.0]) {
    let linhas = 0, colunas = 0, tabulares = 0
    for (const arquivo of arquivos) {
      const doc = await lerDocumento(new Uint8Array(readFileSync(arquivo)))
      for (const linha of doc.lines) {
        if (linha.items.length < 2) continue
        const base = limiarDeColuna(linha) / FATOR_COLUNA
        const cols = separarColunas(linha, base * fator)
        linhas++
        colunas += cols.length
        if (cols.length >= 3) tabulares++
      }
    }
    console.log(
      `${fator.toFixed(1).padStart(5)}  ${String(linhas).padStart(6)}  ` +
      `${(colunas / linhas).toFixed(2).padStart(13)}  ${String(tabulares).padStart(20)}`,
    )
  }
  process.exit(0)
}

// ── Assertiva de roteamento (10.4, D11) ────────────────────────────────────
// No clinBoard o roteamento era registrado e nunca comparado: os fingerprints
// podiam apodrecer sem que nada falhasse. Aqui a pasta do fixture DECLARA qual
// perfil deve ser detectado, e a divergência é relatada.
const ROTEAMENTO_ESPERADO: Record<string, string | null> = {
  hoc: 'hoc', hugo: 'hugo', imec: 'imec', nucleo: 'nucleo', piox: 'piox',
  culturas: null,
  generic: null,
}

/**
 * Exceções por ARQUIVO, quando a pasta não basta.
 *
 * As culturas 03 a 06 são do Hospital IMEC (o cabeçalho diz "Local: Hospital
 * IMEC") — detectá-las como `imec` está CERTO, e a expectativa por pasta é que
 * estava errada. As 07 e 08 vêm de um laboratório de apoio sem perfil, e as 01
 * e 02 têm a camada de texto corrompida: nas quatro, `null` é o resultado
 * correto. O atb.pdf é um receituário, não um laudo.
 */
const EXCECOES: Record<string, string | null> = {
  'culturas/cultura-03/source.pdf': 'imec',
  'culturas/cultura-04/source.pdf': 'imec',
  'culturas/cultura-05/source.pdf': 'imec',
  'culturas/cultura-06/source.pdf': 'imec',
  'hugo/HUGO2/atb.pdf': null,
}

let roteamentoOk = 0
const roteamentoErrado: string[] = []

// ── Execução normal ────────────────────────────────────────────────────────
let totalObs = 0, totalDesc = 0, totalRev = 0, totalCult = 0, totalIso = 0, totalAtb = 0
const porMotivo = new Map<string, number>()
const porNome = new Map<string, number>()
const semNada: string[] = []

for (const arquivo of arquivos) {
  const bytes = new Uint8Array(readFileSync(arquivo))
  const r = await extrairExames({
    document: { bytes, filename: null },
    hints: null,
    options: null,
  })
  totalObs += r.observations.length
  totalDesc += r.discarded.length
  totalRev += r.observations.filter(o => o.requiresReview).length
  totalCult += r.cultures.length
  for (const c of r.cultures) {
    totalIso += c.isolates.length
    for (const i of c.isolates) totalAtb += i.susceptibilities.length
  }
  for (const d of r.discarded) {
    porMotivo.set(d.reason, (porMotivo.get(d.reason) ?? 0) + 1)
    if (d.reason === 'unrecognizedAnalyte' && d.detail) {
      porNome.set(d.detail, (porNome.get(d.detail) ?? 0) + 1)
    }
  }

  const rotulo = arquivo.replace(FIXTURES, '').replace(/^\//, '')
  const pasta = rotulo.split('/')[0] ?? ''
  if (rotulo in EXCECOES || pasta in ROTEAMENTO_ESPERADO) {
    const esperado = rotulo in EXCECOES ? EXCECOES[rotulo]! : ROTEAMENTO_ESPERADO[pasta]!
    if (r.detection.profileId === esperado) roteamentoOk++
    else roteamentoErrado.push(`${rotulo}: esperado ${esperado ?? 'null'}, detectado ${r.detection.profileId ?? 'null'}`)
  }
  // Um laudo de cultura legitimamente não tem observação nenhuma: o resultado
  // dele é a cultura. Contar só observações produzia alarme falso.
  if (r.observations.length === 0 && r.cultures.length === 0) semNada.push(rotulo)
  console.log(
    `${rotulo.padEnd(34)} obs=${String(r.observations.length).padStart(3)}  ` +
    `desc=${String(r.discarded.length).padStart(3)}  ` +
    `rev=${String(r.observations.filter(o => o.requiresReview).length).padStart(3)}  ` +
    `cult=${String(r.cultures.length).padStart(2)}  ` +
    `datas=${new Set(r.observations.map(o => o.collectedAt.iso?.slice(0, 10))).size}`,
  )
}

console.log(`\n── Totais em ${arquivos.length} laudos ──`)
console.log(`  observações:        ${totalObs}`)
console.log(`  descartes:          ${totalDesc}`)
console.log(`  pendentes revisão:  ${totalRev}`)
console.log(`  culturas:           ${totalCult}  (${totalIso} isolados, ${totalAtb} antimicrobianos)`)
console.log(`\n── Roteamento ──`)
console.log(`  corretos:   ${roteamentoOk}/${roteamentoOk + roteamentoErrado.length}`)
for (const e of roteamentoErrado) console.log(`  ✗ ${e}`)

console.log(`\n── Descartes por motivo ──`)
for (const [motivo, n] of [...porMotivo].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${motivo.padEnd(22)} ${n}`)
}
if (process.argv.includes('--descartes')) {
  console.log(`\n── Nomes mais descartados como analito desconhecido ──`)
  const top = [...porNome].sort((a, b) => b[1] - a[1]).slice(0, 30)
  for (const [nome, n] of top) console.log(`  ${String(n).padStart(4)}  ${nome}`)
}

if (semNada.length) {
  console.log(`\n⚠ ${semNada.length} laudos sem NENHUMA observação:`)
  semNada.forEach(s => console.log(`    ${s}`))
}
