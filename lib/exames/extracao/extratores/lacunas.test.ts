import { describe, it, expect } from 'vitest'
import { extrairExames } from '../index'
import { pdfDeLinhas, pdfTabular } from '../_testes/pdfMinimo'

// ══════════════════════════════════════════════════════════════════════════
// LACUNAS — o que o clinBoard extrai e este módulo não extraía.
//
// Cinco das sete famílias foram FECHADAS, e os `it.fails` correspondentes
// viraram asserção normal no momento em que o defeito caiu — que é o serviço
// que este arquivo presta. Sobra a família 6 (título de bloco com a sigla
// entre parênteses).
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
describe('saturação de O2 grafada sem separador', () => {
  const LAUDO = [
    'GASOMETRIA ARTERIAL',
    'Coleta: 12/05/2026',
    'pH............:  7,38  7,35 a 7,45',
    'O2SAT.........:  93,00  %   92,0 a 96,0 %',
  ]

  it('o pH da mesma seção é extraído — o layout em si funciona', async () => {
    expect(nomes(await extrair(LAUDO))).toContain('pH (Arterial)')
  })

  it('"O2SAT" colado resolve para SatO2 (Arterial)', async () => {
    // Renomeado em 03/08/2026: era "O2 Sat (Arterial)", que divergia do
    // "SatO2" sem sufixo do mesmo catálogo. A grafia antiga segue resolvendo.
    expect(nomes(await extrair(LAUDO))).toContain('SatO2 (Arterial)')
  })
})

// ── 2. Seção de cultura que engolia o que vinha depois — CORRIGIDA ─────────
// 5 ocorrências (IMEC5 ×3, HUGO2, HUGO4).
//
// Minha primeira hipótese foi vocabulário — "Influenza tipo A" contra
// "Influenza A" no catálogo. A fixture desmentiu na hora: isolada, a sorologia
// era extraída sem problema. O que quebrava era o CONTEXTO.
//
// No IMEC5 o bloco de sorologia vem DEPOIS de uma hemocultura, e a seção de
// cultura não tinha fim: seguia até o próximo cabeçalho reconhecido. Como
// "COVID Ag / INFLUENZA A-B" não é um deles, as 42 linhas seguintes — a
// sorologia inteira — ficavam num segmento onde nenhum matcher de laboratório
// se aplicava. Não viravam observação NEM descarte: sumiam.
//
// CORREÇÃO: o extrator de culturas passou a declarar quais linhas consumiu, e
// o motor processa todo o resto. Trocou-se uma heurística de fronteira por um
// fato. Estes testes eram `it.fails` e o mecanismo cobrou a virada.
describe('seção de cultura não engole mais o que vem depois', () => {
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

  it('depois de uma hemocultura, a mesma sorologia continua sendo extraída', async () => {
    const r = await extrair([
      'HEMOCULTURA - 2ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: NÃO HOUVE CRESCIMENTO DE BACTÉRIAS.',
      ...SOROLOGIA,
    ])
    expect(nomes(r)).toContain('Influenza A')
  })

  it('a cultura continua sendo extraída no campo dela', async () => {
    // A correção não pode ter custado a cultura: as linhas que o extrator de
    // culturas consome continuam sendo dele, e só o resto volta ao motor.
    const r = await extrair([
      'HEMOCULTURA - 2ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: NÃO HOUVE CRESCIMENTO DE BACTÉRIAS.',
      ...SOROLOGIA,
    ])
    expect(r.cultures).toHaveLength(1)
    expect(r.cultures[0]!.growth).toBe('noGrowth')
  })

  it('o antibiograma não vira observação de laboratório', async () => {
    // Agora que os matchers alcançam segmentos de cultura, a tabela de
    // sensibilidade poderia virar "exame Amicacina = S". Não pode: as linhas
    // que a cultura consumiu ficam fora do alcance do motor.
    const r = await extrair([
      'HEMOCULTURA - 1ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: Escherichia coli',
      'Antibiograma',
      'Antimicrobiano   Classificação/Categoria   MIC',
      'Amicacina   S   <=8',
      'Meropenem   S   <=0.12',
    ])
    expect(nomes(r)).not.toContain('Amicacina')
    expect(r.cultures[0]!.isolates[0]!.susceptibilities).toHaveLength(2)
  })
})

// ── 3. Célula do diferencial ausente do catálogo ───────────────────────────
// 2 ocorrências (HUGO1, HUGO2). "Mieloblastos" não está na lista de células
// do diferencial nem no vocabulário. O HUGO ainda grafa a unidade como "uL",
// e cola valor e unidade na mesma coluna.
describe('diferencial do HUGO: valor e unidade colados', () => {
  // Colunas em POSIÇÃO, como o laudo as diagrama. Escrita com espaços, esta
  // fixture fundia "Mieloblastos : 0,0 %" numa coluna só e era atendida por
  // outro matcher — provava a coisa errada. É a terceira vez neste projeto que
  // o vão sintético mais estreito que o real muda qual caminho é exercitado.
  const COLUNAS = [50, 150, 175, 260, 350]
  const bytes = pdfTabular([
    ['HEMOGRAMA'],
    ['Coleta: 12/05/2026'],
    ['Mieloblastos', ':', '0,0 %', '0 uL', '0 - 0 uL'],
    ['Linfócitos', ':', '15,0 %', '1875 uL', '900 - 3500 uL'],
  ], COLUNAS)

  const extrairHemograma = () =>
    extrairExames({ document: { bytes, filename: null }, hints: null, options: null })

  it('"Mieloblastos" é reconhecido', async () => {
    expect(nomes(await extrairHemograma())).toContain('Mieloblastos')
  })

  it('com valor e unidade colados, o absoluto vence o percentual', async () => {
    const r = await extrairHemograma()
    const linf = r.observations.find(o => o.canonicalName === 'Linfócitos')
    expect(linf?.value).toMatchObject({ kind: 'numeric', value: 1875 })
    expect(linf?.unit.raw).toBe('uL')
  })
})

// ── 4. Qualitativo com ponto final ─────────────────────────────────────────
// 4 ocorrências no líquor do IMEC. O laudo escreve "Ausência de bactérias."
// com ponto; o vocabulário tem o termo sem pontuação, e a coluna se repete.
describe('valor qualitativo terminado em ponto', () => {
  const LAUDO = [
    'ROTINA DE LÍQUOR',
    'Material: Liquor   Coleta...: 12/05/2026 - 19:10',
    'Cor:   Incolor.   Incolor',
    'Bacterioscopia GRAM:   Ausência de bactérias.   Ausência de bactérias',
  ]

  it('o nome é reconhecido — o problema é o valor', async () => {
    expect(nomes(await extrair(LAUDO))).toContain('Bacterioscopia Gram (LCR)')
  })

  it('"Ausência de bactérias." com ponto vira código qualitativo', async () => {
    const r = await extrair(LAUDO)
    const bact = r.observations.find(o => o.canonicalName === 'Bacterioscopia Gram (LCR)')
    expect(bact?.value).toMatchObject({ kind: 'qualitative', code: 'absent' })
  })
})

// ── 5. Crescimento de cultura numa linha de exame ──────────────────────────
// 1 ocorrência (IMECliquor). No líquor, "Bactéria isolada" é um parâmetro do
// laudo, não um bloco de cultura — e o valor dele é a frase de crescimento.
// Distinto da correção feita no extrator de culturas, que trata o mesmo texto
// dentro de um bloco de cultura de verdade.
describe('termo de crescimento no lugar do valor, fora de bloco de cultura', () => {
  it('"NÃO HOUVE CRESCIMENTO DE BACTÉRIAS" é reconhecido como ausência', async () => {
    const r = await extrair([
      'ROTINA DE LÍQUOR',
      'Material: Liquor   Coleta...: 12/05/2026 - 19:10',
      'Bactéria isolada....: NÃO HOUVE CRESCIMENTO DE BACTÉRIAS.',
    ])
    const b = r.observations.find(o => /Bact[ée]ria Isolada/i.test(o.canonicalName ?? ''))
    expect(b?.value).toMatchObject({ kind: 'qualitative' })
  })
})

// ── 6. Bloco cujo título traz a sigla entre parênteses — CORRIGIDA ─────────
// 3 ocorrências (IMEC1, IMEC4, IMEC5). Duas causas somadas: o título tem 46
// caracteres e caía na guarda de metadado (limite 42, feita para separar
// rótulo de prosa), e mesmo passando dela a frase por extenso não está no
// catálogo — quem está é a sigla.
describe('título de bloco com a sigla entre parênteses', () => {
  it('o TTPA é extraído do bloco cujo título traz a sigla', async () => {
    const r = await extrair([
      'TEMPO DE TROMBOPLASTINA PARCIAL ATIVADO (TTPA)',
      'Coleta: 12/05/2026',
      'Resultado: 25,6  segundos',
    ])
    expect(nomes(r)).toContain('TTPA')
    expect(r.observations[0]!.value).toMatchObject({ kind: 'numeric', value: 25.6 })
  })

  it('o texto por extenso também vale quando é ele que está no catálogo', async () => {
    const r = await extrair([
      'DOSAGEM DE CREATININA (CREA)',
      'Coleta: 12/05/2026',
      'Resultado: 1,42  mg/dL',
    ])
    expect(nomes(r)).toContain('Creatinina')
  })

  it('título longo que NÃO resolve continua sendo tratado como prosa', async () => {
    // A guarda de comprimento só é dispensada quando alguma variante do nome
    // resolve no catálogo. Sem isso, qualquer frase longa viraria exame.
    const r = await extrair([
      'Observação: amostra coletada em condições inadequadas de jejum (repetir)',
      'Coleta: 12/05/2026',
      'Resultado: 9,9  mg/dL',
    ])
    expect(r.observations).toHaveLength(0)
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

// ── 8. O doador está ERRADO e divergimos de propósito ──────────────────────
// A contrapartida do arquivo: aqui a paridade acusa "regressão" e a regressão
// é dele. O clinBoard não sufixa o espécime, então a glicose do LÍQUOR sai
// como "Glicose" — indistinguível de glicemia. Num laudo real do IMEC isso
// gravava 166 mg/dL de LCR como se fosse a glicemia do paciente.
//
// Ligar a herança de espécime no IMEC custou 11 "regressões" de paridade, e
// as 11 são este acerto. Por isso a decisão está no perfil e o guarda está
// aqui: se alguém desligar a herança para "melhorar a paridade", quebra.
describe('não é lacuna · o espécime do líquor não se perde na subseção neutra', () => {
  const LAUDO = [
    'ROTINA DE LÍQUOR',
    'Material: Liquor   Coleta...: 12/05/2026 - 19:10',
    'Aspecto:   Límpido.   Límpido',
    'BIOQUIMICA',
    'Glicose:   166   mg/dL   40 - 70',
    'Proteínas:   28   mg/dL   15 - 45',
  ]

  // `hints` porque a fixture sintética não carrega a impressão digital do
  // laboratório, e a herança de espécime é dado do PERFIL (A3).
  const extrairComoImec = () => extrairExames({
    document: { bytes: pdfDeLinhas(LAUDO), filename: null },
    hints: { labProfileId: 'imec', expectedCollectedAt: null },
    options: null,
  })

  it('a glicose do líquor NUNCA é gravada como glicemia', async () => {
    const r = await extrairComoImec()
    expect(nomes(r)).toContain('Glicose (LCR)')
    expect(nomes(r)).not.toContain('Glicose')
  })

  it('a subseção neutra não interrompe o contexto de líquor', async () => {
    const r = await extrairComoImec()
    expect(nomes(r)).toContain('Proteínas (LCR)')
  })
})

// ── 9. Tabela de evolução lida como resultado de agora ─────────────────────
// Achado A-01 da auditoria de 03/08. Os laudos do HUGO trazem, depois do
// resultado, uma seção "Evolução do paciente" com uma coluna por data. O
// extrator lia essa tabela como resultado novo e pegava a PRIMEIRA coluna —
// a data mais antiga. Na tela, esse valor apagava o verdadeiro.
describe('tabela de evolução do paciente não vira resultado', () => {
  const COLUNAS = [50, 170, 240, 310, 380]
  const bytes = pdfTabular([
    ['GASOMETRIA ARTERIAL', 'Valores de referência'],
    ['Coleta: 08/04/2026'],
    ['pH', ':', '7,370', '7,350 - 7,450'],
    ['pCO2', ':', '47,0 mmHg', '35,0 - 45,0 mmHg'],
    ['Evolução do paciente'],
    ['Data', '04/04/2026', '05/04/2026', '06/04/2026', '08/04/2026'],
    ['pH', '7,460', '7,420', '7,400', '7,370'],
    ['pCO2', '33,0', '38,0', '41,0', '47,0'],
  ], COLUNAS)

  const extrair = () =>
    extrairExames({ document: { bytes, filename: null }, hints: null, options: null })

  it('o resultado de verdade é extraído', async () => {
    const r = await extrair()
    const ph = r.observations.filter(o => o.canonicalName === 'pH (Arterial)')
    expect(ph).toHaveLength(1)
    expect(ph[0]!.value).toMatchObject({ kind: 'numeric', value: 7.37 })
  })

  it('a linha da tabela de evolução NÃO vira observação', async () => {
    const r = await extrair()
    const pco2 = r.observations.filter(o => o.canonicalName === 'PCO2 (Arterial)')
    expect(pco2).toHaveLength(1)
    expect(pco2[0]!.value).toMatchObject({ kind: 'numeric', value: 47 })
  })

  it('R1 · a linha descartada aparece com motivo, não some', async () => {
    const r = await extrair()
    expect(r.discarded.some(d => d.reason === 'historicalResult')).toBe(true)
  })
})

// ── 10. O segmento history tem que FECHAR sozinho ───────────────────────────
// Rodada 1 de correção sobre a tarefa acima. `CABECALHOS` nunca vai listar
// "DOSAGEM DE AMILASE", "DOSAGEM DE CREATININA" e o resto dos títulos de
// exame de um laudo — são título de EXAME, não de SEÇÃO. Sem um jeito de
// fechar o segmento history nessas linhas, ele engolia o resto do laudo: no
// corpus real do HUGO um único segmento history chegou a ter 328 linhas,
// e todo exame de verdade depois da tabela de evolução virava descarte por
// engano.
//
// Rodada 2: no laudo de verdade o título vem em DUAS colunas na MESMA linha
// física — "DOSAGEM DE AMILASE" | "Valores de Referência" — porque é também
// o cabeçalho da coluna de referência do bloco que se abre. "Valores de
// Referência" tem letra minúscula, e testar a LINHA INTEIRA (rodada 1) nunca
// fechava nada, porque a segunda coluna sempre reprovava o teste de maiúscula
// pura. A fixture tem que carregar as duas colunas separadas — uma só coluna
// passava com a heurística quebrada e esse teste não provava nada. As
// colunas aqui são mais largas que nos outros blocos deste arquivo: com o
// espaçamento do bloco 9, "DOSAGEM DE AMILASE" (19 caracteres) já não cabia
// antes da coluna seguinte, e o vão medido (6,08pt) ficava ABAIXO do limiar
// de corte de `separarColunas` (~7,3pt) — a linha nunca se partia em duas
// colunas de verdade, e o teste passava sem exercitar o corte.
//
// Rodada 3: a forma de título também exige que a LINHA INTEIRA não tenha
// dígito. A linha "TGO 88 75 60 41" é linha da PRÓPRIA tabela de evolução —
// o analito é sigla, e sigla é maiúscula pura. Com o teste só na primeira
// coluna, ela fechava o segmento no meio da tabela e tudo dali para baixo
// voltava a virar resultado de agora. Medido no HUGO2: duas tabelas vazando
// por sigla.
describe('history não engole o exame que vem depois da tabela de evolução', () => {
  const COLUNAS = [50, 210, 280, 350, 420]
  const bytes = pdfTabular([
    ['GASOMETRIA ARTERIAL', 'Valores de referência'],
    ['Coleta: 08/04/2026'],
    ['pH', ':', '7,370', '7,350 - 7,450'],
    ['Evolução do paciente'],
    ['Data', '04/04/2026', '05/04/2026', '06/04/2026', '08/04/2026'],
    ['pH', '7,460', '7,420', '7,400', '7,370'],
    ['TGO', '88', '75', '60', '41'],
    ['DOSAGEM DE AMILASE', 'Valores de Referência'],
    ['Amilase', ':', '45,0 U/L', '28,0 - 100,0 U/L'],
  ], COLUNAS)

  const extrair = () =>
    extrairExames({ document: { bytes, filename: null }, hints: null, options: null })

  it('o exame depois da tabela de evolução ainda é extraído', async () => {
    const r = await extrair()
    // O laudo real repete o nome do analito no título de duas colunas
    // ("DOSAGEM DE AMILASE   Valores de Referência"), e HOJE essa linha também
    // vira uma observação — com "Valores de Referência" no lugar do valor.
    // Esse é o achado A-02, dono da Tarefa 2. Aqui a asserção é só a desta
    // tarefa: o resultado NUMÉRICO de depois da tabela de evolução existe.
    // Deixar a linha de título no segmento, em vez de engoli-la como título,
    // é deliberado — ver a nota em `segmentar.ts`.
    const amilase = r.observations.filter(o => o.canonicalName === 'Amilase')
    expect(amilase.some(o => o.value.kind === 'numeric' && o.value.value === 45)).toBe(true)
  })

  it('sigla maiúscula DENTRO da tabela não reabre a extração', async () => {
    const r = await extrair()
    expect(r.observations.filter(o => o.canonicalName === 'TGO (AST)')).toHaveLength(0)
    expect(r.discarded.filter(d => d.reason === 'historicalResult').length).toBeGreaterThanOrEqual(3)
  })

  it('R1 · a linha que fecha o history não some — vira observação ou descarte', async () => {
    const r = await extrairExames({
      document: { bytes, filename: null },
      hints: null,
      options: { retainRawText: true },
    })
    const apareceu =
      r.observations.some(o => o.provenance.rawLine.includes('DOSAGEM DE AMILASE')) ||
      r.discarded.some(d => d.rawLine.includes('DOSAGEM DE AMILASE'))
    expect(apareceu).toBe(true)
  })

  it('a tabela de evolução continua descartada com motivo', async () => {
    const r = await extrair()
    expect(r.discarded.some(d => d.reason === 'historicalResult')).toBe(true)
  })
})
