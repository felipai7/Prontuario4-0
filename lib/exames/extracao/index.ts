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
import { avaliarIntegridade } from './texto/integridade'
import { extrairDoTexto } from './motor'
import { extrairCulturas } from './culturas/extrair'
import { extrairImagem } from './imagem/extrair'
import { carregarCatalogo } from './catalogo'
import perfilBase from './perfis/generic/perfil.json'
import { detectar, perfilPorId } from './deteccao/detectar'

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

/** Um documento pode trazer laboratório e imagem no mesmo arquivo. */
function classificar(laboratorio: number, imagem: number): ExtractionResult['documentKind'] {
  if (laboratorio > 0 && imagem > 0) return 'mixed'
  if (imagem > 0) return 'imaging'
  if (laboratorio > 0) return 'laboratory'
  return 'unrecognized'
}

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
export function detectarLaboratorio(texto: DocumentText): LabDetection {
  return detectar(texto)
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

  // A camada de texto existir não significa que ela seja confiável. Um laudo
  // com fonte de codificação própria devolve "Sulfa-Trimetoprim" como
  // "Svmgb-Tsjnfuprsjn" — com as MAIÚSCULAS intactas, então "ANTIBIOGRAMA" e
  // as letras S/I/R saem certas e só o nome do antibiótico vem errado. R1:
  // recusar, nunca extrair.
  const integridade = avaliarIntegridade(texto)
  if (!integridade.confiavel) {
    warnings.push({
      code: 'corruptedTextLayer',
      page: null,
      lineIndex: integridade.primeiraLinha,
      detail: `${Math.round(integridade.proporcaoIlegivel * 100)}% do texto ilegível`,
    })
    texto = { ...texto, lines: [], hasTextLayer: false }
  }

  // ── Camada 2 · detecção ────────────────────────────────────────────────
  const forcado = req.hints?.labProfileId ?? null
  const detection: LabDetection = forcado
    ? { profileId: forcado, confidence: 1, evidence: [], tiedWith: [] }
    : detectarLaboratorio(texto)

  if (detection.tiedWith.length > 1) {
    warnings.push({
      code: 'detectionTie',
      page: null,
      lineIndex: null,
      detail: detection.tiedWith.join(', '),
    })
  }
  if (detection.profileId === null) {
    warnings.push({ code: 'unrecognizedDocument', page: null, lineIndex: null, detail: null })
  } else if (detection.confidence < opcoes.minDetectionConfidence) {
    warnings.push({
      code: 'lowDetectionConfidence',
      page: null,
      lineIndex: null,
      detail: detection.confidence.toFixed(2),
    })
  }

  // ── Camadas 3–7 ────────────────────────────────────────────────────────
  // Sem perfil reconhecido, roda o perfil BASE — mas com o aviso já emitido
  // acima, nunca em silêncio (A4). O que A4 proíbe é o fallback calado, não a
  // extração.
  const perfil =
    (detection.profileId ? perfilPorId(detection.profileId) : null) ?? (perfilBase as LabProfile)
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

  // ── Culturas e antibiograma ────────────────────────────────────────────
  // Bloco, não linha: o isolado, a contagem e a tabela de sensibilidade moram
  // em lugares diferentes do documento, às vezes em páginas diferentes.
  const culturas = texto.hasTextLayer
    ? extrairCulturas(texto, motor.documentDate ?? { iso: null, hasTime: false, source: 'absent', raw: '' }, opcoes, perfil.id)
    : { cultures: [], discarded: [] }

  // ── Laudos de imagem ───────────────────────────────────────────────────
  const imagens = texto.hasTextLayer
    ? extrairImagem(texto, opcoes, perfil.id)
    : { imaging: [], discarded: [] }

  for (const laudo of imagens.imaging) {
    if (laudo.sections.findings === null) {
      warnings.push({
        code: 'imagingSectionsIncomplete',
        page: laudo.provenance.page,
        lineIndex: laudo.provenance.lineIndex,
        detail: 'sem cabeçalho de achados; a separação entre técnica e achados não é confiável',
      })
    }
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
      cultures: culturas.cultures.length,
      imaging: imagens.imaging.length,
      discarded: motor.discarded.length + culturas.discarded.length + imagens.discarded.length,
      warnings: warnings.length,
      requiresReview: motor.observations.filter(o => o.requiresReview).length,
    },
    matcherHits: motor.matcherHits,
  }

  return {
    documentKind: classificar(
      motor.observations.length + culturas.cultures.length,
      imagens.imaging.length,
    ),
    detection,
    observations: motor.observations,
    cultures: culturas.cultures,
    imaging: imagens.imaging,
    discarded: [...motor.discarded, ...culturas.discarded, ...imagens.discarded],
    warnings,
    diagnostics,
  }
}
