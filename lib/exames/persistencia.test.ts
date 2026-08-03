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
