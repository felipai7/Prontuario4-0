# Relatório de conflitos da migração do catálogo

Gerado por `scripts/migrate-clinboard-catalog.mts`. Reexecutável.

| Métrica | Valor |
|---|---|
| Sinônimos migrados | 797 |
| Analitos distintos | 285 |
| Nomes geráveis por regra | 75 |
| Conflitos detectados | 0 |

**Nenhum conflito foi resolvido automaticamente.** Cada item abaixo exige decisão clínica.

## Lacunas deliberadas

Campos deixados em `null` porque preenchê-los seria inventar dado clínico:

- `loinc` em todos os 285 analitos — o doador não tem LOINC. Nunca inventar.
- `plausibleRange` em todos — é a faixa fisicamente possível, usada só para detectar erro de escala (potássio 7,2 lido como 0,72). Sem ela, o validador da F7 não protege contra erro de escala.
- `defaultUnit` e `category` — o doador não os tem.
- `unidades.json` — vazio; F4 popula a partir do corpus, sob revisão.
- `antimicrobianos.json` — vazio; o clinBoard nunca importou antibiograma (D7).
