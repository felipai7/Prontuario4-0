# Relatórios de culturas — como usar

Dois scripts que trabalham juntos:

| Script | Para quê |
|--------|----------|
| `exportar_xml_pardini.py` | **Baixa** o XML em lote do portal (semana única ou retroativo) |
| `gerar_relatorio_semanal.py` | **Gera** os relatórios PDF + Excel a partir do(s) XML |

Instalação (uma vez), no terminal:

```
pip install selenium webdriver-manager reportlab openpyxl
```

---

## 1. Gerar relatórios a partir de XML que você já tem

**Uma semana** (o arquivo que você já baixou):
```
python gerar_relatorio_semanal.py --xml "hpres_1388_07_01_2026 23_59_59.xml"
```

**Retroativo — todas as semanas de uma pasta**, um relatório por semana:
```
python gerar_relatorio_semanal.py --pasta "Exports" --lote
```

**Retroativo + consolidado** (um relatório único do período inteiro, com coluna "Semana"):
```
python gerar_relatorio_semanal.py --pasta "Exports" --lote --consolidar
```

Saída: pasta `Relatorios/` com `Relatorio_Culturas_<periodo>.pdf/.xlsx` por semana e, se pedir, `CONSOLIDADO_Culturas_<periodo>.pdf/.xlsx`.

Sem argumentos, ele pega o XML **mais recente** da pasta atual.

---

## 2. Baixar o XML do portal automaticamente

> Antes de rodar: abra `exportar_xml_pardini.py` e preencha os pontos `# >>> CONFIGURAR`
> (endereço do portal e os *seletores* dos campos da tela de exportação — só aparecem
> quando você inspeciona o portal logado). Guarde login e senha em variáveis de ambiente
> `LAB_USER` e `LAB_PASS`, não no código.

**Uma semana:**
```
python exportar_xml_pardini.py --de 2026-01-01 --ate 2026-01-07
```

**Retroativo — últimos 18 meses em janelas de 7 dias, já gerando os relatórios:**
```
python exportar_xml_pardini.py --retroativo-meses 18 --gerar
```

O exportador retoma de onde parou (checkpoint), não rebaixa período já existente e
registra falhas em `_export_erros.csv`. Se houver 2FA, ele pausa e pede o login humano.

---

## Observações
- **Escopo:** o export é do laboratório inteiro. Quando você tiver a lista de
  atendimentos da UTI, dá para filtrar só a UTI e cruzar com os pacientes.
- **LGPD:** os arquivos têm dados sensíveis de saúde — mantenha tudo em pasta restrita.
- **Sem API:** o download depende da interface web; se o portal mudar de layout,
  ajuste os seletores no topo do `exportar_xml_pardini.py`.

---

## 3. Exportar por MÊS (em vez de 7 dias)

**Um mês específico** (ex.: janeiro/2026) — gera um XML só:
```
python3 exportar_xml_pardini.py --mes 2026-01 --saida Exports
```

**Vários meses de uma vez (retroativo mensal)** — um XML por mês dos últimos 18 meses,
e já gera os relatórios:
```
python3 exportar_xml_pardini.py --retroativo-meses 18 --mensal --saida Exports --gerar
```

**Intervalo de datas, quebrado por mês:**
```
python3 exportar_xml_pardini.py --de 2025-01-01 --ate 2026-06-30 --mensal --saida Exports
```

Lembrete: o exportador só baixa de verdade depois que os pontos `# >>> CONFIGURAR`
(endereço do portal e seletores da tela de exportação) estiverem preenchidos.
Se o portal limitar o tamanho do período por exportação, use janelas menores
(`--dias 15`, por exemplo) ou continue no modo semanal.
