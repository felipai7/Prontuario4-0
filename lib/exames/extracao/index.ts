// ══════════════════════════════════════════════════════════════════════════
// Fronteira pública do módulo de extração de exames.
//
// Este é o ÚNICO arquivo que código de fora do módulo pode importar. As pastas
// texto/, deteccao/, segmentacao/, extratores/, normalizadores/ e
// validadores/ são detalhe interno, e há teste estrutural que verifica isso.
//
// Contrato de erro: `extrairExames` NUNCA lança. Falha é dado de retorno
// (`warnings`, `discarded`), porque as rotas deste repositório devolvem
// `e.message` cru ao navegador — uma exceção com conteúdo de laudo dentro
// vazaria pela rede sem passar por nenhum log (R10).
// ══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import type {
  Diagnostics,
  DocumentText,
  ExtractionOptions,
  ExtractionRequest,
  ExtractionResult,
  LabDetection,
  LabProfile,
  Warning,
} from './contratos'
import { ErroLeituraPdf, lerDocumento } from './texto/pdf'
import { extrairDoTexto } from './motor'
import { carregarCatalogo } from './catalogo'
import perfilBase from './perfis/generic/perfil.json'

export type {
  Analyte,
  Catalog,
  Censoring,
  CultureResult,
  Diagnostics,
  DiscardedItem,
  DiscardReason,
  DocumentText,
  ExamValue,
  ExtractionHints,
  ExtractionOptions,
  ExtractionRequest,
  ExtractionResult,
  FallbackExtractor,
  ImagingReport,
  Isolate,
  LabDetection,
  LabProfile,
  Matcher,
  MatchOutcome,
  Modality,
  Observation,
  ParseContext,
  Provenance,
  QualitativeCode,
  RawObservation,
  Reference,
  RefScope,
  ReviewReason,
  Segment,
  SpecimenContext,
  Susceptibility,
  TemporalRef,
  TextItem,
  TextLine,
  Warning,
  WarningCode,
} from './contratos'

/** Muda quando o comportamento de extração muda — entra em `diagnostics`. */
export const MODULE_VERSION = '0.1.0-f1'

/** Valores padrão das opções. `retainRawText` e o fallback nascem desligados. */
export const OPCOES_PADRAO: Readonly<ExtractionOptions> = Object.freeze({
  minDetectionConfidence: 0.5,
  enableFallbackExtractor: false,
  retainRawText: false,
})

export function resolverOpcoes(
  parciais: Partial<ExtractionOptions> | null,
): Readonly<ExtractionOptions> {
  return Object.freeze({ ...OPCOES_PADRAO, ...(parciais ?? {}) })
}

/**
 * Identifica o documento sem revelar nada dele — R10.
 *
 * Determinístico por construção: mesmo PDF, mesmo hash, sempre (R8).
 */
export function hashDocumento(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Detecta o laboratório emissor a partir do texto já extraído.
 *
 * Função pura sobre texto, exposta na fronteira de propósito: é o que permite
 * testar roteamento sem nenhum PDF em disco (7.B-12).
 */
export function detectarLaboratorio(_texto: DocumentText): LabDetection {
  // F2/F8 implementam. Enquanto não implementado, nada é reconhecido — e o
  // resultado é `null`, não um perfil genérico silencioso (A4).
  return { profileId: null, confidence: 0, evidence: [], tiedWith: [] }
}

/**
 * Extrai dados clínicos estruturados de um PDF de laudo.
 *
 * Não interpreta: não devolve status, alerta nem valor crítico (R3). Não fala
 * com o usuário: avisos são dados (A7). Não guarda estado entre chamadas (R9).
 */
export async function extrairExames(req: ExtractionRequest): Promise<ExtractionResult> {
  // Resolvidas já na F1 para que a fronteira pública não mude nas fases
  // seguintes; o motor as consumirá via ParseContext.
  const opcoes = resolverOpcoes(req.options)
  const documentHash = hashDocumento(req.document.bytes)
  const warnings: Warning[] = []

  // ── Camada 1 · texto com geometria ─────────────────────────────────────
  let texto: DocumentText = { pages: [], lines: [], hasTextLayer: false }
  try {
    texto = await lerDocumento(req.document.bytes)
  } catch (e) {
    // Fora daqui não sobe exceção: falha é dado de retorno. E o `detail`
    // carrega só o motivo tipado, nunca conteúdo do documento (R10).
    warnings.push({
      code: 'malformedDocument',
      page: null,
      lineIndex: null,
      detail: e instanceof ErroLeituraPdf ? e.motivo : 'erroDesconhecido',
    })
  }

  if (texto.pages.length > 0 && !texto.hasTextLayer) {
    // PDF escaneado: tem páginas, não tem camada de texto. Seção 9 — sem OCR
    // nesta fase, o documento resolve para `unrecognized` com aviso claro.
    warnings.push({ code: 'noTextLayer', page: null, lineIndex: null, detail: null })
  }

  // ── Camada 2 · detecção ────────────────────────────────────────────────
  const detection = detectarLaboratorio(texto)
  if (detection.profileId === null) {
    warnings.push({ code: 'unrecognizedDocument', page: null, lineIndex: null, detail: null })
  }

  // ── Camadas 3–7 ────────────────────────────────────────────────────────
  // Sem perfil reconhecido, roda o perfil BASE — mas com o aviso já emitido
  // acima, nunca em silêncio (A4). O que A4 proíbe é o fallback calado, não a
  // extração.
  const perfil = perfilBase as LabProfile
  const motor = texto.hasTextLayer
    ? extrairDoTexto(texto, perfil, opcoes)
    : { observations: [], discarded: [], matcherHits: {}, documentDate: null }

  if (motor.documentDate && motor.documentDate.source === 'absent') {
    warnings.push({ code: 'documentDateAbsent', page: null, lineIndex: null, detail: null })
  }
  const datasDistintas = new Set(
    motor.observations.map(o => o.collectedAt.iso?.slice(0, 10)).filter(Boolean),
  )
  if (datasDistintas.size >= 2) {
    warnings.push({
      code: 'multipleCollectionDates',
      page: null,
      lineIndex: null,
      detail: `${datasDistintas.size} datas de coleta`,
    })
  }

  const catalogo = carregarCatalogo()
  const diagnostics: Diagnostics = {
    moduleVersion: MODULE_VERSION,
    catalogVersion: catalogo.version,
    documentHash,
    pageCount: texto.pages.length,
    lineCount: texto.lines.length,
    counts: {
      observations: motor.observations.length,
      cultures: 0,
      imaging: 0,
      discarded: motor.discarded.length,
      warnings: warnings.length,
      requiresReview: motor.observations.filter(o => o.requiresReview).length,
    },
    matcherHits: motor.matcherHits,
  }

  return {
    documentKind: motor.observations.length > 0 ? 'laboratory' : 'unrecognized',
    detection,
    observations: motor.observations,
    cultures: [],
    imaging: [],
    discarded: motor.discarded,
    warnings,
    diagnostics,
  }
}
