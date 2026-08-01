// ══════════════════════════════════════════════════════════════════════════
// Camada 6b · texto do resultado → ExamValue tipado.
//
// R5 mora aqui. `< 5,0` não é 0 e não é 5,0: é "menor que 5,0". O operador
// viaja DENTRO do tipo do valor, e são QUATRO — o doador colapsou `≤` em `<` e
// `≥` em `>`, perdendo a distinção entre estrito e não-estrito.
//
// 7.B-1 também mora aqui: no doador, a censura era tratada no bloco
// "Resultado:" e no EAS, mas não na tabela multiparâmetro — `PCR  < 5,0  mg/L`
// dentro de uma seção devolvia null e sumia sem entrar em `_discarded`. Como
// aqui a censura é propriedade do TIPO DE VALOR, resolvida num normalizador só,
// ela cobre por construção todo caminho que produza valor.
// ══════════════════════════════════════════════════════════════════════════

import type { Censoring, ExamValue, QualitativeCode } from '../contratos'
import { carregarCatalogo, chaveSinonimo } from '../catalogo'
import qualitativos from '../catalogo/qualitativos.json'
import { converterNumero } from './numero'
import type { ContextoNormalizacao } from './contexto'

const CODIGOS = qualitativos.codes as Record<string, string>
const CRESCIMENTO = qualitativos.growth as Record<string, string>
const DESCRICAO_FISICA = new Set(qualitativos.physicalDescription)
const NAO_USADOS = new Set(qualitativos.notUsedClinically)

/** Os quatro operadores, mais o caso sem censura. */
const OPERADORES: Record<string, Censoring> = {
  '<': 'lt', '<=': 'lte', '≤': 'lte', '=<': 'lte',
  '>': 'gt', '>=': 'gte', '≥': 'gte', '=>': 'gte',
}

/** Termo cuja importação foi decidida clinicamente como "não usamos" (R1). */
export function ehNaoUsadoClinicamente(bruto: string): boolean {
  return NAO_USADOS.has(chaveSinonimo(bruto))
}

/**
 * Lê o operador de censura no início do texto.
 *
 * `≤` e `<=` são o MESMO operador e diferentes de `<`. Colapsar os quatro em
 * dois, como o doador fez, transforma "menor ou igual a 5" em "menor que 5" —
 * o que exclui o próprio 5 do intervalo possível.
 */
export function lerCensura(bruto: string): { censoring: Censoring; resto: string } {
  const t = bruto.trim()
  // Ordem: os de dois caracteres antes dos de um, senão "<=" casa como "<".
  for (const simbolo of ['<=', '=<', '>=', '=>', '≤', '≥', '<', '>']) {
    if (t.startsWith(simbolo)) {
      return { censoring: OPERADORES[simbolo]!, resto: t.slice(simbolo.length).trim() }
    }
  }
  return { censoring: 'none', resto: t }
}

const RE_TITULO = /^1\s*[:/]\s*(\d{1,6})$/
const RE_CRUZES = /^(\+{1,4})$/
const RE_CRUZES_NUM = /^([1-4])\s*\+$/

/**
 * Converte o texto do resultado no valor tipado.
 *
 * A ordem de tentativa importa: título antes de número (para `1:80` não virar
 * 1), cruzes antes de qualitativo, censura antes de número puro.
 */
export function interpretarValor(bruto: string, ctx: ContextoNormalizacao): ExamValue {
  const raw = bruto.trim()
  if (!raw) return { kind: 'text', raw: bruto }

  // Título / diluição: "1:80" não é razão nem decimal.
  const titulo = raw.match(RE_TITULO)
  if (titulo) {
    return { kind: 'titer', numerator: 1, denominator: Number(titulo[1]), raw }
  }

  // Semiquantitativo em cruzes, nas duas grafias.
  const cruzes = raw.match(RE_CRUZES)
  if (cruzes) {
    return { kind: 'semiquantitative', crosses: cruzes[1]!.length as 1 | 2 | 3 | 4, raw }
  }
  const cruzesNum = raw.match(RE_CRUZES_NUM)
  if (cruzesNum) {
    return { kind: 'semiquantitative', crosses: Number(cruzesNum[1]) as 1 | 2 | 3 | 4, raw }
  }

  // Numérico, com ou sem censura.
  const { censoring, resto } = lerCensura(raw)
  // Aceita apenas texto que seja de fato um número (com sinal e separadores);
  // "5 colônias" não pode virar 5 em silêncio.
  if (/^[+-]?\s*[\d.,]+\s*$/.test(resto)) {
    const valor = converterNumero(resto, ctx)
    if (valor !== null) return { kind: 'numeric', value: valor, censoring, raw }
  }

  // Vocabulário qualitativo.
  //
  // O ponto final é pontuação de frase, não parte do termo: o líquor do IMEC
  // escreve "Ausência de bactérias." e "Incolor.". Sem tirá-lo, o termo não
  // casava com o vocabulário e o resultado virava texto solto — quatro exames
  // no corpus. Só a pontuação de FIM sai; nada no meio, para não mexer em
  // "1:80" nem em valores com vírgula.
  const chave = chaveSinonimo(raw.replace(/[.;]+\s*$/, ''))
  const codigo = CODIGOS[chave]
  if (codigo) return { kind: 'qualitative', code: codigo as QualitativeCode, raw }

  // Descrição física (cor e aspecto do líquor e da urina): é TEXTO.
  // Decisão clínica de 31/07/2026 — "xantocrômico" não é resultado alterado.
  if (DESCRICAO_FISICA.has(chave)) return { kind: 'text', raw }

  // Termo de crescimento de cultura aparecendo numa linha de resultado: no
  // líquor, "Bactéria isolada" é parâmetro do laudo e o valor dele é a frase
  // de crescimento. Ausência de crescimento é ausência — `absent`.
  if (CRESCIMENTO[chave] === 'noGrowth') {
    return { kind: 'qualitative', code: 'absent', raw }
  }

  return { kind: 'text', raw }
}

/** Só para checagem cruzada em teste: o catálogo carregado é o mesmo objeto. */
export function catalogoDeValores() {
  return carregarCatalogo()
}
