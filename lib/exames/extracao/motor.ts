// ══════════════════════════════════════════════════════════════════════════
// Orquestração das camadas 4 a 7.
//
// Recebe o texto com geometria e devolve observações normalizadas, descartes e
// contadores. Não conhece PDF, não conhece HTTP, não fala com o usuário (A7).
//
// Todo estado é local a esta função. Não há nada no topo deste módulo além de
// constantes congeladas — R9, e o oposto das três globais que sobrevivem no
// doador (7.B-6).
// ══════════════════════════════════════════════════════════════════════════

import type {
  DiscardedItem, DocumentText, LabProfile, Observation, ParseContext,
  ReviewReason, TemporalRef,
} from './contratos'
import { carregarCatalogo, resolverAnalito } from './catalogo'
import { checarPlausibilidade } from './validacao/plausibilidade'
import { segmentar } from './segmentacao/segmentar'
import { matchers } from './extratores/registro'
import { suprimir } from './extratores/supressao'
import { interpretarValor } from './normalizadores/valor'
import { interpretarReferencia } from './normalizadores/referencia'
import { normalizarUnidade } from './normalizadores/unidade'
import { marcadorDeColeta } from './normalizadores/data'
import { ehRotuloDeMetadado } from './extratores/metadados'

export interface ResultadoMotor {
  observations: Observation[]
  discarded: DiscardedItem[]
  matcherHits: Record<string, number>
  documentDate: TemporalRef
}

/** Motivos de revisão derivados da origem da data (ver nota de contrato). */
function revisaoPorData(data: TemporalRef): ReviewReason[] {
  switch (data.source) {
    case 'proximity': return ['dateFromProximity']
    case 'documentFallback': return ['dateFromDocumentFallback']
    case 'absent': return ['dateAbsent']
    default: return []
  }
}

export function extrairDoTexto(
  texto: DocumentText,
  perfil: LabProfile,
  opcoes: ParseContext['options'],
  /**
   * Linhas já consumidas pelo extrator de culturas.
   *
   * O motor processa TODO o resto — inclusive o que estiver dentro de um
   * segmento de cultura. Antes, o segmento inteiro ficava fora do alcance dos
   * matchers, e como ele não tinha fim engolia o que viesse depois: uma
   * sorologia de 42 linhas sumia sem virar observação nem descarte.
   */
  linhasConsumidas: ReadonlySet<number> = new Set(),
): ResultadoMotor {
  const catalogo = carregarCatalogo()
  const { segments, documentDate } = segmentar(texto, perfil)

  const observations: Observation[] = []
  const discarded: DiscardedItem[] = []
  const matcherHits: Record<string, number> = {}

  for (const segmento of segments) {
    const ctx: ParseContext = {
      profile: perfil,
      catalog: catalogo,
      specimen: segmento.specimen,
      date: segmento.date,
      options: opcoes,
    }

    const aplicaveis = matchers.filter(
      m => m.applicability(segmento, ctx) &&
        !perfil.matchers.disable.includes(m.id) &&
        (perfil.matchers.enable.length === 0 || perfil.matchers.enable.includes(m.id)),
    )

    for (const linha of segmento.lines) {
      if (linhasConsumidas.has(linha.index)) continue

      const supressao = suprimir(linha.text)
      if (supressao) {
        // Linha em branco não interessa a ninguém; as demais supressões sim.
        if (supressao.detail !== 'linha vazia') {
          discarded.push({
            page: linha.page,
            lineIndex: linha.index,
            rawLine: opcoes.retainRawText ? linha.text : '',
            reason: supressao.reason,
            detail: supressao.detail,
          })
        }
        continue
      }

      // Linha de marcador de coleta já foi consumida pelo segmentador como
      // data. Não é resultado, e registrá-la como descarte seria ruído.
      if (marcadorDeColeta(linha.text)) continue

      let consumida = false
      for (const matcher of aplicaveis) {
        const saida = matcher.match(linha, segmento, ctx)
        if (saida.kind === 'noMatch') continue

        consumida = true
        matcherHits[matcher.id] = (matcherHits[matcher.id] ?? 0) + 1

        if (saida.kind === 'discarded') {
          discarded.push(...saida.items)
          break
        }

        for (const bruta of saida.observations) {
          const analito = resolverAnalito(bruta.rawName, bruta.specimen)
          const ctxNorm = { unidadeBruta: bruta.rawUnit, analito }
          const unidade = normalizarUnidade(bruta.rawUnit)
          const referencia = interpretarReferencia(bruta.rawReference, ctxNorm)

          const motivos: ReviewReason[] = [...revisaoPorData(bruta.date)]
          if (!analito) motivos.push('unknownAnalyte')
          if (bruta.rawUnit && unidade.canonical === null) motivos.push('unknownUnit')
          if (referencia.kind === 'rejected') motivos.push('referenceRejected')

          const valor = interpretarValor(bruta.rawValue, ctxNorm)
          // Erro de ESCALA, não de saúde: potássio 7,2 lido como 0,72. Marca
          // para revisão e nunca descarta — se a faixa estiver errada,
          // descartar apaga justamente o valor extremo, que é o que importa.
          if (checarPlausibilidade(valor, unidade, analito).veredito === 'implausivel') {
            motivos.push('implausibleValue')
          }

          observations.push({
            analyteId: analito?.id ?? null,
            canonicalName: analito?.canonicalName ?? null,
            rawName: bruta.rawName,
            value: valor,
            unit: unidade,
            reference: referencia,
            collectedAt: bruta.date,
            specimen: bruta.specimen,
            provenance: bruta.provenance,
            confidence: analito ? 1 : 0.5,
            requiresReview: motivos.length > 0,
            reviewReasons: motivos,
          })
        }
        break
      }

      // Nenhum matcher reivindicou a linha. Só vira descarte se ela PARECIA um
      // resultado — prosa e notas não poluem o canal, mas nada que aparentasse
      // resultado desaparece em silêncio (R1, 7.B-2).
      if (!consumida && pareceResultado(linha.text)) {
        discarded.push({
          page: linha.page,
          lineIndex: linha.index,
          rawLine: opcoes.retainRawText ? linha.text : '',
          reason: 'noValueFound',
          detail: 'linha com aparência de resultado que nenhum extrator reivindicou',
        })
      }
    }
  }

  return { observations, discarded, matcherHits, documentDate }
}

/** Tem nome à esquerda e número à direita — a forma de um resultado. */
function pareceResultado(texto: string): boolean {
  const t = texto.trim()
  if (!/^[A-Za-zÀ-ÿ][^\d]{2,40}[\s:]+[<>≤≥]?\s*[\d.,]+/.test(t)) return false
  const nome = t.split(/[:\s]{2,}|:/)[0] ?? ''
  return !ehRotuloDeMetadado(nome)
}
