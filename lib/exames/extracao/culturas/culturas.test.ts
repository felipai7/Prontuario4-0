import { describe, it, expect } from 'vitest'
import { extrairExames } from '../index'
import { pdfDeLinhas } from '../_testes/pdfMinimo'
import { interpretarMic, interpretarContagem } from './extrair'
import { avaliarIntegridade } from '../texto/integridade'

async function extrair(linhas: string[]) {
  return extrairExames({
    document: { bytes: pdfDeLinhas(linhas), filename: null },
    hints: null,
    options: null,
  })
}

// ══════════════════════════════════════════════════════════════════════════
// Um teste por layout de antibiograma, com PDF sintético. Nenhum dado de
// paciente: organismos e antimicrobianos são reais, o resto é inventado.
// ══════════════════════════════════════════════════════════════════════════

describe('MIC', () => {
  it('preserva o operador nos quatro sentidos', () => {
    expect(interpretarMic('<=8', 'mg/L')).toMatchObject({ operator: 'lte', value: 8 })
    expect(interpretarMic('>32', 'mg/L')).toMatchObject({ operator: 'gt', value: 32 })
    expect(interpretarMic('>= 4', 'mg/L')).toMatchObject({ operator: 'gte', value: 4 })
    expect(interpretarMic('0.25', 'mg/L')).toMatchObject({ operator: 'eq', value: 0.25 })
  })

  it('MIC de combinação não vira um número só', () => {
    // ">8/4" é ampicilina/sulbactam: dois princípios, duas concentrações.
    // Inventar um número aqui seria representar errado.
    const m = interpretarMic('>8/4', 'mg/L')!
    expect(m.value).toBeNull()
    expect(m.operator).toBe('gt')
    expect(m.raw).toBe('>8/4')
    expect(interpretarMic('<=2/38', 'mg/L')!.value).toBeNull()
  })

  it('traço não é MIC zero — é ausência de MIC', () => {
    expect(interpretarMic('-', 'mg/L')).toBeNull()
    expect(interpretarMic('', 'mg/L')).toBeNull()
  })
})

describe('contagem de colônias', () => {
  it('">100000 UFC/mL" mantém o operador — é o que separa contaminação de infecção', () => {
    expect(interpretarContagem('Micro-organismo [1]: X   >100000 UFC/mL')).toMatchObject({
      value: 100000, operator: 'gt', unit: 'CFU/mL',
    })
  })

  it('notação de potência "6 x (10)5 UFC" é expandida', () => {
    expect(interpretarContagem('Contagem de colônias: 6 x (10)5 UFC')).toMatchObject({
      value: 600000, operator: 'eq', unit: 'CFU/mL',
    })
  })

  it('">=" e ">" não colapsam', () => {
    expect(interpretarContagem('>= 100000 UFC/mL')!.operator).toBe('gte')
    expect(interpretarContagem('> 100000 UFC/mL')!.operator).toBe('gt')
  })
})

describe('layout de antibiograma com um isolado', () => {
  const LAUDO = [
    'HEMOCULTURA - 1ª AMOSTRA',
    'Material: Sangue periférico   Coleta...: 27/07/2026 - 08:40',
    'Método..: Cultura automatizada - Comitê Brasileiro de Teste de Sensibilidade',
    'aos Antimicrobianos - BrCAST.',
    'Identificação',
    'Bactéria isolada....: Serratia marcescens',
    'Antibiograma',
    'Antimicrobiano   Classificação/Categoria   MIC',
    'Amicacina   S   <=8',
    'Amp/Sulbactam   R   >8/4',
    'Meropenem   S   <=0.12',
    'S=Sensível',
    'I=Sensível-Necessário aumento de exposição   N/R=Não reportado',
  ]

  it('extrai material, data de coleta, isolado e crescimento', async () => {
    const r = await extrair(LAUDO)
    expect(r.cultures).toHaveLength(1)
    const c = r.cultures[0]!
    expect(c.specimen).toBe('Hemocultura')
    expect(c.growth).toBe('positive')
    expect(c.collectedAt.iso).toBe('2026-07-27T08:40')
    expect(c.isolates.map(i => i.organism)).toEqual(['Serratia marcescens'])
  })

  it('extrai o perfil de sensibilidade sem engolir a legenda', async () => {
    const r = await extrair(LAUDO)
    const atb = r.cultures[0]!.isolates[0]!.susceptibilities
    expect(atb.map(s => s.antimicrobial)).toEqual(['Amicacina', 'Amp/Sulbactam', 'Meropenem'])
    expect(atb[0]).toMatchObject({ interpretation: 'S', standard: 'BrCAST', standardSource: 'declared' })
    expect(atb[1]!.mic).toMatchObject({ operator: 'gt', value: null, raw: '>8/4' })
  })

  it('a norma declarada no laudo é registrada como lida, não assumida', async () => {
    const r = await extrair(LAUDO)
    for (const s of r.cultures[0]!.isolates[0]!.susceptibilities) {
      expect(s.standardSource).toBe('declared')
    }
  })

  it('sem norma declarada, assume BrCAST e registra a assunção', async () => {
    const r = await extrair([
      'UROCULTURA',
      'Coleta: 27/07/2026',
      'Bactéria isolada....: Escherichia coli',
      'Antibiograma',
      'Antimicrobiano   Categoria   MIC',
      'Ampicilina   R   >32',
    ])
    const s = r.cultures[0]!.isolates[0]!.susceptibilities[0]!
    expect(s.standard).toBe('BrCAST')
    expect(s.standardSource).toBe('assumed')
  })
})

describe('layout de antibiograma com dois isolados lado a lado', () => {
  const LAUDO = [
    'CULTURA QUANTITATIVA E ANTIBIOGRAMA ASPIRADO TRAQUEAL',
    'Material: ASPIRADO TRAQUEAL',
    'Coletado em (20/07/2026 16:54)',
    'Micro-organismo [1]: Candida albicans   >100000 UFC/mL',
    'Micro-organismo [2]: Enterococcus faecium   >100000 UFC/mL',
    'TESTE DE SENSIBILIDADE',
    '[1]   [2]',
    'Antibiotico   SENS  MIC   SENS  MIC',
    'Ampicilina   -   -   R   >= 32',
    'Caspofungina   S   0.25   -   -',
    'Linezolida   -   -   S   2',
    'Resultado de teste de sensibilidade interpretado através da padronização BrCAST.',
    'Resultado de Caspofungina para Candida albicans interpretado através de',
    'padronização CLSI.',
  ]

  it('separa os dois isolados, cada um com seu antibiograma', async () => {
    const r = await extrair(LAUDO)
    const isolados = r.cultures[0]!.isolates
    expect(isolados.map(i => i.organism)).toEqual(['Candida albicans', 'Enterococcus faecium'])
    expect(isolados[0]!.susceptibilities).toHaveLength(3)
    expect(isolados[1]!.susceptibilities).toHaveLength(3)
  })

  it('a interpretação de cada coluna vai para o isolado certo', async () => {
    const r = await extrair(LAUDO)
    const [candida, entero] = r.cultures[0]!.isolates
    const amp1 = candida!.susceptibilities.find(s => s.antimicrobial === 'Ampicilina')!
    const amp2 = entero!.susceptibilities.find(s => s.antimicrobial === 'Ampicilina')!
    expect(amp1.interpretation).toBe('NT')   // traço = não testado
    expect(amp2.interpretation).toBe('R')
    expect(amp2.mic).toMatchObject({ operator: 'gte', value: 32 })
  })

  it('a ressalva de norma vale por ANTIMICROBIANO, não pelo laudo inteiro', async () => {
    // O laudo é BrCAST, mas a caspofungina vem interpretada por CLSI. Em CLSI
    // "I" é intermediário; em BrCAST é sensível com exposição aumentada. Ler a
    // norma errada inverte a conduta.
    const r = await extrair(LAUDO)
    const atb = r.cultures[0]!.isolates[0]!.susceptibilities
    expect(atb.find(s => s.antimicrobial === 'Caspofungina')!.standard).toBe('CLSI')
    expect(atb.find(s => s.antimicrobial === 'Ampicilina')!.standard).toBe('BrCAST')
  })

  it('a contagem de colônias acompanha cada isolado', async () => {
    const r = await extrair(LAUDO)
    for (const i of r.cultures[0]!.isolates) {
      expect(i.colonyCount).toMatchObject({ value: 100000, operator: 'gt', unit: 'CFU/mL' })
    }
  })
})

describe('crescimento ausente', () => {
  it('"Não houve desenvolvimento" vira noGrowth, não indeterminado', async () => {
    const r = await extrair([
      'CULTURA DE VIGILÂNCIA - PESQUISA DE MRSA',
      'Coleta: 27/07/2026',
      'Não houve desenvolvimento de Staphylococcus aureus resistente a meticilina',
    ])
    expect(r.cultures[0]!.growth).toBe('noGrowth')
    expect(r.cultures[0]!.isolates).toEqual([])
  })
})

describe('ausência de crescimento no campo do isolado', () => {
  it('"Bactéria isolada: NÃO HOUVE CRESCIMENTO" não cria um isolado', async () => {
    // O campo do isolado traz a AUSÊNCIA de isolado. Criar um isolado com esse
    // nome fazia a cultura sair como `positive` — uma hemocultura negativa
    // registrada como positiva, que é erro clínico direto e do tipo que parece
    // certo: o nome do organismo é uma frase em português.
    const r = await extrair([
      'HEMOCULTURA - 1ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: NÃO HOUVE CRESCIMENTO DE BACTÉRIAS.',
    ])
    expect(r.cultures[0]!.isolates).toEqual([])
    expect(r.cultures[0]!.growth).toBe('noGrowth')
  })

  it('um isolado de verdade continua sendo criado', async () => {
    const r = await extrair([
      'HEMOCULTURA - 1ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: Escherichia coli',
    ])
    expect(r.cultures[0]!.isolates.map(i => i.organism)).toEqual(['Escherichia coli'])
    expect(r.cultures[0]!.growth).toBe('positive')
  })
})

describe('vigilância epidemiológica não é sinônimo de MRSA', () => {
  // Correção clínica de 01/08/2026. O catálogo do clinBoard colapsa TODA
  // cultura de vigilância em "MRSA". Nos laudos do corpus, a vigilância por
  // swab anal declara textualmente que pesquisou "Enterococcus resistentes a
  // Vancomicina" — é VRE, e MRSA é Staphylococcus aureus. Rotular um pelo
  // outro no prontuário afirma um germe que o exame não procurou.
  it('vigilância por swab anal NÃO vira MRSA', async () => {
    const r = await extrair([
      'CULTURA DE VIGILÂNCIA EPIDEMIOLÓGICA - SWAB ANAL',
      'Material: Swab anal   Coleta...: 28/07/2026 - 10:00',
      'Neste exame foram pesquisados:',
      'Enterococcus resistentes a Vancomicina',
    ])
    expect(r.cultures[0]!.specimen).toBe('Cultura de Vigilância')
    expect(r.cultures[0]!.specimen).not.toMatch(/MRSA/)
  })

  it('quando o laudo DIZ pesquisa de MRSA, o nome carrega o germe', async () => {
    const r = await extrair([
      'CULTURA DE VIGILÂNCIA - PESQUISA DE MRSA',
      'Material: Swab nasal   Coleta...: 28/07/2026 - 10:00',
      'Não houve desenvolvimento de Staphylococcus aureus resistente a meticilina',
    ])
    expect(r.cultures[0]!.specimen).toBe('Vigilância MRSA')
    expect(r.cultures[0]!.growth).toBe('noGrowth')
  })

  it('a chave mais específica vence a mais genérica', async () => {
    // "CULTURA DE VIGILÂNCIA - PESQUISA DE MRSA" casa com duas entradas do
    // catálogo. Escolher a primeira do objeto fazia o exame que procurou MRSA
    // perder o nome do germe que procurou.
    const generico = await extrair([
      'CULTURA DE VIGILÂNCIA EPIDEMIOLÓGICA',
      'Material: Swab anal   Coleta...: 28/07/2026 - 10:00',
      'Bactéria isolada....: Escherichia coli',
    ])
    expect(generico.cultures[0]!.specimen).toBe('Cultura de Vigilância')
  })
})

describe('camada de texto corrompida', () => {
  it('R1 · texto ilegível é reconhecido como tal', () => {
    // Reproduz o estrago real de um laudo do corpus: bytes UTF-16 com a ordem
    // trocada. As MAIÚSCULAS sairiam certas e só o nome do antibiótico viria
    // errado — antibiograma com a interpretação certa no antibiótico errado.
    //
    // O teste é de unidade e não de PDF porque o gerador sintético codifica em
    // WinAnsi, que não representa estes caracteres. A cobertura ponta a ponta
    // vem do corpus real (dois laudos, 82% de caracteres ilegíveis cada).
    const corrompido = avaliarIntegridade({
      pages: [],
      lines: [
        { page: 1, index: 0, text: '䌀唀䰀吀唀刀䄀 ⬀ 䄀一吀䤀䈀䤀伀䜀刀䄀䴀䄀', y: 0, items: [], gaps: [] },
        { page: 1, index: 1, text: '匀瘀洀最戀ⴀ吀猀樀渀昀甀瀀爀猀樀渀   䤀', y: 0, items: [], gaps: [] },
      ],
      hasTextLayer: true,
    })
    expect(corrompido.confiavel).toBe(false)
    expect(corrompido.proporcaoIlegivel).toBeGreaterThan(0.5)
    expect(corrompido.primeiraLinha).toBe(0)
  })

  it('laudo em português normal não é confundido com corrompido', () => {
    const integro = avaliarIntegridade({
      pages: [],
      lines: [
        { page: 1, index: 0, text: 'HEMOCULTURA - 1ª AMOSTRA', y: 0, items: [], gaps: [] },
        { page: 1, index: 1, text: 'Bactéria isolada: Serratia marcescens', y: 0, items: [], gaps: [] },
      ],
      hasTextLayer: true,
    })
    expect(integro.confiavel).toBe(true)
  })
})
