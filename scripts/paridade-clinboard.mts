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
// Saída: RELATORIO-PARIDADE.md e REVISAO-PARIDADE.html na raiz. Os DOIS ficam
// fora do git: trazem valores de exame de pacientes reais, e resultado de exame
// é dado clínico ainda que sem o nome ao lado. Nunca entram no CI.
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
  unidade: string
  referencia: string
  data: string
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

  // O clinBoard nao tem campo para cultura: ele emite "Hemocultura = 1" como se
  // fosse um exame de valor. Aqui a cultura vive em `cultures[]`, com material,
  // isolados e antibiograma. O dado E extraido — muda o lugar, nao a presenca.
  // Sem isto, seis culturas contavam como regressao.
  // O doador rotula o exame de LÍQUOR sem sufixo: a glicose do liquor sai como
  // "Glicose", igual à glicemia. Quando temos o mesmo exame COM sufixo de
  // espécime, não é ausência — é o mesmo dado, mais preciso. Sem esta regra a
  // paridade PREMIA a resposta errada, e foi o que quase me fez desligar a
  // herança de líquor no IMEC.
  const comSufixo = new Map<string, any>()
  for (const o of novo.observations) {
    if (!o.canonicalName) continue
    const m = o.canonicalName.match(/^(.*?)\s*\((LCR|U|Arterial|Venosa)\)\s*$/)
    if (m) comSufixo.set(chave(m[1]!), o)
  }

  // Nomes padronizados em 03/08/2026 dentro do PRÓPRIO catálogo, para não
  // haver duas grafias do mesmo exame. O doador ficou com a grafia antiga, e
  // o comparador casa por nome — sem esta tabela, cada padronização aparece
  // como exame perdido. É a mesma armadilha do líquor: paridade não é
  // correção. O dado continua sendo extraído; o que mudou foi o rótulo.
  // Chaveado por `chave()`, não pela grafia literal: ela normaliza caixa e
  // acento, e escrever as chaves à mão já custou uma rodada em silêncio.
  const RENOMEADOS = new Map<string, string>(([
    ['Lactato Venoso', 'Lactato (Venosa)'],
    ['O2 Sat (Arterial)', 'SatO2 (Arterial)'],
    ['O2 Sat (Venosa)', 'SatO2 (Venosa)'],
    ['Hct (Arterial)', 'Hematócrito (Arterial)'],
    ['Hct (Venosa)', 'Hematócrito (Venosa)'],
    ['Pesquisa De Fungos (LCR)', 'Pesquisa de Fungos (LCR)'],
    ['Cloretos', 'Cloro'],
    ['pH Urinário', 'pH (U)'],
    ['DHL', 'LDH'],
    // Task 2a: o doador não sabia ligar "Resultado:" ao título de bloco do
    // HUGO e este exame nunca tinha sido extraído por nenhum dos dois lados
    // até agora — o doador lê pelo texto corrido, sem o mesmo problema de
    // coluna. Ele guarda o nome por extenso; o catálogo daqui só tem a sigla.
    ['Dosagem De Gama Gt', 'GGT'],
  ] as [string, string][]).map(([antes, depois]) => [chave(antes), depois]))

  const materiaisDeCultura = new Set(novo.cultures.map((c: any) => chave(c.specimen)))
  const ehCultura = (nome: string) => {
    const k = chave(nome)
    if (materiaisDeCultura.has(k)) return true
    // "MRSA" do doador corresponde a "Vigilância MRSA" daqui, e assim por diante.
    return [...materiaisDeCultura].some(m => m.includes(k) || k.includes(m))
  }

  for (const [k, a] of porNomeDoador) {
    const b = porNomeNovo.get(k)
    if (!b) {
      soDoador++
      const renomeado = RENOMEADOS.get(k)
      const equivalente = renomeado ? porNomeNovo.get(chave(renomeado)) : undefined
      if (equivalente) {
        divergencias.push({
          arquivo: rotulo, exame: a.name,
          unidade: '', referencia: '', data: a.date ?? '',
          categoria: 'correcaoIntencional',
          motivo: `padronizado no catálogo: agora é "${renomeado}"`,
          clinboard: `${a.value ?? '—'}`,
          novo: equivalente.value?.kind === 'numeric' ? String(equivalente.value.value) : String(equivalente.value?.kind),
        })
        continue
      }
      const maisPreciso = comSufixo.get(k)
      if (maisPreciso) {
        divergencias.push({
          arquivo: rotulo, exame: a.name,
          unidade: '', referencia: '', data: a.date ?? '',
          categoria: 'correcaoIntencional',
          motivo: `o doador não sufixa o espécime; aqui é "${maisPreciso.canonicalName}"`,
          clinboard: `${a.value ?? '—'}`,
          novo: maisPreciso.value?.kind === 'numeric' ? String(maisPreciso.value.value) : String(maisPreciso.value?.kind),
        })
        continue
      }
      if (novo.cultures.length > 0 && ehCultura(a.name)) {
        divergencias.push({
          arquivo: rotulo, exame: a.name,
          unidade: '', referencia: '', data: a.date ?? '',
          categoria: 'diferencaDeForma',
          motivo: 'cultura: extraída em cultures[], com isolado e antibiograma, e não como exame de valor',
          clinboard: `${a.value ?? '—'}`, novo: 'em cultures[]',
        })
        continue
      }
      const { categoria, motivo } = classificar(a, null)
      // Ausência no novo é PERDA DE DADO CLÍNICO, e não uma divergência a
      // discutir: o clinBoard entrega o exame e o novo não. Só não conta como
      // regressão quando alguma decisão explicou a saída (imunidade não
      // importada, por exemplo).
      divergencias.push({
        arquivo: rotulo, exame: a.name,
        unidade: a.unit ?? '', referencia: a.ref ?? '', data: a.date ?? '',
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
      unidade: a.unit ?? '', referencia: a.ref ?? '', data: a.date ?? '',
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
      unidade: b.unit?.canonical ?? b.unit?.raw ?? '',
      referencia: b.reference?.kind === 'range' ? `${b.reference.min} - ${b.reference.max}` : (b.reference?.kind ?? ''),
      data: b.collectedAt?.iso ?? '',
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

// ── Página de revisão clínica ───────────────────────────────────────────────
// Arquivo local, autocontido, aberto no navegador. NÃO é publicado em lugar
// nenhum: traz valor de exame de paciente real. As decisões ficam no
// localStorage do próprio navegador e podem ser exportadas.
const paraRevisar = [...abertas, ...regressoes].map((d, i) => ({ i, ...d }))
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revisão de divergências — extração de exames</title><style>
:root{--b:#e2e8f0;--t:#0f172a;--m:#64748b;--ok:#16a34a;--no:#dc2626;--d:#ca8a04}
*{box-sizing:border-box}body{font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:var(--t);margin:0;padding:24px;background:#f8fafc}
h1{font-size:20px;margin:0 0 4px}p.sub{color:var(--m);margin:0 0 20px}
.barra{position:sticky;top:0;background:#f8fafc;padding:12px 0;border-bottom:1px solid var(--b);margin-bottom:16px;z-index:5}
button{font:inherit;border:1px solid var(--b);background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer}
button.on{background:var(--t);color:#fff;border-color:var(--t)}
.item{background:#fff;border:1px solid var(--b);border-radius:12px;padding:14px 16px;margin-bottom:10px}
.item.decidido{opacity:.5}
.cab{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline}
.exame{font-weight:600;font-size:16px}
.laudo{color:var(--m);font-size:13px;font-family:ui-monospace,monospace}
.vals{display:flex;gap:24px;flex-wrap:wrap;margin:10px 0 6px}
.val{min-width:150px}.val .rot{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--m)}
.val .v{font-size:16px;font-variant-numeric:tabular-nums}
.meta{color:var(--m);font-size:13px}
.acoes{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.acoes button.sel[data-v=novo]{background:var(--ok);color:#fff;border-color:var(--ok)}
.acoes button.sel[data-v=clinboard]{background:var(--no);color:#fff;border-color:var(--no)}
.acoes button.sel[data-v=duvida]{background:var(--d);color:#fff;border-color:var(--d)}
.contador{color:var(--m);font-size:13px;margin-left:8px}
</style></head><body>
<h1>Revisão de divergências</h1>
<p class="sub">Compare cada item com o laudo em papel e diga qual está certo.
As respostas ficam salvas neste navegador. Nada é enviado para lugar nenhum.</p>
<div class="barra">
  <button data-f="todos" class="on">Todos</button>
  <button data-f="regressao">Faltando no novo</button>
  <button data-f="naoClassificada">Extração nova / a esclarecer</button>
  <button data-f="pendentes">Só não decididos</button>
  <button id="exportar">Exportar decisões</button>
  <span class="contador" id="contador"></span>
</div>
<div id="lista"></div>
<script>
const DADOS = ${JSON.stringify(paraRevisar)};
const chave = 'revisao-paridade';
const dec = JSON.parse(localStorage.getItem(chave) || '{}');
let filtro = 'todos';
const id = d => d.arquivo + '|' + d.exame;
function render(){
  const lista = document.getElementById('lista');
  const vis = DADOS.filter(d =>
    filtro === 'todos' ? true :
    filtro === 'pendentes' ? !dec[id(d)] : d.categoria === filtro);
  lista.innerHTML = vis.map(d => {
    const k = id(d), escolha = dec[k];
    const b = (v, txt) => '<button class="' + (escolha === v ? 'sel' : '') + '" data-v="' + v + '" data-k="' + encodeURIComponent(k) + '">' + txt + '</button>';
    return '<div class="item' + (escolha ? ' decidido' : '') + '">' +
      '<div class="cab"><span class="exame">' + d.exame + '</span>' +
      '<span class="laudo">' + d.arquivo + (d.data ? ' · ' + d.data : '') + '</span></div>' +
      '<div class="vals">' +
        '<div class="val"><div class="rot">clinBoard (em uso)</div><div class="v">' + d.clinboard + '</div></div>' +
        '<div class="val"><div class="rot">extrator novo</div><div class="v">' + d.novo + '</div></div>' +
        (d.referencia ? '<div class="val"><div class="rot">referência</div><div class="v">' + d.referencia + '</div></div>' : '') +
      '</div>' +
      '<div class="meta">' + d.motivo + '</div>' +
      '<div class="acoes">' + b('novo','O novo está certo') + b('clinboard','O clinBoard está certo') +
      b('duvida','Não sei / ver depois') + '</div></div>';
  }).join('') || '<p class="meta">Nada nesta lista.</p>';
  const decididos = DADOS.filter(d => dec[id(d)]).length;
  document.getElementById('contador').textContent = decididos + ' de ' + DADOS.length + ' revisados';
}
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b) return;
  if (b.dataset.f){ filtro = b.dataset.f;
    document.querySelectorAll('.barra button[data-f]').forEach(x => x.classList.toggle('on', x === b));
    return render(); }
  if (b.id === 'exportar'){
    // Sem sequências de escape neste trecho: ele vive dentro de um template
    // literal do gerador, e as barras invertidas eram interpretadas ali,
    // virando tabulação e quebra de linha DE VERDADE no arquivo emitido. A
    // string JavaScript saía partida ao meio e a página não abria.
    const TAB = String.fromCharCode(9), NL = String.fromCharCode(10);
    const cab = ['laudo','exame','clinboard','novo','decisao'].join(TAB);
    const linhas = DADOS.filter(d => dec[id(d)]).map(d => [d.arquivo, d.exame, d.clinboard, d.novo, dec[id(d)]].join(TAB));
    const blob = new Blob([cab + NL + linhas.join(NL)], {type:'text/plain'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'decisoes-revisao.tsv'; a.click(); return; }
  if (b.dataset.k){ const k = decodeURIComponent(b.dataset.k);
    dec[k] = dec[k] === b.dataset.v ? undefined : b.dataset.v;
    if (!dec[k]) delete dec[k];
    localStorage.setItem(chave, JSON.stringify(dec)); render(); }
});
render();
</script></body></html>`
writeFileSync(join(process.cwd(), 'REVISAO-PARIDADE.html'), html, 'utf8')

console.log(`laudos:                 ${arquivos.length}`)
console.log(`valores idênticos:      ${paresIguais}`)
console.log(`divergências:           ${divergencias.length}`)
console.log(`  correção intencional: ${intencionais.length}`)
console.log(`  REGRESSÃO:            ${regressoes.length}`)
console.log(`  diferença de forma:   ${forma.length}`)
console.log(`  NÃO CLASSIFICADAS:    ${abertas.length}`)
console.log(`\nRELATORIO-PARIDADE.md e REVISAO-PARIDADE.html gerados (locais, fora do git).`)
