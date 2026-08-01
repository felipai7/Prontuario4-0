// ══════════════════════════════════════════════════════════════════════════
// Contratos do módulo de extração de exames.
//
// Só tipos. Nenhum valor em tempo de execução mora aqui — o que impede que
// este arquivo vire depósito de estado compartilhado (R9).
//
// Convenção deste módulo: NENHUM campo opcional (`?`). Onde o documento de
// especificação usa opcional, aqui usamos `| null` explícito, porque
// `exactOptionalPropertyTypes` está desligado neste repositório e `campo?: X`
// não distingue "ausente" de "presente e undefined" — exatamente a
// ambiguidade que R4 proíbe.
// ══════════════════════════════════════════════════════════════════════════

// ── Camada 1 · texto com geometria ─────────────────────────────────────────

/** Item de texto como o PDF o entrega, com a largura MEDIDA (não estimada). */
export interface TextItem {
  text: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Linha reconstruída a partir dos itens que compartilham a mesma faixa de Y.
 *
 * `gaps` guarda o espaço horizontal real entre itens consecutivos — é o que
 * permite distinguir "nome  valor  unidade  referência" em colunas de uma
 * frase em prosa, sem depender de largura estimada de caractere.
 */
export interface TextLine {
  page: number
  /** Índice global da linha no documento, estável e usado em toda procedência. */
  index: number
  text: string
  y: number
  items: TextItem[]
  gaps: number[]
}

export interface PageMetrics {
  page: number
  width: number
  height: number
  itemCount: number
}

export interface DocumentText {
  pages: PageMetrics[]
  lines: TextLine[]
  /** Falso quando o PDF não tem camada de texto (PDF escaneado) — ver seção 9. */
  hasTextLayer: boolean
}

// ── Camada 2 · detecção de laboratório ─────────────────────────────────────

export type SignalKind = 'institutional' | 'vendor' | 'layout'

export interface DetectionEvidence {
  signalId: string
  kind: SignalKind
  weight: number
  page: number
  lineIndex: number
}

export interface LabDetection {
  /** null quando nada atingiu o limiar — NUNCA cai em perfil genérico calado (A4). */
  profileId: string | null
  /** 0..1. Score bruto normalizado pelo teto do perfil; não é o score. */
  confidence: number
  evidence: DetectionEvidence[]
  /** Empates resolvidos por regra declarada, registrados aqui. */
  tiedWith: string[]
}

// ── Perfil de laboratório (dado, não código — A3) ──────────────────────────

export interface FingerprintSignal {
  id: string
  /** Fonte de RegExp; compilada na carga do perfil, nunca em tempo de match. */
  pattern: string
  weight: number
  kind: SignalKind
}

export interface PreprocessRule {
  id: string
  kind: 'lineRewrite' | 'lineSuppress'
  pattern: string
  /** Só para `lineRewrite`; `null` em `lineSuppress`. */
  replacement: string | null
  /** Motivo do descarte, obrigatório em `lineSuppress` — R1. */
  discardReason: DiscardReason | null
}

/**
 * Bloco de faixas de referência que repete os nomes dos exames.
 *
 * Existe por laboratório, e não globalmente, porque a MESMA marca textual tem
 * função diferente em cada LIS: no HOC "VALOR DE REFERÊNCIA:" sozinho abre a
 * tabela, enquanto no IMEC "Valores de Referência" aparece exame a exame e não
 * abre nada. Tratar isso como regra global consertava dois laboratórios e
 * destruía um terceiro (64 regressões viraram 142 na tentativa).
 */
export interface ReferenceBlockRule {
  /** Abre o bloco: daqui em diante nada é lido como resultado. */
  open: string
  /** Fecha o bloco: a leitura de resultados recomeça. */
  close: string
}

export interface LabProfile {
  id: string
  displayName: string
  fingerprint: {
    threshold: number
    signals: FingerprintSignal[]
  }
  preprocess: PreprocessRule[]
  matchers: {
    enable: string[]
    disable: string[]
  }
  /** Vazio quando o laboratório não tem bloco de referências identificável. */
  referenceBlocks: ReferenceBlockRule[]
  /**
   * Como este laboratório prova o espécime — R6 por perfil (A3).
   *
   * Existe porque a mesma estrutura significa coisas opostas em labs
   * diferentes. Num laudo de líquor do HOC a subseção "BIOQUÍMICA" continua
   * sendo líquor; num do IMEC ela é SÉRICA, porque aquele laudo mistura os dois
   * materiais no mesmo arquivo. Tratar isso como regra global consertava um e
   * quebrava o outro — medido duas vezes, revertido duas vezes.
   */
  specimen: {
    /** Espécimes que atravessam uma subseção neutra ("BIOQUÍMICA", "CITOLOGIA"). */
    inherit: SpecimenContext[]
    /** Usa a linha "Material: X" do laudo como prova do espécime. */
    fromMaterialLine: boolean
  }
}

// ── Valor ──────────────────────────────────────────────────────────────────

/**
 * R5 — quatro operadores, não dois.
 *
 * O clinBoard colapsou `≤` em `lt` e `≥` em `gt`. "menor que 5" e "menor ou
 * igual a 5" são afirmações diferentes sobre o mesmo paciente.
 */
export type Censoring = 'none' | 'lt' | 'lte' | 'gt' | 'gte'

export type QualitativeCode =
  | 'reactive' | 'nonreactive' | 'positive' | 'negative'
  | 'detected' | 'undetected' | 'indeterminate' | 'inconclusive'
  | 'present' | 'absent' | 'rare' | 'occasional' | 'moderate' | 'abundant'

export type ExamValue =
  | { kind: 'numeric'; value: number; censoring: Censoring; raw: string }
  | { kind: 'qualitative'; code: QualitativeCode; raw: string }
  | { kind: 'semiquantitative'; crosses: 1 | 2 | 3 | 4; raw: string }
  | { kind: 'titer'; numerator: 1; denominator: number; raw: string }
  | { kind: 'text'; raw: string }

// ── Referência ─────────────────────────────────────────────────────────────

/** Escopo de aplicação da faixa. Campos nunca opcionais — R4. */
export interface RefScope {
  ageMin: number | null
  ageMax: number | null
  ageUnit: 'd' | 'm' | 'a' | null
  sex: 'M' | 'F' | null
}

/**
 * R4 — ausência de referência é um dado.
 *
 * `absent`   = o laudo não trouxe faixa nenhuma.
 * `rejected` = havia algo no lugar da faixa e eu não confio (faixa etária lida
 *              como referência foi o defeito D5; aqui ela é registrada, não
 *              silenciada).
 * A ausência de `kind: 'notSought'` é deliberada: todo caminho que produz
 * observação passa pelo normalizador de referência, então "não procurei" não
 * é um estado alcançável. Se algum dia for, entra aqui explicitamente.
 */
export type Reference =
  | { kind: 'range'; min: number; max: number; unit: string; raw: string; scope: RefScope | null }
  | { kind: 'upperBound'; max: number; unit: string; raw: string; scope: RefScope | null }
  | { kind: 'lowerBound'; min: number; unit: string; raw: string; scope: RefScope | null }
  | { kind: 'qualitative'; expected: QualitativeCode; raw: string }
  | { kind: 'absent' }
  | { kind: 'rejected'; raw: string; reason: string }

// ── Data ───────────────────────────────────────────────────────────────────

/**
 * R7/R8 — cada observação carrega sua própria data, e nunca uma data inventada.
 *
 * `source` importa clinicamente: uma data de impressão usada como data de
 * coleta desloca a série temporal inteira do paciente.
 */
export interface TemporalRef {
  iso: string | null
  hasTime: boolean
  source: 'collectionMarker' | 'sectionMarker' | 'proximity' | 'documentFallback' | 'absent'
  raw: string
}

// ── Espécime ───────────────────────────────────────────────────────────────

/**
 * R6 — contexto de espécime é escopo léxico, nunca estado de módulo.
 *
 * O mesmo pH significa coisas diferentes em sangue arterial, urina e líquor.
 */
export type SpecimenContext =
  | 'blood'
  | 'arterialBlood'
  | 'venousBlood'
  | 'urine'
  | 'csf'
  | 'stool'
  | 'respiratory'
  | 'other'
  | 'unknown'

// ── Procedência (R2) ───────────────────────────────────────────────────────

export interface Provenance {
  page: number
  lineIndex: number
  /** Suprimido (string vazia) quando `retainRawText === false` — R10. */
  rawLine: string
  matcherId: string
  profileId: string
  fallbackUsed: boolean
}

// ── Observação ─────────────────────────────────────────────────────────────

export type ReviewReason =
  | 'dateFromProximity'
  | 'dateFromDocumentFallback'
  | 'dateAbsent'
  | 'unknownAnalyte'
  | 'unknownUnit'
  | 'referenceRejected'
  | 'implausibleValue'
  | 'lowDetectionConfidence'
  | 'fallbackExtracted'
  | 'duplicateCollection'

export interface Observation {
  analyteId: string | null
  canonicalName: string | null
  /** Exatamente como veio no laudo — a âncora para depurar um valor errado. */
  rawName: string
  value: ExamValue
  unit: { raw: string; canonical: string | null }
  reference: Reference
  collectedAt: TemporalRef
  specimen: SpecimenContext
  provenance: Provenance
  confidence: number
  requiresReview: boolean
  reviewReasons: ReviewReason[]
}

/**
 * Saída crua de um matcher, antes dos normalizadores.
 *
 * Não tem nome canônico, valor tipado nem data resolvida: são precisamente as
 * decisões que a camada 6 toma, e mantê-las fora daqui é o que impede um
 * matcher de normalizar do seu jeito (a família de defeitos D4).
 */
export interface RawObservation {
  rawName: string
  rawValue: string
  rawUnit: string
  rawReference: string
  specimen: SpecimenContext
  date: TemporalRef
  provenance: Provenance
}

// ── Cultura e antibiograma ─────────────────────────────────────────────────

/**
 * Norma de interpretação do antibiograma.
 *
 * Importa clinicamente: em BrCAST/EUCAST, `I` significa "sensível com exposição
 * aumentada" — o antibiótico FUNCIONA com dose maior. Em CLSI, `I` é
 * "intermediário" — eficácia incerta, evitar. Mesma letra, condutas opostas.
 *
 * Fica por ANTIMICROBIANO, e não por laudo, porque um mesmo antibiograma pode
 * misturar as duas: nos laudos do corpus, estreptomicina e gentamicina de alto
 * nível e a caspofungina para Candida vêm interpretadas por CLSI, com o resto
 * em BrCAST.
 */
export type SusceptibilityStandard = 'BrCAST' | 'CLSI'

export interface Mic {
  operator: 'eq' | 'lt' | 'lte' | 'gt' | 'gte'
  /**
   * `null` quando o MIC é de uma COMBINAÇÃO e vem como razão — "> 8/4" para
   * ampicilina/sulbactam, "<= 2/38" para trimetoprima/sulfametoxazol. Um número
   * só não representa isso, e inventar um representaria errado.
   */
  value: number | null
  unit: string
  raw: string
}

export interface Susceptibility {
  antimicrobial: string
  /** `NT` = não testado (o traço no laudo). É informação, não ausência dela. */
  interpretation: 'S' | 'I' | 'R' | 'SDD' | 'NS' | 'NT' | 'unknown'
  mic: Mic | null
  method: string | null
  standard: SusceptibilityStandard
  /**
   * Decisão clínica de 31/07/2026: quando o laudo não declara a norma, assume
   * BrCAST. `assumed` registra que foi assunção, para a origem continuar
   * auditável mesmo com o valor preenchido.
   */
  standardSource: 'declared' | 'assumed'
}

export interface Isolate {
  organism: string
  /** O que separa contaminação de infecção urinária — precisa do operador. */
  /**
   * O que separa contaminação de infecção urinária.
   *
   * O operador tem os quatro sentidos, e não três: ">100.000" e ">=100.000"
   * são afirmações diferentes, e colapsá-las repetiria aqui o atalho que R5
   * proíbe no valor de exame.
   */
  colonyCount: {
    value: number
    operator: 'eq' | 'lt' | 'lte' | 'gt' | 'gte'
    unit: 'CFU/mL' | 'CFU/g'
    raw: string
  } | null
  susceptibilities: Susceptibility[]
}

export interface CultureResult {
  specimen: string
  collectedAt: TemporalRef
  growth: 'noGrowth' | 'positive' | 'contaminated' | 'indeterminate'
  isolates: Isolate[]
  provenance: Provenance
}

// ── Laudo de imagem ────────────────────────────────────────────────────────

export type Modality = 'CT' | 'MR' | 'US' | 'XR' | 'PET' | 'NM' | 'ECHO' | 'ENDO' | 'other'

export interface ImagingReport {
  modality: Modality
  title: string
  bodyRegion: string | null
  performedAt: TemporalRef
  sections: {
    indication: string | null
    technique: string | null
    findings: string | null
    conclusion: string | null
  }
  /** R1 — o que não coube em seção reconhecida não some. */
  unsectionedText: string | null
  provenance: Provenance
}

// ── Descarte (R1) ──────────────────────────────────────────────────────────

export type DiscardReason =
  | 'unrecognizedAnalyte'
  | 'noValueFound'
  | 'implausibleValue'
  | 'ambiguousReference'
  | 'historicalResult'
  | 'headerOrFooter'
  | 'referenceTable'
  | 'lowConfidence'
  | 'duplicate'
  | 'unsupportedBlock'
  | 'blockInvalidated'
  /**
   * Decisão clínica de não importar, e não uma falha de leitura.
   *
   * Existe para que "não usamos este resultado" seja visível em vez de
   * silencioso — a hemoglobina redundante dentro da gasometria, o resultado de
   * imunidade sorológica. R1 vale igual para o descarte deliberado.
   */
  | 'notUsedClinically'

export interface DiscardedItem {
  page: number
  lineIndex: number
  /** Suprimido (string vazia) quando `retainRawText === false` — R10. */
  rawLine: string
  reason: DiscardReason
  detail: string | null
}

// ── Avisos (A7 — dados, não toast) ─────────────────────────────────────────

export type WarningCode =
  | 'notImplemented'
  | 'noTextLayer'
  | 'unrecognizedDocument'
  | 'lowDetectionConfidence'
  | 'detectionTie'
  | 'fallbackExtractorUsed'
  | 'multipleCollectionDates'
  | 'documentDateAbsent'
  | 'malformedDocument'
  /** Camada de texto ilegível — ver `texto/integridade.ts`. */
  | 'corruptedTextLayer'
  /**
   * Laudo de imagem sem cabeçalho de achados.
   *
   * Alguns laudos passam da técnica direto para a descrição, sem marcador. Não
   * há como saber onde uma acaba e a outra começa, e chutar arquivaria achado
   * clínico como técnica. O texto fica onde está, íntegro, e o consumidor é
   * avisado de que a separação não é confiável neste documento.
   */
  | 'imagingSectionsIncomplete'

export interface Warning {
  code: WarningCode
  page: number | null
  lineIndex: number | null
  /** NUNCA conteúdo de laudo — R10. Só rótulo, contador ou id. */
  detail: string | null
}

// ── Diagnóstico (R10 — contadores, hashes e índices; sem PII) ──────────────

export interface Diagnostics {
  moduleVersion: string
  catalogVersion: string
  /** SHA-256 dos bytes: identifica o documento sem revelar nada dele. */
  documentHash: string
  pageCount: number
  lineCount: number
  counts: {
    observations: number
    cultures: number
    imaging: number
    discarded: number
    warnings: number
    requiresReview: number
  }
  /** matcherId → quantas linhas ele capturou. */
  matcherHits: Record<string, number>
}
// Nota deliberada: não há campo de duração aqui. Tempo de execução varia entre
// chamadas e quebraria a igualdade profunda que R8 exige.

// ── Entrada e saída ────────────────────────────────────────────────────────

export interface ExtractionHints {
  /** Só para conferência — jamais para preencher uma data que não foi lida (R8). */
  expectedCollectedAt: string | null
  /** Força um perfil, ignorando a detecção. */
  labProfileId: string | null
}

export interface ExtractionOptions {
  minDetectionConfidence: number
  enableFallbackExtractor: boolean
  retainRawText: boolean
}

export interface ExtractionRequest {
  document: { bytes: Uint8Array; filename: string | null }
  hints: ExtractionHints | null
  options: Partial<ExtractionOptions> | null
}

export interface ExtractionResult {
  documentKind: 'laboratory' | 'imaging' | 'mixed' | 'unrecognized'
  detection: LabDetection
  observations: Observation[]
  cultures: CultureResult[]
  imaging: ImagingReport[]
  /** R1 — campo de primeira classe; nenhum consumidor o ignora por acidente. */
  discarded: DiscardedItem[]
  /** A7 — a camada acima decide como mostrar. */
  warnings: Warning[]
  diagnostics: Diagnostics
}

// ── Contexto de parse (A1 — imutável, passado por parâmetro) ───────────────

export interface Catalog {
  version: string
  /** sinônimo normalizado → analyteId */
  synonyms: Readonly<Record<string, string>>
  analytes: Readonly<Record<string, Analyte>>
  qualitative: Readonly<Record<string, QualitativeCode>>
  units: Readonly<Record<string, string>>
}

export interface Analyte {
  id: string
  canonicalName: string
  category: string
  defaultSpecimen: SpecimenContext
  defaultUnit: string | null
  valueKind: ExamValue['kind']
  loinc: string | null
  /**
   * Faixa fisicamente possível, NÃO faixa de normalidade. Só o validador usa,
   * e só para detectar erro de escala (potássio 7,2 lido como 0,72).
   *
   * `unit` é obrigatório: 1,4 mg/dL de creatinina é 124 µmol/L, e comparar um
   * número contra uma faixa sem saber a unidade produz o falso alarme que a
   * faixa existia para evitar. Sem unidade compatível, o validador não opina.
   */
  plausibleRange: { min: number; max: number; unit: string } | null
  needsClinicalReview: boolean
}

export interface ParseContext {
  readonly profile: LabProfile
  readonly catalog: Catalog
  /** R6 — escopo léxico do espécime vigente neste ponto do documento. */
  readonly specimen: SpecimenContext
  /** R7 — escopo de data vigente neste ponto do documento. */
  readonly date: TemporalRef
  readonly options: Readonly<ExtractionOptions>
}

// ── Matchers (A2) ──────────────────────────────────────────────────────────

export interface Segment {
  kind: 'examSection' | 'table' | 'culture' | 'antibiogram' | 'eas' | 'notes' | 'footer' | 'imaging'
  title: string | null
  lines: TextLine[]
  specimen: SpecimenContext
  date: TemporalRef
}

/**
 * Resultado de um matcher.
 *
 * `noMatch` = "esta linha não é minha".
 * `discarded` = "esta linha é minha e eu a rejeitei" — e o motivo vem junto.
 *
 * A ausência de um terceiro caminho é intencional: é o que torna 7.B-2
 * verificável por tipo, e não por disciplina. Não existe forma de um matcher
 * consumir uma linha e devolver nada.
 */
export type MatchOutcome =
  | { kind: 'observations'; observations: RawObservation[] }
  | { kind: 'discarded'; items: DiscardedItem[] }
  | { kind: 'noMatch' }

export interface Matcher {
  readonly id: string
  applicability(segment: Segment, ctx: ParseContext): boolean
  match(line: TextLine, segment: Segment, ctx: ParseContext): MatchOutcome
}

// ── Ponto de extensão para IA (A5) ─────────────────────────────────────────

/**
 * O núcleo determinístico NÃO depende disto e funciona sem nenhuma
 * implementação registrada. Resultado vindo daqui nasce com
 * `provenance.fallbackUsed = true` e `requiresReview = true`.
 */
export interface FallbackExtractor {
  readonly id: string
  extract(text: DocumentText, ctx: ParseContext): Promise<{
    observations: RawObservation[]
    warnings: Warning[]
  }>
}
