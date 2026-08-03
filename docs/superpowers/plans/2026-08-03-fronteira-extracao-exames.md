# Fronteira do módulo de extração de exames — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o caminho por onde erro clínico chega ao prontuário — valor de outra data, cultura que some, aviso invisível, gravação que falha em silêncio.

**Architecture:** O miolo do módulo (`lib/exames/extracao/**`) não muda de forma. Cria-se um formato de entrega próprio do domínio (`entrega.ts`) que carrega tudo que o módulo produz, uma peça de persistência testável (`persistencia.ts`), e a rota passa a orquestrar extração + gravação. `@/types` deixa de ser importado pelo domínio clínico: só `adaptador.ts`, a peça de borda, conhece os dois lados.

**Tech Stack:** TypeScript strict, Next.js 14 App Router, vitest 2.1.9, Supabase.

## Global Constraints

- **R1** — nada desaparece em silêncio. Toda linha rejeitada vira `discarded` com motivo.
- **R3** — o extrator não opina sobre alterado/normal. Isso é `interpretacao.ts`.
- **R8** — data nunca é inventada. Sem data no laudo, `null`.
- **R10** — nenhum conteúdo de laudo em log, telemetria ou mensagem de erro.
- **D2** — nada é reescrito no banco. Nenhum passo deste plano faz `UPDATE` em registro existente.
- `npm test` precisa passar em clone limpo: nenhum teste novo pode depender de `FIXTURES_EXAMES`.
- Fixtures sintéticas de layout usam `pdfTabular(linhas, xs)` com colunas em posição medida, **nunca** `pdfDeLinhas` com espaços. Quatro vezes neste projeto o vão gerado por espaços foi mais estreito que o real e o teste provou a coisa errada.
- Toda tarefa termina com `npx tsc --noEmit` limpo e `npx vitest run` verde.
- Números de regressão vigentes: **459 testes**, **912 observações no corpus**, **13 divergências de paridade**.

---

### Task 1: A seção "Evolução do paciente" deixa de virar resultado

Fecha o achado A-01 (a gasometria mostrando o valor de quatro dias antes) e a decisão D11.

**Files:**
- Modify: `lib/exames/extracao/contratos.ts:561` (`Segment['kind']`)
- Modify: `lib/exames/extracao/segmentacao/segmentar.ts:21-38` (`CABECALHOS`)
- Modify: `lib/exames/extracao/motor.ts:79-163` (descarte com motivo)
- Test: `lib/exames/extracao/extratores/lacunas.test.ts` (bloco novo no fim)

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `Segment['kind']` passa a incluir `'history'`. Nenhuma outra tarefa depende disso.

**Por que funciona:** os três matchers (`tabular`, `bloco`, `doisPontos`) têm a mesma `applicability`: `kind === 'examSection' || 'eas' || 'culture'`. Um segmento de kind novo não é alcançado por nenhum deles, sem tocar em matcher nenhum.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar no fim de `lib/exames/extracao/extratores/lacunas.test.ts`:

```typescript
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run lacunas -t "tabela de evolução"`
Expected: FAIL — `expected length 2 to be 1`, porque hoje a linha da evolução vira uma segunda observação.

- [ ] **Step 3: Acrescentar o kind ao contrato**

Em `lib/exames/extracao/contratos.ts`, linha 561, trocar por:

```typescript
export interface Segment {
  /**
   * `history` — tabela de resultados anteriores que o próprio laudo imprime
   * ("Evolução do paciente" no HUGO). NENHUM matcher se aplica a ela: os três
   * aceitam apenas examSection, eas e culture. As linhas viram descarte com
   * motivo, e não observação.
   *
   * Antes de 03/08/2026 essa tabela era lida como resultado de agora, e o
   * extrator pegava a coluna mais antiga: a gasometria de 08/04 aparecia com
   * os valores de 04/04.
   */
  kind: 'examSection' | 'table' | 'culture' | 'antibiogram' | 'eas' | 'notes' | 'footer' | 'imaging' | 'history'
  title: string | null
  lines: TextLine[]
  specimen: SpecimenContext
  date: TemporalRef
}
```

- [ ] **Step 4: Reconhecer o cabeçalho**

Em `lib/exames/extracao/segmentacao/segmentar.ts`, dentro de `CABECALHOS`, acrescentar **antes** da linha de subseções neutras (a que casa `BIOQUÍMICA|SOROLOGIA|...`):

```typescript
  // Tabela de resultados anteriores impressa pelo próprio laudo. Abre um
  // segmento que nenhum matcher alcança — ver Segment['kind'] no contrato.
  [/EVOLU[ÇC][ÃA]O\s+DO\s+PACIENTE|HIST[ÓO]RICO\s+DE\s+RESULTADOS|RESULTADOS\s+ANTERIORES/i, null, 'history'],
```

- [ ] **Step 5: Registrar o descarte com motivo (R1)**

Em `lib/exames/extracao/motor.ts`, logo depois de `for (const linha of segmento.lines) {` (linha 79), inserir:

```typescript
      // R1 — a tabela de evolução não vira resultado, mas também não some.
      if (segmento.kind === 'history') {
        discarded.push({
          page: linha.page,
          lineIndex: linha.index,
          rawLine: opcoes.retainRawText ? linha.text : '',
          reason: 'historicalResult',
          detail: 'linha de tabela de resultados anteriores',
        })
        continue
      }
```

- [ ] **Step 6: Rodar o teste**

Run: `npx vitest run lacunas -t "tabela de evolução"`
Expected: PASS — 3 testes.

- [ ] **Step 7: Rodar a suíte inteira e os tipos**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `tsc` sem saída; **462 testes passando** (459 + 3).

- [ ] **Step 8: Confirmar no corpus real que o defeito sumiu**

Run: `FIXTURES_EXAMES=~/clinboard/fixtures npx tsx scripts/rodar-corpus.mts 2>&1 | grep "observações:"`
Expected: o total **cai** de 912 para cerca de 887 — as ~25 linhas da tabela de evolução deixaram de virar observação. **Queda aqui é acerto, não regressão.** Anotar o número exato: é a nova linha de base.

- [ ] **Step 9: Commit**

```bash
git add lib/exames/extracao/contratos.ts lib/exames/extracao/segmentacao/segmentar.ts lib/exames/extracao/motor.ts lib/exames/extracao/extratores/lacunas.test.ts
git commit -m "A tabela de evolucao do laudo deixa de virar resultado de agora

Achado A-01 da auditoria. Os laudos do HUGO imprimem 'Evolucao do paciente'
com uma coluna por data; o extrator lia isso como resultado novo e pegava a
PRIMEIRA coluna, a mais antiga. A gasometria de 08/04 aparecia na tela com os
valores de 04/04 — pH 7,46 no lugar de 7,370, pCO2 33 no lugar de 47.

Segment ganha o kind 'history'. Os tres matchers aceitam apenas examSection,
eas e culture, entao nenhum alcanca o segmento novo — sem tocar em matcher.
As linhas viram descarte com motivo 'historicalResult' (R1)."
```

---

### Task 2: "Valores de Referência" deixa de virar valor de exame

Fecha o achado A-06.

**Files:**
- Modify: `lib/exames/extracao/extratores/supressao.ts:49`
- Test: `lib/exames/extracao/extratores/lacunas.test.ts` (bloco novo no fim)

**Interfaces:**
- Consumes: nada.
- Produces: nada que outra tarefa use.

**O detalhe que faz falhar hoje:** `supressao.ts:49` já ignora `"Valores de referência:"` **com dois-pontos**, de propósito, porque o matcher de bloco usa essa linha como faixa do exame acima. O cabeçalho de coluna do HUGO vem **sem** dois-pontos e sem nada depois, e por isso escapa.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `lib/exames/extracao/extratores/lacunas.test.ts`:

```typescript
// ── 10. Título de coluna lido como valor ───────────────────────────────────
// Achado A-06. "DOSAGEM DE AMILASE   Valores de Referência" é cabeçalho de
// DUAS colunas. O extrator lia o título da segunda como se fosse o resultado
// da primeira, e gravava o exame com valor "Valores de Referência".
describe('título de coluna não vira valor de exame', () => {
  const bytes = pdfTabular([
    ['DOSAGEM DE AMILASE', 'Valores de Referência'],
    ['Coleta: 08/04/2026'],
    ['Resultado:', '135 U/L', '0 - 110 U/L'],
  ], [50, 240, 380])

  it('o valor extraído é o número, não o título da coluna', async () => {
    const r = await extrairExames({ document: { bytes, filename: null }, hints: null, options: null })
    const valores = r.observations.map(o => o.value.raw)
    expect(valores).not.toContain('Valores de Referência')
  })

  it('R1 · a linha do título aparece como descarte, não some', async () => {
    const r = await extrairExames({ document: { bytes, filename: null }, hints: null, options: null })
    const sumiu = r.observations.length === 0 && r.discarded.length === 0
    expect(sumiu).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run lacunas -t "título de coluna"`
Expected: FAIL — `expected [ '135', 'Valores de Referência' ] not to contain 'Valores de Referência'`.

- [ ] **Step 3: Suprimir o cabeçalho SEM dois-pontos**

Em `lib/exames/extracao/extratores/supressao.ts`, logo **depois** da linha 49 (o `return null` que protege `"Valores de referência:"`), inserir:

```typescript
  // Cabeçalho de COLUNA, sem dois-pontos e sem nada depois: "DOSAGEM DE
  // AMILASE   Valores de Referência". A linha acima protege a forma COM
  // dois-pontos, que o matcher de bloco usa como faixa do exame anterior —
  // são coisas diferentes e a distinção é o dois-pontos.
  if (/^\s*valor(?:es)?\s+de\s+refer[êe]ncias?\s*$/i.test(texto)) {
    return { reason: 'referenceTable', detail: 'título de coluna de referência' }
  }
```

- [ ] **Step 4: Rodar o teste**

Run: `npx vitest run lacunas -t "título de coluna"`
Expected: PASS — 2 testes.

- [ ] **Step 5: Suíte, tipos e corpus**

Run: `npx tsc --noEmit && npx vitest run`
Expected: **464 testes passando**.

Run: `FIXTURES_EXAMES=~/clinboard/fixtures CLINBOARD_HTML=~/clinboard/clinboard.html npx tsx scripts/paridade-clinboard.mts 2>&1 | grep REGRESS`
Expected: **13 regressões ou menos.** Se subir, parar e investigar antes de commitar.

- [ ] **Step 6: Commit**

```bash
git add lib/exames/extracao/extratores/supressao.ts lib/exames/extracao/extratores/lacunas.test.ts
git commit -m "Titulo de coluna 'Valores de Referencia' deixa de virar valor de exame

Achado A-06. Amilase, Creatinina, Sodio e mais 8 exames do HUGO eram gravados
com valor 'Valores de Referencia'. Na tela ficava escondido porque o valor
verdadeiro vinha depois e sobrescrevia — mas ficava no banco.

A regra ja ignorava a forma COM dois-pontos, de proposito: o matcher de bloco
usa aquela linha como faixa do exame acima. O cabecalho de coluna vem SEM
dois-pontos, e por isso escapava. A distincao e o dois-pontos."
```

---

### Task 3: Conferir se o laudo é do paciente da tela

Fecha o achado A-02 — o mais grave da auditoria — e a decisão D8.

**Files:**
- Create: `lib/exames/extracao/paciente/conferir.ts`
- Create: `lib/exames/extracao/paciente/conferir.test.ts`
- Modify: `lib/exames/extracao/contratos.ts:467-472` (`ExtractionHints`) e `486+` (`ExtractionResult`)
- Modify: `lib/exames/extracao/index.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type VeredictoPaciente = 'confere' | 'naoConfere' | 'nomeAusente' | 'naoPerguntado'`
  - `function conferirPaciente(linhas: readonly TextLine[], nomeEsperado: string | null): VeredictoPaciente`
  - `ExtractionHints.expectedPatientName: string | null`
  - `ExtractionResult.patientCheck: VeredictoPaciente`

**O desenho é pergunta-e-veredito.** A rota manda o nome do paciente da tela; o módulo devolve só um veredito. O nome que está no laudo **nunca aparece em campo de saída nenhum** — não dá para gravar nem logar por acidente, porque ele não existe fora desta função.

- [ ] **Step 1: Escrever o teste que falha**

Criar `lib/exames/extracao/paciente/conferir.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { conferirPaciente } from './conferir'
import { extrairExames } from '../index'
import { pdfDeLinhas } from '../_testes/pdfMinimo'
import type { TextLine } from '../contratos'

const linhas = (...textos: string[]): TextLine[] =>
  textos.map((text, i) => ({ text, page: 1, index: i, x: 50, y: 700 - i * 12, gaps: [] } as unknown as TextLine))

describe('conferência de paciente · pergunta e veredito', () => {
  it('nome igual confere', () => {
    expect(conferirPaciente(linhas('Paciente: MARIA DAS DORES SILVA'), 'Maria das Dores Silva'))
      .toBe('confere')
  })

  it('tolera acento perdido e ordem de maiúsculas', () => {
    expect(conferirPaciente(linhas('Nome: JOAO PEREIRA DE SOUSA'), 'João Pereira de Sousa'))
      .toBe('confere')
  })

  it('tolera nome abreviado pelo laboratório', () => {
    expect(conferirPaciente(linhas('Paciente: MARIA D. D. SILVA'), 'Maria das Dores Silva'))
      .toBe('confere')
  })

  it('paciente diferente NÃO confere', () => {
    expect(conferirPaciente(linhas('Paciente: ANTONIO CARLOS FERREIRA'), 'Maria das Dores Silva'))
      .toBe('naoConfere')
  })

  it('laudo sem nome devolve nomeAusente, não naoConfere', () => {
    expect(conferirPaciente(linhas('HEMOGRAMA', 'Hemoglobina 12,0'), 'Maria das Dores Silva'))
      .toBe('nomeAusente')
  })

  it('sem pergunta, sem veredito', () => {
    expect(conferirPaciente(linhas('Paciente: MARIA DAS DORES SILVA'), null))
      .toBe('naoPerguntado')
  })
})

describe('R10 · o nome do laudo não sai do módulo', () => {
  it('nenhum campo do resultado carrega o nome que estava no laudo', async () => {
    const r = await extrairExames({
      document: { bytes: pdfDeLinhas([
        'Paciente: ANTONIO CARLOS FERREIRA',
        'BIOQUIMICA', 'Coleta: 12/05/2026',
        'Glicose              92    mg/dL      70 - 99',
      ]), filename: null },
      hints: { labProfileId: null, expectedCollectedAt: null, expectedPatientName: 'Maria das Dores Silva' },
      options: null,
    })
    expect(r.patientCheck).toBe('naoConfere')
    // O veredito existe; o nome, não.
    expect(JSON.stringify(r)).not.toMatch(/ANTONIO|FERREIRA/i)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run conferir`
Expected: FAIL — `Cannot find module './conferir'`.

- [ ] **Step 3: Escrever a implementação**

Criar `lib/exames/extracao/paciente/conferir.ts`:

```typescript
// ══════════════════════════════════════════════════════════════════════════
// Conferência de paciente — pergunta e veredito, nunca leitura e devolução.
//
// A rota MANDA o nome do paciente da tela. Este módulo DEVOLVE só um veredito.
// O nome que está no laudo não aparece em nenhum campo de saída, não é
// retornado, não é logado: ele não existe fora desta função.
//
// Isso é mais forte que "temos o cuidado de não guardar". É a mesma regra que
// já vale para o texto do laudo (R10): impossível por construção.
//
// AVISA, não bloqueia. Nome de casada, nome abreviado pelo laboratório e
// acento perdido gerariam alarme falso demais para justificar uma trava.
// ══════════════════════════════════════════════════════════════════════════

import type { TextLine } from '../contratos'

export type VeredictoPaciente = 'confere' | 'naoConfere' | 'nomeAusente' | 'naoPerguntado'

/** Rótulos que introduzem o nome do paciente nos laudos do acervo. */
const ROTULO_NOME = /^\s*(?:paciente|nome(?:\s+do\s+paciente)?|pac\.?)\s*[.:]\s*(.{3,60})$/i

/** NFD sem acento, maiúsculo, só letras e espaço. */
function normalizar(nome: string): string {
  return nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Partículas que não identificam ninguém e atrapalham a comparação. */
const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E'])

function partes(nome: string): string[] {
  return normalizar(nome).split(' ').filter(p => p.length > 0 && !PARTICULAS.has(p))
}

/**
 * Duas partes casam quando são iguais, ou quando uma é a inicial da outra —
 * "MARIA D SILVA" no laudo e "Maria das Dores Silva" na tela são a mesma
 * pessoa, e o laboratório abrevia por conta própria.
 */
function casam(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length === 1) return b.startsWith(a)
  if (b.length === 1) return a.startsWith(b)
  return false
}

export function conferirPaciente(
  linhas: readonly TextLine[],
  nomeEsperado: string | null,
): VeredictoPaciente {
  if (!nomeEsperado || partes(nomeEsperado).length === 0) return 'naoPerguntado'

  let doLaudo: string[] | null = null
  for (const linha of linhas) {
    const m = linha.text.match(ROTULO_NOME)
    if (!m) continue
    const p = partes(m[1]!)
    if (p.length >= 2) { doLaudo = p; break }
  }
  if (!doLaudo) return 'nomeAusente'

  const esperado = partes(nomeEsperado)

  // Primeiro e último nome são os que o laboratório nunca omite. Exigir os
  // dois evita casar "Maria Silva" com "Maria Souza", e não exige que o meio
  // esteja completo.
  const primeiroCasa = casam(doLaudo[0]!, esperado[0]!)
  const ultimoCasa = casam(doLaudo[doLaudo.length - 1]!, esperado[esperado.length - 1]!)

  return primeiroCasa && ultimoCasa ? 'confere' : 'naoConfere'
}
```

- [ ] **Step 4: Acrescentar ao contrato**

Em `lib/exames/extracao/contratos.ts`, trocar `ExtractionHints` (linha 467) por:

```typescript
export interface ExtractionHints {
  /** Só para conferência — jamais para preencher uma data que não foi lida (R8). */
  expectedCollectedAt: string | null
  /** Força um perfil, ignorando a detecção. */
  labProfileId: string | null
  /**
   * O nome do paciente da tela, para conferir se o laudo é dele.
   *
   * Vai DE FORA PARA DENTRO de propósito: o módulo devolve só um veredito, e
   * o nome que está no laudo nunca sai daqui. Ver `paciente/conferir.ts`.
   */
  expectedPatientName: string | null
}
```

E acrescentar em `ExtractionResult`, depois de `detection`:

```typescript
  /** Veredito da conferência de paciente. NUNCA carrega o nome do laudo (D8). */
  patientCheck: VeredictoPaciente
```

Acrescentar o import do tipo no topo de `contratos.ts`:

```typescript
import type { VeredictoPaciente } from './paciente/conferir'
export type { VeredictoPaciente }
```

- [ ] **Step 5: Ligar no fluxo**

Em `lib/exames/extracao/index.ts`, importar e preencher o campo em **todos** os pontos de retorno (inclusive os de falha, com `'naoPerguntado'`):

```typescript
import { conferirPaciente } from './paciente/conferir'
```

E no retorno do caminho bem-sucedido, depois de ter `texto`:

```typescript
    patientCheck: conferirPaciente(texto.lines, req.hints?.expectedPatientName ?? null),
```

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run conferir`
Expected: PASS — 7 testes.

- [ ] **Step 7: Suíte inteira e tipos**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `tsc` limpo; **471 testes**. Se `tsc` reclamar de `hints` em testes existentes, acrescentar `expectedPatientName: null` a cada objeto de hints — há um em `lacunas.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add lib/exames/extracao/paciente/ lib/exames/extracao/contratos.ts lib/exames/extracao/index.ts lib/exames/extracao/extratores/lacunas.test.ts
git commit -m "Conferir se o laudo e do paciente da tela, sem guardar dado pessoal

Achado A-02, o mais grave da auditoria: nada conferia se o laudo enviado era
do paciente aberto. O desenho e pergunta-e-veredito:

  a rota MANDA      'o paciente desta tela se chama <nome>'
  o modulo DEVOLVE  confere | naoConfere | nomeAusente | naoPerguntado

O nome que esta no laudo nao aparece em campo de saida nenhum, e ha teste
garantindo isso. Nao da para gravar nem logar por acidente porque ele nao
existe fora da funcao que compara — impossivel por construcao, e nao 'temos o
cuidado de nao guardar'.

Tolera acento perdido e nome abreviado pelo laboratorio. Avisa, nao bloqueia."
```

---

### Task 4: O formato de entrega do domínio

Inverte a dependência (o domínio deixa de importar o formato do banco) e faz cultura e conflito caberem. Decisões D3, D4, D5.

**Files:**
- Create: `lib/exames/entrega.ts`
- Create: `lib/exames/entrega.test.ts`
- Modify: `lib/exames/adaptador.ts` (passa a consumir `Entrega`)
- Modify: `lib/exames/adaptador.test.ts`

**Interfaces:**
- Consumes: `ExtractionResult`, `VeredictoPaciente` (Task 3).
- Produces:

```typescript
export interface ValorEntregue {
  nome: string
  valor: string
  unidade: string | null
  referencia: string | null
  valorNumerico: number | null
  censura: 'lt' | 'lte' | 'gt' | 'gte' | null
  analitoId: string | null
  precisaConferencia: boolean
  motivos: string[]
  conflito: boolean
  origem: { pagina: number; linha: number; regra: string }
}
export interface LinhaEntregue {
  dataColeta: string | null
  tipo: string
  valores: ValorEntregue[]
  observacoes: string | null
}
export interface Entrega {
  linhas: LinhaEntregue[]
  pendencias: { nome: string; motivo: string }[]
  conferenciaPaciente: VeredictoPaciente
  impressaoDigital: string
}
export function montarEntrega(resultado: ExtractionResult, lidoPorIA: boolean): Entrega
```

- [ ] **Step 1: Escrever o teste que falha**

Criar `lib/exames/entrega.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { montarEntrega } from './entrega'
import { extrairExames } from './extracao'
import { pdfDeLinhas, pdfTabular } from './extracao/_testes/pdfMinimo'

async function entregar(bytes: Uint8Array) {
  const r = await extrairExames({ document: { bytes, filename: null }, hints: null, options: null })
  return montarEntrega(r, false)
}

describe('D3 · cultura vira registro, não desaparece', () => {
  it('um laudo com cultura E exames entrega os dois', async () => {
    const e = await entregar(pdfDeLinhas([
      'BIOQUIMICA', 'Coleta: 12/05/2026',
      'Glicose              92    mg/dL      70 - 99',
      'HEMOCULTURA - 1ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: Escherichia coli',
    ]))
    const nomes = e.linhas.flatMap(l => l.valores.map(v => v.nome))
    expect(nomes).toContain('Glicose')
    expect(nomes.some(n => /Hemocultura/i.test(n))).toBe(true)
  })

  it('a cultura carrega o organismo isolado no valor', async () => {
    const e = await entregar(pdfDeLinhas([
      'HEMOCULTURA - 1ª AMOSTRA',
      'Material: Sangue periférico   Coleta...: 12/05/2026 - 08:40',
      'Bactéria isolada....: Escherichia coli',
    ]))
    const cultura = e.linhas.flatMap(l => l.valores).find(v => /Hemocultura/i.test(v.nome))
    expect(cultura?.valor).toMatch(/Escherichia coli/)
  })
})

describe('D4 e D5 · dois valores do mesmo exame', () => {
  const bytes = pdfTabular([
    ['GASOMETRIA ARTERIAL', 'Valores de referência'],
    ['Coleta: 08/04/2026'],
    ['pCO2', ':', '47,0 mmHg', '35,0 - 45,0 mmHg'],
    ['pCO2', ':', '33,0 mmHg', '35,0 - 45,0 mmHg'],
  ], [50, 170, 240, 380])

  it('os DOIS sobrevivem — o sistema não escolhe', async () => {
    const e = await entregar(bytes)
    const pco2 = e.linhas.flatMap(l => l.valores).filter(v => v.nome === 'PCO2 (Arterial)')
    expect(pco2).toHaveLength(1)
    expect(pco2[0]!.valor).toBe('47,0 / 33,0')
  })

  it('o conflito é marcado e entra nas pendências', async () => {
    const e = await entregar(bytes)
    const pco2 = e.linhas.flatMap(l => l.valores).find(v => v.nome === 'PCO2 (Arterial)')!
    expect(pco2.conflito).toBe(true)
    expect(pco2.precisaConferencia).toBe(true)
    expect(e.pendencias.some(p => p.nome === 'PCO2 (Arterial)')).toBe(true)
  })

  it('R3 · em conflito o sistema não opina sobre alterado', async () => {
    const e = await entregar(bytes)
    const pco2 = e.linhas.flatMap(l => l.valores).find(v => v.nome === 'PCO2 (Arterial)')!
    expect(pco2.valorNumerico).toBeNull()
  })
})

describe('D9 · as pendências saem prontas para a tela', () => {
  it('resultado sem data de coleta aparece na lista', async () => {
    const e = await entregar(pdfDeLinhas([
      'BIOQUIMICA',
      'Glicose              92    mg/dL      70 - 99',
    ]))
    expect(e.pendencias).toContainEqual({ nome: 'Glicose', motivo: 'sem data de coleta' })
  })

  it('sem pendência, a lista vem vazia — não nula', async () => {
    const e = await entregar(pdfDeLinhas([
      'BIOQUIMICA', 'Coleta: 12/05/2026',
      'Glicose              92    mg/dL      70 - 99',
    ]))
    expect(e.pendencias).toEqual([])
  })
})

describe('a origem de cada número viaja junto', () => {
  it('cada valor sabe de que página e linha veio', async () => {
    const e = await entregar(pdfDeLinhas([
      'BIOQUIMICA', 'Coleta: 12/05/2026',
      'Glicose              92    mg/dL      70 - 99',
    ]))
    const g = e.linhas[0]!.valores[0]!
    expect(g.origem.pagina).toBe(1)
    expect(g.origem.regra).toBeTruthy()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run entrega`
Expected: FAIL — `Cannot find module './entrega'`.

- [ ] **Step 3: Escrever `entrega.ts`**

Criar `lib/exames/entrega.ts`. O arquivo tem uma responsabilidade: converter o resultado técnico da extração no formato que o domínio de exames entrega. **Não importa `@/types`** — essa é a inversão de dependência que a auditoria pediu.

```typescript
// ══════════════════════════════════════════════════════════════════════════
// O formato de entrega do domínio de exames.
//
// Antes de 03/08/2026 o adaptador convertia direto para o formato do BANCO
// (`@/types`), e por isso só exame numérico passava: aquele formato não tem
// lugar para cultura nem para marcação de revisão. Doze culturas e todas as
// marcações eram produzidas e descartadas na fronteira (achados A-03 e A-04).
//
// Este arquivo é o formato do DOMÍNIO. Ele carrega tudo que o módulo produz.
// Quem traduz para o banco é `adaptador.ts`, a peça de borda — e é o único
// lugar em `lib/exames/` que pode importar `@/types`.
// ══════════════════════════════════════════════════════════════════════════

import type { ExtractionResult, Observation, VeredictoPaciente } from './extracao'

export interface ValorEntregue {
  nome: string
  /** Grafia de exibição. Em conflito, os dois valores unidos por " / " (D5). */
  valor: string
  unidade: string | null
  referencia: string | null
  /** `null` em conflito: sem escolher um valor, não há número (R3). */
  valorNumerico: number | null
  censura: 'lt' | 'lte' | 'gt' | 'gte' | null
  analitoId: string | null
  precisaConferencia: boolean
  motivos: string[]
  conflito: boolean
  /** Rastreabilidade: de onde saiu este número. Sem texto do laudo (R10). */
  origem: { pagina: number; linha: number; regra: string }
}

export interface LinhaEntregue {
  dataColeta: string | null
  tipo: string
  valores: ValorEntregue[]
  observacoes: string | null
}

export interface Entrega {
  linhas: LinhaEntregue[]
  /** Pronta para a lista acima da tabela (D9). Vazia, nunca nula. */
  pendencias: { nome: string; motivo: string }[]
  conferenciaPaciente: VeredictoPaciente
  impressaoDigital: string
}

const MOTIVOS: Record<string, string> = {
  dateFromProximity: 'data deduzida pela proximidade, não por marcador de coleta',
  dateFromDocumentFallback: 'data do documento, não da coleta deste exame',
  dateAbsent: 'sem data de coleta',
  unknownAnalyte: 'exame não reconhecido no catálogo',
  unknownUnit: 'unidade não reconhecida',
  referenceRejected: 'a coluna de referência não trazia uma faixa confiável',
  implausibleValue: 'valor fora da faixa fisicamente possível',
  lowDetectionConfidence: 'laboratório não identificado com segurança',
  fallbackExtracted: 'lido por IA, não pelo extrator local',
  duplicateCollection: 'coleta possivelmente duplicada',
}

const CONFLITO = 'dois valores no mesmo laudo'

function iso(o: Observation): string { return o.collectedAt.iso ?? '' }

function paraFormatoDaTela(isoStr: string | null): string | null {
  if (!isoStr) return null
  const [data, hora] = isoStr.split('T')
  const [ano, mes, dia] = (data ?? '').split('-')
  if (!ano || !mes || !dia) return null
  return hora ? `${dia}/${mes}/${ano} ${hora.slice(0, 5)}` : `${dia}/${mes}/${ano}`
}

function textoDaReferencia(o: Observation): string | null {
  const r = o.reference
  switch (r.kind) {
    case 'range': return `${r.min} - ${r.max}`
    case 'upperBound': return `até ${r.max}`
    case 'lowerBound': return `acima de ${r.min}`
    case 'qualitative': return r.raw
    // 'rejected' vira null DE PROPÓSITO — o laudo trouxe algo, e esse algo não
    // era uma faixa. Exibi-lo como referência é o defeito D5 do doador.
    default: return null
  }
}

function deObservacao(o: Observation): ValorEntregue {
  const v = o.value
  return {
    nome: o.canonicalName ?? o.rawName,
    valor: v.raw.trim() || '—',
    unidade: o.unit.canonical ?? (o.unit.raw || null),
    referencia: textoDaReferencia(o),
    valorNumerico: v.kind === 'numeric' ? v.value : null,
    censura: v.kind === 'numeric' && v.censoring !== 'none' ? v.censoring : null,
    analitoId: o.analyteId,
    precisaConferencia: o.requiresReview,
    motivos: o.reviewReasons.map(m => MOTIVOS[m] ?? m),
    conflito: false,
    origem: { pagina: o.provenance.page, linha: o.provenance.lineIndex, regra: o.provenance.matcherId },
  }
}

/**
 * Funde dois ou mais valores do mesmo exame na mesma coleta (D4, D5).
 *
 * O sistema NÃO escolhe: mostra os dois, marca conflito, e deixa de opinar
 * sobre o número — `valorNumerico` vira null, então nenhuma camada acima
 * consegue classificar como alterado (R3).
 */
function fundirConflito(iguais: ValorEntregue[]): ValorEntregue {
  const base = iguais[0]!
  return {
    ...base,
    valor: iguais.map(v => v.valor).join(' / '),
    valorNumerico: null,
    censura: null,
    conflito: true,
    precisaConferencia: true,
    motivos: [...new Set([...iguais.flatMap(v => v.motivos), CONFLITO])],
  }
}

/** Uma cultura vira uma linha de texto, na tabela que já existe (D3). */
function deCultura(c: ExtractionResult['cultures'][number]): ValorEntregue {
  const organismos = c.isolates.map(i => i.organism).filter(Boolean)
  const texto =
    c.growth === 'noGrowth' ? 'Ausência de crescimento'
    : organismos.length > 0 ? organismos.join(', ')
    : c.growth === 'contaminated' ? 'Contaminada'
    : 'Indeterminada'
  const atb = c.isolates
    .flatMap(i => i.susceptibilities.map(s => `${s.antimicrobial} ${s.interpretation}`))
    .join(' · ')
  return {
    nome: c.specimen,
    valor: atb ? `${texto} — ${atb}` : texto,
    unidade: null,
    referencia: null,
    valorNumerico: null,
    censura: null,
    analitoId: null,
    precisaConferencia: true,
    motivos: ['cultura — confira o antibiograma no laudo'],
    conflito: false,
    origem: { pagina: c.provenance.page, linha: c.provenance.lineIndex, regra: c.provenance.matcherId },
  }
}

export function montarEntrega(resultado: ExtractionResult, lidoPorIA: boolean): Entrega {
  const porData = new Map<string, ValorEntregue[]>()
  const guardar = (chave: string, valor: ValorEntregue) => {
    const g = porData.get(chave)
    if (g) g.push(valor); else porData.set(chave, [valor])
  }

  for (const o of resultado.observations) guardar(iso(o), deObservacao(o))
  for (const c of resultado.cultures) guardar(c.collectedAt.iso ?? '', deCultura(c))

  const linhas: LinhaEntregue[] = []
  const pendencias: { nome: string; motivo: string }[] = []
  const chaves = [...porData.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))

  for (const chave of chaves) {
    // Fusão de conflitos: mesmo nome, mesma coleta.
    const porNome = new Map<string, ValorEntregue[]>()
    for (const v of porData.get(chave)!) {
      const g = porNome.get(v.nome)
      if (g) g.push(v); else porNome.set(v.nome, [v])
    }
    const valores = [...porNome.values()].map(iguais =>
      iguais.length === 1 ? iguais[0]! : fundirConflito(iguais))

    for (const v of valores) {
      if (!v.precisaConferencia) continue
      for (const motivo of v.motivos) pendencias.push({ nome: v.nome, motivo })
    }

    linhas.push({
      dataColeta: paraFormatoDaTela(chave || null),
      tipo: 'Exame',
      valores,
      observacoes: lidoPorIA ? 'Lido por IA — não conferido pelo extrator local' : null,
    })
  }

  return {
    linhas,
    pendencias,
    conferenciaPaciente: resultado.patientCheck,
    impressaoDigital: resultado.diagnostics.documentHash,
  }
}
```

- [ ] **Step 4: Rodar os testes de entrega**

Run: `npx vitest run entrega`
Expected: PASS — 8 testes.

- [ ] **Step 5: Fazer o adaptador consumir a entrega**

Substituir o corpo de `lib/exames/adaptador.ts` para receber `Entrega` em vez de `ExtractionResult`. A assinatura pública passa a ser:

```typescript
export function adaptarParaExames(entrega: Entrega, tipoPadrao = 'Exame'): ExameParaSalvar[]
```

E cada `ValorEntregue` vira `ResultadoExame`:

```typescript
function converter(v: ValorEntregue): ResultadoExame {
  const interpretacao =
    v.conflito ? { alterado: false, direcao: 'normal' as const }
    : v.valorNumerico !== null ? interpretarNumerico(v.valorNumerico, v.censura, referenciaDe(v))
    : { alterado: false, direcao: 'qualitativo' as const }
  return {
    nome: v.nome,
    valor: v.valor,
    unidade: v.unidade,
    referencia: v.referencia,
    alterado: interpretacao.alterado,
    direcao: interpretacao.direcao,
    valor_num: v.valorNumerico,
    censura: v.censura,
    analito_id: v.analitoId,
    revisar: v.precisaConferencia,
    motivos_revisao: v.motivos,
  }
}
```

- [ ] **Step 6: Atualizar `adaptador.test.ts`**

Trocar o auxiliar `extrairEAdaptar` para passar pela entrega:

```typescript
async function extrairEAdaptar(linhas: string[]) {
  const r = await extrairExames({
    document: { bytes: pdfDeLinhas(linhas), filename: null },
    hints: null, options: null,
  })
  return adaptarParaExames(montarEntrega(r, false))
}
```

- [ ] **Step 7: Suíte e tipos**

Run: `npx tsc --noEmit && npx vitest run`
Expected: **479 testes**. Nenhum teste de `adaptador.test.ts` deve mudar de asserção — só o caminho até ele.

- [ ] **Step 8: Verificar a inversão de dependência**

Run: `grep -rn "from '@/types'" lib/exames/ | grep -v ".test."`
Expected: **apenas `lib/exames/adaptador.ts` e `lib/exames/agrupamento.ts`.** Se `entrega.ts` aparecer, a inversão não foi feita.

- [ ] **Step 9: Commit**

```bash
git add lib/exames/entrega.ts lib/exames/entrega.test.ts lib/exames/adaptador.ts lib/exames/adaptador.test.ts
git commit -m "Formato de entrega do dominio: cultura e marcacoes passam a caber

Achados A-03 e A-04. O adaptador convertia direto para o formato do BANCO, e
aquele formato so tem lugar para exame numerico — por isso 12 culturas e todas
as marcacoes de revisao eram produzidas e descartadas na fronteira.

entrega.ts e o formato do DOMINIO e nao importa @/types. Carrega exames,
culturas, pendencias prontas para a tela, veredito de paciente e a origem de
cada numero. adaptador.ts vira a peca de borda — o unico lugar de lib/exames
que conhece os dois lados.

Conflito (D4/D5): os dois valores sobrevivem unidos por ' / ', o valor
numerico vira null para que nenhuma camada acima classifique como alterado, e
o exame entra nas pendencias."
```

---

### Task 5: Gravação que confere o resultado

Fecha o achado A-05 e as decisões D6 e D7.

**Files:**
- Create: `lib/exames/persistencia.ts`
- Create: `lib/exames/persistencia.test.ts`

**Interfaces:**
- Consumes: `Entrega`, `adaptarParaExames` (Task 4).
- Produces:

```typescript
export interface ClienteExames {
  buscarPorImpressaoDigital(pacienteId: string, hash: string): Promise<{ dataEnvio: string } | null>
  inserir(linhas: LinhaParaInserir[]): Promise<{ erro: string | null }>
}
export type ResultadoGravacao =
  | { ok: true; registros: number; duplicataDe: string | null }
  | { ok: false; motivo: string }
export async function gravarEntrega(
  cliente: ClienteExames, pacienteId: string, entrega: Entrega, nomeArquivo: string | null,
): Promise<ResultadoGravacao>
```

**Por que uma interface em vez do cliente do Supabase direto:** permite testar o caminho de falha sem banco. Hoje quatro `insert` não conferem o erro e a tela diz "Exame salvo!" mesmo assim — e isso nunca foi pego porque não havia como testar.

- [ ] **Step 1: Escrever o teste que falha**

Criar `lib/exames/persistencia.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { gravarEntrega, type ClienteExames } from './persistencia'
import type { Entrega } from './entrega'

const ENTREGA: Entrega = {
  linhas: [{ dataColeta: '12/05/2026', tipo: 'Exame', observacoes: null, valores: [{
    nome: 'Glicose', valor: '92', unidade: 'mg/dL', referencia: '70 - 99',
    valorNumerico: 92, censura: null, analitoId: 'glicose.serum',
    precisaConferencia: false, motivos: [], conflito: false,
    origem: { pagina: 1, linha: 3, regra: 'tabular' },
  }] }],
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

describe('A-05 · falha de gravação NÃO passa por sucesso', () => {
  it('erro do banco vira resultado explícito', async () => {
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

  it('a marcação de duplicata entra em cada resultado', async () => {
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
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run persistencia`
Expected: FAIL — `Cannot find module './persistencia'`.

- [ ] **Step 3: Escrever `persistencia.ts`**

```typescript
// ══════════════════════════════════════════════════════════════════════════
// Gravação dos exames — com conferência do resultado.
//
// Até 03/08/2026 quatro pontos de `ExamesTab.tsx` gravavam sem olhar o erro e
// mostravam "Exame extraído e salvo!" em seguida. Apagar e editar, no mesmo
// arquivo, conferiam — o que mostra que foi descuido, não política (A-05).
//
// `ClienteExames` é uma interface e não o cliente do Supabase de propósito: o
// caminho de FALHA precisa ser testável sem banco, e era justamente ele que
// nunca tinha sido exercitado.
// ══════════════════════════════════════════════════════════════════════════

import { adaptarParaExames } from './adaptador'
import type { Entrega } from './entrega'
import type { ResultadoExame } from '@/types'

export interface LinhaParaInserir {
  paciente_id: string
  tipo_exame: string
  data_exame: string | null
  resultados: ResultadoExame[] | null
  observacoes: string | null
  raw_text: null
  nome_arquivo: string | null
  impressao_digital: string
}

export interface ClienteExames {
  buscarPorImpressaoDigital(pacienteId: string, hash: string): Promise<{ dataEnvio: string } | null>
  inserir(linhas: LinhaParaInserir[]): Promise<{ erro: string | null }>
}

export type ResultadoGravacao =
  | { ok: true; registros: number; duplicataDe: string | null }
  | { ok: false; motivo: string }

const DUPLICATA = 'coleta possivelmente duplicada'

export async function gravarEntrega(
  cliente: ClienteExames,
  pacienteId: string,
  entrega: Entrega,
  nomeArquivo: string | null,
): Promise<ResultadoGravacao> {
  // D6 — grava e marca. Bloquear atrapalha mais do que ajuda: um laudo
  // reemitido com correção tem bytes diferentes e nem seria detectado aqui.
  const anterior = await cliente.buscarPorImpressaoDigital(pacienteId, entrega.impressaoDigital)

  const linhas: LinhaParaInserir[] = adaptarParaExames(entrega).map(l => ({
    paciente_id: pacienteId,
    tipo_exame: l.tipo_exame,
    data_exame: l.data_exame,
    resultados: anterior
      ? l.resultados.map(r => ({ ...r, revisar: true, motivos_revisao: [...(r.motivos_revisao ?? []), DUPLICATA] }))
      : l.resultados,
    observacoes: l.observacoes,
    raw_text: null,
    nome_arquivo: nomeArquivo,
    impressao_digital: entrega.impressaoDigital,
  }))

  const { erro } = await cliente.inserir(linhas)
  // R10 — devolve a mensagem do banco, que não contém conteúdo de laudo, e
  // nunca os valores que estavam sendo gravados.
  if (erro) return { ok: false, motivo: erro }

  return { ok: true, registros: linhas.length, duplicataDe: anterior?.dataEnvio ?? null }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run persistencia`
Expected: PASS — 5 testes.

- [ ] **Step 5: Suíte e tipos**

Run: `npx tsc --noEmit && npx vitest run`
Expected: **484 testes**.

- [ ] **Step 6: Migração da coluna nova**

A coluna `impressao_digital` não existe na tabela `exames`. Criar via SQL, **sem tocar em dado existente**:

```sql
ALTER TABLE exames ADD COLUMN IF NOT EXISTS impressao_digital text;
CREATE INDEX IF NOT EXISTS exames_impressao_digital_idx
  ON exames (paciente_id, impressao_digital);
```

Rodar no painel do Supabase. Linhas existentes ficam com `NULL`, o que é correto: elas nunca foram conferidas contra impressão digital.

- [ ] **Step 7: Commit**

```bash
git add lib/exames/persistencia.ts lib/exames/persistencia.test.ts
git commit -m "Gravacao passa a conferir se deu certo

Achado A-05: quatro pontos gravavam sem olhar o erro e a tela dizia 'Exame
extraido e salvo!' em seguida. Apagar e editar, no mesmo arquivo, conferiam —
descuido, nao politica.

ClienteExames e uma interface, nao o cliente do Supabase, porque o caminho de
FALHA precisa ser testavel sem banco: era justamente ele que nunca tinha sido
exercitado.

D6 — laudo repetido grava e marca com 'coleta possivelmente duplicada', que
estava declarado no contrato desde 01/08 e nunca era emitido. Bloquear
atrapalha mais do que ajuda."
```

---

### Task 6: A rota orquestra extração e gravação

Decisões D7 e D10, e o tratamento de erro da seção 6 do spec.

**Files:**
- Modify: `app/api/extract-exam/route.ts` (arquivo inteiro)
- Create: `app/api/extract-exam/route.test.ts`

**Interfaces:**
- Consumes: `montarEntrega` (Task 4), `gravarEntrega` + `ClienteExames` (Task 5), `VeredictoPaciente` (Task 3).
- Produces: a resposta HTTP consumida pela Task 7:

```typescript
type RespostaExtracao =
  | { ok: true; via: 'local' | 'ia'; registros: number; pendencias: { nome: string; motivo: string }[]
      conferenciaPaciente: VeredictoPaciente; duplicataDe: string | null }
  | { ok: false; erro: string }
```

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/api/extract-exam/route.test.ts` — testando a função de orquestração, não o HTTP:

```typescript
import { describe, it, expect } from 'vitest'
import { processarPdf } from './route'
import { pdfDeLinhas } from '@/lib/exames/extracao/_testes/pdfMinimo'
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

  it('A-05 · falha de gravação vira erro, não sucesso', async () => {
    const r = await processarPdf(
      cliente({ inserir: async () => ({ erro: 'permissão negada' }) }),
      'pac-1', PDF(), 'laudo.pdf', 'Maria das Dores Silva')
    expect(r.ok).toBe(false)
  })

  it('R10 · o erro devolvido não carrega conteúdo do laudo', async () => {
    const r = await processarPdf(
      cliente({ inserir: async () => ({ erro: 'falha' }) }),
      'pac-1', PDF(), 'laudo.pdf', 'Maria das Dores Silva')
    if (!r.ok) expect(r.erro).not.toMatch(/Glicose|MARIA|92/)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run route`
Expected: FAIL — `processarPdf` não é exportado.

- [ ] **Step 3: Extrair a orquestração para uma função exportada**

Em `app/api/extract-exam/route.ts`, substituir `extrairLocalmente` por:

```typescript
/**
 * Extrai e GRAVA. Exportada para teste — a orquestração é onde estavam os
 * achados A-02, A-03 e A-05, e ela não era testável enquanto vivia dentro do
 * handler HTTP.
 */
export async function processarPdf(
  cliente: ClienteExames,
  pacienteId: string,
  bytes: Uint8Array,
  nomeArquivo: string | null,
  nomeDoPaciente: string | null,
): Promise<RespostaExtracao> {
  const resultado = await extrairExames({
    document: { bytes, filename: nomeArquivo },
    hints: { labProfileId: null, expectedCollectedAt: null, expectedPatientName: nomeDoPaciente },
    options: null,
  })

  // Cultura conta: um laudo só de cultura não tem observação nenhuma, e antes
  // caía na IA mesmo tendo sido lido aqui (A-03).
  if (resultado.observations.length === 0 && resultado.cultures.length === 0) {
    return { ok: false, erro: 'NAO_RECONHECIDO' }
  }

  const entrega = montarEntrega(resultado, false)
  const gravacao = await gravarEntrega(cliente, pacienteId, entrega, nomeArquivo)
  if (!gravacao.ok) return { ok: false, erro: gravacao.motivo }

  return {
    ok: true,
    via: 'local',
    registros: gravacao.registros,
    pendencias: entrega.pendencias,
    conferenciaPaciente: entrega.conferenciaPaciente,
    duplicataDe: gravacao.duplicataDe,
  }
}
```

- [ ] **Step 4: Implementar o `ClienteExames` sobre o Supabase**

No mesmo arquivo:

```typescript
function clienteSupabase(supabase: SupabaseClient): ClienteExames {
  return {
    async buscarPorImpressaoDigital(pacienteId, hash) {
      const { data } = await supabase.from('exames')
        .select('created_at').eq('paciente_id', pacienteId)
        .eq('impressao_digital', hash).limit(1).maybeSingle()
      return data ? { dataEnvio: new Date(data.created_at).toLocaleDateString('pt-BR') } : null
    },
    async inserir(linhas) {
      const { error } = await supabase.from('exames').insert(linhas)
      return { erro: error?.message ?? null }
    },
  }
}
```

- [ ] **Step 5: Trocar o `catch` genérico**

Substituir o `catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }` por:

```typescript
  } catch {
    // R10 — a mensagem original pode carregar trecho do que foi enviado. O
    // módulo local não lança, mas o caminho da IA pode.
    return NextResponse.json(
      { ok: false, erro: 'Não foi possível ler este laudo. Tente novamente ou use outro formato.' },
      { status: 500 },
    )
  }
```

- [ ] **Step 6: Marcar o que vem da IA (D10)**

No caminho da IA, ao montar a resposta, gravar via `gravarEntrega` com `montarEntrega(resultadoDaIA, true)` — o `true` faz `observacoes` receber `"Lido por IA — não conferido pelo extrator local"`, **uma vez por laudo** e não por valor.

- [ ] **Step 7: Rodar os testes**

Run: `npx vitest run route`
Expected: PASS — 4 testes.

- [ ] **Step 8: Suíte, tipos e build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: **488 testes**; build sem erro.

- [ ] **Step 9: Commit**

```bash
git add app/api/extract-exam/
git commit -m "A rota orquestra extracao e gravacao, e para de vazar mensagem crua

D7 — a gravacao sai do navegador. Uma falha vira erro que a tela nao consegue
ignorar, a conferencia de duplicidade passa a poder consultar o banco, e a
orquestracao vira testavel sem abrir navegador: era justamente ali que
estavam os achados A-02, A-03 e A-05.

A-03 — cultura passa a contar na decisao local-vs-IA. Antes, um laudo so de
cultura tinha zero observacoes e caia na IA mesmo tendo sido lido aqui.

O catch generico devolvia e.message ao navegador. O modulo local nao lanca,
mas o caminho da IA pode, e a mensagem dele pode conter pedacos do envio."
```

---

### Task 7: A tela mostra as pendências, o conflito e a origem

Fecha o achado A-04 e as decisões D5, D9 e D10.

**Files:**
- Modify: `components/modules/shared/ExamesTab.tsx:355-444` (os três handlers) e `~680` (acima da tabela)

**Interfaces:**
- Consumes: `RespostaExtracao` (Task 6).
- Produces: nada.

- [ ] **Step 1: Tirar a gravação dos três handlers**

`handleExtract`, `handleExtractPasted` e `handleExtractText` param de chamar `supabase.from('exames').insert`. Passam a mandar `paciente_id` e `paciente_nome` no corpo, e a tratar a resposta:

```typescript
      const resp = await fetch('/api/extract-exam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64: b64, mediaType: file.type,
          pacienteId: paciente.id, pacienteNome: paciente.nome,
          nomeArquivo: file.name,
        }),
      })
      const data = await resp.json()
      if (!resp.ok || !data.ok) throw new Error(data.erro ?? 'Não foi possível salvar')

      setPendencias(data.pendencias ?? [])
      setConferenciaPaciente(data.conferenciaPaciente ?? 'naoPerguntado')
      resetAdding(); onRefresh()
      showToast(
        data.duplicataDe
          ? `Salvo. Atenção: este mesmo arquivo já foi enviado em ${data.duplicataDe}.`
          : data.registros > 1
            ? `Laudo com ${data.registros} datas de coleta: ${data.registros} exames salvos!`
            : 'Exame extraído e salvo!',
      )
```

- [ ] **Step 2: Acrescentar os dois estados**

Junto dos outros `useState` do componente:

```typescript
  const [pendencias, setPendencias] = useState<{ nome: string; motivo: string }[]>([])
  const [conferenciaPaciente, setConferenciaPaciente] = useState<string>('naoPerguntado')
```

- [ ] **Step 3: Aviso de paciente diferente (D8)**

Logo acima da tabela (antes da linha `<table ...>` em ~680):

```tsx
      {conferenciaPaciente === 'naoConfere' && (
        <div className="mb-3 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <b>Atenção:</b> o nome no laudo enviado não parece ser o deste paciente.
          O exame foi salvo — confira antes de usar.
        </div>
      )}
```

- [ ] **Step 4: Lista de pendências (D9)**

Logo abaixo do aviso acima:

```tsx
      {pendencias.length > 0 && (
        <div className="mb-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>⚠ {pendencias.length} resultado{pendencias.length > 1 ? 's' : ''} deste laudo
          {pendencias.length > 1 ? ' pedem' : ' pede'} conferência</b>
          <ul className="mt-1.5 space-y-0.5">
            {pendencias.map((p, i) => (
              <li key={`${p.nome}-${i}`} className="text-amber-800">
                {p.nome} · {p.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
```

- [ ] **Step 5: Símbolo na célula (D9) e conflito (D5)**

Em `PivotCell` (linha ~810), depois do `<span>` da unidade:

```tsx
      {r.revisar && (
        <span className="ml-1 text-amber-600" title={(r.motivos_revisao ?? []).join(' · ')}>⚠</span>
      )}
```

O conflito não precisa de código próprio: `r.valor` já chega como `"47,0 / 33,0"` da Task 4, e `revisar` já é `true`.

- [ ] **Step 6: Verificar no navegador**

Run: `npm run dev` (ou `preview_start`), abrir um paciente, enviar um PDF do HUGO.
Expected, todos verificados na tela:
1. a gasometria mostra `pCO2 47,0` — e **não** 33,0;
2. a lista âmbar de pendências aparece acima da tabela;
3. o `⚠` aparece nas células marcadas;
4. enviar o **mesmo** arquivo de novo mostra "já foi enviado em ...", e o exame é salvo assim mesmo;
5. `💬 Lido por IA` aparece só quando o laudo cair na IA.

- [ ] **Step 7: Confirmar que a tela não grava mais**

Run: `grep -n "from('exames').insert" components/modules/shared/ExamesTab.tsx`
Expected: **só a linha de `handleManualSave`** (lançamento manual, que não passa pelo módulo). Os três de extração devem ter sumido.

- [ ] **Step 8: Suíte, tipos e lint**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`
Expected: 488 testes; lint sem `Error:` novo.

- [ ] **Step 9: Commit**

```bash
git add components/modules/shared/ExamesTab.tsx
git commit -m "A tela mostra as pendencias, o conflito e o aviso de paciente

Achado A-04: o extrator marcava, o adaptador traduzia para portugues, o banco
guardava — e nenhum componente lia. Toda a camada de seguranca era invisivel,
inclusive o validador de plausibilidade.

D9 — simbolo na celula E lista de pendencias acima da tabela, escolhido entre
tres formas com as alternativas a vista.
D5 — conflito chega pronto como '47,0 / 33,0'; a celula nao precisa saber.
D8 — aviso vermelho quando o nome do laudo nao bate com o do paciente.
D7 — os tres handlers de extracao param de gravar direto no banco."
```

---

### Task 8: Travas de regressão sobre o acervo real

Impede que o trabalho seguinte desfaça este em silêncio.

**Files:**
- Modify: `scripts/rodar-corpus.mts` (piso de contagem)

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Medir a linha de base atual**

Run: `FIXTURES_EXAMES=~/clinboard/fixtures npx tsx scripts/rodar-corpus.mts 2>&1 | grep -E "observações:|culturas:"`

Anotar os dois números. O de observações é **menor** que 912 — a queda é o acerto da Task 1.

- [ ] **Step 2: Acrescentar o piso ao script**

No fim de `scripts/rodar-corpus.mts`, antes do resumo final:

```typescript
// Piso medido em 03/08/2026, depois de a tabela de evolução deixar de virar
// resultado. Cair abaixo disto é perder exame; subir é ganho, e o piso deve
// subir junto no mesmo commit. Já houve commit vermelho neste projeto por
// piso maior que o real — meça antes de escrever.
const PISO_OBSERVACOES = 0   // ← substituir pelo número do Step 1
const PISO_CULTURAS = 12
if (totalObservacoes < PISO_OBSERVACOES) {
  console.error(`✗ REGRESSÃO: ${totalObservacoes} observações, piso é ${PISO_OBSERVACOES}`)
  process.exit(1)
}
if (totalCulturas < PISO_CULTURAS) {
  console.error(`✗ REGRESSÃO: ${totalCulturas} culturas, piso é ${PISO_CULTURAS}`)
  process.exit(1)
}
```

- [ ] **Step 3: Verificar que o piso está correto**

Run: `FIXTURES_EXAMES=~/clinboard/fixtures npx tsx scripts/rodar-corpus.mts; echo "saída: $?"`
Expected: `saída: 0`. Se der 1, o piso foi escrito maior que o real — corrigir antes de commitar.

- [ ] **Step 4: Conferir a paridade**

Run: `FIXTURES_EXAMES=~/clinboard/fixtures CLINBOARD_HTML=~/clinboard/clinboard.html npx tsx scripts/paridade-clinboard.mts 2>&1 | grep -E "REGRESS|correção"`
Expected: **13 regressões ou menos.** As linhas da tabela de evolução que deixamos de ler podem aparecer como divergência — se aparecerem, classificar como correção intencional no comparador, do mesmo jeito que já foi feito com o líquor e com os nomes padronizados.

- [ ] **Step 5: Commit**

```bash
git add scripts/rodar-corpus.mts
git commit -m "Piso de regressao no acervo real

Impede que o trabalho seguinte desfaca este em silencio. O piso de observacoes
esta abaixo das 912 anteriores de proposito: a queda e a tabela de evolucao
deixando de virar resultado, que e acerto e nao perda."
```

---

## Auto-revisão do plano

**Cobertura do spec — cada decisão tem tarefa:**

| Decisão | Tarefa |
|---|---|
| D1 objetivo | escopo do plano inteiro |
| D2 não reescrever o banco | nenhum passo faz `UPDATE`; a migração do Step 6/Task 5 só acrescenta coluna |
| D3 cultura como registro | Task 4 (`deCultura`) e Task 6 (cultura conta na decisão local-vs-IA) |
| D4 mostrar os dois | Task 4 (`fundirConflito`) |
| D5 conflito na célula | Task 4 (`" / "`) e Task 7 (Step 5) |
| D6 duplicata grava e marca | Task 5 |
| D7 gravação no servidor | Tasks 5, 6 e 7 |
| D8 conferir paciente | Task 3 e Task 7 (Step 3) |
| D9 símbolo + lista | Task 7 (Steps 4 e 5) |
| D10 IA marcada uma vez | Task 4 (`lidoPorIA`) e Task 6 (Step 6) |
| D11 descartar evolução | Task 1 |

**Achados da auditoria — cada um tem tarefa:** A-01 Task 1 · A-02 Task 3 · A-03 Tasks 4 e 6 · A-04 Task 7 · A-05 Tasks 5 e 6 · A-06 Task 2 · A-08 Tasks 4 e 5 · A-09 Task 6 · A-10 Task 4 (a origem passa a viajar) · A-12 Task 8.

**Fora deste plano, e por quê:** A-07 (nomes legados em linhas separadas) e A-11 (texto e print sempre vão para a IA) são inconsistências sem perda de dado, e a separação dos módulos de imagem tem spec própria (seção 8.1 do design).

**Consistência de tipos:** `VeredictoPaciente` (Task 3) é usado em `Entrega` (Task 4) e em `RespostaExtracao` (Task 6). `Entrega` (Task 4) é consumida por `gravarEntrega` (Task 5). `ClienteExames` (Task 5) é implementado na Task 6. `RespostaExtracao` (Task 6) é consumida pela Task 7.

**Contagem de testes esperada, tarefa a tarefa:** 459 → 462 → 464 → 471 → 479 → 484 → 488 → 488.
