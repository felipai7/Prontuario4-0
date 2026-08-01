#!/usr/bin/env node
// =============================================================================
// migrate-clinboard-catalog.mts — extrai o conhecimento clínico do clinBoard e
// emite o catálogo versionado deste módulo.
//
// Por que script e não conversão manual: 683 entradas convertidas à mão
// introduzem erro de digitação em nome de exame, e erro de digitação em nome de
// exame parte o histórico do paciente em duas colunas silenciosamente. Além
// disso o script é reexecutável, e a migração fica auditável em diff.
//
// O script NÃO resolve conflito nenhum sozinho. Ele detecta, relata e marca
// `needsClinicalReview`. Decisão clínica é humana.
//
//   CLINBOARD_HTML=~/clinboard/clinboard.html npx tsx scripts/migrate-clinboard-catalog.mts
//
// Saída: lib/exames/extracao/catalogo/*.json + RELATORIO-CONFLITOS.md
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const DESTINO = join(AQUI, '..', 'lib', 'exames', 'extracao', 'catalogo')

function expandir(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p
}
const CLINBOARD = expandir(process.env.CLINBOARD_HTML ?? '~/clinboard/clinboard.html')
if (!existsSync(CLINBOARD)) {
  console.error(`clinboard.html não encontrado em ${CLINBOARD}. Use CLINBOARD_HTML=...`)
  process.exit(2)
}

// ── Extração dos objetos literais ───────────────────────────────────────────
// Avalia o recorte do doador para obter os OBJETOS, em vez de parsear JS com
// regex. O recorte por marcador textual é o mesmo do regression-synthetic.mjs;
// é aceitável aqui porque esta é uma migração pontual, não uma suíte perene
// (7.B-15 explica por que aquela abordagem é frágil como padrão).
function carregarDoador() {
  const linhas = readFileSync(CLINBOARD, 'utf8').split('\n')
  const ini = linhas.findIndex(l => l.includes('async function extractPDFText(file)'))
  const fimMarca = linhas.findIndex((l, i) => i > ini && l.includes('function getCultureType('))
  let fim = -1
  for (let i = fimMarca + 1; i < linhas.length; i++) if (linhas[i] === '}') { fim = i; break }
  if (ini < 0 || fim < 0) throw new Error('marcadores do clinboard.html não encontrados')
  const fabrica = new Function('pdfjsLib', 'toast', `
    ${linhas.slice(ini, fim + 1).join('\n')}
    return { NAME_MAP, PARAM_WHITELIST, GASO_PARAMS, GASO_SPECIAL_NAMES, _gasoRename,
             QUAL_STATUS, LCR_RENAME, LCR_KEEP, _lcrName, CULTURE_TYPES, EAS_NAME_MAP,
             SKIP_NAMES, COLLECTION_DATE_PATTERNS, IMG_MODALITIES };
  `)
  return fabrica({}, () => {})
}

const D = carregarDoador()

// ── Utilidades de normalização ──────────────────────────────────────────────
const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Chave de busca de sinônimo: NFC, maiúsculo, espaços colapsados. */
const chaveSinonimo = (s: string) =>
  s.normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim()

/** Chave de comparação frouxa: ignora acento, caixa e espaço. Só para detectar quase-duplicatas. */
const chaveFrouxa = (s: string) =>
  semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim()

/** Identificador estável de analito, derivado do nome canônico. */
function idDeAnalito(nomeCanonico: string): { id: string; specimen: string; base: string } {
  const sufixos: [RegExp, string, string][] = [
    [/\s*\(LCR\)\s*$/i, 'csf', 'csf'],
    [/\s*\(U\)\s*$/i, 'urine', 'urine'],
    [/\s*\(Arterial\)\s*$/i, 'arterialBlood', 'art'],
    [/\s*\(Venosa\)\s*$/i, 'venousBlood', 'ven'],
    [/\s+Venoso\s*$/i, 'venousBlood', 'ven'],
  ]
  let base = nomeCanonico
  let specimen = 'blood'
  let curto = 'serum'
  for (const [re, esp, sufixo] of sufixos) {
    if (re.test(nomeCanonico)) { base = nomeCanonico.replace(re, ''); specimen = esp; curto = sufixo; break }
  }
  const slug = semAcento(base)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')
  return { id: `${slug}.${curto}`, specimen, base: base.trim() }
}

// ── Vocabulário qualitativo ─────────────────────────────────────────────────
// R3: o doador mapeia para 'normal'|'high'|'low', que é INTERPRETAÇÃO. Aqui
// mapeamos para QualitativeCode, que é vocabulário. A interpretação sai do
// módulo — vai para lib/exames/interpretacao.ts.
//
// Três famílias distintas convivem no QUAL_STATUS do doador e precisam ser
// separadas: códigos sorológicos, crescimento de cultura e descrição física
// (cor/aspecto do líquor). A terceira NÃO é um resultado qualitativo — é texto.
const QUALITATIVO: Record<string, string> = {
  'NEGATIVO': 'negative', 'NEGATIVA': 'negative', 'NEGATIVOS': 'negative',
  'POSITIVO': 'positive', 'POSITIVA': 'positive',
  'REAGENTE': 'reactive',
  'NÃO REAGENTE': 'nonreactive', 'NAO REAGENTE': 'nonreactive',
  'DETECTADO': 'detected', 'DETECTÁVEL': 'detected', 'DETECTAVEL': 'detected',
  'NÃO DETECTADO': 'undetected', 'NAO DETECTADO': 'undetected',
  'NÃO DETECTÁVEL': 'undetected', 'NAO DETECTAVEL': 'undetected',
  'AUSENTE': 'absent', 'PRESENTE': 'present',
  'INDETERMINADO': 'indeterminate', 'INCONCLUSIVO': 'inconclusive',
  'AUSÊNCIA DE ANTICORPOS': 'absent',
  'AUSÊNCIA DE BACTÉRIAS': 'absent', 'AUSENCIA DE BACTERIAS': 'absent',
  'AUSÊNCIA DE BAAR': 'absent', 'AUSENCIA DE BAAR': 'absent',
  'AUSÊNCIA DE FUNGOS': 'absent', 'AUSENCIA DE FUNGOS': 'absent',
  'AUSÊNCIA DE ESTRUTURAS FÚNGICAS': 'absent', 'AUSENCIA DE ESTRUTURAS FUNGICAS': 'absent',
  'PRESENÇA DE ESTRUTURAS FÚNGICAS': 'present', 'PRESENCA DE ESTRUTURAS FUNGICAS': 'present',
}

/** Termos de crescimento de cultura — vão para `CultureResult.growth`, não para valor. */
const CRESCIMENTO: Record<string, string> = {
  'NÃO HOUVE CRESCIMENTO': 'noGrowth', 'NAO HOUVE CRESCIMENTO': 'noGrowth',
  'NÃO HOUVE CRESCIMENTO DE BACTÉRIAS': 'noGrowth', 'NAO HOUVE CRESCIMENTO DE BACTERIAS': 'noGrowth',
}

/** Descrição física: é TEXTO, não código. Nenhum deles cabe em QualitativeCode. */
const DESCRICAO_FISICA = [
  'LÍMPIDO', 'LIMPIDO', 'INCOLOR', 'CRISTALINO', 'TURVO', 'LIGEIRAMENTE TURVO',
  'OPACO', 'HEMORRÁGICO', 'HEMORRAGICO', 'XANTOCRÔMICO', 'XANTOCROMICO',
  'AMARELADO', 'ROSADO', 'AVERMELHADO',
]

/** Sem correspondência em QualitativeCode — exigem decisão clínica. */
const SEM_CODIGO = ['IMUNE', 'NÃO IMUNE', 'NAO IMUNE']

// ── Construção do catálogo ──────────────────────────────────────────────────
interface Conflito { tipo: string; detalhe: string }
const conflitos: Conflito[] = []

const nameMap = D.NAME_MAP as Record<string, string | null>
const sinonimos: Record<string, string> = {}
const analitos: Record<string, any> = {}
const vistos = new Map<string, string>()

// 1) Chaves duplicadas com valores divergentes (E1 já resolvido; detecta NOVOS).
for (const [bruto, canonico] of Object.entries(nameMap)) {
  const chave = chaveSinonimo(bruto)
  if (canonico == null) continue
  if (vistos.has(chave) && vistos.get(chave) !== canonico) {
    conflitos.push({
      tipo: 'chaveDuplicadaDivergente',
      detalhe: `"${bruto}" mapeia para "${vistos.get(chave)}" e para "${canonico}"`,
    })
  }
  vistos.set(chave, canonico)
}

function registrarAnalito(nomeCanonico: string, origem: string, valueKind = 'numeric') {
  const { id, specimen, base } = idDeAnalito(nomeCanonico)
  if (!analitos[id]) {
    analitos[id] = {
      id,
      canonicalName: nomeCanonico,
      category: null,          // não inventar: o doador não tem categorias
      defaultSpecimen: specimen,
      defaultUnit: null,       // não inventar
      valueKind,
      loinc: null,             // NUNCA inventar código LOINC
      plausibleRange: null,    // faixa fisicamente possível — decisão clínica
      needsClinicalReview: true,
      origem: [origem],
      _base: base,
    }
  } else if (!analitos[id].origem.includes(origem)) {
    analitos[id].origem.push(origem)
  }
  return id
}

for (const [bruto, canonico] of Object.entries(nameMap)) {
  if (canonico == null) continue
  const id = registrarAnalito(canonico, 'NAME_MAP')
  sinonimos[chaveSinonimo(bruto)] = id
}

// 1b) Extras da PARAM_WHITELIST. Ela é o vocabulário REAL do doador:
//     `Object.values(NAME_MAP)` mais nomes curados à mão ('TP (segundos)',
//     'Cálcio Total', 'FiO2', 'Blastos', …). Deixá-los de fora perderia parte
//     do ativo clínico sem nenhum aviso.
const valoresNameMap = new Set(
  Object.values(nameMap).filter((v): v is string => v != null).map(chaveSinonimo),
)
for (const nome of D.PARAM_WHITELIST as Set<string>) {
  if (valoresNameMap.has(chaveSinonimo(nome))) continue
  const id = registrarAnalito(nome, 'PARAM_WHITELIST')
  sinonimos[chaveSinonimo(nome)] = id
}

// 2) EAS — parâmetros de urina.
const easMap = D.EAS_NAME_MAP as Record<string, string>
for (const [bruto, canonico] of Object.entries(easMap)) {
  if (!canonico) continue
  const id = registrarAnalito(canonico, 'EAS_NAME_MAP')
  sinonimos[chaveSinonimo(bruto)] = id
}

// 3) Nomes que REGRAS podem produzir. É a lição do E2: sete nomes de líquor
//    eram gerados de propósito pelo parser e não estavam na whitelist, então
//    chegavam à revisão desmarcados e se perdiam. Aqui todo nome gerável entra
//    no catálogo, e há teste afirmando isso.
const geradosPorRegra: string[] = []

for (const nome of D.LCR_KEEP as Set<string>) geradosPorRegra.push(nome)
for (const nome of Object.values(D.LCR_RENAME as Record<string, string>)) geradosPorRegra.push(nome)
// Saídas do fallback por expressão regular dentro de _lcrName. Ficam num dado
// nomeado, e não soltas aqui, porque o teste do E2 precisa lê-las do catálogo —
// uma lista repetida no teste provaria só que copiei certo.
const SAIDAS_REGRA_LIQUOR = [
  'Células Nucleadas (LCR)', 'Células (LCR)', 'Macrófagos (LCR)',
  'Cloretos (LCR)', 'Proteínas (LCR)',
]
for (const nome of SAIDAS_REGRA_LIQUOR) geradosPorRegra.push(nome)
// Saídas de _gasoRename: canônico + sufixo de contexto, e os nomes especiais.
for (const ctx of ['Arterial', 'Venosa']) {
  for (const canonico of Object.values(D.GASO_PARAMS as Record<string, string | null>)) {
    if (canonico) geradosPorRegra.push(`${canonico} (${ctx})`)
  }
  for (const especial of Object.values((D.GASO_SPECIAL_NAMES as any)[ctx] ?? {})) {
    geradosPorRegra.push(especial as string)
  }
}
for (const nome of Object.values(D.CULTURE_TYPES as Record<string, string>)) geradosPorRegra.push(nome)

for (const nome of geradosPorRegra) {
  const id = registrarAnalito(nome, 'regra')
  sinonimos[chaveSinonimo(nome)] = id
}

// 4) Quase-duplicatas: nomes canônicos que diferem só por acento, caixa ou espaço.
const porChaveFrouxa = new Map<string, Set<string>>()
for (const a of Object.values(analitos)) {
  const k = chaveFrouxa(a.canonicalName)
  if (!porChaveFrouxa.has(k)) porChaveFrouxa.set(k, new Set())
  porChaveFrouxa.get(k)!.add(a.canonicalName)
}
for (const [, nomes] of porChaveFrouxa) {
  if (nomes.size > 1) {
    conflitos.push({
      tipo: 'quaseDuplicata',
      detalhe: `diferem só por acento/caixa/espaço: ${[...nomes].map(n => `"${n}"`).join(' vs ')}`,
    })
  }
}

// 5) E2 — nomes que uma REGRA produz e o vocabulário do doador não reconhece.
//
// Checar contra `sinonimos` seria vicioso: o passo 3 acabou de registrá-los. A
// base correta é a PARAM_WHITELIST, que é o vocabulário efetivo do doador
// (NAME_MAP + extras curados + LCR + culturas) — foi ela que o E2 corrigiu.
// Comparar contra o NAME_MAP sozinho acusaria 69 falsos positivos.
//
// Esperado hoje: zero. Se um dia aparecer item aqui, é uma regra nova emitindo
// nome que ninguém cadastrou — a família exata do E2.
const vocabularioDoador = new Set([...(D.PARAM_WHITELIST as Set<string>)].map(chaveSinonimo))
for (const nome of [...new Set(geradosPorRegra)].sort()) {
  if (!vocabularioDoador.has(chaveSinonimo(nome))) {
    conflitos.push({ tipo: 'geradoPorRegraForaDoVocabulario', detalhe: `"${nome}"` })
  }
}

// 6) Qualitativos sem código, e as três famílias misturadas no doador.
for (const termo of SEM_CODIGO) {
  conflitos.push({
    tipo: 'qualitativoSemCodigo',
    detalhe: `"${termo}" não corresponde a nenhum QualitativeCode do contrato`,
  })
}
for (const termo of DESCRICAO_FISICA) {
  conflitos.push({
    tipo: 'descricaoFisicaComoQualitativo',
    detalhe: `"${termo}" é descrição física (cor/aspecto), não código qualitativo`,
  })
}

// ── Escrita ─────────────────────────────────────────────────────────────────
mkdirSync(DESTINO, { recursive: true })
const VERSAO = '1.0.0'

function escrever(arquivo: string, dados: unknown) {
  // Chaves ordenadas: diff textual estável entre reexecuções (R8).
  const ordenar = (v: any): any => {
    if (Array.isArray(v)) return v.map(ordenar)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map(k => [k, ordenar(v[k])]))
    }
    return v
  }
  writeFileSync(join(DESTINO, arquivo), JSON.stringify(ordenar(dados), null, 2) + '\n', 'utf8')
}

// Remove os campos auxiliares que só serviram à migração.
const analitosLimpos = Object.fromEntries(
  Object.entries(analitos).map(([id, a]: [string, any]) => {
    const { _base, origem, ...resto } = a
    return [id, { ...resto, origem: origem.sort() }]
  }),
)

escrever('analitos.json', { version: VERSAO, analytes: analitosLimpos })
escrever('sinonimos.json', { version: VERSAO, synonyms: sinonimos })
escrever('qualitativos.json', {
  version: VERSAO,
  codes: QUALITATIVO,
  growth: CRESCIMENTO,
  physicalDescription: DESCRICAO_FISICA,
  needsClinicalReview: SEM_CODIGO,
})
escrever('culturas.json', { version: VERSAO, materials: D.CULTURE_TYPES })
escrever('descartes.json', { version: VERSAO, skipNames: [...(D.SKIP_NAMES as Set<string>)].sort() })
escrever('marcadores-data.json', {
  version: VERSAO,
  collectionPatterns: (D.COLLECTION_DATE_PATTERNS as RegExp[]).map(r => r.source),
})
escrever('imagem.json', {
  version: VERSAO,
  // A ORDEM é significativa: PET e ECO antes de TC e USG, porque suas
  // descrições contêm as palavras dos outros.
  modalities: (D.IMG_MODALITIES as [string, RegExp][]).map(([codigo, re]) => ({
    code: codigo,
    pattern: re.source,
    flags: re.flags,
  })),
})
escrever('especimes.json', {
  version: VERSAO,
  gasometry: {
    params: D.GASO_PARAMS,
    specialNames: D.GASO_SPECIAL_NAMES,
    // Mapeiam para null no doador: descarte deliberado por redundância com o
    // hemograma. Aqui vira descarte COM motivo registrado (R1), não sumiço.
    deliberatelyDiscarded: Object.entries(D.GASO_PARAMS as Record<string, string | null>)
      .filter(([, v]) => v === null).map(([k]) => k),
  },
  csf: {
    rename: D.LCR_RENAME,
    keep: [...(D.LCR_KEEP as Set<string>)].sort(),
    // Nomes que o fallback por expressão regular de `_lcrName` produz sem
    // constar de `rename`. É a lição do E2: o que uma regra pode produzir tem
    // que existir no catálogo, e isso é um teste, não uma convenção.
    ruleOutputs: [...SAIDAS_REGRA_LIQUOR].sort(),
  },
})
escrever('unidades.json', {
  version: VERSAO,
  // O doador não tem tabela de unidades. Este arquivo nasce vazio de propósito:
  // preenchê-lo por adivinhação seria inventar dado clínico. F4 o popula com
  // as unidades observadas no corpus, sob revisão.
  canonical: {},
  needsClinicalReview: true,
})
escrever('antimicrobianos.json', {
  version: VERSAO,
  // O clinBoard nunca importou antibiograma (D7): não há vocabulário a migrar.
  // Este arquivo existe para deixar a lacuna explícita, não para fingir cobertura.
  antimicrobials: {},
  needsClinicalReview: true,
})

// ── Relatório de conflitos ──────────────────────────────────────────────────
const porTipo = new Map<string, string[]>()
for (const c of conflitos) {
  if (!porTipo.has(c.tipo)) porTipo.set(c.tipo, [])
  porTipo.get(c.tipo)!.push(c.detalhe)
}

const titulos: Record<string, string> = {
  chaveDuplicadaDivergente: 'Chaves duplicadas com valores divergentes',
  quaseDuplicata: 'Nomes canônicos que diferem só por acento, caixa ou espaço',
  geradoPorRegraForaDoVocabulario:
    'Nomes produzidos por regra que o vocabulário não reconhece — a família do E2',
  qualitativoSemCodigo: 'Termos qualitativos sem código correspondente no contrato',
  descricaoFisicaComoQualitativo: 'Descrição física tratada como resultado qualitativo pelo doador',
}

let md = `# Relatório de conflitos da migração do catálogo\n\n`
md += `Gerado por \`scripts/migrate-clinboard-catalog.mts\`. Reexecutável.\n\n`
md += `| Métrica | Valor |\n|---|---|\n`
md += `| Sinônimos migrados | ${Object.keys(sinonimos).length} |\n`
md += `| Analitos distintos | ${Object.keys(analitos).length} |\n`
md += `| Nomes geráveis por regra | ${new Set(geradosPorRegra).size} |\n`
md += `| Conflitos detectados | ${conflitos.length} |\n\n`
md += `**Nenhum conflito foi resolvido automaticamente.** Cada item abaixo exige decisão clínica.\n\n`

for (const [tipo, itens] of porTipo) {
  md += `## ${titulos[tipo] ?? tipo} (${itens.length})\n\n`
  for (const i of [...new Set(itens)].sort()) md += `- ${i}\n`
  md += `\n`
}

md += `## Lacunas deliberadas\n\n`
md += `Campos deixados em \`null\` porque preenchê-los seria inventar dado clínico:\n\n`
md += `- \`loinc\` em todos os ${Object.keys(analitos).length} analitos — o doador não tem LOINC. Nunca inventar.\n`
md += `- \`plausibleRange\` em todos — é a faixa fisicamente possível, usada só para detectar erro de escala (potássio 7,2 lido como 0,72). Sem ela, o validador da F7 não protege contra erro de escala.\n`
md += `- \`defaultUnit\` e \`category\` — o doador não os tem.\n`
md += `- \`unidades.json\` — vazio; F4 popula a partir do corpus, sob revisão.\n`
md += `- \`antimicrobianos.json\` — vazio; o clinBoard nunca importou antibiograma (D7).\n`

writeFileSync(join(DESTINO, 'RELATORIO-CONFLITOS.md'), md, 'utf8')

console.log(`Sinônimos migrados:        ${Object.keys(sinonimos).length}`)
console.log(`Analitos distintos:        ${Object.keys(analitos).length}`)
console.log(`Nomes geráveis por regra:  ${new Set(geradosPorRegra).size}`)
console.log(`Conflitos detectados:      ${conflitos.length}`)
for (const [tipo, itens] of porTipo) console.log(`  ${tipo}: ${new Set(itens).size}`)
console.log(`\nCatálogo em ${DESTINO}`)
