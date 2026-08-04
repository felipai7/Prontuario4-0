import { describe, it, expect } from 'vitest'
import { montarEntrega } from './entrega'
import { extrairExames } from './extracao'
import { pdfDeLinhas } from './extracao/_testes/pdfMinimo'

// ══════════════════════════════════════════════════════════════════════════
// I5 · laudo de imagem no mesmo arquivo não pode sumir calado.
//
// `montarEntrega` lê `observations` e `cultures`, e nunca `imaging`. E
// `processarPdf` só passa a bola para a IA quando as DUAS primeiras estão
// vazias — então um PDF que traz exames de laboratório E um laudo de imagem
// é resolvido aqui, localmente, e o texto da imagem não chega nem ao
// prontuário nem a `discarded[]`. Some, sem rastro, exatamente o que R1
// existe para impedir.
//
// Importar o laudo de imagem de verdade está FORA de escopo (design, 8.1).
// O mínimo que fecha o buraco é tornar a perda VISÍVEL: uma pendência na
// lista acima da tabela, e uma nota no campo de observações do registro —
// que fica gravado, e não só na tela do momento.
// ══════════════════════════════════════════════════════════════════════════

const LAUDO_MISTO = [
  'BIOQUIMICA',
  'Coleta: 12/05/2026',
  'Glicose              92    mg/dL      70 - 99',
  'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO',
  'INDICAÇÃO: Cefaleia súbita.',
  'TÉCNICA: Cortes axiais sem contraste.',
  'ACHADOS:',
  'Hematoma subdural agudo à esquerda, com desvio da linha média.',
  'CONCLUSÃO:',
  'Hematoma subdural agudo.',
]

async function entregar(linhas: string[]) {
  const r = await extrairExames({
    document: { bytes: pdfDeLinhas(linhas), filename: null },
    hints: null,
    options: null,
  })
  return { r, e: montarEntrega(r, false) }
}

describe('I5 · o laudo de imagem que não foi importado aparece', () => {
  it('o extrator de fato produziu um laudo de imagem (a fixture carrega o caso)', async () => {
    const { r } = await entregar(LAUDO_MISTO)
    expect(r.imaging.length).toBeGreaterThan(0)
    // E o laudo de laboratório do mesmo arquivo foi lido aqui, localmente —
    // é isso que impede a rota de mandar o arquivo para a IA e faz a imagem
    // sumir sem ninguém perceber.
    expect(r.observations.length).toBeGreaterThan(0)
  })

  it('a perda vira PENDÊNCIA, na lista que a tela já mostra', async () => {
    const { e } = await entregar(LAUDO_MISTO)
    expect(e.pendencias.some(p => /imagem/i.test(p.motivo))).toBe(true)
  })

  it('a perda também fica GRAVADA nas observações do registro', async () => {
    // Pendência é de tela e some no refresh; observações vão para o banco.
    const { e } = await entregar(LAUDO_MISTO)
    expect(e.linhas[0]!.observacoes).toMatch(/imagem/i)
  })

  it('R10 · o aviso não carrega o conteúdo do laudo de imagem', async () => {
    const { e } = await entregar(LAUDO_MISTO)
    const texto = JSON.stringify(e)
    expect(texto).not.toMatch(/subdural/i)
    expect(texto).not.toMatch(/linha média/i)
  })

  it('sem laudo de imagem, nenhuma pendência é inventada', async () => {
    const { e } = await entregar([
      'BIOQUIMICA', 'Coleta: 12/05/2026',
      'Glicose              92    mg/dL      70 - 99',
    ])
    expect(e.pendencias.some(p => /imagem/i.test(p.motivo))).toBe(false)
    expect(e.linhas[0]!.observacoes ?? '').not.toMatch(/imagem/i)
  })
})
