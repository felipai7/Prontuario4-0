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
