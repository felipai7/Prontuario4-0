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
} from './contratos'

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
  resolverOpcoes(req.options)
  const documentHash = hashDocumento(req.document.bytes)

  // ── F1: esqueleto. As camadas 1–7 entram nas fases seguintes. ───────────
  const diagnostics: Diagnostics = {
    moduleVersion: MODULE_VERSION,
    catalogVersion: 'não-carregado',
    documentHash,
    pageCount: 0,
    lineCount: 0,
    counts: {
      observations: 0,
      cultures: 0,
      imaging: 0,
      discarded: 0,
      warnings: 1,
      requiresReview: 0,
    },
    matcherHits: {},
  }

  return {
    documentKind: 'unrecognized',
    detection: { profileId: null, confidence: 0, evidence: [], tiedWith: [] },
    observations: [],
    cultures: [],
    imaging: [],
    discarded: [],
    warnings: [
      {
        code: 'notImplemented',
        page: null,
        lineIndex: null,
        detail: `motor de extração ausente na versão ${MODULE_VERSION}`,
      },
    ],
    diagnostics,
  }
}
