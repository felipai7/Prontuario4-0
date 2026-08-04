// ══════════════════════════════════════════════════════════════════════════
// Testa a ORQUESTRAÇÃO (extrai + grava), não a rota HTTP.
//
// Importa só `./processar`, nunca `./route`: `route.ts` importa `next/server`
// e o cliente Supabase do servidor, e carregar isso no processo do vitest é
// exatamente o tipo de quebra que a Correção 1 do despacho existe para evitar.
// ══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import { processarPdf, MENSAGEM_NAO_RECONHECIDO } from './processar'
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

describe('R3.1 · a nota discreta ("o laudo não trouxe") viaja separada das pendências', () => {
  it('caminho local devolve notasLaudo, canal separado de pendencias', async () => {
    const r = await processarPdf(cliente(), 'pac-1', pdfDeLinhas([
      'Paciente: MARIA DAS DORES SILVA',
      'GASOMETRIA ARTERIAL', 'Coleta: 12/05/2026',
      'pH............:  7,38',
    ]), 'laudo.pdf', 'Maria das Dores Silva')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.notasLaudo.length).toBeGreaterThan(0)
      expect(r.pendencias.length).toBe(0)
    }
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

// I5 — a mesma lacuna que fazia o laudo de imagem sumir calado (ver
// `lib/exames/imagem-vira-registro.test.ts`) também mandava o documento para
// a IA sem necessidade: `observations` e `cultures` vazios, mas `imaging`
// não. Vinte de cinquenta PDFs do acervo real caíam aqui — dezessete deles
// eram laudo de imagem que o extrator local JÁ tinha lido.
describe('I5 · imagem conta na decisão local-vs-IA', () => {
  const PDF_SO_IMAGEM = () => pdfDeLinhas([
    'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO',
    'Data do exame: 29/06/2026',
    'INDICAÇÃO: Cefaleia súbita.',
    'TÉCNICA: Cortes axiais sem contraste.',
    'ACHADOS:',
    'Não há evidência de hemorragia intracraniana.',
    'CONCLUSÃO:',
    'Exame dentro dos limites da normalidade.',
  ])

  it('laudo só de imagem (zero observações, zero culturas) é processado localmente, não cai como não reconhecido', async () => {
    const r = await processarPdf(cliente(), 'pac-1', PDF_SO_IMAGEM(), 'laudo.pdf', null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.via).toBe('local')
      expect(r.registros).toBe(1)
    }
  })
})

// C1 — a coluna `impressao_digital` só existe depois do ALTER TABLE, que é
// pendência externa. Sem esta tolerância, TODA gravação falharia hoje — e
// agora que o caminho local é o único, falhar aqui é não gravar exame nenhum.
describe('C1 · o caminho local grava com e sem a coluna impressao_digital', () => {
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

  it('coluna AUSENTE · grava assim mesmo', async () => {
    const { cliente: c, gravadas } = bancoSemAColuna()
    const r = await processarPdf(c, 'pac-1', PDF(), 'laudo.pdf', 'Maria das Dores Silva')
    expect(r.ok).toBe(true)
    expect(gravadas).toHaveLength(1)
  })

  it('coluna PRESENTE · o campo continua sendo enviado', async () => {
    let gravado: any = null
    await processarPdf(
      cliente({ inserir: async l => { gravado = l; return { erro: null } } }),
      'pac-1', PDF(), 'laudo.pdf', 'Maria das Dores Silva')
    expect('impressao_digital' in gravado[0]).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 03/08/2026 — a IA saiu da rota. O que antes era o sinal interno
// `NAO_RECONHECIDO` ("manda para o Google") passou a ser a ÚNICA coisa que a
// médica vê quando o leitor local não dá conta, e por isso virou mensagem de
// verdade. Sem estes testes, a remoção deixaria o caso mudo: o envio falharia
// e a tela mostraria o nome de um sinal interno.
// ══════════════════════════════════════════════════════════════════════════

describe('laudo que o leitor local não reconhece', () => {
  // Laboratório fora da lista: o texto é legível, mas não casa com perfil
  // nenhum e não tem linha de resultado que o extrator saiba montar. É o
  // caso do antibiograma solto medido no acervo (1 de 50).
  const PDF_LAB_DESCONHECIDO = () => pdfDeLinhas([
    'CLINICA POPULAR SAO JORGE',
    'Documento interno - conferencia de estoque',
    'Item 4471 conferido por AMANDA P. em 02/08',
  ])

  it('devolve a falha honesta em vez de sumir com o envio', async () => {
    const r = await processarPdf(cliente(), 'pac-1', PDF_LAB_DESCONHECIDO(), 'laudo.pdf', null)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro).toBe(MENSAGEM_NAO_RECONHECIDO)
      // Diz o que fazer, não só que deu errado — é o caminho manual.
      expect(r.erro).toMatch(/Manual/)
      // E não é mais o nome de um sinal interno na cara da médica.
      expect(r.erro).not.toMatch(/NAO_RECONHECIDO/)
    }
  })

  it('R10 · a mensagem não carrega nada do que estava no documento', async () => {
    const r = await processarPdf(cliente(), 'pac-1', PDF_LAB_DESCONHECIDO(), 'laudo.pdf', 'Maria das Dores Silva')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro).not.toMatch(/SAO JORGE|AMANDA|4471|Maria|laudo\.pdf/i)
      // O diagnóstico existe para o LOG, e também não carrega conteúdo: só
      // perfil, códigos de aviso e contagens.
      expect(JSON.stringify(r.diagnostico ?? {})).not.toMatch(/SAO JORGE|AMANDA|4471|Maria/i)
    }
  })

  it('não é confundida com falha de gravação: só este caso traz diagnóstico', async () => {
    const naoReconhecido = await processarPdf(cliente(), 'pac-1', PDF_LAB_DESCONHECIDO(), 'laudo.pdf', null)
    const bancoFalhou = await processarPdf(
      cliente({ inserir: async () => ({ erro: 'permissão negada' }) }),
      'pac-1', PDF(), 'laudo.pdf', 'Maria das Dores Silva')
    expect(naoReconhecido.ok).toBe(false)
    expect(bancoFalhou.ok).toBe(false)
    // É por esta diferença que a rota escolhe 422 (documento) ou 500 (nós).
    if (!naoReconhecido.ok) expect(naoReconhecido.diagnostico).toBeDefined()
    if (!bancoFalhou.ok) expect(bancoFalhou.diagnostico).toBeUndefined()
  })
})
