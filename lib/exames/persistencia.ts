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

/**
 * A mesma linha SEM a impressão digital — a única forma que o banco aceita
 * enquanto a coluna não existe. Ver `inserirTolerandoImpressaoDigital`.
 */
export type LinhaSemImpressaoDigital = Omit<LinhaParaInserir, 'impressao_digital'>

export interface ClienteExames {
  buscarPorImpressaoDigital(pacienteId: string, hash: string): Promise<{ dataEnvio: string } | null>
  inserir(linhas: (LinhaParaInserir | LinhaSemImpressaoDigital)[]): Promise<{ erro: string | null }>
}

// ══════════════════════════════════════════════════════════════════════════
// A coluna `impressao_digital` ainda NÃO existe no banco (C1).
//
// Ela não está em `supabase/schema.sql` e nenhuma migração do repositório a
// cria. O PostgREST recusa um insert que nomeie coluna desconhecida — código
// PGRST204 — e o insert daqui a nomeia em TODA linha. Ou seja: hoje, em
// produção, TODA gravação de exame falharia, pelos dois caminhos. O
// `.catch(() => null)` logo abaixo protege só a BUSCA de duplicata; o insert
// estava a descoberto.
//
// MECANISMO ESCOLHIDO: tentar COM a coluna e, só diante do erro específico de
// coluna inexistente, regravar SEM ela.
//
// A alternativa — omitir a coluna sempre — é mais simples e foi descartada:
// ela desligaria a detecção de duplicata (D6) para sempre, porque nada
// voltaria a preencher a coluna no dia em que o ALTER TABLE rodar, e ninguém
// se lembraria de reverter o código. Com a retentativa, o banco de hoje grava
// (sem marcação de duplicata, que é o degrau aceitável) e o banco de depois
// do ALTER TABLE volta a gravar COM a impressão digital sozinho, sem nova
// implantação. O custo é uma ida a mais ao banco, e só no caminho que já
// falhou.
//
// NÃO foi escrita migração nenhuma de propósito: ela não seria aplicada nesta
// sessão e deixaria no repositório o registro falso de que já foi.
// ══════════════════════════════════════════════════════════════════════════

/**
 * O erro é "esta coluna não existe", e não uma falha de gravação de verdade.
 *
 * Casa pelo código do PostgREST OU pelo nome da coluna junto de uma palavra de
 * esquema — a mensagem exata varia com a versão ("Could not find the
 * 'impressao_digital' column of 'exames' in the schema cache").
 */
function ehColunaInexistente(erro: string): boolean {
  if (/PGRST204/i.test(erro)) return true
  return /impressao_digital/i.test(erro) && /column|coluna|schema/i.test(erro)
}

/**
 * Insere, e regrava sem a impressão digital se — e só se — o banco recusar
 * justamente por causa dela.
 *
 * UMA retentativa, nunca um laço: se o insert sem a coluna também falhar, a
 * falha é real e sobe inteira. R10 — devolve a mensagem do banco, que não
 * carrega conteúdo de laudo.
 */
export async function inserirTolerandoImpressaoDigital(
  cliente: ClienteExames,
  linhas: LinhaParaInserir[],
): Promise<{ erro: string | null }> {
  const { erro } = await cliente.inserir(linhas)
  if (!erro || !ehColunaInexistente(erro)) return { erro }

  const semColuna: LinhaSemImpressaoDigital[] = linhas.map(
    ({ impressao_digital: _semLugarNoBanco, ...resto }) => resto,
  )
  return cliente.inserir(semColuna)
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
          // R3.1 — coleta duplicada é dúvida sobre O VALOR (pode já estar
          // gravado), não "o laudo não trouxe um dado": entra no canal
          // "confira" também, senão a duplicata some do ⚠ da tela mesmo
          // continuando em `motivos_revisao`.
          confere_valor: true,
          motivos_confere: [...(r.motivos_confere ?? []), DUPLICATA],
        }))
      : l.resultados,
    observacoes: l.observacoes,
    raw_text: null,
    nome_arquivo: nomeArquivo,
    impressao_digital: entrega.impressaoDigital,
  }))

  const { erro } = await inserirTolerandoImpressaoDigital(cliente, linhas)
  // R10 — devolve a mensagem do banco, que não contém conteúdo de laudo, e
  // nunca os valores que estavam sendo gravados.
  if (erro) return { ok: false, motivo: erro }

  return { ok: true, registros: linhas.length, duplicataDe: anterior?.dataEnvio ?? null }
}
