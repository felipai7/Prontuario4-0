import { describe, it, expect } from 'vitest'
import { extrairExames } from '../index'
import { pdfDeLinhas } from '../_testes/pdfMinimo'

// ══════════════════════════════════════════════════════════════════════════
// LACUNAS CONHECIDAS — o que o clinBoard extrai e este módulo ainda não.
//
// Cada bloco reproduz, em PDF sintético, o layout exato de um caso que a
// paridade sobre o corpus real acusou como regressão. Os valores são
// fictícios; o LAYOUT é fiel, porque é ele que quebra.
//
// Marcados com `it.fails()`: passam enquanto o defeito existe e QUEBRAM no dia
// em que alguém o corrigir, obrigando a virar a asserção. É o oposto de um
// teste que documenta o comportamento errado como se fosse o certo — este
// arquivo é uma lista de dívida que se cobra sozinha.
//
// Sem este arquivo a suíte fica verde sobre 56 exames que o clinBoard entrega
// e nós não. Já aconteceu três vezes neste projeto: suíte verde, corpus real
// dizendo outra coisa.
// ══════════════════════════════════════════════════════════════════════════

async function extrair(linhas: string[]) {
  return extrairExames({
    document: { bytes: pdfDeLinhas(linhas), filename: null },
    hints: null,
    options: null,
  })
}

const nomes = (r: Awaited<ReturnType<typeof extrair>>) =>
  r.observations.map(o => o.canonicalName)

// ── 1. Saturação de O2 grafada sem espaço ──────────────────────────────────
// 7 ocorrências no corpus (IMEC1, IMEC2×2, IMEC4, IMEC5, IMEC6, HUGO1).
// O LIS escreve "O2SAT" colado; o catálogo herdou "O2 SAT", "SATO2" e "SO2",
// todos com separador. A seção 8.1 já avisava que estes laudos grafam o
// oxigênio de forma irregular — inclusive com o DÍGITO ZERO no lugar da letra
// O ("02 SAT"), que o catálogo cobre.
describe('lacuna · saturação de O2 grafada sem separador', () => {
  const LAUDO = [
    'GASOMETRIA ARTERIAL',
    'Coleta: 12/05/2026',
    'pH............:  7,38  7,35 a 7,45',
    'O2SAT.........:  93,00  %   92,0 a 96,0 %',
  ]

  it('o pH da mesma seção é extraído — o layout em si funciona', async () => {
    expect(nomes(await extrair(LAUDO))).toContain('pH (Arterial)')
  })

  it.fails('"O2SAT" colado deveria resolver para O2 Sat (Arterial)', async () => {
    expect(nomes(await extrair(LAUDO))).toContain('O2 Sat (Arterial)')
  })
})

// ── 2. Seção de cultura que nunca termina ──────────────────────────────────
// 5 ocorrências (IMEC5 ×3, HUGO2, HUGO4), e a causa NÃO é a que eu supus.
//
// Minha primeira hipótese foi vocabulário — "Influenza tipo A" contra
// "Influenza A" no catálogo. A fixture desmentiu na hora: isolada, a sorologia
// é extraída sem problema. O que quebra é o CONTEXTO.
//
// No IMEC5 o bloco de sorologia vem DEPOIS de uma hemocultura, e a seção de
// cultura não tem fim: ela segue até o próximo cabeçalho reconhecido. Como
// "COVID Ag / INFLUENZA A-B" não é um deles, as 42 linhas seguintes — incluindo
// a sorologia inteira — ficam num segmento `culture`, onde nenhum matcher de
// laboratório se aplica. Não viram observação NEM descarte: somem.
describe('lacuna · seção de cultura sem fim engole o que vem depois', () => {
  const SOROLOGIA = [
    'COVID Ag / INFLUENZA A-B',
    'Influenza tipo A:  NEGATIVO',
    'Influenza tipo B:  NEGATIVO',
  ]

  it('sozinha, a sorologia é extraída — o vocabulário está certo', async () => {
    const r = await extrair(['Coleta: 12/05/2026', ...SOROLOGIA])
    expect(nomes(r)).toContain('Influenza A')
    expect(nomes(r)).toContain('Influenza B')
  })

  it.fails('depois de uma hemocultura, a mesma sorologia deveria continuar sendo extraída', async () => {
    const r = await extrair([
      'HEMOCULTURA - 2ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: NÃO HOUVE CRESCIMENTO DE BACTÉRIAS.',
      ...SOROLOGIA,
    ])
    expect(nomes(r)).toContain('Influenza A')
  })

  it.fails('R1 · o que a seção de cultura engole deveria ao menos virar descarte', async () => {
    // Pior que não extrair: não extrair EM SILÊNCIO. Hoje estas linhas não
    // aparecem em `discarded` — o usuário não tem como saber que existiram.
    const r = await extrair([
      'HEMOCULTURA - 2ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: NÃO HOUVE CRESCIMENTO DE BACTÉRIAS.',
      ...SOROLOGIA,
    ])
    expect(r.discarded.length).toBeGreaterThan(0)
  })
})

// ── 3. Célula do diferencial ausente do catálogo ───────────────────────────
// 2 ocorrências (HUGO1, HUGO2). "Mieloblastos" não está na lista de células
// do diferencial nem no vocabulário. O HUGO ainda grafa a unidade como "uL",
// e cola valor e unidade na mesma coluna.
describe('lacuna · mieloblastos no diferencial', () => {
  const LAUDO = [
    'HEMOGRAMA',
    'Coleta: 12/05/2026',
    'Mieloblastos  :  0,0 %   0 uL   0 - 0 uL',
    'Linfócitos  :  15,0 %   1875 uL   900 - 3500 uL',
  ]

  it.fails('"Mieloblastos" deveria ser reconhecido', async () => {
    expect(nomes(await extrair(LAUDO))).toContain('Mieloblastos')
  })

  it.fails('com valor e unidade colados, o absoluto ainda deveria vencer', async () => {
    const r = await extrair(LAUDO)
    const linf = r.observations.find(o => o.canonicalName === 'Linfócitos')
    expect(linf?.value).toMatchObject({ kind: 'numeric', value: 1875 })
  })
})

// ── 4. Qualitativo com ponto final ─────────────────────────────────────────
// 4 ocorrências no líquor do IMEC. O laudo escreve "Ausência de bactérias."
// com ponto; o vocabulário tem o termo sem pontuação, e a coluna se repete.
describe('lacuna · valor qualitativo terminado em ponto', () => {
  const LAUDO = [
    'ROTINA DE LÍQUOR',
    'Material: Liquor   Coleta...: 12/05/2026 - 19:10',
    'Cor:   Incolor.   Incolor',
    'Bacterioscopia GRAM:   Ausência de bactérias.   Ausência de bactérias',
  ]

  it('o nome é reconhecido — o problema é o valor', async () => {
    expect(nomes(await extrair(LAUDO))).toContain('Bacterioscopia Gram (LCR)')
  })

  it.fails('"Ausência de bactérias." com ponto deveria virar código qualitativo', async () => {
    const r = await extrair(LAUDO)
    const bact = r.observations.find(o => o.canonicalName === 'Bacterioscopia Gram (LCR)')
    expect(bact?.value).toMatchObject({ kind: 'qualitative', code: 'absent' })
  })
})

// ── 5. Crescimento de cultura numa linha de exame ──────────────────────────
// 1 ocorrência (IMECliquor). "Bactéria isolada" com o texto de crescimento no
// lugar do valor: é vocabulário de CULTURA aparecendo numa linha de resultado.
describe('lacuna · termo de crescimento no lugar do valor', () => {
  it.fails('"NÃO HOUVE CRESCIMENTO DE BACTÉRIAS" deveria ser reconhecido como ausência', async () => {
    const r = await extrair([
      'ROTINA DE LÍQUOR',
      'Material: Liquor   Coleta...: 12/05/2026 - 19:10',
      'Bactéria isolada....: NÃO HOUVE CRESCIMENTO DE BACTÉRIAS.',
    ])
    const b = r.observations.find(o => /Bact[ée]ria Isolada/i.test(o.canonicalName ?? ''))
    expect(b?.value).toMatchObject({ kind: 'qualitative' })
  })
})

// ── 6. Bloco cujo título traz a sigla entre parênteses ─────────────────────
// 3 ocorrências (IMEC1, IMEC4, IMEC5). O título é
// "TEMPO DE TROMBOPLASTINA PARCIAL ATIVADO (TTPA)" e o valor vem abaixo; o
// matcher de bloco procura o nome acima e não o reconhece por extenso.
describe('lacuna · título de bloco com a sigla entre parênteses', () => {
  it.fails('o TTPA deveria ser extraído do bloco cujo título traz a sigla', async () => {
    const r = await extrair([
      'TEMPO DE TROMBOPLASTINA PARCIAL ATIVADO (TTPA)',
      'Coleta: 12/05/2026',
      'Resultado: 25,6  segundos',
    ])
    expect(nomes(r)).toContain('TTPA')
  })
})

// ── 7. Cultura contada como observação pelo doador ─────────────────────────
// 6 ocorrências. NÃO é perda de dado: a cultura É extraída, no campo próprio
// `cultures[]`. O clinBoard não tem esse campo e emite a cultura como se fosse
// um exame de valor 0/1. O teste existe para deixar a diferença explícita —
// é divergência de FORMA, e o comparador de paridade é que precisa saber.
describe('não é lacuna · cultura vive em cultures[], não em observations[]', () => {
  it('a hemocultura é extraída, no campo certo', async () => {
    const r = await extrair([
      'HEMOCULTURA - 1ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: Escherichia coli',
    ])
    expect(r.cultures).toHaveLength(1)
    expect(r.cultures[0]!.isolates[0]!.organism).toBe('Escherichia coli')
    expect(nomes(r)).not.toContain('Hemocultura')
  })
})
