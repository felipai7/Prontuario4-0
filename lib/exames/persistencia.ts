// ══════════════════════════════════════════════════════════════════════════
// Gravação dos exames — com conferência do resultado.
//
// Até 03/08/2026 quatro pontos de `ExamesTab.tsx` gravavam sem olhar o erro e
// mostravam "Exame extraído e salvo!" em seguida. Apagar e editar, no mesmo
// arquivo, conferiam — o que mostra que foi descuido, não política (A-05).
//
// `ClienteExames` é uma interface e não o cliente do Supabase de propósito: o
// caminho de FALHA precisa ser testável sem banco, e era justamente ele que
// nunca tinha sido exercitado.
//
// `LinhaParaInserir` deriva `resultados` de `ExameParaSalvar` (adaptador.ts)
// em vez de importar `ResultadoExame` de `@/types` diretamente: só
// `adaptador.ts` e `agrupamento.ts` podem conhecer o formato do banco.
// ══════════════════════════════════════════════════════════════════════════

import { adaptarParaExames, type ExameParaSalvar } from './adaptador'
import type { Entrega } from './entrega'

/** Uma linha pronta para `insert` na tabela `exames`. */
export interface LinhaParaInserir {
  paciente_id: string
  tipo_exame: string
  data_exame: string | null
  resultados: ExameParaSalvar['resultados']
  observacoes: string | null
  raw_text: null
  nome_arquivo: string | null
  impressao_digital: string
}

export interface ClienteExames {
  buscarPorImpressaoDigital(pacienteId: string, hash: string): Promise<{ dataEnvio: string } | null>
  inserir(linhas: LinhaParaInserir[]): Promise<{ erro: string | null }>
}

export type ResultadoGravacao =
  | { ok: true; registros: number; duplicataDe: string | null }
  | { ok: false; motivo: string }

const DUPLICATA = 'coleta possivelmente duplicada'

/**
 * Grava a entrega do domínio, e devolve o que de fato aconteceu.
 *
 * D6 — laudo repetido GRAVA e MARCA, nunca bloqueia. Bloquear atrapalha mais
 * do que ajuda: um laudo reemitido com correção tem bytes diferentes e nem
 * seria pego por impressão digital; e um bloqueio equivocado esconde um
 * resultado real do plantonista.
 */
export async function gravarEntrega(
  cliente: ClienteExames,
  pacienteId: string,
  entrega: Entrega,
  nomeArquivo: string | null,
): Promise<ResultadoGravacao> {
  // A coluna `impressao_digital` só existe depois que a migração for
  // aplicada (pendência externa a este código — ver task-5-report.md). Até
  // lá, `buscarPorImpressaoDigital` pode REJEITAR (coluna inexistente) em vez
  // de devolver `null`. Tratar essa falha como "nenhum envio anterior
  // encontrado" é a mesma regra do D6 aplicada um passo antes: não gravar
  // porque a pergunta "isto é duplicata?" não pôde ser respondida seria pior
  // do que gravar sem a marcação de duplicata.
  const anterior = await cliente
    .buscarPorImpressaoDigital(pacienteId, entrega.impressaoDigital)
    .catch(() => null)

  const linhas: LinhaParaInserir[] = adaptarParaExames(entrega).map(l => ({
    paciente_id: pacienteId,
    tipo_exame: l.tipo_exame,
    data_exame: l.data_exame,
    resultados: anterior
      ? l.resultados.map(r => ({
          ...r,
          revisar: true,
          motivos_revisao: [...(r.motivos_revisao ?? []), DUPLICATA],
        }))
      : l.resultados,
    observacoes: l.observacoes,
    raw_text: null,
    nome_arquivo: nomeArquivo,
    impressao_digital: entrega.impressaoDigital,
  }))

  const { erro } = await cliente.inserir(linhas)
  // R10 — devolve a mensagem do banco, que não contém conteúdo de laudo, e
  // nunca os valores que estavam sendo gravados.
  if (erro) return { ok: false, motivo: erro }

  return { ok: true, registros: linhas.length, duplicataDe: anterior?.dataEnvio ?? null }
}
