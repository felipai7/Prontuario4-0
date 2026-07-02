# Prompt para Claude Code — Módulos Médico Plantonista e Médico Intensivista

> Cole tudo abaixo desta linha no Claude Code, na raiz do projeto `uti-app` (Prontuario4-0).

---

## Contexto do projeto

Este é um sistema de prontuário de UTI em **Next.js 14 (App Router) + TypeScript + Tailwind + Supabase (auth, Postgres, realtime) + Gemini (@google/genai)**, deploy no Vercel. Estrutura atual relevante:

- `components/dashboard/UTIGrid.tsx` — grid de 19 leitos (UTI 01: leitos 1–9, UTI 02: leitos 10–19)
- `components/paciente/PacienteModal.tsx` — modal do paciente com 6 abas hardcoded: Balanço Hídrico (`BalancoTab`), Sinais Vitais (`SinaisVitaisTab`), Exames Laboratoriais (`ExamesTab`), Exames de Imagem (`ExamesImagemTab`), Hemodinâmica (`HemodinamicaTab`), Intensivista Horizontal (`IntensivistaHorizontalTab`)
- `app/api/` — rotas de IA: `avaliacao-clinica`, `gerar-resumo-alta`, `evolucao-exames`, `extract-exam`, `extract-imagem`, `extract-sinais-vitais`
- `supabase/*.sql` — SQLs incrementais executados manualmente no SQL Editor do Supabase
- `types/index.ts` — todos os tipos
- Padrão existente de "estado atual" (1 registro por paciente, upsert): tabela `cuidados_horizontais`
- RLS em todas as tabelas: `for all to authenticated using (true) with check (true)`; realtime habilitado; trigger `handle_updated_at`

## Objetivo

Reorganizar o prontuário médico em **dois módulos** com seletor no header do `PacienteModal`, e criar **duas abas novas** (Neurológico e Ventilatório):

| Módulo | Abas |
|---|---|
| 🩺 Médico Plantonista | Balanço Hídrico · Sinais Vitais · Hemodinâmica · **Neurológico (nova)** · **Ventilatório (nova)** · Exames Laboratoriais · Exames de Imagem |
| 📋 Médico Intensivista | Cuidados Horizontais (conteúdo atual de `IntensivistaHorizontalTab`, renomear a aba) · Exames Laboratoriais · Exames de Imagem |

As abas de exames são **componentes únicos compartilhados** entre os dois módulos (sem duplicar código). Nenhuma funcionalidade existente pode ser perdida.

## Arquitetura desejada

1. Criar `lib/modules.ts` — registro declarativo de módulos e abas:
   - Cada módulo: `{ id, label, tabs: [{ id, label, component }] }`
   - O `PacienteModal` renderiza o seletor de módulo (botões segmentados no header, ao lado ou acima das abas) e as abas do módulo ativo a partir desse registro. Módulo padrão: Plantonista. Persistir o módulo/aba ativos apenas em estado local.
   - Objetivo: adicionar futuros módulos (Enfermagem, Nutrição, Fisioterapia) apenas registrando novas entradas.
2. Reorganizar componentes (mover, ajustando imports):
   - `components/modules/plantonista/` → `BalancoTab`, `SinaisVitaisTab`, `HemodinamicaTab`, `NeurologicoTab` (novo), `VentilatorioTab` (novo)
   - `components/modules/intensivista/` → `IntensivistaTab` (renomear de `IntensivistaHorizontalTab`)
   - `components/modules/shared/` → `ExamesTab`, `ExamesImagemTab`
   - `components/paciente/` mantém `PacienteModal`, `CadastroForm`, `AltaModal`
3. Manter o padrão atual de dados do modal (fetch no `PacienteModal` + realtime + `onRefresh`), apenas acrescentando as duas novas tabelas ao `Promise.all` e às subscriptions.

## Banco de dados

Criar `supabase/migrations/001_neurologico_ventilatorio.sql` (também deixar instrução no arquivo: colar no SQL Editor do Supabase e executar). Seguir exatamente os padrões de `supabase/intensivista_horizontal.sql` (RLS, realtime, trigger updated_at).

```sql
-- Estado atual: 1 registro por paciente (unique em paciente_id), padrão upsert

create table public.avaliacoes_neurologicas (
  id                uuid default uuid_generate_v4() primary key,
  paciente_id       uuid not null unique references public.pacientes(id) on delete cascade,
  escala            text check (escala in ('RASS', 'GLASGOW')),
  rass              integer check (rass between -5 and 4),
  glasgow_ao        integer check (glasgow_ao between 1 and 4),
  glasgow_rv        integer check (glasgow_rv between 1 and 5),
  glasgow_rm        integer check (glasgow_rm between 1 and 6),
  sedacao_em_uso    boolean default false not null,
  sedativos         text[],
  sedativo_outro    text,
  despertar_diario  boolean,
  created_at        timestamptz default now() not null,
  updated_at        timestamptz default now() not null
);

create table public.suportes_ventilatorios (
  id              uuid default uuid_generate_v4() primary key,
  paciente_id     uuid not null unique references public.pacientes(id) on delete cascade,
  modalidade      text check (modalidade in ('ar_ambiente', 'o2_suplementar', 'ventilacao_mecanica')),
  o2_dispositivo  text check (o2_dispositivo in ('Cateter nasal', 'Máscara facial', 'Máscara com reservatório', 'CNAF', 'VNI', 'Outro')),
  o2_fluxo_l_min  numeric(4,1),
  vm_data_inicio  date,
  vm_via          text check (vm_via in ('TOT', 'TQT')),
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);
```

Adicionar: RLS igual às demais tabelas, `alter publication supabase_realtime add table ...` para ambas, e triggers de `updated_at`. Adicionar os tipos `AvaliacaoNeurologica` e `SuporteVentilatorio` em `types/index.ts` seguindo o estilo existente.

## Aba Neurológico (`NeurologicoTab.tsx`)

Tudo por **botões/chips selecionáveis** — nada digitado, exceto o campo texto "Outro" sedativo. Visual consistente com as abas existentes (Tailwind, mesmo estilo de cards/botões do projeto).

- **Escala** (segmentado): `RASS` | `Glasgow`. Trocar de escala NÃO apaga os valores da outra no banco; só alterna o que é exibido/editado.
- **RASS**: régua de botões de −5 a +4 (um selecionável). Cada botão com `title` descritivo: −5 Não desperta, −4 Sedação profunda, −3 Sedação moderada, −2 Sedação leve, −1 Sonolento, 0 Alerta e calmo, +1 Inquieto, +2 Agitado, +3 Muito agitado, +4 Combativo.
- **Glasgow por componentes**: três réguas — AO (1–4), RV (1–5), RM (1–6) — com o **total 3–15 calculado e exibido** (não editável, não persistido; só os componentes vão ao banco).
- **Em uso de sedativos?** Sim/Não. Se "Não": limpar `sedativos`, `sedativo_outro` e `despertar_diario` e ocultar os campos abaixo.
- **Quais sedativos** (multi-seleção): Propofol, Midazolam, Fentanil, Dexmedetomidina, Cetamina, Outro. "Outro" abre campo texto (`sedativo_outro`).
- **Despertar diário**: Sim/Não (visível só com sedação ativa).
- Persistência: `upsert` em `avaliacoes_neurologicas` por `paciente_id`, salvando a cada mudança (com feedback via `showToast` em erro) ou com botão Salvar — seguir o padrão que for mais consistente com `IntensivistaHorizontalTab`.

## Aba Ventilatório (`VentilatorioTab.tsx`)

- **Modalidade** (segmentado, um selecionável): Ar ambiente | O₂ suplementar | Ventilação mecânica. Trocar de modalidade oculta (mas preserva no banco) os campos das outras.
- **Se O₂ suplementar**: dispositivo (chips, um selecionável): Cateter nasal, Máscara facial, Máscara com reservatório, CNAF, VNI, Outro. Campo opcional numérico de fluxo (L/min).
- **Se Ventilação mecânica**:
  - Via aérea: `TOT` | `TQT` (chips)
  - `vm_data_inicio` (input date; default = hoje ao selecionar VM pela primeira vez, editável)
  - Exibir **"X dia(s) de VM"** calculado a partir de `vm_data_inicio`
- Persistência: `upsert` em `suportes_ventilatorios` por `paciente_id`.
- **Badge no header do `PacienteModal`**: se modalidade = VM, mostrar badge tipo `VM · TOT · 7d` junto às infos do paciente.

## Integrações obrigatórias

1. **`app/api/avaliacao-clinica/route.ts`**: aceitar `neuro` e `ventilatorio` no payload e incluir seções no prompt do Gemini (ex.: "Neurológico: RASS −2, sedação com Propofol + Fentanil, em despertar diário" / "Ventilatório: VM via TOT há 7 dias"). O `PacienteModal` passa esses dados no `handleAvaliarIA`.
2. **`AltaModal` / `app/api/gerar-resumo-alta/route.ts`**: incluir os dois registros no snapshot da alta (`resumos_alta`) e no texto gerado.
3. **Realtime**: assinar `avaliacoes_neurologicas` e `suportes_ventilatorios` no canal do modal, como as demais tabelas.

## Restrições

- Não alterar comportamento das abas existentes além de movê-las de pasta/módulo.
- Não introduzir dependências novas.
- Manter todo o texto da UI em português brasileiro.
- Não criar sistema de roles/perfis nesta etapa (virá depois, com os módulos de Enfermagem/Nutrição/Fisioterapia).
- Tipagem estrita: sem `any` novos.

## Verificação final

1. `npm run build` sem erros.
2. Conferir: seletor de módulo alterna abas corretamente; exames aparecem nos dois módulos; Glasgow soma certo; "Não" em sedação limpa dependentes; troca de modalidade ventilatória preserva dados; badge de VM no header; avaliação por IA e resumo de alta incluem os novos dados.
3. Listar ao final: arquivos criados/movidos/alterados + lembrete para executar a migration no SQL Editor do Supabase antes de testar.
