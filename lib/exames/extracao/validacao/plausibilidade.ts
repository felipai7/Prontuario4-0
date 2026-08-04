// ══════════════════════════════════════════════════════════════════════════
// Faixa de plausibilidade — detecção de ERRO DE LEITURA, não de doença.
//
// Um laudo traz potássio 7,2 e o extrator lê 0,72 porque a vírgula caiu numa
// coluna errada. Ou traz sódio 140 e sai 1.400 porque o separador de milhar
// foi lido como decimal. São erros de ESCALA, e o único jeito de pegá-los sem
// um segundo laudo é saber o que é fisicamente possível num ser humano.
//
// ISTO NÃO É FAIXA DE NORMALIDADE, e a distinção é a coisa mais importante
// deste arquivo. Potássio 6,8 é gravemente alterado e perfeitamente possível:
// tem que passar. Creatinina 9,4 é insuficiência renal e passa. O que não
// passa é creatinina 940, que nenhum rim produz e nenhum laudo relata.
//
// Por isso as faixas são GENEROSAS de propósito. Uma faixa apertada aqui
// transformaria justamente o valor crítico — o que mais importa numa UTI —
// no valor marcado como suspeito.
//
// ── O que acontece com um valor implausível ───────────────────────────────
//
// Ele é MARCADO PARA REVISÃO, nunca descartado. `DiscardReason` prevê
// 'implausibleValue', e não usamos: se a faixa estiver errada, descartar
// apaga um resultado real, e o mais provável de ser apagado é o extremo, que
// é o que o plantonista precisa ver. Marcar mostra o valor E a dúvida.
//
// ── Sem unidade compatível, não se opina ──────────────────────────────────
//
// Creatinina 1,4 mg/dL é 124 µmol/L. Comparar um número contra uma faixa sem
// conferir a unidade produz exatamente o alarme falso que a faixa existia
// para evitar. Unidade ausente ou diferente da faixa: o validador se cala.
// ══════════════════════════════════════════════════════════════════════════

import type { Analyte, ExamValue } from '../contratos'

/** A unidade como o contrato a expõe em `Observation.unit`. */
type Unidade = { raw: string; canonical: string | null }

export type ResultadoPlausibilidade =
  | { veredito: 'plausivel' }
  | { veredito: 'naoChecado'; porque: 'semFaixa' | 'semUnidade' | 'unidadeDiferente' | 'naoNumerico' }
  | { veredito: 'implausivel'; faixa: { min: number; max: number; unit: string } }

/** Equivalência de grafia da unidade — não conversão. `/mm³` e `/mm3` são a mesma. */
function mesmaUnidade(a: string, b: string): boolean {
  const n = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[\s.]/g, '')
      .replace(/3/g, '³').replace(/µ/g, 'u')
  return n(a) === n(b)
}

/**
 * Diz se um valor cabe na faixa fisicamente possível do analito.
 *
 * Devolve `naoChecado` com o motivo sempre que faltar informação para
 * comparar — nunca `plausivel` por omissão. Quem chama precisa distinguir
 * "conferido e passou" de "não deu para conferir".
 */
export function checarPlausibilidade(
  valor: ExamValue,
  unidade: Unidade,
  analito: Analyte | null,
): ResultadoPlausibilidade {
  const faixa = analito?.plausibleRange
  if (!faixa) return { veredito: 'naoChecado', porque: 'semFaixa' }
  if (valor.kind !== 'numeric') return { veredito: 'naoChecado', porque: 'naoNumerico' }

  const daObservacao = unidade.canonical ?? unidade.raw
  if (!daObservacao) {
    // Faixa adimensional (INR, densidade urinária, pH): não há o que conferir.
    if (faixa.unit === '') {
      return valor.value < faixa.min || valor.value > faixa.max
        ? { veredito: 'implausivel', faixa }
        : { veredito: 'plausivel' }
    }
    return { veredito: 'naoChecado', porque: 'semUnidade' }
  }
  if (!mesmaUnidade(daObservacao, faixa.unit)) {
    return { veredito: 'naoChecado', porque: 'unidadeDiferente' }
  }

  // Valor censurado ("< 5,0") é comparado pelo número que carrega: o limite
  // do aparelho está sempre dentro do fisicamente possível, então um censurado
  // fora da faixa é erro de leitura como qualquer outro.
  return valor.value < faixa.min || valor.value > faixa.max
    ? { veredito: 'implausivel', faixa }
    : { veredito: 'plausivel' }
}
