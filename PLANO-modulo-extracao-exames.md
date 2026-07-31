# F0 — Reconhecimento e plano · módulo de extração de exames

Status: **aguardando aprovação**. Nenhum código de produção escrito.
Data do reconhecimento: 31/07/2026.

---

## 1. Reconhecimento do repositório de destino (2.1)

### 1.1 Estrutura de módulos e fronteira pública

Não existe sistema formal de módulos. A convenção observada é:

| Camada | Local | Forma |
|---|---|---|
| Lógica de domínio pura | `lib/<dominio>/<arquivo>.ts` | `export function` nomeadas |
| Tipos | `types/index.ts` — **barrel único de 720 linhas** | `export interface` / `export type` |
| Fronteira HTTP | `app/api/<nome>/route.ts` | `export async function POST` |
| UI | `components/modules/<perfil>/` e `components/modules/shared/` | componentes React |
| Acesso a dados | `lib/supabase/{client,server}.ts` | factory `createClient()` |

A fronteira pública de um módulo é simplesmente **o conjunto de exports nomeados do arquivo**. Não há `index.ts` de barril por pasta (`lib/exames/` expõe `agrupamento.ts` diretamente), nem `internal/`, nem convenção de `_` para privado no nível de arquivo. Imports usam o alias `@/*` (`tsconfig.json` → `paths`), replicado no `vitest.config.ts`.

**Consequência para o módulo:** ele deve expor uma fronteira pública explícita em um arquivo só, e o resto da pasta é detalhe interno por convenção — não por mecanismo. Vou compensar isso com teste estrutural (nenhum import de fora atravessa para submódulo interno).

### 1.2 Runner de testes, linter, TypeScript

- **Testes:** `vitest@2.1.9`. `npm test` → `vitest run`. Config em `vitest.config.ts`: `environment: 'node'`, `include: ['lib/**/*.test.ts']`. Testes ficam **colocados ao lado do fonte** (`lib/exames/agrupamento.test.ts` ao lado de `agrupamento.ts`), com `describe`/`it` **em português**. Hoje há 6 arquivos de teste.
- **Linter:** `eslint@8` + `eslint-config-next`, via `npm run lint` (`next lint`). Sem Prettier, sem config de formatação.
- **TypeScript:** `strict: true`. **`exactOptionalPropertyTypes` NÃO está ligado**, nem `noUncheckedIndexedAccess`. `target: es2017`, `module: esnext`, `moduleResolution: bundler`, `resolveJsonModule: true` (importante — permite importar o catálogo JSON direto), `allowJs: true`, `skipLibCheck: true`.
- **Nomenclatura:** domínio em **português** (`agruparExamesPorHorario`, `ClusterExames`, `parseExameTimestamp`); infraestrutura e conceitos importados em inglês (`ShiftStatus`, `PaySettings`). Comentários em português, com cabeçalhos de seção `// ── Título ───`. Arquivos em camelCase (`featureFlags.ts`) ou substantivo simples (`agrupamento.ts`).

### 1.3 Injeção de dependências

**Não há container nem DI por construtor.** O padrão é: função pura recebe dados por parâmetro; cliente externo vem de uma factory importada diretamente (`getAI()` em `lib/ai.ts`, `createClient()` em `lib/supabase/server.ts`), chamada dentro do handler.

**Consequência:** o `FallbackExtractor` (A5) e o `ParseContext` (A1) devem ser **parâmetros de função**, o que já é o que o documento pede. Isso está alinhado com o repositório, não em conflito.

### 1.4 Propagação de erros

**Exceções.** Não existe `Result<T, E>` em lugar nenhum do projeto. O padrão das rotas é uniforme:

```ts
try { /* ... */ } catch (e: any) {
  return NextResponse.json({ error: e.message }, { status: 500 })
}
```

⚠️ **Risco identificado:** `e.message` é devolvido cru ao cliente em todas as 6 rotas de API. Se o extrator algum dia colocar conteúdo de laudo numa mensagem de erro, ele vaza pela rede — violação de R10 por um caminho que não passa por `console`. Mitigação proposta: o módulo **nunca lança** para fora; a fronteira pública devolve `ExtractionResult` sempre, com falhas em `warnings[]`/`discarded[]`. Erros verdadeiramente excepcionais (PDF corrompido) viram um tipo de erro próprio com mensagem fixa, sem interpolação de conteúdo.

### 1.5 Camada de domínio clínico existente

Sim, e ela **conflita com R3, R4 e R5**. `types/index.ts`:

```ts
export interface ResultadoExame {
  nome: string
  valor: string                      // ← perde censura, número e unidade
  unidade: string | null
  referencia: string | null          // ← null ambíguo (R4)
  alterado: boolean                  // ← interpretação dentro do dado (R3)
  direcao: 'alto' | 'baixo' | 'normal' | 'qualitativo'   // ← idem
}

export interface Exame {
  id, paciente_id, tipo_exame
  data_exame: string | null          // ← UMA data por documento (R7)
  resultados: ResultadoExame[] | null
  observacoes, raw_text, nome_arquivo, created_at
}
```

Existe também `ExameImagem` (com `resumo_ia`, `achados: Record<string,string>`) e a camada de multi-tenancy por `unit_id` (`Paciente.unit_id`, `Unit`, `Ala`, `Leito`), recém-introduzida pelo Felipe. Todo dado clínico é isolado por unidade via RLS no Supabase.

Consumidor a jusante já existente: `lib/exames/agrupamento.ts` agrupa `Exame[]` por horário de coleta parseando `data_exame` como texto livre. Ele passa a ser **redundante** quando cada observação carregar sua própria data (R7) — mas não posso removê-lo sem quebrar `ExamesTab.tsx`.

### 1.6 Política de logging e dados sensíveis

**Não existe política escrita — mas existe prática:** `grep` por `console.` em `lib/`, `app/` e `components/` retorna **zero ocorrências**. O projeto, na prática, já cumpre R10. Minha obrigação aqui é não ser o primeiro a quebrar isso.

Dados sensíveis: o `.gitignore` do repositório de destino não menciona fixtures (ainda não há). O clinBoard tem política explícita e madura (ver 3.3) que vou replicar.

### 1.7 Ausências relevantes

- **Sem CI.** Não existe `.github/` no repositório de destino. Nada força a suíte a rodar. (7.B-16 vale aqui também.)
- **Sem `pdfjs-dist`.** Dependência nova, necessária para a camada 1.
- **Sem `src/`.** A estrutura proposta na seção 6.2 do documento (`src/modules/exam-extraction/`) não existe neste repositório.
- Node local: **v24.15.0**.

---

## 2. Reconhecimento da fonte doadora (2.2)

Doador localizado em **`~/clinboard`** (fora deste repositório, git próprio, HEAD = `8498911 Merge D6 parte 2`).

### 2.1 Âncoras conferidas por busca de símbolo

Todas as 40 âncoras da seção 6.1 foram confirmadas. `clinboard.html` tem exatamente **6.859 linhas**. Divergências (todas dentro da margem "~" do documento):

| Símbolo | Documento | Conferido |
|---|---|---|
| `GASO_PARAMS` | ~3600 | **3605** |
| `GASO_SPECIAL_NAMES` | ~3600–3642 | **3625** |
| `QUAL_STATUS` | ~3900 | **3899** |
| `parseQualRow` | ~3950 | **3937** |
| `LCR_RENAME` | ~3960 | **3968** |

Todo o resto bate na linha exata.

### 2.2 Volumetria real do conhecimento clínico

Medido por script, não por estimativa:

| Ativo | Medida |
|---|---|
| `NAME_MAP` | **683 chaves únicas** → **196 nomes canônicos distintos** |
| Conflitos de valor no `NAME_MAP` | **0** — a correção E1 já foi aplicada; os 5 conflitos da tabela 6.4 não existem mais no fonte |
| `GASO_PARAMS` | 24 entradas, 2 delas mapeando para `null` (descarte deliberado: Hb e "Tipo de coleta") |
| `GASO_SPECIAL_NAMES` | 2 contextos × 5 sinônimos (cálcio iônico) |
| `CULTURE_TYPES` | 27 entradas |
| `IMG_MODALITIES` | 9 modalidades, **ordem significativa** (PET → ECO → COL → END → CINT → TC → RNM → USG → RX) |
| Perfis de laboratório | 6 (`GENERIC`, `HOC`, `PIOX`, `IMEC`, `NUCLEO`, `HUGO`) |

Observação: os perfis são objetos `…Lab` (`GenericLab`, `HOCLab`, …) registrados em `LabRegistry`, não constantes com o nome da tabela. Os números de linha do documento (4837/4865/…) apontam para eles corretamente.

### 2.3 Suíte sintética doadora — executada

```
node scripts/regression-synthetic.mjs
Resumo sintético: 71 checagens · 71 pass · 0 fail        (exit 0)
```

Confirma os 71 checks. O mecanismo de extração do parser (fatiar o HTML entre `async function extractPDFText(file)` e o fim de `getCultureType`) funciona — **é o mesmo mecanismo que vou reutilizar na F9 para a paridade**, rodando o clinBoard a partir do Node sem precisar do browser.

Confirmado também 7.B-9: `npm test` no doador é `run-fixtures && run-imaging && regression-synthetic`. Num clone sem PDFs, a sintética nunca roda.

---

## 3. Levantamento do corpus real (2.3)

`⟨CAMINHO_DAS_FIXTURES⟩` não foi preenchido no documento, mas **o corpus existe**: `~/clinboard/fixtures/`.

### 3.1 Catálogo por laboratório

| Perfil | PDFs | Casos indexados | Tipos de exame cobertos |
|---|---|---|---|
| **HOC** | 5 | 4 | bioquímica, eletrólitos, hemograma, coagulograma, gasometria, urina (EAS), hepático, **líquor** |
| **HUGO** | 5 | 4 | bioquímica, hemograma, coagulograma, gasometria arterial e **venosa**, sorologia/teste rápido (COVID-19 Ag) |
| **IMEC** | 8 | 7 | gasometria arterial **e** venosa, hemograma, coagulograma, hepático, troponina, cálcio iônico, **cultura**, EAS, viral, NT-proBNP, **líquor** |
| **PIOX** | 5 | 5 | hemograma, coagulograma, bioquímica, hepático, prova do laço, proteínas |
| **NUCLEO** | 2 | 2 | EAS, hemograma, coagulograma, bioquímica, hepático |
| **GENERIC** | **0** | **0** | — |
| **imaging** | 17 | 17 | TC (7), RNM (5), USG (3), RX (2) |

Total: **42 PDFs de laboratório + imagem**, com `expected.json` revisado ao lado.

### 3.2 Lacunas do corpus — isto muda o nível de confiança

1. **`GENERIC` não tem um único fixture.** É o perfil de fallback, o que mais recebe documentos desconhecidos em produção, e é o único sem cobertura. F8 não pode declarar "documento não reconhecido resolve para `unrecognized`" sem pelo menos um caso.
2. **Cultura e antibiograma aparecem só como *tag* dentro de IMEC4/IMEC5** — não há fixture dedicado, e o antibiograma nunca foi importado por ninguém (D7). **F6 é a fase com menos rede de segurança de todo o plano.** Vou precisar de PDFs de cultura com antibiograma para desenhá-la com honestidade.
3. **Sem fixture de título/diluição (`1:80`)**, sem fixture de sorologia pareada IgG+IgM em bloco, sem fixture explicitamente multi-data (o caso D6p2 só existe em texto sintético).
4. **Nenhum PDF sem camada de texto** (para provar o caminho `unrecognized` da seção 9).
5. **O corpus inteiro é de pacientes reais e existe só nesta máquina.** Não está em git (por decisão correta, LGPD). Perder o disco = perder a rede de regressão e a base da F9.

### 3.3 Política de dados que vou herdar

Do `fixtures/README.md` do doador, que já está bem resolvido:
- PDFs, `expected.json` e `extracted.txt` **nunca** vão para o git; `index.json` e READMEs vão.
- O gabarito se escreve **olhando o laudo em papel**, não capturando a saída do parser. O README do doador chama isso de "o modo de falha mais caro do projeto" — concordo, e é exatamente o que a seção 10.2 exige.

---

## 4. Plano

### 4.1 Estrutura de diretórios proposta

O documento propõe `src/modules/exam-extraction/`. **Este repositório não tem `src/` e coloca lógica de domínio em `lib/<dominio>/`.** Pela regra de 2.1 ("a convenção do projeto vence"), proponho:

```
lib/exames/extracao/
├── index.ts                    ← FRONTEIRA PÚBLICA (único import permitido de fora)
├── contratos.ts                ← tipos da seção 5
├── texto/                      ← [1] TextLayer
│   ├── pdf.ts                  ← pdfjs → itens com página/x/y/largura medida
│   ├── linhas.ts               ← clusterização por Y, gaps por largura real
│   └── *.test.ts
├── deteccao/                   ← [2] LabDetector (função pura sobre texto)
├── preprocessamento/           ← [3] reescritas declarativas do perfil
├── segmentacao/                ← [4] blocos tipados + escopo de espécime e de data
├── extratores/                 ← [5] um arquivo por matcher, cada um com seu teste
│   ├── registro.ts             ← precedência declarada em UM lugar (A2)
│   ├── tabular.ts, colon.ts, gasometria.ts, eas.ts, liquor.ts,
│   ├── qualitativo.ts, cultura.ts, antibiograma.ts, imagem.ts
├── normalizadores/             ← [6] numero, unidade, referencia, data, nome, censura
├── validadores/                ← [7] plausibilidade, dedup, quarentena
├── catalogo/                   ← JSON versionado (seção 6.2 do documento)
│   ├── analitos.json, sinonimos.json, unidades.json, qualitativos.json,
│   ├── especimes.json, culturas.json, antimicrobianos.json,
│   ├── marcadores-data.json, imagem.json
├── perfis/
│   ├── generic/perfil.json, hoc/perfil.json, piox/perfil.json,
│   ├── imec/perfil.json, nucleo/perfil.json, hugo/perfil.json
└── README.md                   ← contrato, política de dados, como adicionar um lab

lib/exames/adaptador.ts         ← ExtractionResult → ResultadoExame[] (ver 4.4)
scripts/migrate-clinboard-catalog.mjs
scripts/fixtures-sinteticas.mjs ← gera PDFs reais sintéticos (10.2)
scripts/run-fixtures-reais.mjs  ← corpus local, NÃO bloqueante em CI
fixtures/                       ← só sintéticos versionados; reais via env var
```

Testes ficam **colocados** (`normalizadores/numero.test.ts`), o que já casa com `include: ['lib/**/*.test.ts']` do vitest — **zero mudança de configuração**.

Nomes em português nos arquivos e helpers internos (convenção do repo); **os tipos do contrato ficam com os nomes em inglês do documento** (`Observation`, `ExtractionResult`, `Censoring`) — `types/index.ts` já mistura os dois registros, e manter o vocabulário do documento facilita revisar o módulo contra a especificação.

### 4.2 Contratos públicos

`lib/exames/extracao/index.ts` expõe **quatro coisas e nada mais**:

```ts
export async function extrairExames(req: ExtractionRequest): Promise<ExtractionResult>
export function detectarLaboratorio(texto: DocumentText): LabDetection   // puro, testável só (7.B-12)
export type { ExtractionRequest, ExtractionResult, Observation, ... }
export interface FallbackExtractor { ... }                               // A5
```

`extrairExames` **nunca lança** para fora (ver 1.4). Contrato de dados exatamente como a seção 5, com estas decisões:

- **`| null` explícito em vez de `?`** onde o documento usa opcional (`mic`, `scope`, `colonyCount`, `detail`). Motivo: `exactOptionalPropertyTypes` está desligado neste repositório, então `{ mic?: X }` não distingue "ausente" de "presente e `undefined`" — exatamente o tipo de ambiguidade que R4 proíbe. Ligar a flag repo-wide mexeria em código do Felipe; **prefiro não mexer e resolver dentro do módulo.**
- `Censoring` com os **quatro** operadores + `none`, como o documento manda.
- `discarded` e `warnings` são campos obrigatórios do resultado, nunca opcionais.

### 4.3 Ordem das fases

Mantenho F0–F10 do documento. Ajustes que proponho:

| Fase | Ajuste proposto | Motivo |
|---|---|---|
| **F1** | Inclui **criar `.github/workflows/ci.yml`** (`tsc --noEmit` + `next lint` + `vitest run`) | Não existe CI neste repositório; sem isso, 7.B-16 se repete aqui |
| **F2** | Precisa da dependência nova `pdfjs-dist` | Camada 1 não existe sem ela |
| **F3** | Script de migração em `.mjs`, não `.ts` | `scripts/gen-sw.mjs` já é o padrão do repo; evita adicionar tsx/ts-node |
| **F6** | **Bloqueada até haver fixture de cultura com antibiograma** | Ver 3.2, item 2 |
| **F9** | Roda o clinBoard a partir do Node reusando o slicer do `regression-synthetic.mjs` | Já provei que funciona |
| **F10** | Integração atrás de feature flag nova (`NEXT_PUBLIC_FF_EXTRACAO_DETERMINISTICA`) | `lib/featureFlags.ts` já é o mecanismo do projeto; produção fica idêntica com a flag desligada |

### 4.4 Como o módulo conversa com o que já existe

O ponto mais delicado do plano, e onde a regra "a convenção do projeto vence" cria trabalho real:

```
PDF → [módulo de extração] → ExtractionResult          ← limpo, sem interpretação (R3)
                                    │
                                    ▼
                         lib/exames/interpretacao.ts   ← NOVO: calcula alterado/direção
                                    │
                                    ▼
                         lib/exames/adaptador.ts       ← NOVO: → ResultadoExame[] para o banco
                                    │
                                    ▼
                              tabela `exames`          ← schema atual, inalterado na F10
```

O `getStatus` do clinBoard vira `lib/exames/interpretacao.ts`, **fora** do extrator. É a dívida 7.B-8 paga na origem.

**O que o adaptador perde ao gravar no schema atual** (e que precisa de decisão — ver 4.5):
- censura (`< 5,0` volta a virar string em `valor`)
- data por observação (`Exame.data_exame` é uma só)
- procedência, `discarded`, `requiresReview`, `confidence`

Ou seja: **sem mudança de banco, R5 e R7 valem dentro do módulo e morrem na porta de saída.**

### 4.5 Onde discordo do documento, ou preciso de definição

| # | Ponto | Situação |
|---|---|---|
| **P1** | `src/modules/exam-extraction/` | **Divirjo.** Uso `lib/exames/extracao/`, pela regra de 2.1. Sem impacto semântico. |
| **P2** | Campos opcionais (`mic?`, `scope?`) | **Divirjo.** Uso `\| null` explícito, porque `exactOptionalPropertyTypes` está off. Alternativa seria ligar a flag repo-wide — não farei sem combinar com o Felipe. |
| **P3** | Script de migração em `.ts` | **Divirjo.** `.mjs`, como `scripts/gen-sw.mjs`. |
| **P4** | Persistência | **Preciso de decisão.** O schema atual não comporta censura nem data por observação. Ver perguntas Q4/Q5. |
| **P5** | Papel da IA | **Preciso de decisão.** Hoje 100% da extração é Gemini. Ver Q6. |
| **P6** | CI no repositório compartilhado | **Preciso de aviso ao Felipe** antes de adicionar `.github/workflows/`. |
| **P7** | `lib/exames/agrupamento.ts` | Fica intocado. Vira redundante quando R7 valer ponta a ponta, mas removê-lo quebraria a `ExamesTab` do Felipe. |

### 4.6 Riscos já identificados (13.5)

| Risco | Gravidade | Mitigação |
|---|---|---|
| Corpus real existe em **uma única máquina**, fora do git | **Alta** — perdê-lo custa a suíte e a F9 | Backup criptografado antes da F1; F2 gera fixtures sintéticas versionáveis |
| `GENERIC` sem nenhum fixture | Alta | F8 não fecha sem ao menos 2 casos genéricos |
| Antibiograma sem corpus e sem precedente (D7) | Alta | F6 bloqueada até haver amostra |
| `e.message` devolvido cru pelas rotas | Média | Módulo não lança; erro com mensagem fixa |
| Adaptador perde censura e data por observação | Média | Explícito em Q4/Q5; enquanto não decidido, o adaptador **marca `requiresReview`** em vez de gravar valor degradado em silêncio |
| Repositório compartilhado com o Felipe, direto na `main` | Média | Trabalhar em branch + flag desligada, como no PR #1 |

---

## 5. Perguntas clínicas em aberto

Bloqueiam as fases indicadas.

- **Q1 (bloqueia F6) — antibiograma.** Qual vocabulário de interpretação usar: `S / I / R` (CLSI clássico) ou `S / I / R` no sentido do BrCAST/EUCAST, em que **`I` significa "sensível com exposição aumentada"** e não "intermediário"? São significados clínicos diferentes para a mesma letra, e o código que eu gravar é o que outro módulo vai ler.
- **Q2 (bloqueia F6) — corpus.** Você tem PDFs de cultura **com antibiograma** dos laboratórios que já usamos? Sem eles a F6 é desenho no escuro.
- **Q3 (bloqueia F5) — gasometria.** O clinBoard descarta de propósito a hemoglobina e o "tipo de coleta" de dentro da gasometria (redundantes com o hemograma). Mantenho o descarte — agora **registrado em `discarded[]` com motivo**, em vez de sumir? E a convenção `Cálcio iônico Venoso` (sem parênteses, ao contrário dos outros parâmetros venosos) permanece?
- **Q4 (bloqueia F10) — valores censurados no banco.** `< 5,0` precisa continuar sendo `< 5,0` depois de salvo. Isso exige mudar a tabela `exames`. Prefere (a) acrescentar campos ao JSONB de `resultados`, ou (b) uma tabela nova de observações, com a antiga mantida para compatibilidade?
- **Q5 (bloqueia F10) — data por observação.** Um PDF com coletas de dois dias hoje vira **um** exame com **uma** data. Manter assim na integração (e perder a distinção), ou o salvamento passa a criar um registro por data de coleta?
- **Q6 (bloqueia F10) — papel da IA.** Depois que o extrator determinístico funcionar, o Gemini deve (a) sumir do caminho, (b) ficar só para documentos não reconhecidos, ou (c) rodar sempre em paralelo para comparação durante um período? A opção (b) é a que o documento pede (A5); a (c) custa mais mas dá dado de paridade em produção.

---

## 6. Resultado da suíte, neste momento

| Suíte | Executados | Passou | Falhou | Ignorados |
|---|---|---|---|---|
| `npm test` (repositório de destino, pré-existente) | **166** em 7 arquivos | **166** | **0** | 0 |
| `regression-synthetic.mjs` (doador, referência) | **71** | **71** | **0** | 0 |
| Módulo de extração | **0** — nenhum código escrito | — | — | — |

Nada foi implementado. Este documento é a entrega da F0.
