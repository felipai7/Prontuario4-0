-- ══════════════════════════════════════════════════════════════════════════
-- MÓDULO DE NUTRIÇÃO
--
-- O maior dos módulos: ~26 indicadores. Quase tudo é por paciente por dia, o
-- que o torna também o mais pesado de preencher. Três defesas contra isso:
--   1. Derivar o que já existe (constipação e diarreia saem do Balanço Hídrico,
--      opioide sai dos Cuidados Horizontais, dias de VM saem do Ventilatório).
--   2. Herdar o dia anterior no formulário.
--   3. Tela de round: todos os pacientes numa tabela, preenchida numa passada.
--
-- Guarda-se a PORCENTAGEM, não "atingiu a meta sim/não": o Dr. Flaubert definiu
-- adequação proteica por paciente como "média ≥80%", e não se tira média de
-- sim/não. De quebra, mudar o alvo depois não invalida os meses antigos.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Avaliação nutricional (uma por internação) ────────────────────────────

create table if not exists public.nutricao_avaliacoes (
  id                uuid primary key default uuid_generate_v4(),
  paciente_id       uuid not null references public.pacientes(id) on delete cascade,
  data_avaliacao    date not null,
  hora_avaliacao    time,
  risco_nutricional boolean not null default false,
  deficit           boolean not null default false,
  observacao        text,
  criado_em         timestamptz not null default now(),
  criado_por        uuid references auth.users(id) on delete set null,
  unique (paciente_id)
);

create index if not exists nutricao_avaliacoes_data_idx on public.nutricao_avaliacoes(data_avaliacao);

-- ── Registro diário ───────────────────────────────────────────────────────
--
-- As vias são três colunas de porcentagem em vez de uma coluna "via": o
-- paciente pode estar em NE e VO no mesmo dia, e a planilha conta os dois.
-- Coluna nula = não recebeu por aquela via naquele dia.

create table if not exists public.nutricao_dia (
  id                  uuid primary key default uuid_generate_v4(),
  paciente_id         uuid not null references public.pacientes(id) on delete cascade,
  data                date not null,

  elegivel_tn         boolean not null default false,
  elegivel_ne         boolean not null default false,
  jejum               boolean not null default false,

  np_pct_meta         numeric(5,1),   -- nutrição parenteral: % da meta calórica
  ne_pct_meta         numeric(5,1),   -- nutrição enteral
  vo_pct_aceitacao    numeric(5,1),   -- via oral: % de aceitação
  proteica_pct        numeric(5,1),   -- % da meta proteica do dia

  intolerancia_gi_grave        boolean not null default false,
  interrupcao_nao_justificada  boolean not null default false,
  discutido_round              boolean not null default false,
  hipoglicemia_relacionada_tn  boolean not null default false,

  observacao          text,
  criado_em           timestamptz not null default now(),
  criado_por          uuid references auth.users(id) on delete set null,
  unique (paciente_id, data)
);

create index if not exists nutricao_dia_data_idx on public.nutricao_dia(data);

-- ── Diarreia: checagem de dois pontos ─────────────────────────────────────
--
-- Quem preenche o Balanço (médico) marca se a evacuação foi diarreica. A
-- nutrição pode marcar de forma independente. Duas colunas em vez de uma para
-- que a discordância seja visível em vez de a última gravação vencer.
--
-- Null = ainda não respondeu. Um marcou e o outro não respondeu → pedido de
-- confirmação aparece para o outro.
--
-- Para o indicador, conta como diarreica se QUALQUER um marcou sim: deixar de
-- detectar intolerância é pior que detectar a mais. As discordâncias aparecem
-- no painel de qualidade.
alter table public.periodos_balanco
  add column if not exists diarreica_medico   boolean,
  add column if not exists diarreica_nutricao boolean;

comment on column public.periodos_balanco.diarreica_medico is
  'Marcação de quem preenche o balanço. Null = não respondeu.';
comment on column public.periodos_balanco.diarreica_nutricao is
  'Marcação independente da nutrição. Divergência com o médico vira pendência no painel de qualidade.';

alter table public.nutricao_avaliacoes enable row level security;
alter table public.nutricao_dia        enable row level security;

drop policy if exists "Nutricao avaliacoes: autenticados" on public.nutricao_avaliacoes;
create policy "Nutricao avaliacoes: autenticados"
  on public.nutricao_avaliacoes for all to authenticated using (true) with check (true);

drop policy if exists "Nutricao dia: autenticados" on public.nutricao_dia;
create policy "Nutricao dia: autenticados"
  on public.nutricao_dia for all to authenticated using (true) with check (true);

-- ── Contagens do mês ──────────────────────────────────────────────────────

drop function if exists public.contagens_nutricao_mes(date);

create function public.contagens_nutricao_mes(p_mes date)
returns table (
  -- Avaliação e elegibilidade
  avaliados                    bigint,
  avaliados_ate_24h            bigint,
  admissoes_elegiveis_24h      bigint,
  deficit_risco                bigint,
  elegiveis_ne                 bigint,
  elegiveis_tn                 bigint,
  elegiveis_tn_receberam       bigint,
  -- Vias (pacientes-dia)
  dias_np                      bigint,
  dias_ne                      bigint,
  dias_vo                      bigint,
  dias_np_adequado             bigint,
  dias_ne_adequado             bigint,
  dias_vo_adequado             bigint,
  -- Proteica
  dias_elegiveis_tn            bigint,
  dias_proteica_adequada       bigint,
  pacientes_proteica_media_ok  bigint,
  pacientes_proteica_avaliados bigint,
  -- VM
  dias_vm_com_nutricao         bigint,
  dias_vm_nutricao_adequada    bigint,
  -- Início e jejum
  jejum_maior_24h              bigint,
  ne_iniciada_ate_48h          bigint,
  elegiveis_inicio_ne          bigint,
  -- Diarreia
  pacientes_ne                 bigint,
  pacientes_vo                 bigint,
  pacientes_diarreia_ne        bigint,
  pacientes_diarreia_vo        bigint,
  episodios_diarreia_ne        bigint,
  dias_diarreia_ne             bigint,
  -- Constipação
  constipados                  bigint,
  avaliados_constipacao        bigint,
  constipados_opioide          bigint,
  pacientes_opioide            bigint,
  constipacao_vm               bigint,
  -- Sintomas e round
  intolerancia_gi              bigint,
  interrupcao_tn               bigint,
  hipoglicemia_tn              bigint,
  dias_discutidos_round        bigint,
  -- Qualidade
  divergencias_diarreia        bigint
)
language sql
stable
security invoker
as $$
with
  bounds as (
    select p_mes as ini, (p_mes + interval '1 month')::date as fim_excl
  ),
  censo as (
    select c.* from public.censo_diario c, bounds b
     where c.dia >= b.ini and c.dia < b.fim_excl
  ),
  dia as (
    select n.* from public.nutricao_dia n, bounds b
     where n.data >= b.ini and n.data < b.fim_excl
  ),
  -- Admissões do mês que sobreviveram tempo suficiente para serem avaliadas.
  -- Flaubert: óbitos, altas e transferências precoces não entram.
  admissoes as (
    select p.id, p.data_internacao
      from public.pacientes p, bounds b
     where p.data_internacao >= b.ini and p.data_internacao < b.fim_excl
       and not exists (
         select 1 from public.resumos_alta r
          where r.paciente_id = p.id and r.tipo_saida is not null
            and (r.data_alta at time zone 'America/Sao_Paulo')::date
                < p.data_internacao + 1)
  ),
  av as (
    select a.* from public.nutricao_avaliacoes a
     where exists (select 1 from censo c where c.paciente_id = a.paciente_id)
  ),
  -- Dias em VM vêm do Ventilatório: a nutrição não redigita.
  vm_dias as (
    select distinct sv.paciente_id, sv.data as dia
      from public.suportes_ventilatorios sv, bounds b
     where sv.modalidade = 'ventilacao_mecanica'
       and sv.data >= b.ini and sv.data < b.fim_excl
  ),
  -- Diarreia: conta se qualquer um dos dois marcou sim.
  balanco as (
    select pb.paciente_id,
           (pb.inicio at time zone 'America/Sao_Paulo')::date as dia,
           pb.evacuacao,
           coalesce(pb.diarreica_medico, false) or coalesce(pb.diarreica_nutricao, false) as diarreica,
           pb.diarreica_medico is not null and pb.diarreica_nutricao is not null
             and pb.diarreica_medico <> pb.diarreica_nutricao as divergente
      from public.periodos_balanco pb, bounds b
     where (pb.inicio at time zone 'America/Sao_Paulo')::date >= b.ini
       and (pb.inicio at time zone 'America/Sao_Paulo')::date <  b.fim_excl
  ),
  dias_diarreia as (
    select distinct paciente_id, dia from balanco where diarreica
  ),
  -- Episódio clínico: intervalo maior que 48h sem diarreia abre um novo.
  episodios as (
    select paciente_id, dia,
           dia - lag(dia) over (partition by paciente_id order by dia) as intervalo
      from dias_diarreia
  ),
  opioide as (
    select ch.paciente_id from public.cuidados_horizontais ch where ch.opioide_em_uso
    union
    select a.paciente_id
      from public.auditoria_intensivista a, bounds b
     where a.tabela = 'cuidados_horizontais'
       and (a.dados_novos->>'opioide_em_uso')::boolean
       and (a.changed_at at time zone 'America/Sao_Paulo')::date >= b.ini
       and (a.changed_at at time zone 'America/Sao_Paulo')::date <  b.fim_excl
  ),
  -- Constipação: 72h sem evacuar. Derivado do Balanço, não digitado.
  evacuacoes as (
    select paciente_id, dia from balanco where evacuacao > 0
  ),
  intervalos as (
    select paciente_id,
           dia - lag(dia) over (partition by paciente_id order by dia) as gap
      from evacuacoes
  ),
  constipados_set as (
    select distinct paciente_id from intervalos where gap > 3
  ),
  -- Primeiro dia de TN e de elegibilidade, para início de NE e jejum.
  marcos as (
    select paciente_id,
           min(data) filter (where ne_pct_meta is not null)                    as primeiro_ne,
           min(data) filter (where elegivel_ne)                                as primeiro_elegivel_ne,
           min(data) filter (where np_pct_meta is not null or ne_pct_meta is not null) as primeiro_tn,
           count(*) filter (where jejum)                                       as dias_jejum
      from dia group by paciente_id
  ),
  proteica as (
    select paciente_id, avg(proteica_pct) as media
      from dia where elegivel_tn and proteica_pct is not null
     group by paciente_id
  )
select
  (select count(*) from av),
  (select count(*) from av a join admissoes ad on ad.id = a.paciente_id
    where a.data_avaliacao <= ad.data_internacao + 1),
  (select count(*) from admissoes),
  (select count(*) from av where risco_nutricional or deficit),
  (select count(distinct paciente_id) from dia where elegivel_ne),
  (select count(distinct paciente_id) from dia where elegivel_tn),
  (select count(distinct paciente_id) from dia
    where elegivel_tn and (np_pct_meta is not null or ne_pct_meta is not null)),
  (select count(*) from dia where np_pct_meta is not null),
  (select count(*) from dia where ne_pct_meta is not null),
  (select count(*) from dia where vo_pct_aceitacao is not null),
  (select count(*) from dia where np_pct_meta > 70),
  (select count(*) from dia where ne_pct_meta > 70),
  (select count(*) from dia where vo_pct_aceitacao > 60),
  (select count(*) from dia where elegivel_tn),
  (select count(*) from dia where elegivel_tn and proteica_pct >= 80),
  (select count(*) from proteica where media >= 80),
  (select count(*) from proteica),
  (select count(*) from dia d join vm_dias v on v.paciente_id = d.paciente_id and v.dia = d.data
    where d.np_pct_meta is not null or d.ne_pct_meta is not null or d.vo_pct_aceitacao is not null),
  (select count(*) from dia d join vm_dias v on v.paciente_id = d.paciente_id and v.dia = d.data
    where d.np_pct_meta > 70 or d.ne_pct_meta > 70 or d.vo_pct_aceitacao > 60),
  -- Jejum >24h antes da TN: 2+ dias de jejum e TN começando depois.
  (select count(*) from marcos where dias_jejum >= 2
     and (primeiro_tn is null or primeiro_tn > (select min(data) from dia d where d.paciente_id = marcos.paciente_id))),
  (select count(*) from marcos
    where primeiro_ne is not null and primeiro_elegivel_ne is not null
      and primeiro_ne - primeiro_elegivel_ne <= 2),
  (select count(*) from marcos where primeiro_elegivel_ne is not null),
  (select count(distinct paciente_id) from dia where ne_pct_meta is not null),
  (select count(distinct paciente_id) from dia where vo_pct_aceitacao is not null),
  (select count(distinct d.paciente_id) from dias_diarreia d
    where exists (select 1 from dia n where n.paciente_id = d.paciente_id and n.data = d.dia and n.ne_pct_meta is not null)),
  (select count(distinct d.paciente_id) from dias_diarreia d
    where exists (select 1 from dia n where n.paciente_id = d.paciente_id and n.data = d.dia and n.vo_pct_aceitacao is not null)),
  (select count(*) from episodios e
    where (e.intervalo is null or e.intervalo > 2)
      and exists (select 1 from dia n where n.paciente_id = e.paciente_id and n.data = e.dia and n.ne_pct_meta is not null)),
  (select count(*) from dias_diarreia d
    where exists (select 1 from dia n where n.paciente_id = d.paciente_id and n.data = d.dia and n.ne_pct_meta is not null)),
  (select count(*) from constipados_set),
  (select count(distinct paciente_id) from balanco),
  (select count(*) from constipados_set c where exists (select 1 from opioide o where o.paciente_id = c.paciente_id)),
  (select count(*) from opioide o where exists (select 1 from censo c where c.paciente_id = o.paciente_id)),
  (select count(*) from constipados_set c where exists (select 1 from vm_dias v where v.paciente_id = c.paciente_id)),
  (select count(distinct paciente_id) from dia where intolerancia_gi_grave),
  (select count(distinct paciente_id) from dia where interrupcao_nao_justificada),
  (select count(distinct paciente_id) from dia where hipoglicemia_relacionada_tn),
  (select count(*) from dia where discutido_round),
  (select count(*) from balanco where divergente)
$$;

revoke all on function public.contagens_nutricao_mes(date) from public, anon;
grant execute on function public.contagens_nutricao_mes(date) to authenticated;
