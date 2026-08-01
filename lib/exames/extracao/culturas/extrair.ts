// ══════════════════════════════════════════════════════════════════════════
// Camada 5c · culturas e antibiograma.
//
// Não é um `Matcher`: cultura é bloco, não linha. O isolado sai de uma linha, a
// contagem de colônias de outra, e a tabela de sensibilidade costuma estar
// numa PÁGINA seguinte, depois de um rodapé. Um matcher linha a linha não tem
// como ligar as três coisas — e forçá-lo a isso exigiria "isolado corrente"
// numa variável, que é exatamente o estado mutável que R6/R9 proíbem.
//
// Dois layouts no corpus, e eles são bem diferentes:
//
//   A (IMEC)                        B (laboratório de apoio)
//   Bactéria isolada....: X          Micro-organismo [1]: X   >100000 UFC/mL
//   Antibiograma                     Micro-organismo [2]: Y   >100000 UFC/mL
//   Antimicrobiano Categoria MIC     TESTE DE SENSIBILIDADE
//   Amicacina      S         <=8       [1]   [2]
//                                    Antibiotico  SENS MIC  SENS MIC
//                                    Ampicilina    -    -    R  >= 32
// ══════════════════════════════════════════════════════════════════════════

import type {
  CultureResult, DiscardedItem, DocumentText, ExtractionOptions, Isolate,
  Mic, Susceptibility, SusceptibilityStandard, TemporalRef, TextLine,
} from '../contratos'
import { marcadorDeColeta } from '../normalizadores/data'
import { separarColunas } from '../extratores/colunas'
import { ehRotuloDeMetadado } from '../extratores/metadados'
import culturas from '../catalogo/culturas.json'

const MATERIAIS = culturas.materials as Record<string, string>

/**
 * As chaves ordenadas da mais longa para a mais curta.
 *
 * Casar por prefixo exige escolher a mais específica: senão "CULTURA DE
 * VIGILÂNCIA - PESQUISA DE MRSA" cai em "CULTURA DE VIGILÂNCIA" e o exame
 * perde o germe que de fato procurou.
 */
const CHAVES_POR_ESPECIFICIDADE = Object.entries(MATERIAIS)
  .sort((a, b) => b[0].length - a[0].length)

/** Cabeçalho que abre um bloco de cultura. */
const RE_CABECALHO_CULTURA =
  /^(?:hemocultura|urocultura|urinocultura|coprocultura|cultura\b|swab\b|aspirado\b|secre[çc][ãa]o\b|pesquisa\s+de\s+mrsa)/i

/**
 * Layout A: o isolado vem rotulado.
 *
 * `Resultado` entra na lista porque a cultura de VIGILÂNCIA do IMEC usa esse
 * rótulo para o germe: "Resultado...........: Klebsiella pneumoniae". Sem ele,
 * uma vigilância POSITIVA para enterobactéria produtora de ESBL era registrada
 * como indeterminada e sem isolado — e vigilância positiva define precaução de
 * contato.
 *
 * Só vale DENTRO de um bloco de cultura, e só quando o valor não é número:
 * "Resultado: 154,1" num laudo bioquímico é valor de exame, e pertence ao
 * matcher de bloco.
 */
const RE_ISOLADO_A =
  /^(?:bact[ée]ria\s+isolada|micro-?organismo\s+isolado|agente\s+isolado|resultados?)\s*[.:]+\s*(.+)$/i

/** Um organismo é texto, não número. Barra "Resultado: 154,1" de virar isolado. */
const RE_NAO_ORGANISMO = /^[<>=]?\s*[\d.,]+\s*[A-Za-zµ%/³]*\s*$/

/** Layout B: isolados numerados, com a contagem colada. */
const RE_ISOLADO_B = /^micro-?organismo\s*\[(\d+)\]\s*[.:]+\s*(.+)$/i

/** "Não houve desenvolvimento", "ausência de crescimento", "sem crescimento". */
const RE_SEM_CRESCIMENTO =
  /(?:n[ãa]o\s+houve\s+(?:crescimento|desenvolvimento)|aus[êe]ncia\s+de\s+(?:crescimento|desenvolvimento)|sem\s+crescimento|cultura\s+negativa)/i

const RE_CONTAMINADA = /contamina[çd]|flora\s+mista|m[úu]ltiplos\s+morfotipos/i

/** Abre a tabela de sensibilidade nos dois layouts. */
const RE_ABRE_ANTIBIOGRAMA = /^(?:antibiograma|teste\s+de\s+sensibilidade|tsa)\b/i

/** Cabeçalho de coluna da tabela — não é um antimicrobiano. */
const RE_CABECALHO_TABELA =
  /^(?:antimicrobiano|antibi[óo]tico|antibiotico|classifica|categoria|\[\d\]|sens\b|mic\b)/i

/** Linha de legenda: "S=Sensível", "I=Sensível-Necessário aumento…". */
const RE_LEGENDA = /^(?:[SIRN]\s*[/*]?\s*[A-Z]?\s*=|branco\s*=|neg\s*=|mic\s*=|---\s*=|\^\s*=|interpreta[çc][ãa]o\s*:)/i

const INTERPRETACOES: Record<string, Susceptibility['interpretation']> = {
  S: 'S', I: 'I', R: 'R', SDD: 'SDD', NS: 'NS',
  'S*': 'S', 'R*': 'R',
  '-': 'NT', '--': 'NT', '---': 'NT', 'N/R': 'NT', 'NR': 'NT', 'NT': 'NT',
}

const RE_MIC = /^([<>]=?|≤|≥)?\s*([\d.,]+(?:\/[\d.,]+)?)$/

/** "6 x (10)5 UFC", ">100000 UFC/mL", ">= 10^5 UFC/mL". */
const RE_UFC =
  /([<>]=?|≤|≥)?\s*([\d.,]+)\s*(?:x\s*\(?10\)?\s*\^?(\d+)|[eE]([\d]+))?\s*(?:UFC|CFU)\s*(?:\/\s*(mL|ml|g))?/

function operadorDe(simbolo: string | undefined): Mic['operator'] {
  switch (simbolo) {
    case '<': return 'lt'
    case '<=': case '≤': return 'lte'
    case '>': return 'gt'
    case '>=': case '≥': return 'gte'
    default: return 'eq'
  }
}

/**
 * Número de antibiograma.
 *
 * ATENÇÃO: aqui o ponto é DECIMAL, não separador de milhar. O analisador emite
 * o MIC em formato internacional — "0.25", "<=0.12". Tratar o ponto como
 * milhar transformava 0,25 mg/L em 25 mg/L: um erro de escala de cem vezes,
 * num número que decide se o antibiótico é usável. É a mesma família do
 * potássio 7,2 lido como 0,72.
 */
function numero(texto: string): number | null {
  const t = texto.trim()
  const temPonto = t.includes('.')
  const temVirgula = t.includes(',')
  // Os dois presentes: formato pt-BR, ponto é milhar.
  if (temPonto && temVirgula) return finito(Number(t.replace(/\./g, '').replace(',', '.')))
  if (temVirgula) return finito(Number(t.replace(',', '.')))
  // Só ponto, ou nenhum: decimal. Contagem de colônias vem sem separador
  // ("100000"), então não há milhar a desfazer.
  return finito(Number(t))
}

function finito(n: number): number | null {
  return Number.isFinite(n) ? n : null
}

/** MIC pode ser razão de combinação ("> 8/4"); nesse caso `value` fica null. */
export function interpretarMic(bruto: string, unidade: string): Mic | null {
  const t = bruto.trim()
  if (!t || t === '-' || t === '---') return null
  const m = t.match(RE_MIC)
  if (!m) return null
  const numerico = m[2]!.includes('/') ? null : numero(m[2]!)
  return { operator: operadorDe(m[1]), value: numerico, unit: unidade, raw: t }
}

export function interpretarContagem(linha: string): Isolate['colonyCount'] {
  const m = linha.match(RE_UFC)
  if (!m) return null
  const base = numero(m[2]!)
  if (base === null) return null
  const expoente = m[3] ?? m[4]
  const valor = expoente ? base * 10 ** Number(expoente) : base
  return {
    value: valor,
    operator: operadorDe(m[1]),
    unit: m[5]?.toLowerCase() === 'g' ? 'CFU/g' : 'CFU/mL',
    raw: m[0].trim(),
  }
}

/** Material canônico a partir do cabeçalho do bloco. */
function materialDe(titulo: string): string {
  // "CULTURA - ASPIRADO TRAQUEAL" e "Aspirado Traqueal" são o MESMO material.
  // Sem tirar o prefixo, o cabeçalho repetido a cada página abria um bloco novo
  // e o mesmo laudo virava três culturas.
  const alvo = titulo
    .toUpperCase()
    .replace(/^CULTURA\s*(?:QUANTITATIVA)?\s*(?:E\s+ANTIBIOGRAMA\s*)?(?:[-–:]\s*|DE\s+)?/, '')
    .replace(/\s*\+\s*TSA\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Da chave MAIS ESPECÍFICA para a mais genérica. "CULTURA DE VIGILÂNCIA -
  // PESQUISA DE MRSA" casa com duas entradas, e a genérica ("CULTURA DE
  // VIGILÂNCIA") vinha primeiro por acaso da ordem do objeto — o exame que
  // procurou MRSA perdia o nome do germe que procurou.
  const original = titulo.toUpperCase().replace(/\s+/g, ' ').trim()
  for (const [chave, canonico] of CHAVES_POR_ESPECIFICIDADE) {
    if (original.startsWith(chave) || alvo.startsWith(chave)) return canonico
  }
  return titulo.trim()
}

/**
 * Normas declaradas no documento.
 *
 * A norma vale por ANTIMICROBIANO: um mesmo antibiograma do corpus traz o
 * corpo em BrCAST e ressalva CLSI para estreptomicina, gentamicina de alto
 * nível e caspofungina. Decisão clínica de 31/07/2026: sem declaração nenhuma,
 * assume BrCAST — e `standardSource` registra que foi assunção.
 */
function normasDeclaradas(linhas: TextLine[]): {
  padrao: SusceptibilityStandard
  declarado: boolean
  excecoesClsi: string[]
} {
  const texto = linhas.map(l => l.text).join('\n')
  const mencionaBrcast = /BrCAST|EUCAST/i.test(texto)
  const excecoes: string[] = []
  // A ressalva costuma quebrar entre linhas: "…interpretadas através de
  // padronização" numa, "CLSI." na seguinte. Olhar só a linha do "CLSI"
  // perderia o nome do antimicrobiano — e o antimicrobiano é justamente o que
  // muda de norma.
  linhas.forEach((linha, i) => {
    if (!/CLSI/i.test(linha.text)) return
    const janela = [linhas[i - 2]?.text ?? '', linhas[i - 1]?.text ?? '', linha.text].join(' ')
    if (!/interpretad|padroniza/i.test(janela)) return
    const nomes = janela.match(/[A-ZÀ-Ý][a-zà-ÿ]{4,}(?:\s+(?:de\s+)?Alto\s+N[íi]vel)?/g) ?? []
    for (const nome of nomes) {
      if (/^(Resultado|Interpreta|Padroniza|Antimicrobian|Candida|Estirpe|Amostra|Para|Atrav)/i.test(nome)) continue
      excecoes.push(nome.trim())
    }
  })
  return {
    padrao: mencionaBrcast ? 'BrCAST' : 'BrCAST',
    declarado: mencionaBrcast,
    excecoesClsi: excecoes,
  }
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** A norma vale por antimicrobiano; as ressalvas do laudo vencem o padrão. */
function normaDoAntimicrobiano(
  nome: string,
  norma: { padrao: SusceptibilityStandard; excecoesClsi: string[] },
): SusceptibilityStandard {
  const alvo = semAcento(nome)
  for (const excecao of norma.excecoesClsi) {
    const e = semAcento(excecao)
    if (alvo.startsWith(e.slice(0, Math.min(8, e.length))) || e.startsWith(alvo.slice(0, 8))) {
      return 'CLSI'
    }
  }
  return norma.padrao
}

interface Bloco {
  titulo: string
  /** Índice global da linha de título, para marcá-la como consumida. */
  tituloLinha: number | null
  linhas: TextLine[]
}

function dividirEmBlocos(texto: DocumentText): Bloco[] {
  const blocos: Bloco[] = []
  let atual: Bloco | null = null
  for (const linha of texto.lines) {
    const t = linha.text.trim()
    if (RE_CABECALHO_CULTURA.test(t) && t.length <= 70) {
      // O mesmo cabeçalho se repete a cada página; não abre bloco novo.
      if (atual && materialDe(atual.titulo) === materialDe(t)) { atual.linhas.push(linha); continue }
      atual = { titulo: t, tituloLinha: linha.index, linhas: [] }
      blocos.push(atual)
      continue
    }
    if (atual) atual.linhas.push(linha)
  }
  return blocos
}

/** Tabela de sensibilidade do layout B: colunas por isolado. */
function lerTabelaMultiIsolado(
  linhas: TextLine[],
  inicio: number,
  quantidadeIsolados: number,
  norma: ReturnType<typeof normasDeclaradas>,
  unidadeMic: string,
  usadas: Set<number>,
): Susceptibility[][] {
  const porIsolado: Susceptibility[][] = Array.from({ length: quantidadeIsolados }, () => [])
  for (let i = inicio; i < linhas.length; i++) {
    const colunas = separarColunas(linhas[i]!).map(c => c.texto)
    if (colunas.length < 2) continue
    const nome = colunas[0]!.trim()
    if (RE_CABECALHO_TABELA.test(nome) || RE_LEGENDA.test(linhas[i]!.text)) continue
    if (!/^[A-Za-zÀ-ÿ]/.test(nome)) continue
    usadas.add(linhas[i]!.index)

    // Pares (SENS, MIC) por isolado, na ordem das colunas.
    for (let k = 0; k < quantidadeIsolados; k++) {
      const sens = colunas[1 + k * 2]
      const mic = colunas[2 + k * 2]
      if (sens === undefined) continue
      const interpretacao = INTERPRETACOES[sens.trim().toUpperCase()] ?? 'unknown'
      if (porIsolado[k]!.some(x => semAcento(x.antimicrobial) === semAcento(nome))) continue
      porIsolado[k]!.push({
        antimicrobial: nome,
        interpretation: interpretacao,
        mic: mic ? interpretarMic(mic, unidadeMic) : null,
        method: null,
        standard: normaDoAntimicrobiano(nome, norma),
        standardSource: norma.declarado ? 'declared' : 'assumed',
      })
    }
  }
  return porIsolado
}

/** Tabela de sensibilidade do layout A: um isolado, três colunas. */
function lerTabelaSimples(
  linhas: TextLine[],
  inicio: number,
  norma: ReturnType<typeof normasDeclaradas>,
  unidadeMic: string,
  usadas: Set<number>,
): Susceptibility[] {
  const saida: Susceptibility[] = []
  for (let i = inicio; i < linhas.length; i++) {
    const colunas = separarColunas(linhas[i]!).map(c => c.texto)
    if (colunas.length < 2) continue
    const nome = colunas[0]!.trim()
    if (RE_CABECALHO_TABELA.test(nome) || RE_LEGENDA.test(linhas[i]!.text)) continue
    if (!/^[A-Za-zÀ-ÿ]/.test(nome) || nome.length > 40) continue
    const bruta = colunas[1]!.trim().toUpperCase()
    const interpretacao = INTERPRETACOES[bruta]
    if (!interpretacao) continue
    if (saida.some(x => semAcento(x.antimicrobial) === semAcento(nome))) continue
    usadas.add(linhas[i]!.index)
    saida.push({
      antimicrobial: nome,
      interpretation: interpretacao,
      mic: colunas[2] ? interpretarMic(colunas[2], unidadeMic) : null,
      method: null,
      standard: normaDoAntimicrobiano(nome, norma),
      standardSource: norma.declarado ? 'declared' : 'assumed',
    })
  }
  return saida
}

export function extrairCulturas(
  texto: DocumentText,
  dataDocumento: TemporalRef,
  opcoes: Readonly<ExtractionOptions>,
  profileId: string,
): { cultures: CultureResult[]; discarded: DiscardedItem[]; linhasUsadas: Set<number> } {
  const cultures: CultureResult[] = []
  const discarded: DiscardedItem[] = []
  // Quais linhas este extrator realmente consumiu.
  //
  // Antes, o segmentador marcava um bloco inteiro como `culture` e nenhum
  // matcher de laboratório se aplicava ali. Como a seção de cultura não tinha
  // fim, ela engolia o que viesse depois: no IMEC5 uma sorologia inteira, 42
  // linhas, sumia sem virar observação NEM descarte — o silêncio que R1
  // proíbe. Declarar as linhas usadas troca uma heurística de fronteira por um
  // fato: o que a cultura não usou volta para o motor.
  const linhasUsadas = new Set<number>()
  const norma = normasDeclaradas(texto.lines)
  const unidadeMic =
    texto.lines.find(l => /MIC\s*=\s*mcg\/ml/i.test(l.text)) ? 'mg/L' : 'mg/L'

  for (const bloco of dividirEmBlocos(texto)) {
    const primeira = bloco.linhas[0] ?? texto.lines[0]
    if (!primeira) continue
    if (bloco.tituloLinha !== null) linhasUsadas.add(bloco.tituloLinha)

    // ── Data da coleta do bloco ─────────────────────────────────────────
    let coleta = dataDocumento
    for (const linha of bloco.linhas) {
      const marca = marcadorDeColeta(linha.text)
      if (marca) { coleta = marca; break }
    }

    // ── Isolados ────────────────────────────────────────────────────────
    const isolates: Isolate[] = []
    const vistos = new Set<string>()
    for (const linha of bloco.linhas) {
      const a = linha.text.match(RE_ISOLADO_A)
      const b = linha.text.match(RE_ISOLADO_B)
      const bruto = a?.[1] ?? b?.[2]
      if (!bruto) continue
      const organismo = bruto.replace(/\s{2,}.*$/, '').trim()
      // Nome de organismo não é número nem rótulo do laudo. Sem esta guarda,
      // "Resultado:   Valor de referência :" — o cabeçalho de duas colunas da
      // tabela — virava um isolado chamado "Valor de referência", e a cultura
      // saía POSITIVA por causa dele.
      if (RE_NAO_ORGANISMO.test(organismo)) continue
      if (ehRotuloDeMetadado(organismo)) continue
      if (RE_SEM_CRESCIMENTO.test(organismo)) { linhasUsadas.add(linha.index); continue }
      linhasUsadas.add(linha.index)
      if (!organismo || vistos.has(organismo)) continue
      // "Bactéria isolada: NÃO HOUVE CRESCIMENTO DE BACTÉRIAS." — o campo do
      // isolado traz a AUSÊNCIA de isolado. Criar um isolado com esse nome
      // fazia a cultura sair como `positive`: uma hemocultura negativa
      // registrada como positiva, que é erro clínico direto.
      if (RE_SEM_CRESCIMENTO.test(organismo)) continue
      vistos.add(organismo)
      isolates.push({
        organism: organismo,
        colonyCount: interpretarContagem(linha.text),
        susceptibilities: [],
      })
    }

    // ── Crescimento ─────────────────────────────────────────────────────
    for (const l of bloco.linhas) {
      if (RE_SEM_CRESCIMENTO.test(l.text) || RE_CONTAMINADA.test(l.text) || RE_LEGENDA.test(l.text)) {
        linhasUsadas.add(l.index)
      }
    }
    const semCrescimento = bloco.linhas.some(l => RE_SEM_CRESCIMENTO.test(l.text))
    const contaminada = bloco.linhas.some(l => RE_CONTAMINADA.test(l.text))
    const growth: CultureResult['growth'] =
      isolates.length > 0 ? (contaminada ? 'contaminated' : 'positive')
      : semCrescimento ? 'noGrowth'
      : 'indeterminate'

    // ── Antibiograma ────────────────────────────────────────────────────
    const abertura = bloco.linhas.findIndex(l => RE_ABRE_ANTIBIOGRAMA.test(l.text.trim()))
    if (abertura >= 0) linhasUsadas.add(bloco.linhas[abertura]!.index)
    if (abertura >= 0 && isolates.length > 0) {
      const multiIsolado = bloco.linhas
        .slice(abertura, abertura + 4)
        .some(l => /\[\s*1\s*\].*\[\s*2\s*\]/.test(l.text))
      if (multiIsolado && isolates.length > 1) {
        const tabelas = lerTabelaMultiIsolado(
          bloco.linhas, abertura + 1, isolates.length, norma, unidadeMic, linhasUsadas,
        )
        tabelas.forEach((t, i) => { if (isolates[i]) isolates[i]!.susceptibilities = t })
      } else {
        isolates[0]!.susceptibilities = lerTabelaSimples(
          bloco.linhas, abertura + 1, norma, unidadeMic, linhasUsadas,
        )
      }
    } else if (abertura >= 0) {
      // R1/D7 — antibiograma sem isolado a que se ligar não some em silêncio.
      discarded.push({
        page: bloco.linhas[abertura]!.page,
        lineIndex: bloco.linhas[abertura]!.index,
        rawLine: opcoes.retainRawText ? bloco.linhas[abertura]!.text : '',
        reason: 'unsupportedBlock',
        detail: 'antibiograma sem isolado identificado no bloco',
      })
    }

    cultures.push({
      specimen: materialDe(bloco.titulo),
      collectedAt: coleta,
      growth,
      isolates,
      provenance: {
        page: primeira.page,
        lineIndex: primeira.index,
        rawLine: opcoes.retainRawText ? bloco.titulo : '',
        matcherId: 'cultura',
        profileId,
        fallbackUsed: false,
      },
    })
  }

  return { cultures, discarded, linhasUsadas }
}
