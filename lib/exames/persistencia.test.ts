import { describe, it, expect } from 'vitest'
import { gravarEntrega, type ClienteExames } from './persistencia'
import type { Entrega } from './entrega'

const ENTREGA: Entrega = {
  linhas: [{
    dataColeta: '12/05/2026',
    tipo: 'Exame',
    observacoes: null,
    valores: [{
      nome: 'Glicose',
      valor: '92',
      unidade: 'mg/dL',
      referencia: '70 - 99',
      referenciaEstruturada: { kind: 'range', min: 70, max: 99, unit: 'mg/dL', raw: '70 - 99', scope: null },
      valorNumerico: 92,
      censura: null,
      valorQualitativo: null,
      cruzes: null,
      analitoId: 'glicose.serum',
      precisaConferencia: false,
      motivos: [],
      conflito: false,
      origem: { pagina: 1, linha: 3, regra: 'tabular' },
    }],
  }],
  pendencias: [],
  conferenciaPaciente: 'confere',
  impressaoDigital: 'abc123',
}

function clienteFake(over: Partial<ClienteExames> = {}): ClienteExames {
  return {
    buscarPorImpressaoDigital: async () => null,
    inserir: async () => ({ erro: null }),
    ...over,
  }
}

describe('A-05 · falha de gravação não passa por sucesso', () => {
  it('erro do banco vira resultado explícito, não um "salvo" mentiroso', async () => {
    const r = await gravarEntrega(
      clienteFake({ inserir: async () => ({ erro: 'permissão negada' }) }),
      'pac-1', ENTREGA, 'laudo.pdf')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toMatch(/permissão negada/)
  })

  it('gravação bem-sucedida devolve quantos registros entraram', async () => {
    const r = await gravarEntrega(clienteFake(), 'pac-1', ENTREGA, 'laudo.pdf')
    expect(r).toEqual({ ok: true, registros: 1, duplicataDe: null })
  })

  it('R10 · o motivo do erro não carrega conteúdo do laudo', async () => {
    const r = await gravarEntrega(
      clienteFake({ inserir: async () => ({ erro: 'falha ao gravar' }) }),
      'pac-1', ENTREGA, 'laudo.pdf')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).not.toMatch(/Glicose|92/)
  })
})

describe('D6 · laudo repetido grava e marca, não bloqueia', () => {
  it('arquivo já enviado antes: grava assim mesmo', async () => {
    const r = await gravarEntrega(
      clienteFake({ buscarPorImpressaoDigital: async () => ({ dataEnvio: '10/05/2026' }) }),
      'pac-1', ENTREGA, 'laudo.pdf')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.duplicataDe).toBe('10/05/2026')
  })

  it('a marcação de duplicata entra em cada resultado gravado', async () => {
    let gravado: any = null
    await gravarEntrega(
      clienteFake({
        buscarPorImpressaoDigital: async () => ({ dataEnvio: '10/05/2026' }),
        inserir: async l => { gravado = l; return { erro: null } },
      }),
      'pac-1', ENTREGA, 'laudo.pdf')
    const motivos = gravado[0].resultados[0].motivos_revisao
    expect(motivos).toContain('coleta possivelmente duplicada')
  })

  it('sem duplicata, a marcação não aparece', async () => {
    let gravado: any = null
    await gravarEntrega(
      clienteFake({ inserir: async l => { gravado = l; return { erro: null } } }),
      'pac-1', ENTREGA, 'laudo.pdf')
    expect(gravado[0].resultados[0].motivos_revisao).not.toContain('coleta possivelmente duplicada')
  })
})

describe('Correção 3 · busca de duplicata sem a coluna impressao_digital', () => {
  // A migração que cria a coluna (brief original, Step 6) não foi aplicada
  // nesta sessão — o banco de produção está sujeito a esse estado
  // intermediário até a Juliana rodar o SQL. `buscarPorImpressaoDigital`
  // pode então REJEITAR (coluna inexistente) em vez de devolver `null`.
  //
  // Decisão: tratar essa falha como "nenhum envio anterior encontrado" e
  // NUNCA deixá-la bloquear a gravação — é a mesma lógica do D6 aplicada um
  // passo antes. Bloquear o salvamento porque a pergunta "isto é duplicata?"
  // não pôde ser respondida seria pior do que salvar sem a marcação.
  it('lookup de duplicata falha: grava do mesmo jeito, sem marcar duplicata', async () => {
    const r = await gravarEntrega(
      clienteFake({
        buscarPorImpressaoDigital: async () => { throw new Error('column "impressao_digital" does not exist') },
      }),
      'pac-1', ENTREGA, 'laudo.pdf')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.duplicataDe).toBeNull()
  })

  it('lookup de duplicata falha: a falha do banco não vira falha de gravação', async () => {
    let gravado: any = null
    const r = await gravarEntrega(
      clienteFake({
        buscarPorImpressaoDigital: async () => { throw new Error('column "impressao_digital" does not exist') },
        inserir: async l => { gravado = l; return { erro: null } },
      }),
      'pac-1', ENTREGA, 'laudo.pdf')
    expect(r.ok).toBe(true)
    expect(gravado[0].resultados[0].motivos_revisao).not.toContain('coleta possivelmente duplicada')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// C1 · o INSERT também precisa sobreviver à coluna que ainda não existe.
//
// O bloco acima cobria só a BUSCA de duplicata. O `.catch(() => null)` que a
// protege não alcança o `insert`, e o insert nomeia `impressao_digital` em
// TODA linha gravada. O PostgREST recusa um insert que nomeia coluna
// desconhecida (PGRST204) — ou seja, hoje, em produção, TODA gravação de
// exame falharia, pelos dois caminhos.
//
// A coluna vai passar a existir quando a médica rodar o ALTER TABLE. O código
// tem que funcionar nos DOIS estados, e é isso que estes testes fixam: um
// banco de antes e um de depois, exercitados lado a lado.
// ══════════════════════════════════════════════════════════════════════════

/** Banco ANTES do ALTER TABLE: recusa qualquer insert que nomeie a coluna. */
function bancoSemAColuna() {
  const gravadas: any[] = []
  const cliente = clienteFake({
    inserir: async linhas => {
      if (linhas.some(l => 'impressao_digital' in l)) {
        return {
          erro: "Could not find the 'impressao_digital' column of 'exames' in the schema cache (PGRST204)",
        }
      }
      gravadas.push(...linhas)
      return { erro: null }
    },
  })
  return { cliente, gravadas }
}

/** Banco DEPOIS do ALTER TABLE: aceita a coluna e a guarda. */
function bancoComAColuna() {
  const gravadas: any[] = []
  const cliente = clienteFake({
    inserir: async linhas => { gravadas.push(...linhas); return { erro: null } },
  })
  return { cliente, gravadas }
}

describe('C1 · a gravação funciona com e sem a coluna impressao_digital', () => {
  it('coluna AUSENTE: o exame é gravado assim mesmo', async () => {
    const { cliente, gravadas } = bancoSemAColuna()
    const r = await gravarEntrega(cliente, 'pac-1', ENTREGA, 'laudo.pdf')
    expect(r.ok).toBe(true)
    expect(gravadas).toHaveLength(1)
    // O resultado clínico chegou ao banco — que é o ponto todo.
    expect(gravadas[0].resultados[0].nome).toBe('Glicose')
  })

  it('coluna AUSENTE: a linha regravada não nomeia mais a coluna', async () => {
    const { cliente, gravadas } = bancoSemAColuna()
    await gravarEntrega(cliente, 'pac-1', ENTREGA, 'laudo.pdf')
    expect('impressao_digital' in gravadas[0]).toBe(false)
  })

  it('coluna PRESENTE: grava de primeira, COM a impressão digital', async () => {
    const { cliente, gravadas } = bancoComAColuna()
    const r = await gravarEntrega(cliente, 'pac-1', ENTREGA, 'laudo.pdf')
    expect(r.ok).toBe(true)
    // D6 volta a funcionar sozinho no dia do ALTER TABLE: sem esta linha, a
    // detecção de duplicata ficaria desligada para sempre.
    expect(gravadas[0].impressao_digital).toBe('abc123')
  })

  it('coluna PRESENTE: uma tentativa só, sem regravar nada', async () => {
    let chamadas = 0
    const r = await gravarEntrega(
      clienteFake({ inserir: async () => { chamadas++; return { erro: null } } }),
      'pac-1', ENTREGA, 'laudo.pdf')
    expect(r.ok).toBe(true)
    expect(chamadas).toBe(1)
  })

  it('erro de VERDADE continua sendo falha — não vira retentativa infinita', async () => {
    let chamadas = 0
    const r = await gravarEntrega(
      clienteFake({ inserir: async () => { chamadas++; return { erro: 'permissão negada' } } }),
      'pac-1', ENTREGA, 'laudo.pdf')
    expect(r.ok).toBe(false)
    expect(chamadas).toBe(1)
  })

  it('a coluna ausente na SEGUNDA tentativa não é engolida', async () => {
    // Se o insert sem a coluna também falhar, a falha é real e tem que subir.
    const r = await gravarEntrega(
      clienteFake({
        inserir: async () => ({
          erro: "Could not find the 'impressao_digital' column of 'exames' in the schema cache (PGRST204)",
        }),
      }),
      'pac-1', ENTREGA, 'laudo.pdf')
    expect(r.ok).toBe(false)
  })
})
