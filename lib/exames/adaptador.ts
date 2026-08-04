// ══════════════════════════════════════════════════════════════════════════
// Adaptador: entrega do domínio → linhas da tabela `exames`.
//
// É a fronteira entre o módulo de exames — que fala o formato do DOMÍNIO,
// `Entrega` — e o schema que a tela já usa. Tudo que é decisão clínica de
// apresentação — se está alterado, para que lado, como exibir — acontece
// aqui, e não lá dentro. É o único arquivo de `lib/exames/` (fora de
// `agrupamento.ts`, que fala com a tela por outro caminho) que pode importar
// `@/types`: a peça de borda, de propósito.
//
// Antes de 03/08/2026 este arquivo convertia direto do `ExtractionResult` da
// extração para `@/types`, e aquele formato só tem lugar para exame
// numérico — cultura e marcação de revisão eram produzidas e descartadas
// aqui mesmo (achados A-03 e A-04). `entrega.ts` fechou essa lacuna; este
// arquivo agora só traduz o que ele já preparou.
//
// Decisões da Juliana em 01/08/2026, na revisão da integração:
//   Q4  valor censurado guarda o operador junto do número
//   Q5  cada data de coleta vira um registro próprio
// ══════════════════════════════════════════════════════════════════════════

import type { ResultadoExame } from '@/types'
import type { Entrega, ValorEntregue } from './entrega'
import {
  interpretarCruzes,
  interpretarNumerico,
  interpretarQualitativo,
} from './interpretacao'

/** Uma linha pronta para inserir em `exames`. */
export interface ExameParaSalvar {
  tipo_exame: string
  /** "DD/MM/AAAA" ou "DD/MM/AAAA HH:MM", como a tela espera. Nunca inventada. */
  data_exame: string | null
  resultados: ResultadoExame[]
  observacoes: string | null
}

/**
 * Traduz um valor entregue pelo domínio para a linha que o banco entende.
 *
 * Em conflito não há interpretação: `valorNumerico` já chegou nulo de
 * `entrega.ts` (D5), e não há o que comparar contra a referência.
 *
 * A ordem importa: numérico, depois qualitativo, depois cruzes — são
 * mutuamente exclusivos por construção em `entrega.ts` (um `ExamValue` só
 * tem um `kind`), mas testar nessa ordem é o que preserva o comportamento de
 * antes desta fronteira existir, quando o dispatch olhava `o.value.kind`
 * direto.
 */
function converter(v: ValorEntregue): ResultadoExame {
  const interpretacao =
    v.conflito ? { alterado: false, direcao: 'normal' as const }
    : v.valorNumerico !== null ? interpretarNumerico(v.valorNumerico, v.censura, v.referenciaEstruturada)
    : v.valorQualitativo !== null ? interpretarQualitativo(v.valorQualitativo)
    : v.cruzes !== null ? interpretarCruzes(v.cruzes)
    : { alterado: false, direcao: 'qualitativo' as const }

  return {
    nome: v.nome,
    valor: v.valor,
    unidade: v.unidade,
    referencia: v.referencia,
    alterado: interpretacao.alterado,
    direcao: interpretacao.direcao,
    valor_num: v.valorNumerico,
    censura: v.censura,
    analito_id: v.analitoId,
    // Sentido inalterado (D9/R3.1): QUALQUER motivo, dos dois canais.
    revisar: v.precisaConferencia,
    motivos_revisao: v.motivos,
    // Novo par: só o canal "confira" — o que a tela usa para o ⚠ da célula.
    confere_valor: v.confereValor,
    motivos_confere: v.motivosConfere,
  }
}

/**
 * Traduz a entrega do domínio para as linhas que a tela grava em `exames`.
 *
 * Uma linha por data de coleta já vem pronta de `entrega.ts` (Q5): um PDF
 * pode agregar coletas de dias diferentes, e cada uma chega em separado —
 * agrupar aqui de novo repetiria a decisão em dois lugares.
 */
export function adaptarParaExames(
  entrega: Entrega,
  tipoPadrao = 'Exame',
): ExameParaSalvar[] {
  return entrega.linhas.map(linha => ({
    tipo_exame: linha.tipo || tipoPadrao,
    data_exame: linha.dataColeta,
    resultados: linha.valores.map(converter),
    observacoes: linha.observacoes,
  }))
}
