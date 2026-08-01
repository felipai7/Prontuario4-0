// ══════════════════════════════════════════════════════════════════════════
// Camada 6e · data de coleta.
//
// D6 e R8 moram aqui. O doador tinha fallback silencioso para "hoje" quando não
// achava data — o que deslocava a série temporal inteira do paciente sem
// nenhum sinal. Aqui não existe `Date.now()`: data ausente resolve para `null`,
// `source: 'absent'`, e o consumidor é obrigado a pedir a data antes de gravar.
//
// `source` importa clinicamente: uma data de IMPRESSÃO usada como data de
// COLETA move todos os exames do paciente para o dia errado.
// ══════════════════════════════════════════════════════════════════════════

import type { TemporalRef } from '../contratos'
import marcadores from '../catalogo/marcadores-data.json'

const PADROES_COLETA = marcadores.collectionPatterns.map(p => new RegExp(p))

/** Qualquer data no formato brasileiro, com hora opcional. */
const DATA_SOLTA = /(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/

export const SEM_DATA: TemporalRef = Object.freeze({
  iso: null, hasTime: false, source: 'absent', raw: '',
})

function paraIso(dia: string, mes: string, ano: string, hora?: string, minuto?: string): string {
  const base = `${ano}-${mes}-${dia}`
  return hora && minuto ? `${base}T${hora}:${minuto}` : base
}

/**
 * Extrai a data de coleta de UMA linha, se ela trouxer marcador explícito.
 *
 * Marcador explícito é o único sinal de alta confiança — "Coletado(...)",
 * "Coleta:", "Data de coleta:". Uma data solta na linha pode ser nascimento,
 * liberação ou impressão, e por isso não entra aqui.
 */
export function marcadorDeColeta(linha: string): TemporalRef | null {
  for (const re of PADROES_COLETA) {
    const m = linha.match(re)
    if (!m) continue
    const partes = m[1]?.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (!partes) continue
    const hora = m[2]?.match(/^(\d{2}):(\d{2})$/)
    return {
      iso: paraIso(partes[1]!, partes[2]!, partes[3]!, hora?.[1], hora?.[2]),
      hasTime: Boolean(hora),
      source: 'collectionMarker',
      raw: m[0],
    }
  }
  return null
}

/**
 * Data solta, sem marcador de coleta. Confiança baixa por construção.
 *
 * Quem usa isto marca `requiresReview`, porque a data pode ser de nascimento,
 * de liberação ou de impressão. Nunca é usada quando existe marcador explícito.
 */
export function dataSolta(
  linha: string,
  source: 'proximity' | 'documentFallback',
): TemporalRef | null {
  const m = linha.match(DATA_SOLTA)
  if (!m) return null
  return {
    iso: paraIso(m[1]!, m[2]!, m[3]!, m[4], m[5]),
    hasTime: Boolean(m[4]),
    source,
    raw: m[0],
  }
}

/** Só a parte de data, para comparar coletas distintas ignorando a hora. */
export function diaDe(ref: TemporalRef): string | null {
  return ref.iso ? ref.iso.slice(0, 10) : null
}
