// ══════════════════════════════════════════════════════════════════════════
// Supressão de linhas — D2.
//
// O defeito: uma expressão regular de resultado não ancorada capturava
// "Resultado Anterior : 3,80" como se fosse o valor ATUAL, em cinco dos seis
// perfis. Um paciente com creatinina 1,42 hoje e 3,80 na semana passada ficava
// registrado com 3,80 — e a conduta seguia o número errado.
//
// R1 governa o arquivo inteiro: suprimir NÃO é sumir. Toda linha suprimida sai
// daqui com um motivo, e vira `DiscardedItem`.
// ══════════════════════════════════════════════════════════════════════════

import type { DiscardReason } from '../contratos'
import descartes from '../catalogo/descartes.json'

const NOMES_DE_DESCARTE = new Set(descartes.skipNames)

/** As seis variações de rótulo histórico observadas nos laudos. */
const RESULTADO_ANTERIOR =
  /^\s*(?:resultado|result\.?|valor|exame|dosagem)\s+anterior\b|^\s*anterior\s*[:.]/i

/** Cabeçalho e rodapé repetidos por página, assinatura eletrônica, QR. */
const CABECALHO_RODAPE =
  /^\s*(?:p[áa]gina\s+\d|documento\s+assinad|assinad[oa]\s+eletr[ôo]nic|conferir\s+em|valida[çc][ãa]o|hash\b|www\.|https?:|CRM[\s:/-]|CRBM[\s:/-]|CRF[\s:/-]|impresso\s+em|paciente\s*:|registro\s*:|prontu[áa]rio|conv[êe]nio\s*:|leito\s*:|nascimento|hospital\b|laborat[óo]rio\b|cl[íi]nica\b|m[ée]dico\s+solicitante|servi[çc]o\s+solicitante|libera[çd]o?\b)/i

/** Linhas que anunciam faixa de referência tabelada, não resultado. */
const TABELA_REFERENCIA =
  /^\s*(?:valores?\s+de\s+refer[êe]ncia|refer[êe]ncia\s*:|adultos?\s+(?:ambulat|internados|maior)|rec[ée]m\s*-?\s*nascidos?|crian[çc]as?\s+de\s+\d)/i

export interface Supressao {
  reason: DiscardReason
  detail: string
}

/**
 * Decide se a linha deve ser suprimida, e por quê.
 *
 * Devolver o motivo, e não um booleano, é o que permite ao usuário distinguir
 * "isto era um resultado antigo" de "isto era rodapé" — no doador, os dois
 * chegavam com a mesma mensagem genérica (7.B-4).
 */
export function suprimir(linha: string): Supressao | null {
  const texto = linha.trim()
  if (!texto) return { reason: 'headerOrFooter', detail: 'linha vazia' }

  if (RESULTADO_ANTERIOR.test(texto)) {
    return { reason: 'historicalResult', detail: 'rótulo de resultado anterior' }
  }
  if (CABECALHO_RODAPE.test(texto)) {
    return { reason: 'headerOrFooter', detail: 'cabeçalho, rodapé ou assinatura' }
  }
  if (TABELA_REFERENCIA.test(texto)) {
    return { reason: 'referenceTable', detail: 'tabela de referência' }
  }

  // Nomes que são rótulo de seção, não exame ("MATERIAL", "MÉTODO", "HEMOGRAMA").
  const semPontuacao = texto.replace(/[:.]+\s*$/, '').toUpperCase().replace(/\s+/g, ' ').trim()
  if (NOMES_DE_DESCARTE.has(semPontuacao)) {
    return { reason: 'headerOrFooter', detail: 'rótulo de seção' }
  }

  return null
}
