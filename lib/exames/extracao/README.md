# Módulo de extração de exames

Recebe o PDF de um laudo e devolve dados clínicos estruturados. Determinístico,
sem rede, sem estado entre chamadas.

## O que ele faz e o que não faz

**Faz:** lê o PDF, identifica o laboratório emissor, separa as seções, extrai
resultados de laboratório, culturas com antibiograma e laudos de imagem,
normaliza nome, número, unidade, referência e data.

**Não faz:** não diz se um valor está alto, baixo ou crítico. Isso é
[`lib/exames/interpretacao.ts`](../interpretacao.ts), que recebe o resultado já
extraído. A separação é deliberada — no clinBoard os dois moram juntos, e mudar
a regra de alerta obriga a mexer no parser.

Também não fala com o usuário. Avisos são dados de retorno (`warnings`,
`discarded`); quem traduz para a tela é [`adaptador.ts`](../adaptador.ts).

## Contrato

```ts
import { extrairExames } from '@/lib/exames/extracao'

const resultado = await extrairExames({
  document: { bytes, filename: null },
  hints: null,     // { labProfileId } força um perfil
  options: null,   // { retainRawText, minDetectionConfidence, ... }
})
```

`extrairExames` **nunca lança**. Falha é dado de retorno — as rotas deste
repositório devolvem `e.message` cru ao navegador, e uma exceção com conteúdo de
laudo dentro vazaria pela rede sem passar por log nenhum.

Campos do resultado que costumam ser esquecidos:

| Campo | Por que existe |
|---|---|
| `discarded[]` | Toda linha rejeitada, com motivo. Silêncio nunca é opção |
| `warnings[]` | Documento ilegível, laboratório não reconhecido, datas múltiplas |
| `observations[].provenance` | Página, linha e matcher que capturou — é o que permite depurar um valor errado em produção |
| `observations[].requiresReview` | O módulo decide *o que* precisa de conferência; a tela decide como mostrar |
| `value.censoring` | `< 5,0` não é 0 nem 5,0. Quatro operadores, não dois |
| `collectedAt.source` | Data de coleta, de seção, por proximidade ou ausente. Uma data de impressão usada como coleta desloca a série do paciente |

## Política de dados

Este módulo processa dados de paciente identificáveis.

- **Nada de conteúdo de laudo em log, telemetria ou mensagem de erro.** Há teste
  estrutural que falha se aparecer um `console` no módulo.
- `retainRawText` nasce **desligado**: sem ele, `provenance.rawLine` vem vazio.
- `diagnostics` carrega contadores, versões e o **hash** do documento — nunca
  trechos dele.
- **Fixtures reais não entram no git.** Os PDFs do corpus e os relatórios
  derivados deles ficam só na máquina, cobertos pelo `.gitignore`. Valor de
  exame é dado clínico ainda que sem o nome do paciente ao lado.

Os scripts que dependem do corpus (`rodar-corpus`, `paridade-clinboard`) exigem
`FIXTURES_EXAMES` e não rodam no CI. A suíte que trava o merge é a sintética, que
roda em qualquer clone limpo.

## Como adicionar um laboratório novo

1. **Coloque 2 ou 3 PDFs** do laboratório em `$FIXTURES_EXAMES/<lab>/<id>/source.pdf`.
   Eles não vão para o git.

2. **Veja o que sai hoje:**
   ```
   FIXTURES_EXAMES=~/clinboard/fixtures npx tsx scripts/rodar-corpus.mts
   ```

3. **Crie o perfil** em `perfis/<lab>/perfil.json`. É só dado — nenhum código do
   núcleo muda:

   ```json
   {
     "id": "exemplo",
     "displayName": "Nome do laboratório",
     "fingerprint": {
       "threshold": 10,
       "signals": [
         { "id": "cnes", "pattern": "CNES\\s*0000000", "weight": 10, "kind": "institutional" }
       ]
     },
     "preprocess": [],
     "matchers": { "enable": [], "disable": [] },
     "referenceBlocks": [],
     "specimen": { "inherit": [], "fromMaterialLine": false }
   }
   ```

   Regras dos sinais:
   - `institutional` (CNES, CNPJ, nome do estabelecimento) é estável — peso alto.
   - `layout` (um typo consistente, um rótulo próprio do sistema) serve quando não
     há identificador institucional.
   - `vendor` (modelo de analisador, nome do LIS) identifica o **fornecedor**, não
     o laboratório: peso sempre **abaixo do limiar**, porque dois laboratórios da
     mesma região com o mesmo sistema colidiriam. Há teste garantindo isso.
   - **Nunca** use nome de responsável técnico, registro profissional ou endereço.
     Mudam sozinhos e são dado pessoal desnecessário. Há teste garantindo isso.

4. **Registre o perfil** em [`deteccao/detectar.ts`](deteccao/detectar.ts).

5. **Escreva a fixture sintética** do layout, em
   [`extratores/layouts.test.ts`](extratores/layouts.test.ts). Use `pdfTabular()`
   para colunas em posição, não `pdfDeLinhas()` com espaços: três vezes neste
   projeto um teste sintético provou a coisa errada porque o vão gerado era mais
   estreito que o de um laudo real.

6. **Meça antes de escolher.** Se a mudança envolve uma regra que pode ir num
   perfil ou no núcleo, rode as combinações sobre o corpus e compare. Duas
   decisões deste módulo — bloco de referências e herança de espécime — foram
   tomadas assim, e nas duas a opção que parecia obviamente certa piorava o
   resultado.

## Suítes

| Comando | O que cobre | Trava merge |
|---|---|---|
| `npm test` | Tudo que não depende de dado de paciente | **sim** |
| `FIXTURES_EXAMES=… npx tsx scripts/rodar-corpus.mts` | Corpus real, contagens e roteamento | não |
| `FIXTURES_EXAMES=… CLINBOARD_HTML=… npx tsx scripts/paridade-clinboard.mts` | Paridade contra o clinBoard | não |

O arquivo [`extratores/lacunas.test.ts`](extratores/lacunas.test.ts) usa
`it.fails()` para as lacunas conhecidas: elas passam enquanto o defeito existe e
**quebram quando alguém o corrigir**, obrigando a virar a asserção. Sem isso a
suíte fica verde sobre exames que o clinBoard entrega e nós não — o que já
aconteceu três vezes neste projeto.
