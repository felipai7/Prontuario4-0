// ══════════════════════════════════════════════════════════════════════════
// Testa a ORQUESTRAÇÃO (extrai + grava), não a rota HTTP.
//
// Importa só `./processar`, nunca `./route`: `route.ts` importa `next/server`
// e o cliente Supabase do servidor, e carregar isso no processo do vitest é
// exatamente o tipo de quebra que a Correção 1 do despacho existe para evitar.
// ══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import { processarPdf, processarIA, type ResultadoIA } from './processar'
// Relativo, não pelo alias `@/lib/exames/extracao/...`: o teste estrutural
// `fronteira.test.ts` proíbe código de fora do módulo de importar um caminho
// interno pelo alias — só o índice público (`@/lib/exames/extracao`) pode. O
// helper de PDF sintético é utilitário de TESTE, não módulo interno, e os
// outros testes que o usam de fora de `extracao/` (entrega.test.ts,
// adaptador.test.ts) já acessam assim.
import { pdfDeLinhas } from '../../../lib/exames/extracao/_testes/pdfMinimo'
import type { ClienteExames } from '@/lib/exames/persistencia'

const cliente = (over: Partial<ClienteExames> = {}): ClienteExames => ({
  buscarPorImpressaoDigital: async () => null,
  inserir: async () => ({ erro: null }),
  ...over,
})

const PDF = () => pdfDeLinhas([
  'Paciente: MARIA DAS DORES SILVA',
  'BIOQUIMICA', 'Coleta: 12/05/2026',
  'Glicose              92    mg/dL      70 - 99',
])

// A-03 — um laudo só de cultura não tem NENHUMA observação numérica, e antes
// caía na IA mesmo tendo sido lido aqui.
const PDF_SO_CULTURA = () => pdfDeLinhas([
  'HEMOCULTURA - 1ª AMOSTRA',
  'Coleta: 27/07/2026',
  'Bactéria isolada....: Escherichia coli',
])

describe('a rota entrega o que o módulo produz', () => {
  it('grava e devolve as pendências', async () => {
    const r = await processarPdf(cliente(), 'pac-1', PDF(), 'laudo.pdf', 'Maria das Dores Silva')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.registros).toBe(1)
      expect(r.conferenciaPaciente).toBe('confere')
    }
  })

  it('A-02 · laudo de outro paciente é sinalizado', async () => {
    const r = await processarPdf(cliente(), 'pac-1', PDF(), 'laudo.pdf', 'Antonio Carlos Ferreira')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.conferenciaPaciente).toBe('naoConfere')
  })

  it('A-05 · falha de gravação vira erro, não sucesso, e não carrega o campo de sucesso', async () => {
    const r = await processarPdf(
      cliente({ inserir: async () => ({ erro: 'permissão negada' }) }),
      'pac-1', PDF(), 'laudo.pdf', 'Maria das Dores Silva')
    expect(r.ok).toBe(false)
    expect('registros' in r).toBe(false)
  })

  it('R10 · o erro devolvido não carrega conteúdo do laudo', async () => {
    const r = await processarPdf(
      cliente({ inserir: async () => ({ erro: 'falha' }) }),
      'pac-1', PDF(), 'laudo.pdf', 'Maria das Dores Silva')
    if (!r.ok) expect(r.erro).not.toMatch(/Glicose|MARIA|92/)
  })
})

describe('A-03 · cultura conta na decisão local-vs-IA', () => {
  it('laudo só com cultura (zero observações) é processado localmente, não cai como não reconhecido', async () => {
    const r = await processarPdf(cliente(), 'pac-1', PDF_SO_CULTURA(), 'laudo.pdf', null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.via).toBe('local')
      expect(r.registros).toBe(1)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Tarefa 6b — `processarIA`: o mesmo contrato de resposta, mas para o
// resultado que já veio pronto da IA (prints, texto colado, ou PDF que o
// extrator local não reconheceu). NÃO passa por `montarEntrega`/
// `adaptarParaExames`: esse caminho recalcularia `alterado`/`direcao` a
// partir de `referenciaEstruturada`, campo que a IA nunca preenche (ela só
// devolve texto livre de referência), e apagaria sinal que a IA já acertou.
// ══════════════════════════════════════════════════════════════════════════

const RESULTADO_IA = (): ResultadoIA => ({
  tipo_exame: 'Bioquímica',
  data_exame: '12/05/2026',
  resultados: [
    { nome: 'Potássio', valor: '6,2', unidade: 'mEq/L', referencia: '3,5 - 5,0', alterado: true, direcao: 'alto' },
  ],
  observacoes: null,
})

describe('D7 · o caminho da IA também para de fingir sucesso', () => {
  it('falha de gravação vira resultado explícito, não sucesso', async () => {
    const r = await processarIA(
      cliente({ inserir: async () => ({ erro: 'permissão negada' }) }),
      'pac-1', RESULTADO_IA(), 'print-colado.png')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toMatch(/permissão negada/)
  })
})

// C1 — o caminho da IA nomeia `impressao_digital` (vazia) na linha inserida,
// e por isso morre exatamente igual ao caminho local enquanto a coluna não
// existe. É o caminho de quem colou um print porque o PDF não foi reconhecido:
// falhar aqui é falhar na última alternativa que a plantonista tinha.
describe('C1 · os DOIS caminhos gravam com e sem a coluna impressao_digital', () => {
  const bancoSemAColuna = () => {
    const gravadas: any[] = []
    return {
      gravadas,
      cliente: cliente({
        inserir: async linhas => {
          if (linhas.some(l => 'impressao_digital' in l)) {
            return { erro: "Could not find the 'impressao_digital' column of 'exames' in the schema cache (PGRST204)" }
          }
          gravadas.push(...linhas)
          return { erro: null }
        },
      }),
    }
  }

  it('coluna AUSENTE · caminho da IA grava assim mesmo', async () => {
    const { cliente: c, gravadas } = bancoSemAColuna()
    const r = await processarIA(c, 'pac-1', RESULTADO_IA(), 'print-colado.png')
    expect(r.ok).toBe(true)
    expect(gravadas[0].resultados[0].nome).toBe('Potássio')
  })

  it('coluna AUSENTE · caminho local do PDF grava assim mesmo', async () => {
    const { cliente: c, gravadas } = bancoSemAColuna()
    const r = await processarPdf(c, 'pac-1', PDF(), 'laudo.pdf', 'Maria das Dores Silva')
    expect(r.ok).toBe(true)
    expect(gravadas).toHaveLength(1)
  })

  it('coluna PRESENTE · caminho da IA continua enviando o campo', async () => {
    let gravado: any = null
    await processarIA(
      cliente({ inserir: async l => { gravado = l; return { erro: null } } }),
      'pac-1', RESULTADO_IA(), 'print-colado.png')
    expect('impressao_digital' in gravado[0]).toBe(true)
  })
})

describe('flags da IA sobrevivem sem recálculo', () => {
  it('alterado e direcao chegam ao inserir EXATAMENTE como a IA devolveu', async () => {
    let gravado: any = null
    await processarIA(
      cliente({ inserir: async linhas => { gravado = linhas; return { erro: null } } }),
      'pac-1', RESULTADO_IA(), 'print-colado.png')
    const r = gravado[0].resultados[0]
    expect(r.alterado).toBe(true)
    expect(r.direcao).toBe('alto')
    // Continua sendo o MESMO valor da IA, não um recálculo que por acaso bateu.
    expect(r.valor).toBe('6,2')
    expect(r.referencia).toBe('3,5 - 5,0')
  })
})

describe('D10 · o marcador de IA é do registro, não do valor', () => {
  it('observações do registro carregam o marcador; nenhum resultado individual carrega', async () => {
    let gravado: any = null
    await processarIA(
      cliente({ inserir: async linhas => { gravado = linhas; return { erro: null } } }),
      'pac-1', RESULTADO_IA(), 'print-colado.png')
    expect(gravado[0].observacoes).toMatch(/Lido por IA/)
    for (const r of gravado[0].resultados) {
      expect(JSON.stringify(r)).not.toMatch(/Lido por IA/)
    }
  })

  it('sucesso devolve o mesmo formato de resposta do caminho local', async () => {
    const r = await processarIA(cliente(), 'pac-1', RESULTADO_IA(), 'print-colado.png')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.via).toBe('ia')
      expect(r.registros).toBe(1)
      expect(r.duplicataDe).toBeNull()
    }
  })
})
