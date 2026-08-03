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

**Nota sobre D6:** um laudo reemitido pelo laboratório com correção tem bytes
diferentes, logo impressão digital diferente, e não seria detectado como
duplicado de qualquer forma. A marcação só dispara em arquivo byte a byte
idêntico. A decisão vale mesmo assim, pelo motivo dela: bloquear atrapalha mais
do que ajuda.

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
       · a seção "Evolução do paciente" é descartada, com motivo registrado
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
       · valor marcado para conferência aparece sinalizado
       · conflito aparece como  47,0 / 33,0 ⚠            (D5)
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
| Laudos de imagem | Hoje vão para a IA e são gravados; não são perdidos como as culturas |
| Corrigir registros já gravados | D2 |
| Conferir se o laudo é do paciente certo | Achado A-02, crítico, mas exige decidir regra de privacidade antes |

**A-02 continua aberto e é o achado mais grave da auditoria.** Não entra aqui
porque a decisão que ele exige — ler um dado pessoal que hoje é descartado de
propósito — não foi tomada.

## 9. Perguntas de domínio ainda em aberto

Da auditoria, seguem sem resposta e **não** são resolvidas por este design:

- **P1** — o sistema deve recusar um laudo que parece ser de outro paciente?
- **P3** — laudos de imagem pertencem ao módulo de exames?
- **P5** — a tabela de "evolução do paciente" deve ser aproveitada como
  histórico datado, em vez de apenas descartada?
- **P6** — como exatamente um valor marcado para conferência deve aparecer?
  Este design diz *que* ele aparece; a forma exata ainda não foi desenhada.
- **P7** — o que a IA lê deve nascer marcado como "não conferido"? Decidido em
  01/08, nunca implementado, e fora do escopo deste trabalho.
