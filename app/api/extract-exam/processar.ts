// ══════════════════════════════════════════════════════════════════════════
// Orquestração: extrai LOCALMENTE e GRAVA.
//
// Vive fora de `route.ts` de propósito (Correção 1 do despacho da Tarefa 6):
// importar um módulo de rota do App Router sob o vitest arrasta `next/server`
// e o cliente Supabase do servidor para o processo de teste — exatamente o
// tipo de quebra que gastaria uma rodada inteira. `route.ts` só lê o corpo
// HTTP, monta o `ClienteExames` de verdade e chama `processarPdf`.
//
// É aqui que estavam os achados A-02 (conferência de paciente), A-03
// (cultura não contava na decisão local-vs-IA) e A-05 (falha de gravação
// virava sucesso): a orquestração inteira vivia dentro do handler HTTP, sem
// nenhum jeito de testá-la sem subir servidor e banco.
// ══════════════════════════════════════════════════════════════════════════

import { extrairExames } from '@/lib/exames/extracao'
import { montarEntrega } from '@/lib/exames/entrega'
import { gravarEntrega, inserirTolerandoImpressaoDigital, type ClienteExames } from '@/lib/exames/persistencia'
import type { VeredictoPaciente } from '@/lib/exames/extracao'

export type RespostaExtracao =
  | {
      ok: true
      via: 'local' | 'ia'
      registros: number
      pendencias: { nome: string; motivo: string }[]
      conferenciaPaciente: VeredictoPaciente
      duplicataDe: string | null
    }
  | { ok: false; erro: string }

/**
 * Extrai localmente e GRAVA. Devolve o que de fato aconteceu — nunca "ok"
 * quando a gravação falhou (A-05).
 */
export async function processarPdf(
  cliente: ClienteExames,
  pacienteId: string,
  bytes: Uint8Array,
  nomeArquivo: string | null,
  nomeDoPaciente: string | null,
): Promise<RespostaExtracao> {
  const resultado = await extrairExames({
    document: { bytes, filename: nomeArquivo },
    hints: { labProfileId: null, expectedCollectedAt: null, expectedPatientName: nomeDoPaciente },
    options: null,
  })

  // A-03 — cultura conta. Um laudo só de cultura não tem observação
  // numérica nenhuma, e antes disso caía na IA mesmo tendo sido lido aqui:
  // doze culturas no acervo, seis delas em laudos sem nenhum exame numérico.
  if (resultado.observations.length === 0 && resultado.cultures.length === 0) {
    return { ok: false, erro: 'NAO_RECONHECIDO' }
  }

  const entrega = montarEntrega(resultado, false)
  const gravacao = await gravarEntrega(cliente, pacienteId, entrega, nomeArquivo)
  // A-05 — a falha do banco vira resultado explícito, nunca um "ok: true"
  // mentiroso. `gravacao.motivo` já é seguro (R10 — ver persistencia.ts).
  if (!gravacao.ok) return { ok: false, erro: gravacao.motivo }

  return {
    ok: true,
    via: 'local',
    registros: gravacao.registros,
    pendencias: entrega.pendencias,
    conferenciaPaciente: entrega.conferenciaPaciente,
    duplicataDe: gravacao.duplicataDe,
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Tarefa 6b — o caminho da IA (prints, texto colado, e PDF que o extrator
// local não reconheceu) fecha o mesmo buraco do D7: até aqui a gravação
// continuava acontecendo no navegador, e uma falha do banco virava "Exame
// extraído e salvo!" do mesmo jeito.
//
// NÃO reaproveita `montarEntrega`/`gravarEntrega`: os dois passam por
// `adaptarParaExames`, que RECALCULA `alterado`/`direcao` a partir de
// `referenciaEstruturada` (a referência já normalizada em forma estruturada).
// A IA nunca preenche esse campo — ela só devolve a referência como texto
// livre, no formato que veio do laudo — então forçar o resultado dela por
// ali faria todo valor cair no caminho "sem referência" do adaptador,
// derrubando um "alterado: true" que a IA já tinha acertado. Este caminho
// grava `alterado`/`direcao` exatamente como a IA devolveu, sem reinterpretar
// nada.
// ══════════════════════════════════════════════════════════════════════════

/** O formato solto que o prompt da IA devolve — não é `ExtractionResult`. */
export interface ResultadoIA {
  tipo_exame: string
  data_exame: string | null
  resultados: {
    nome: string
    valor: string
    unidade: string | null
    referencia: string | null
    alterado: boolean
    direcao: 'alto' | 'baixo' | 'normal' | 'qualitativo'
  }[] | null
  observacoes: string | null
}

// D10 — o marcador vai no REGISTRO (uma vez por laudo), nunca em cada
// resultado. Quarenta marcadores em quarenta valores é ruído; um marcador no
// registro é informação.
const MARCADOR_IA = 'Lido por IA — não conferido pelo extrator local'

/**
 * Grava o resultado que já veio pronto da IA. Devolve o mesmo formato de
 * `processarPdf` — é o que permite a tela (Tarefa 7) tratar os dois com um
 * contrato só.
 */
export async function processarIA(
  cliente: ClienteExames,
  pacienteId: string,
  resultadoDaIA: ResultadoIA,
  nomeArquivo: string | null,
): Promise<RespostaExtracao> {
  const resultados = resultadoDaIA.resultados ?? []

  const observacoes = resultadoDaIA.observacoes
    ? `${resultadoDaIA.observacoes}; ${MARCADOR_IA}`
    : MARCADOR_IA

  // C1 — mesma tolerância do caminho local: a coluna `impressao_digital` só
  // existe depois do ALTER TABLE, e sem isto TODA gravação por este caminho
  // falharia hoje. Ver `inserirTolerandoImpressaoDigital`.
  const { erro } = await inserirTolerandoImpressaoDigital(cliente, [{
    paciente_id: pacienteId,
    tipo_exame: resultadoDaIA.tipo_exame || 'Exame',
    data_exame: resultadoDaIA.data_exame,
    // Passa `alterado`/`direcao` (e o resto) sem reinterpretar — ver o
    // comentário do topo desta seção sobre por que isto não usa
    // `adaptarParaExames`.
    resultados: resultados.map(r => ({
      nome: r.nome,
      valor: r.valor,
      unidade: r.unidade,
      referencia: r.referencia,
      alterado: r.alterado,
      direcao: r.direcao,
    })),
    observacoes,
    raw_text: null,
    nome_arquivo: nomeArquivo,
    // Sem impressão digital, de propósito: o caminho da IA não tem bytes de
    // documento estáveis para hashear (texto colado e prints não são o PDF
    // original, e mesmo quando é PDF a IA só entra quando o extrator local
    // JÁ não reconheceu nada). Não há fingerprint confiável aqui — e um
    // hash inventado (ex. do texto colado) pareceria conferência de
    // duplicata sem ser: o mesmo laudo colado duas vezes com espaçamento
    // diferente teria hashes diferentes, e round-trips pela IA não são
    // determinísticos do jeito que o parser local é (R8). Vazio, não fingido.
    impressao_digital: '',
  }])

  // A-05/D7 — mesma regra do caminho local: erro do banco vira resultado
  // explícito, nunca um "ok: true" que a tela mostraria como sucesso.
  // `erro` é a mensagem do Supabase, não conteúdo do laudo (R10).
  if (erro) return { ok: false, erro }

  return {
    ok: true,
    via: 'ia',
    registros: 1,
    // O caminho da IA não roda a conferência de pendência por valor (isso
    // exigiria a mesma reinterpretação que este caminho evita de propósito).
    pendencias: [],
    // Idem para a conferência de nome do paciente: ela lê a geometria do
    // texto do PDF local (`conferirPaciente` sobre `texto.lines`), camada
    // que este caminho não tem. 'naoPerguntado' é o mesmo default que a
    // tela já usa antes de qualquer extração.
    conferenciaPaciente: 'naoPerguntado',
    duplicataDe: null,
  }
}
