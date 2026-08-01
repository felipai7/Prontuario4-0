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

/**
 * Nomes que o EAS produz sem sufixo de urina, mas que SÓ existem em urina:
 * densidade, cetonas, cilindros, cristais, leveduras, células do sedimento.
 *
 * Sem esta lista, oito deles ganhariam DOIS analitos — um vindo do NAME_MAP
 * como sangue e outro do EAS — e o mesmo exame apareceria em duas linhas do
 * histórico do paciente. É a mesma classe de estrago que o E1 corrigiu.
 */
const URINARIOS_POR_NATUREZA = new Set(
  Object.values(D.EAS_NAME_MAP as Record<string, string>)
    .filter(v => v && !/\(/.test(v))
    .map(chaveSinonimoBruta),
)

/** Igual a `chaveSinonimo`, declarada antes para uso no conjunto acima. */
function chaveSinonimoBruta(s: string): string {
  return s.normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim()
}

/**
 * Renomeações canônicas por decisão clínica (31/07/2026).
 *
 * O doador grafa o cálcio iônico venoso como "Cálcio iônico Venoso", sem
 * parênteses, enquanto o arterial já é "Cálcio iônico (Arterial)" e todos os
 * demais parâmetros de gasometria usam "(Arterial)"/"(Venosa)". Padronizado.
 *
 * A grafia antiga continua valendo como SINÔNIMO: laudos que a escrevem
 * literalmente precisam seguir resolvendo, senão a padronização parte o
 * histórico do paciente em duas linhas — o estrago que o E1 corrigiu.
 */
const RENOMEACOES_CLINICAS: Record<string, string> = {
  'Cálcio iônico Venoso': 'Cálcio iônico (Venosa)',
}

function canonizar(nome: string): string {
  return RENOMEACOES_CLINICAS[nome] ?? nome
}

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
  if (curto === 'serum' && URINARIOS_POR_NATUREZA.has(chaveSinonimoBruta(nomeCanonico))) {
    specimen = 'urine'
    curto = 'urine'
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
  // Sedimento urinário: o contrato já previa rare/occasional/moderate/abundant,
  // e o doador não tinha termo nenhum mapeado para eles. Vocabulário padrão do
  // EAS, acrescentado a partir do corpus.
  'RARAS': 'rare', 'RARA': 'rare', 'RAROS': 'rare', 'RARO': 'rare',
  'ALGUMAS': 'occasional', 'ALGUNS': 'occasional', 'OCASIONAIS': 'occasional',
  'MODERADA': 'moderate', 'MODERADAS': 'moderate', 'MODERADO': 'moderate',
  'MODERADOS': 'moderate', 'REGULAR': 'moderate',
  'NUMEROSAS': 'abundant', 'NUMEROSOS': 'abundant',
  'ABUNDANTE': 'abundant', 'ABUNDANTES': 'abundant',
  'AUSENTES': 'absent',
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

/**
 * Decisão clínica (31/07/2026): não usamos resultado de imunidade sorológica.
 *
 * "Não usar" não pode virar sumiço silencioso (R1): estes termos entram no
 * catálogo de descarte deliberado, e a linha correspondente aparece em
 * `discarded[]` com motivo `notUsedClinically`. O usuário fica sabendo que o
 * laudo trazia o dado e que o módulo optou por não importá-lo.
 */
const NAO_USADOS = ['IMUNE', 'NÃO IMUNE', 'NAO IMUNE']

/**
 * Grafias que o LIS usa e o doador não cobria.
 *
 * A seção 8.1 avisa que estes laudos grafam o oxigênio de forma irregular — o
 * catálogo herdado já trazia "02 SAT" com o DÍGITO ZERO no lugar da letra O.
 * Faltava a forma COLADA, sem separador nenhum, que é a que o IMEC usa: sete
 * saturações perdidas no corpus por causa de um espaço.
 */
const SINONIMOS_EXTRA: Record<string, string> = {
  'O2SAT': 'O2 Sat', '02SAT': 'O2 Sat', 'SATO2': 'O2 Sat', 'SAT O2': 'O2 Sat',
  'MIELOBLASTOS': 'Mieloblastos',
}

// ── Diferencial leucocitário (decisão clínica de 31/07/2026) ────────────────
//
// O laudo traz DOIS números na mesma linha:
//
//   Neutrófilos   :  69   %   8.625   /mm³   51 a 65   2.295 a 6.500
//
// Decisão da Juliana, na revisão de paridade: vale o ABSOLUTO, em /mm³ — o
// mesmo que o clinBoard já guarda. Cheguei a implementar os dois como analitos
// separados e foi recusado: um exame, um valor.
//
// A lista existe para o matcher saber em quais linhas há dois números a
// escolher; sem ela, o percentual (que vem primeiro) venceria por posição.
const CELULAS_DIFERENCIAL = [
  'Promielócitos', 'Mielócitos', 'Metamielócitos', 'Bastonetes', 'Segmentados',
  'Neutrófilos', 'Eosinófilos', 'Basófilos', 'Linfócitos', 'Linfócitos Atípicos',
  'Monócitos', 'Plasmócitos', 'Blastos',
  // Faltava, e aparecia no HUGO. Sem ele a linha inteira caía em descarte.
  'Mieloblastos',
]

// ── Faixas de plausibilidade (decisão clínica de 31/07/2026) ────────────────
//
// NÃO são faixas de normalidade. São o intervalo FISICAMENTE POSSÍVEL, usado
// só para detectar erro de escala — um potássio de 7,2 lido como 0,72 não gera
// erro em lugar nenhum, gera conduta. São deliberadamente largas: qualquer
// valor real de UTI precisa caber dentro, inclusive os extremos incompatíveis
// com a vida, que existem e são justamente os que não podem ser perdidos.
//
// A unidade é parte da faixa. Se o laudo vier em outra unidade, o validador
// não opina — nunca converte por conta própria.
//
// Cobre os analitos de maior peso em UTI, conforme combinado. Os demais 250
// seguem com `plausibleRange: null`, e o validador simplesmente não os checa.
const PLAUSIBILIDADE: Record<string, { min: number; max: number; unit: string }> = {
  // Eletrólitos e função renal
  'sodio.serum':          { min: 90,   max: 200,     unit: 'mmol/L' },
  'potassio.serum':       { min: 0.5,  max: 12,      unit: 'mmol/L' },
  'cloro.serum':          { min: 50,   max: 180,     unit: 'mmol/L' },
  'magnesio.serum':       { min: 0.2,  max: 15,      unit: 'mg/dL' },
  'fosforo.serum':        { min: 0.1,  max: 25,      unit: 'mg/dL' },
  'calcio.ionico.serum':  { min: 0.2,  max: 3,       unit: 'mmol/L' },
  'ureia.serum':          { min: 1,    max: 500,     unit: 'mg/dL' },
  'creatinina.serum':     { min: 0.05, max: 30,      unit: 'mg/dL' },
  // Metabólico
  'glicose.serum':        { min: 5,    max: 1500,    unit: 'mg/dL' },
  'lactato.serum':        { min: 0.1,  max: 40,      unit: 'mmol/L' },
  'albumina.serum':       { min: 0.3,  max: 8,       unit: 'g/dL' },
  // Gasometria arterial
  'ph.art':               { min: 6.5,  max: 7.9,     unit: '' },
  'pco2.art':             { min: 5,    max: 200,     unit: 'mmHg' },
  'po2.art':              { min: 10,   max: 700,     unit: 'mmHg' },
  'hco3.art':             { min: 1,    max: 60,      unit: 'mmol/L' },
  'be.art':               { min: -40,  max: 40,      unit: 'mmol/L' },
  // Hemograma
  'hemoglobina.serum':    { min: 1,    max: 25,      unit: 'g/dL' },
  'hematocrito.serum':    { min: 3,    max: 75,      unit: '%' },
  'leucocitos.serum':     { min: 0,    max: 500000,  unit: '/mm³' },
  'plaquetas.serum':      { min: 0,    max: 3000000, unit: '/mm³' },
  // Coagulação
  'inr.serum':            { min: 0.4,  max: 20,      unit: '' },
  'ttpa.serum':           { min: 8,    max: 300,     unit: 's' },
  // Inflamatório e hepático
  'pcr.serum':            { min: 0,    max: 600,     unit: 'mg/L' },
  'bilirrubina.total.serum': { min: 0, max: 60,      unit: 'mg/dL' },
  'tgo.ast.serum':        { min: 0,    max: 20000,   unit: 'U/L' },
  'tgp.alt.serum':        { min: 0,    max: 20000,   unit: 'U/L' },
  'amilase.serum':        { min: 0,    max: 20000,   unit: 'U/L' },
  'lipase.serum':         { min: 0,    max: 20000,   unit: 'U/L' },
  // Urina
  'densidade.urine':      { min: 1,    max: 1.06,    unit: '' },
}

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

function registrarAnalito(nomeBruto: string, origem: string, valueKind = 'numeric') {
  const nomeCanonico = canonizar(nomeBruto)
  // A grafia antiga segue resolvendo, para a padronização não partir histórico.
  if (nomeCanonico !== nomeBruto) sinonimos[chaveSinonimo(nomeBruto)] = idDeAnalito(nomeCanonico).id
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
      plausibleRange: PLAUSIBILIDADE[id] ?? null,
      // Segue pendente de revisão enquanto não houver faixa de plausibilidade
      // nem unidade padrão — os dois campos que o validador da F7 precisa.
      needsClinicalReview: !PLAUSIBILIDADE[id],
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

// 1c) Grafias extras, autoradas a partir do corpus. As de gasometria entram
//     no escopo dos dois contextos, como as demais do GASO_PARAMS.
for (const [bruto, canonico] of Object.entries(SINONIMOS_EXTRA)) {
  if (canonico === 'O2 Sat') continue // tratado abaixo, com escopo
  const id = registrarAnalito(canonico, 'corpus')
  sinonimos[chaveSinonimo(bruto)] = id
}

// 2) Vocabulário POR ESPÉCIME.
//
// R6: contexto de espécime é escopo léxico. "Glicose" dentro de uma seção de
// urina é glicose urinária; no sangue, é glicemia; no líquor, é outra coisa
// ainda. Jogar os três na mesma tabela faz o último carregado vencer — foi o
// que aconteceu na primeira versão deste script, e uma glicemia de sangue
// passou a resolver para glicose urinária.
//
// Regra: se o nome canônico tem sufixo de espécime, o sinônimo NU é ambíguo e
// fica restrito ao escopo. Se não tem (densidade, cetonas, cilindros — que só
// existem em urina), pode ser global sem risco.
// Saídas do fallback por expressão regular dentro de _lcrName. Ficam num dado
// nomeado, e não soltas, porque o teste do E2 precisa lê-las do catálogo —
// uma lista repetida no teste provaria só que copiei certo.
const SAIDAS_REGRA_LIQUOR = [
  'Células Nucleadas (LCR)', 'Células (LCR)', 'Macrófagos (LCR)',
  'Cloretos (LCR)', 'Proteínas (LCR)',
]

const sinonimosPorEspecime: Record<string, Record<string, string>> = {
  urine: {}, csf: {}, arterialBlood: {}, venousBlood: {},
}

function registrarPorEspecime(especime: string, bruto: string, canonico: string, origem: string) {
  const id = registrarAnalito(canonico, origem)
  const temSufixo = /\((LCR|U|Arterial|Venosa)\)\s*$|\sVenoso\s*$/i.test(canonico)
  if (temSufixo) sinonimosPorEspecime[especime]![chaveSinonimo(bruto)] = id
  else sinonimos[chaveSinonimo(bruto)] = id
  return id
}

const easMap = D.EAS_NAME_MAP as Record<string, string>
for (const [bruto, canonico] of Object.entries(easMap)) {
  if (!canonico) continue
  registrarPorEspecime('urine', bruto, canonico, 'EAS_NAME_MAP')
}

// Líquor: a tabela de renomeação é, por definição, escopo de líquor.
for (const [bruto, canonico] of Object.entries(D.LCR_RENAME as Record<string, string>)) {
  registrarPorEspecime('csf', bruto, canonico, 'LCR_RENAME')
}

// Os nomes que o fallback por expressão regular de `_lcrName` produz não estão
// no LCR_RENAME: "Células Nucleadas", "Macrófagos", "Cloretos", "Proteínas"
// aparecem NUS no laudo e só ganham o sufixo (LCR) pela regra. Sem registrá-los
// no escopo de líquor, "Cloretos" dentro do líquor resolvia para o cloreto
// SÉRICO — outro analito, outra linha no histórico do paciente.
for (const nome of SAIDAS_REGRA_LIQUOR) {
  const nu = nome.replace(/\s*\(LCR\)\s*$/, '')
  registrarPorEspecime('csf', nu, nome, 'regra-liquor')
}
for (const nome of D.LCR_KEEP as Set<string>) {
  const nu = nome.replace(/\s*\(LCR\)\s*$/, '')
  if (nu !== nome) registrarPorEspecime('csf', nu, nome, 'LCR_KEEP')
}

// Gasometria: o mesmo parâmetro nu ("SODIO", "PH") significa arterial ou venoso
// conforme a seção. Sem escopo, um sódio de gasometria viraria o sódio sérico.
for (const [contexto, especime] of [['Arterial', 'arterialBlood'], ['Venosa', 'venousBlood']] as const) {
  for (const [bruto, canonico] of Object.entries(D.GASO_PARAMS as Record<string, string | null>)) {
    if (!canonico) continue
    registrarPorEspecime(especime, bruto, `${canonico} (${contexto})`, 'GASO_PARAMS')
    // O analisador escreve o ÍON, com a carga: "K+", "NA+", "CL-". O catálogo
    // herdado tem só "K", "NA", "CL". Sem estas variantes, o sódio de uma
    // gasometria arterial resolvia para o sódio SÉRICO — outro analito, outra
    // linha no histórico do paciente.
    if (bruto.length <= 3) {
      for (const carga of ['+', '++', '-']) {
        registrarPorEspecime(especime, `${bruto}${carga}`, `${canonico} (${contexto})`, 'GASO_PARAMS')
      }
    }
  }
  for (const [bruto, canonico] of Object.entries((D.GASO_SPECIAL_NAMES as any)[contexto] ?? {})) {
    registrarPorEspecime(especime, bruto, canonico as string, 'GASO_SPECIAL_NAMES')
  }
  for (const [bruto, canonico] of Object.entries(SINONIMOS_EXTRA)) {
    if (canonico !== 'O2 Sat') continue
    registrarPorEspecime(especime, bruto, `${canonico} (${contexto})`, 'corpus')
  }
}

// 3) Nomes que REGRAS podem produzir. É a lição do E2: sete nomes de líquor
//    eram gerados de propósito pelo parser e não estavam na whitelist, então
//    chegavam à revisão desmarcados e se perdiam. Aqui todo nome gerável entra
//    no catálogo, e há teste afirmando isso.
const geradosPorRegra: string[] = []

for (const nome of D.LCR_KEEP as Set<string>) geradosPorRegra.push(nome)
for (const nome of Object.values(D.LCR_RENAME as Record<string, string>)) geradosPorRegra.push(nome)
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
/**
 * Correção clínica de 01/08/2026 nos materiais de cultura.
 *
 * O doador colapsa TODA cultura de vigilância em "MRSA". Nos laudos do corpus,
 * "CULTURA DE VIGILÂNCIA EPIDEMIOLÓGICA - SWAB ANAL" declara textualmente que
 * pesquisou "Enterococcus resistentes a Vancomicina" — é VRE, e MRSA é
 * Staphylococcus aureus. Rotular um pelo outro no prontuário afirma um germe
 * que o exame não procurou.
 *
 * A correção não substitui um palpite por outro: a vigilância genérica passa a
 * se chamar apenas "Cultura de Vigilância", sem afirmar alvo nenhum. Só quando
 * o laudo DIZ "pesquisa de MRSA" é que o nome carrega o germe.
 */
const CULTURAS_CORRIGIDAS: Record<string, string> = {
  ...(D.CULTURE_TYPES as Record<string, string>),
  'CULTURA DE VIGILÂNCIA': 'Cultura de Vigilância',
  'CULTURA DE VIGILANCIA': 'Cultura de Vigilância',
  'CULTURA DE VIGILÂNCIA EPIDEMIOLÓGICA': 'Cultura de Vigilância',
  'CULTURA DE VIGILANCIA EPIDEMIOLOGICA': 'Cultura de Vigilância',
  'CULTURA DE VIGILÂNCIA - PESQUISA DE MRSA': 'Vigilância MRSA',
  'PESQUISA DE MRSA': 'Vigilância MRSA',
  'SWAB ANAL': 'Swab Anal',
  'SWAB NASAL': 'Swab Nasal',
  'VIGILÂNCIA': 'Cultura de Vigilância',
  'VIGILANCIA': 'Cultura de Vigilância',
}

for (const nome of Object.values(D.CULTURE_TYPES as Record<string, string>)) geradosPorRegra.push(nome)
for (const nome of Object.values(CULTURAS_CORRIGIDAS)) geradosPorRegra.push(nome)

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
// Vocabulário NOVO, autorado aqui por decisão clínica: não estar no doador é o
// esperado, não um conflito. O que este cheque procura é regra emitindo nome
// que NINGUÉM cadastrou.
const autorados = new Set(
  ['Cultura de Vigilância', 'Vigilância MRSA', 'Swab Anal', 'Swab Nasal']
    .map(chaveSinonimo),
)
for (const nome of [...new Set(geradosPorRegra)].sort()) {
  const k = chaveSinonimo(nome)
  if (!vocabularioDoador.has(k) && !autorados.has(k)) {
    conflitos.push({ tipo: 'geradoPorRegraForaDoVocabulario', detalhe: `"${nome}"` })
  }
}

// 6) As duas famílias que o doador misturava já têm decisão clínica tomada
//    (31/07/2026) e por isso não são mais conflito — são dado do catálogo:
//    descrição física vira valor de texto; imunidade sorológica não é
//    importada, mas é registrada em `discarded[]`.

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
escrever('sinonimos.json', {
  version: VERSAO,
  synonyms: sinonimos,
  // R6 — vocabulário que só vale dentro do escopo do espécime. Consultado
  // ANTES do global quando a seção prova o contexto, e ignorado fora dele.
  bySpecimen: sinonimosPorEspecime,
})
escrever('qualitativos.json', {
  version: VERSAO,
  codes: QUALITATIVO,
  growth: CRESCIMENTO,
  // Decisão clínica de 31/07/2026: cor e aspecto do líquor são TEXTO. O doador
  // os classificava como 'normal'/'high' — "xantocrômico" não é um resultado
  // alterado, é a cor do líquor. A leitura clínica fica no módulo de
  // interpretação, fora daqui (R3).
  physicalDescription: DESCRICAO_FISICA,
  // Decisão clínica de 31/07/2026: resultado de imunidade não é importado.
  // Continua visível em `discarded[]` com motivo `notUsedClinically` (R1).
  notUsedClinically: NAO_USADOS,
})
escrever('culturas.json', { version: VERSAO, materials: CULTURAS_CORRIGIDAS })
escrever('descartes.json', { version: VERSAO, skipNames: [...(D.SKIP_NAMES as Set<string>)].sort() })
// Marcadores acrescentados a partir do corpus de culturas, que o doador não
// cobria: "Coletado em (20/07/2026 16:54)" e "Coleta...: 27/07/2026 - 08:40".
const MARCADORES_EXTRA = [
  String.raw`[Cc]oletad[oa]\s+em\s*\(?\s*(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}))?`,
  String.raw`[Cc]oleta[.\s]*:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}:\d{2})`,
]

escrever('marcadores-data.json', {
  version: VERSAO,
  // Os específicos vêm ANTES dos genéricos: "Coleta...: 27/07/2026 - 08:40"
  // também casa com o padrão genérico de "Coleta:", que captura só a data e
  // descarta a hora. Ordem errada = hora de coleta perdida em silêncio, que é
  // o mesmo defeito que a camada de texto expôs no clinBoard.
  collectionPatterns: [
    ...MARCADORES_EXTRA,
    ...(D.COLLECTION_DATE_PATTERNS as RegExp[]).map(r => r.source),
  ],
})
// O doador usa códigos em português (TC, RNM, USG, RX, ECO, CINT, COL, END);
// o contrato usa os códigos do padrão internacional. A tradução fica aqui, num
// lugar só, para não haver dois vocabulários de modalidade circulando.
const MODALIDADE_CONTRATO: Record<string, string> = {
  PET: 'PET', ECO: 'ECHO', COL: 'ENDO', END: 'ENDO',
  CINT: 'NM', TC: 'CT', RNM: 'MR', USG: 'US', RX: 'XR',
}

escrever('imagem.json', {
  version: VERSAO,
  // A ORDEM é significativa: PET e ECO antes de TC e USG, porque suas
  // descrições contêm as palavras dos outros — "TOMOGRAFIA POR EMISSÃO" é PET,
  // e "ECODOPPLERCARDIOGRAMA" contém DOPPLER mas é ecocardiograma.
  modalities: (D.IMG_MODALITIES as [string, RegExp][]).map(([codigo, re]) => ({
    code: MODALIDADE_CONTRATO[codigo] ?? 'other',
    legacyCode: codigo,
    pattern: re.source,
    flags: re.flags,
  })),
})
escrever('diferencial.json', {
  version: VERSAO,
  // Células cujo laudo traz percentual e absoluto lado a lado.
  cells: CELULAS_DIFERENCIAL,
  // O valor que vale é o absoluto, em /mm³ — decisão clínica de 31/07/2026.
  preferAbsolute: true,
  absoluteUnit: '/mm³',
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
// O doador não tem tabela de unidades — esta é AUTORADA, não migrada. Cobre
// só normalização de grafia (a mesma unidade escrita de formas diferentes pelo
// LIS), nunca conversão de valor: converter mg/dL em µmol/L muda o número, e
// mudar número de exame sem decisão clínica explícita é o que R1 proíbe.
const UNIDADES: Record<string, string> = {
  // Contagem celular — a origem de `x10~3/uL`, que é como alguns LIS grafam.
  'X10~3/UL': '10³/µL', 'X10^3/UL': '10³/µL', '10^3/UL': '10³/µL',
  '10E3/UL': '10³/µL', 'MIL/MM3': '10³/µL', 'MIL/MM³': '10³/µL',
  'X10~6/UL': '10⁶/µL', 'X10^6/UL': '10⁶/µL', '10^6/UL': '10⁶/µL',
  'MILHOES/MM3': '10⁶/µL', 'MILHÕES/MM³': '10⁶/µL',
  '/MM3': '/mm³', '/MM³': '/mm³', 'MM3': '/mm³', 'CEL/MM3': '/mm³', 'CEL/MM³': '/mm³',
  '/UL': '/µL', '/µL': '/µL',
  // Massa e concentração
  'MG/DL': 'mg/dL', 'G/DL': 'g/dL', 'MG/L': 'mg/L', 'G/L': 'g/L',
  'UG/DL': 'µg/dL', 'µG/DL': 'µg/dL', 'NG/ML': 'ng/mL', 'PG/ML': 'pg/mL',
  'UG/ML': 'µg/mL', 'µG/ML': 'µg/mL', 'NG/DL': 'ng/dL',
  // Molar
  'MMOL/L': 'mmol/L', 'UMOL/L': 'µmol/L', 'µMOL/L': 'µmol/L', 'MEQ/L': 'mEq/L',
  'MOSM/KG': 'mOsm/kg', 'MOSM/L': 'mOsm/L',
  // Atividade e pressão
  'U/L': 'U/L', 'UI/L': 'UI/L', 'UI/ML': 'UI/mL', 'MUI/ML': 'mUI/mL',
  'MMHG': 'mmHg', 'MM HG': 'mmHg',
  // Adimensionais e razões
  '%': '%', 'SEG': 's', 'SEGUNDOS': 's', 'S': 's',
  'FL': 'fL', 'PG': 'pg',
  'ML/MIN': 'mL/min', 'ML/MIN/1.73M2': 'mL/min/1,73m²',
  // Cultura
  'UFC/ML': 'CFU/mL', 'UFC/G': 'CFU/g',
}

escrever('unidades.json', {
  version: VERSAO,
  canonical: UNIDADES,
  // Nenhuma conversão de valor foi cadastrada, de propósito. Ver comentário.
  conversions: {},
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
