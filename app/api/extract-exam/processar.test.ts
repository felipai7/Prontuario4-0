// ══════════════════════════════════════════════════════════════════════════
// Testa a ORQUESTRAÇÃO (extrai + grava), não a rota HTTP.
//
// Importa só `./processar`, nunca `./route`: `route.ts` importa `next/server`
// e o cliente Supabase do servidor, e carregar isso no processo do vitest é
// exatamente o tipo de quebra que a Correção 1 do despacho existe para evitar.
// ══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import { processarPdf } from './processar'
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
