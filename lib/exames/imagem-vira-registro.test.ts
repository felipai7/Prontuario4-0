import { describe, it, expect } from 'vitest'
import { montarEntrega } from './entrega'
import { extrairExames } from './extracao'
import { pdfDeLinhas } from './extracao/_testes/pdfMinimo'

// ══════════════════════════════════════════════════════════════════════════
// I5 · laudo de imagem no mesmo arquivo que exame de laboratório.
//
// Até 03/08/2026, `montarEntrega` lia `observations` e `cultures`, e nunca
// `imaging`. Um PDF que trazia exame de laboratório E laudo de imagem no
// mesmo arquivo era "resolvido" localmente (porque `observations` não estava
// vazio) e o laudo de imagem desaparecia — nem ia para o prontuário, nem
// virava pendência visível, nem contava em `discarded[]`. Este arquivo
// (antes `imagem-nao-importada.test.ts`) testava só que a perda tinha ficado
// VISÍVEL como nota de "não importado". Agora ela não existe mais: o laudo
// de imagem vira registro na mesma tabela que a cultura — ver `deImagem` em
// `entrega.ts`.
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

describe('I5 · o laudo misto (laboratório + imagem) entrega os dois', () => {
  it('o extrator de fato produziu os dois — laboratório e imagem', async () => {
    const { r } = await entregar(LAUDO_MISTO)
    expect(r.imaging.length).toBeGreaterThan(0)
    // E o laudo de laboratório do mesmo arquivo foi lido aqui, localmente —
    // é isso que impede a rota de mandar o arquivo para a IA.
    expect(r.observations.length).toBeGreaterThan(0)
  })

  it('a entrega tem um valor para cada um, não só o de laboratório', async () => {
    const { e } = await entregar(LAUDO_MISTO)
    const nomes = e.linhas.flatMap(l => l.valores.map(v => v.nome))
    expect(nomes).toContain('Glicose')
    expect(nomes).toContain('TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO')
  })

  it('a conclusão da imagem chega ao valor — é o que a médica lê primeiro', async () => {
    const { e } = await entregar(LAUDO_MISTO)
    const imagem = e.linhas.flatMap(l => l.valores).find(v => v.nome === 'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO')!
    expect(imagem.valor).toMatch(/Hematoma subdural agudo/)
  })

  it('sem laudo de imagem, nenhum registro de imagem é inventado', async () => {
    const { e } = await entregar([
      'BIOQUIMICA', 'Coleta: 12/05/2026',
      'Glicose              92    mg/dL      70 - 99',
    ])
    const nomes = e.linhas.flatMap(l => l.valores.map(v => v.nome))
    expect(nomes.some(n => /TOMOGRAFIA/i.test(n))).toBe(false)
  })
})
