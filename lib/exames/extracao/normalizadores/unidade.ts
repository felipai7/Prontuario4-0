// ══════════════════════════════════════════════════════════════════════════
// Camada 6c · normalização de unidade.
//
// Só grafia, nunca conversão de valor. Converter mg/dL em µmol/L muda o
// número, e mudar número de exame sem decisão clínica explícita é o que R1
// proíbe. `unidades.json` tem `conversions: {}` de propósito.
// ══════════════════════════════════════════════════════════════════════════

import unidades from '../catalogo/unidades.json'

const CANONICAS = unidades.canonical as Record<string, string>

/**
 * Limpa a unidade como o laudo a escreveu.
 *
 * Remove pontuação de borda — `74,6 %:` traz a unidade como `%:` por causa do
 * layout em duas colunas — e colapsa espaço interno.
 */
export function limparUnidade(bruta: string): string {
  return bruta
    .replace(/[\s:;,.]+$/g, '')
    .replace(/^[\s:;,.]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve a unidade para a forma canônica, ou `null` quando desconhecida.
 *
 * `null` não é falha: é "o laudo trouxe algo que eu não reconheço". Quem chama
 * marca `requiresReview`, e o valor continua extraído — perder o valor junto
 * com a unidade seria trocar um problema pequeno por um grande.
 */
export function normalizarUnidade(bruta: string): { raw: string; canonical: string | null } {
  const limpa = limparUnidade(bruta)
  if (!limpa) return { raw: bruta, canonical: null }

  const chave = limpa.toUpperCase().replace(/\s+/g, ' ')
  const direta = CANONICAS[chave]
  if (direta) return { raw: limpa, canonical: direta }

  // Grafias do mesmo símbolo: micro como "u" ou "µ", expoente como ~, ^ ou E.
  const alternativa = chave
    .replace(/µ/g, 'U')
    .replace(/[~^]/g, '^')
    .replace(/\bE(\d)/g, '^$1')
  const porAlternativa = CANONICAS[alternativa]
  if (porAlternativa) return { raw: limpa, canonical: porAlternativa }

  return { raw: limpa, canonical: null }
}
