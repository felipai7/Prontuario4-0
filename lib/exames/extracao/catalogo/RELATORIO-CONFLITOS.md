# Relatório de conflitos da migração do catálogo

Gerado por `scripts/migrate-clinboard-catalog.mts`. Reexecutável.

| Métrica | Valor |
|---|---|
| Sinônimos migrados | 797 |
| Analitos distintos | 281 |
| Nomes geráveis por regra | 72 |
| Conflitos detectados | 17 |

**Nenhum conflito foi resolvido automaticamente.** Cada item abaixo exige decisão clínica.

## Termos qualitativos sem código correspondente no contrato (3)

- "IMUNE" não corresponde a nenhum QualitativeCode do contrato
- "NAO IMUNE" não corresponde a nenhum QualitativeCode do contrato
- "NÃO IMUNE" não corresponde a nenhum QualitativeCode do contrato

## Descrição física tratada como resultado qualitativo pelo doador (14)

- "AMARELADO" é descrição física (cor/aspecto), não código qualitativo
- "AVERMELHADO" é descrição física (cor/aspecto), não código qualitativo
- "CRISTALINO" é descrição física (cor/aspecto), não código qualitativo
- "HEMORRAGICO" é descrição física (cor/aspecto), não código qualitativo
- "HEMORRÁGICO" é descrição física (cor/aspecto), não código qualitativo
- "INCOLOR" é descrição física (cor/aspecto), não código qualitativo
- "LIGEIRAMENTE TURVO" é descrição física (cor/aspecto), não código qualitativo
- "LIMPIDO" é descrição física (cor/aspecto), não código qualitativo
- "LÍMPIDO" é descrição física (cor/aspecto), não código qualitativo
- "OPACO" é descrição física (cor/aspecto), não código qualitativo
- "ROSADO" é descrição física (cor/aspecto), não código qualitativo
- "TURVO" é descrição física (cor/aspecto), não código qualitativo
- "XANTOCROMICO" é descrição física (cor/aspecto), não código qualitativo
- "XANTOCRÔMICO" é descrição física (cor/aspecto), não código qualitativo

## Lacunas deliberadas

Campos deixados em `null` porque preenchê-los seria inventar dado clínico:

- `loinc` em todos os 281 analitos — o doador não tem LOINC. Nunca inventar.
- `plausibleRange` em todos — é a faixa fisicamente possível, usada só para detectar erro de escala (potássio 7,2 lido como 0,72). Sem ela, o validador da F7 não protege contra erro de escala.
- `defaultUnit` e `category` — o doador não os tem.
- `unidades.json` — vazio; F4 popula a partir do corpus, sob revisão.
- `antimicrobianos.json` — vazio; o clinBoard nunca importou antibiograma (D7).
