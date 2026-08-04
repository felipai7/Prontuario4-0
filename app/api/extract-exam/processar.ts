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
import { gravarEntrega, type ClienteExames } from '@/lib/exames/persistencia'
import type { VeredictoPaciente } from '@/lib/exames/extracao'

/**
 * O que a tela mostra quando a leitura local não reconheceu o documento.
 *
 * Até 03/08/2026 este caso não tinha mensagem: ele era o SINAL de "manda para
 * a IA" (`erro: 'NAO_RECONHECIDO'`), e a médica nunca via nada. Removida a IA,
 * não há mais para onde mandar — o caso precisa dizer o que aconteceu e o que
 * fazer, na mesma tela, sem que ela tenha que adivinhar se o envio sumiu.
 *
 * Cobre as DUAS causas medidas no acervo de 50 laudos: laboratório fora da
 * lista (1 caso) e PDF sem camada de texto (2 casos). Nomeia as duas porque
 * a conduta é a mesma e porque dizer só "laboratório não reconhecido" seria
 * mentira nos dois PDFs digitalizados.
 *
 * R10 — é uma constante: não interpola nada do laudo, e por construção não
 * tem como carregar conteúdo de paciente.
 */
export const MENSAGEM_NAO_RECONHECIDO =
  'Este laudo não foi reconhecido: o laboratório não está entre os que o programa lê, ' +
  'ou o PDF é uma imagem sem texto. Digite os resultados na aba Manual.'

export type RespostaExtracao =
  | {
      ok: true
      via: 'local'
      registros: number
      /** Canal "confira este valor" (R3.1) — o que vira a lista âmbar. */
      pendencias: { nome: string; motivo: string }[]
      /** Canal "o laudo não trouxe" (R3.1) — o que vira a nota discreta. */
      notasLaudo: { nome: string; motivo: string }[]
      conferenciaPaciente: VeredictoPaciente
      duplicataDe: string | null
    }
  | { ok: false; erro: string; diagnostico?: Record<string, unknown> }

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

  // A-03/I5 — cultura E imagem contam. Um laudo só de cultura ou só de
  // imagem não tem observação numérica nenhuma, e antes disso caía na IA
  // mesmo tendo sido lido aqui: doze culturas no acervo, e vinte de
  // cinquenta PDFs medidos indo para a IA — dezessete deles laudo de imagem
  // que este extrator já lia localmente (ver `lib/exames/entrega.ts`,
  // `deImagem`).
  if (
    resultado.observations.length === 0 &&
    resultado.cultures.length === 0 &&
    resultado.imaging.length === 0
  ) {
    // `diagnostico` é o veredito da leitura, para o LOG da rota — nunca para a
    // tela. Sem conteúdo de laudo (R10): um identificador de perfil, códigos
    // de aviso tipados e contagens. É também como a rota distingue "não
    // reconhecido" (culpa do documento) de falha de gravação (culpa nossa),
    // agora que não existe mais o sentinel 'NAO_RECONHECIDO' que servia só
    // para decidir se caía na IA.
    return {
      ok: false,
      erro: MENSAGEM_NAO_RECONHECIDO,
      diagnostico: {
        perfil: resultado.detection.profileId,
        confianca: Number(resultado.detection.confidence.toFixed(2)),
        avisos: resultado.warnings.map(w => w.code),
        paginas: resultado.diagnostics.pageCount,
        linhas: resultado.diagnostics.lineCount,
        descartes: resultado.discarded.length,
      },
    }
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
    notasLaudo: entrega.notasLaudo,
    conferenciaPaciente: entrega.conferenciaPaciente,
    duplicataDe: gravacao.duplicataDe,
  }
}
