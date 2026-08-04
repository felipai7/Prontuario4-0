# Evolução do pipeline de extração de exames

**Data:** 03/08/2026
**Autoria das decisões:** Juliana (médica, responsável clínica do produto)
**Origem:** auditoria técnica do módulo, 03/08/2026
**Status:** design aprovado, aguardando plano de implementação

---

## 1. Por que este trabalho existe

A auditoria mediu o módulo sobre os 50 laudos reais do acervo e encontrou doze
achados. O miolo do módulo está saudável: é fechado (não importa nada do app),
é idempotente (20 laudos lidos duas vezes deram 20 resultados idênticos), não
tem dependência circular, e tem 459 testes que de fato pegam regressões.

**Os cinco achados mais graves estão todos na mesma faixa: a fronteira entre o
módulo e a tela.** Ali não há um único teste.

| Achado | O que acontece |
|---|---|
| A-01 | A gasometria do HUGO mostra o valor de quatro dias antes |
| A-03 | Seis culturas com antibiograma somem sem deixar rastro |
| A-04 | As marcações de "confira este valor" nunca chegam à tela |
| A-05 | Se a gravação falhar, a tela diz "Exame salvo!" |
| A-06 | O título "Valores de Referência" é gravado como se fosse um resultado |

## 2. Critério de sucesso

**Nenhum valor errado ou invisível chega ao prontuário.**

Este é o critério, e ele foi escolhido explicitamente em vez de "deixar a base
pronta para crescer". A consequência prática é que extensibilidade — versionar
perfis de laboratório, criar encaixe para OCR ou para outro modelo de IA —
fica **fora** deste trabalho, ainda que a auditoria as tenha apontado como
lacunas reais.

## 3. Decisões tomadas

| # | Decisão | Consequência |
|---|---|---|
| D1 | O objetivo é impedir erro clínico, não preparar para crescer | Encaixes de troca ficam de fora |
| D2 | Nada é reescrito no banco | Registros já gravados ficam como estão; a correção é só daqui pra frente |
| D3 | Cultura vira registro de texto na tabela que já existe | O dado para de sumir sem exigir tela nova |
| D4 | Dois valores do mesmo exame: mostrar os dois e marcar | O sistema nunca escolhe calado |
| D5 | Conflito aparece na mesma célula: `47,0 / 33,0 ⚠` | A tabela mantém uma linha por exame |
| D6 | Laudo reenviado: **grava e marca**, não bloqueia | Ser bloqueada é pior que ter um duplicado |
| D7 | A gravação passa do navegador para o servidor | Erro vira falha que a tela não consegue ignorar |
| D8 | O sistema confere se o laudo é do paciente da tela | Avisa, não bloqueia. O nome do laudo nunca sai do módulo |
| D9 | Marcação de conferência: símbolo na célula **e** lista de pendências acima da tabela | Você vê se há algo pendente sem varrer a tabela |
| D10 | O que a IA lê é marcado **uma vez por laudo**, não por valor | 40 valores marcados fazem a marcação virar ruído |
| D11 | A tabela "Evolução do paciente" é descartada, não aproveitada | Ela não traz unidade nem referência, e duplica o que já foi subido |

**Nota sobre D6:** um laudo reemitido pelo laboratório com correção tem bytes
diferentes, logo impressão digital diferente, e não seria detectado como
duplicado de qualquer forma. A marcação só dispara em arquivo byte a byte
idêntico. A decisão vale mesmo assim, pelo motivo dela: bloquear atrapalha mais
do que ajuda.

**Nota sobre D8 — como conferir o paciente sem guardar dado pessoal.**

O desenho é pergunta-e-veredito, e não leitura-e-devolução:

```
a rota MANDA:      "o paciente desta tela se chama <nome>"
o módulo DEVOLVE:  confere | não confere | não achei nome no laudo
```

O nome que está no laudo **nunca aparece em nenhum campo de saída**. Não há
como ele ser gravado, logado ou vazado por acidente, porque ele não existe fora
da função que faz a comparação. Isso é mais forte do que "temos o cuidado de
não guardar": torna o vazamento impossível por construção, que é a mesma regra
que vale hoje para o texto do laudo (R10).

A comparação tolera abreviação e ordem trocada, e o resultado **avisa, não
bloqueia** — nome de casada, nome abreviado pelo laboratório e acento perdido
gerariam alarme falso demais para justificar uma trava.

**Nota sobre D10.** A marcação de origem responde "de onde veio este laudo" e
aparece uma vez, no cabeçalho do exame. As marcações por valor continuam
existindo e ficam reservadas ao que é específico daquele número: sem data de
coleta, referência não confiável, valor fora da faixa fisicamente possível.

## 4. Arquitetura

### 4.1 O problema estrutural

Hoje a última seta aponta para o lado errado:

```
tela ExamesTab ──→ rota ──→ módulo de extração
                              ↓
                          adaptador ──importa──→ @/types  (formato do banco)
                              ↓
tela grava direto no banco, em 4 lugares, sem conferir o resultado
```

`adaptador.ts`, `interpretacao.ts` e `agrupamento.ts` importam `@/types` — o
formato da linha do banco. O domínio clínico depende do formato de
persistência. Como esse formato só tem lugar para exame numérico, cultura e
marcações de revisão não cabem, e por isso desaparecem.

### 4.2 A arquitetura proposta

```
módulo de extração   (lib/exames/extracao/**  —  NÃO MUDA de forma)
        │  produz ExtractionResult
        ▼
  entrega.ts         formato PRÓPRIO do domínio de exames
                     carrega: linhas, culturas, marcações, avisos, origem
        │
        ▼
  adaptador.ts       peça de borda — único lugar que conhece os dois lados
        │
        ▼
  persistencia.ts    grava · CONFERE o erro · marca duplicidade
        │
        ▼
  rota               orquestra; devolve resultado explícito
        │
        ▼
  ExamesTab.tsx      só exibe
```

A regra de direção passa a ser: **nada em `lib/exames/` importa `@/types`,
exceto `adaptador.ts`.** Essa é a peça de borda, e conhecer os dois lados é o
trabalho dela.

### 4.3 Peças

| Peça | Situação | Responsabilidade | Depende de |
|---|---|---|---|
| `lib/exames/entrega.ts` | **nova** | O formato do domínio e a construção dele a partir do resultado da extração | Só `extracao/` |
| `lib/exames/persistencia.ts` | **nova** | Gravar, conferir o erro, detectar arquivo repetido | Só o cliente do banco |
| `lib/exames/adaptador.ts` | muda de papel | Converter entrega → linha do banco | `entrega.ts` e `@/types` |
| `lib/exames/interpretacao.ts` | ajuste | Passa a operar sobre os tipos do domínio | Só `extracao/` e `entrega.ts` |
| `app/api/extract-exam/route.ts` | muda | Orquestra: extrai → monta entrega → grava → responde | as três acima |
| `components/.../ExamesTab.tsx` | muda | Envia e exibe. Para de gravar | a rota |
| `extracao/extratores/supressao.ts` | ajuste cirúrgico | Reconhecer "Evolução do paciente" | — |
| `extracao/extratores/*.ts` | ajuste cirúrgico | Não ler "Valores de Referência" como valor | — |

## 5. Fluxo do dado

```
[0]  você envia o PDF na tela do paciente
       ↓
[1]  o módulo lê o laudo
       · recebe o nome do paciente da tela e devolve só um veredito   (D8)
       · a seção "Evolução do paciente" é descartada, com motivo      (D11)
       · o título "Valores de Referência" não vira valor
       ↓
[2]  monta a ENTREGA
       · uma linha por data de coleta                    (decisão Q5, 01/08)
       · culturas viram registro de texto                (D3)
       · dois valores do mesmo exame: guarda os DOIS     (D4)
       · carrega as marcações de conferência
       · carrega página e linha de origem de cada número
       ↓
[3]  confere a impressão digital do arquivo
       · já enviado antes? marca como possível duplicata (D6)
       ↓
[4]  GRAVA e CONFERE
       · falhou? a tela recebe erro e NÃO diz "salvo"    (D7)
       ↓
[5]  a tela exibe
       · lista de pendências acima da tabela             (D9)
       · símbolo na célula de cada valor marcado         (D9)
       · conflito aparece como  47,0 / 33,0 ⚠            (D5)
       · "lido por IA" no cabeçalho, uma vez             (D10)
       · aviso se o laudo parece ser de outro paciente   (D8)
```

Como a tela fica, com D9 aplicado:

```
  ⚠ 3 resultados deste laudo pedem conferência
     Ureia · sem data de coleta
     Sódio · sem data de coleta
     PCR · referência não confiável

                      06/04      08/04

  Creatinina           1,42       1,58
  Ureia                  62         71 ⚠
  Potássio              4,1        5,9
  Sódio                 138        141 ⚠
```

## 6. Tratamento de erro

Três regras:

1. **O módulo continua nunca lançando erro.** Já é assim, e não muda: as rotas
   deste repositório devolvem `e.message` ao navegador, e uma exceção com
   conteúdo de laudo dentro vazaria pela rede.
2. **A rota para de devolver a mensagem crua.** Hoje há um único `catch` que
   devolve `e.message`. Passa a distinguir: *laudo já enviado antes*, *falha ao
   gravar*, e *erro inesperado* — este com mensagem genérica, sem conteúdo do
   laudo (R10).
3. **"Exame salvo!" só depois de confirmado.** A gravação devolve um resultado
   explícito que a tela não consegue ignorar.

## 7. Testes

Sete testes novos. **Cada um deve falhar hoje antes de passar** — um teste que
já passa no código atual não prova nada sobre o defeito que diz cobrir.

| Teste | Achado que trava |
|---|---|
| Laudo com tabela "Evolução do paciente" → a linha histórica é descartada com motivo | A-01 |
| Laudo com cultura + exames → a entrega traz os dois | A-03 |
| Dois valores do mesmo exame → os dois sobrevivem e vêm marcados | A-01 / D4 |
| Gravação falha → quem chamou recebe erro, e nada diz "salvo" | A-05 |
| Resultado marcado para conferência → chega até a tela | A-04 |
| Mesmo arquivo duas vezes → o segundo é gravado E marcado | A-08 / D6 |
| Título "Valores de Referência" não vira valor | A-06 |
| Laudo de outro paciente → veredito "não confere", e o nome do laudo **não aparece em nenhum campo de saída** | A-02 / D8 |
| Laudo com pendências → a lista aparece acima da tabela | D9 |
| Laudo lido pela IA → marcação de origem uma vez, não por valor | D10 |

Mais duas travas de regressão sobre os 50 laudos reais:

- o total de resultados extraídos não pode cair — **hoje 912**;
- a comparação com o sistema doador não pode piorar — **hoje 13 divergências**.

**Nota sobre a fixture da tabela de evolução:** precisa ser escrita com as
colunas em posição medida (`pdfTabular`), não com espaços (`pdfDeLinhas`).
Quatro vezes neste projeto um teste sintético provou a coisa errada porque o
vão gerado era mais estreito que o de um laudo real.

## 8. O que fica fora, e por quê

| Fora do escopo | Motivo |
|---|---|
| Versionar os perfis de laboratório | Serve à extensibilidade, não ao critério D1 |
| Encaixe para trocar OCR / leitor / modelo de IA | Idem |
| Tela própria para antibiograma | D3 — cultura entra como texto; tela fica para depois |
| **Separar Exames Laboratoriais e Exames de Imagem em dois módulos** | Decidido que SIM, em spec própria — ver 8.1 |
| Corrigir registros já gravados | D2 |
| Aproveitar a tabela de evolução como histórico datado | D11 |

### 8.1 O próximo trabalho, já decidido

Laudos de imagem passam a ter **módulo próprio**, separado dos laboratoriais.
A decisão está tomada; o desenho fica para uma spec própria, pelo motivo de
sequência abaixo.

Laudo de imagem **não está perdendo dado hoje** — ele vai para a IA e é
gravado. Separar os módulos é organização e extensibilidade, que é o que a
decisão D1 conscientemente deixou de fora deste trabalho. Fazer junto dobraria
o escopo e atrasaria a saída da gasometria errada do ar.

## 9. Perguntas de domínio — respondidas em 03/08

| | Pergunta | Resposta |
|---|---|---|
| **P1** | Recusar laudo de outro paciente? | **Sim** — avisar, não bloquear. Vira D8 |
| **P3** | Imagem pertence a este módulo? | **Não** — módulo próprio, em spec seguinte (8.1) |
| **P5** | Aproveitar a tabela de evolução? | **Não** — descartar. Vira D11 |
| **P6** | Como a marcação aparece? | Símbolo na célula **e** lista acima. Vira D9 |
| **P7** | O que a IA lê nasce marcado? | **Sim, uma vez por laudo.** Vira D10 |

**Ponto que ainda não foi confirmado por ela:** D10 é sugestão minha, feita a
pedido, e não foi contestada — mas também não foi escolhida entre alternativas
como as outras. Se a preferência for marcar valor a valor, é uma linha de
diferença e vale dizer antes do plano.
