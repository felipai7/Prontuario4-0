-- ══════════════════════════════════════════════════════════════════════════
-- INDICADORES — FASE 1
-- Captura de admissão/saída + contagens mensais.
--
-- Roda no SQL Editor do Supabase ou via `supabase db query --linked --file`.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Campos novos ───────────────────────────────────────────────────────

-- Oncológico: par do `paliativo`, denominador da mortalidade em oncológicos.
alter table public.pacientes
  add column if not exists oncologico boolean not null default false;

-- Liga a internação atual à alta anterior do mesmo paciente (reinternação).
-- Nulo = primeira internação. O intervalo <48h/<30d é derivado, nunca digitado.
alter table public.pacientes
  add column if not exists readmissao_de uuid references public.resumos_alta(id) on delete set null;

-- Corticoide e opioide: mesmo padrão do IBP/anticoagulante (estado atual).
-- O histórico "usou em algum momento do mês" sai da auditoria_intensivista.
alter table public.cuidados_horizontais
  add column if not exists corticoide_em_uso boolean not null default false,
  add column if not exists opioide_em_uso    boolean not null default false;

-- Tipo de saída: a peça que faltava para todo o bloco de mortalidade.
-- Transferência entra em "saídas" (denominador), conforme definição do Dr. Flaubert:
-- "Mortalidade UTI = óbitos na UTI / todas as saídas, incluindo transferências".
alter table public.resumos_alta
  add column if not exists tipo_saida text
    check (tipo_saida in ('alta', 'obito', 'transferencia'));

-- resumos_alta só se ligava ao paciente via paciente_snapshot->>'id'. FK de verdade.
-- on delete set null: apagar o paciente não pode apagar o registro de saída.
alter table public.resumos_alta
  add column if not exists paciente_id uuid references public.pacientes(id) on delete set null;

update public.resumos_alta
   set paciente_id = (paciente_snapshot->>'id')::uuid
 where paciente_id is null
   and paciente_snapshot->>'id' is not null;

create index if not exists resumos_alta_paciente_id_idx on public.resumos_alta(paciente_id);
create index if not exists resumos_alta_data_alta_idx   on public.resumos_alta(data_alta);
create index if not exists pacientes_data_internacao_idx on public.pacientes(data_internacao);

-- ── 2. SAPS 3 → mortalidade esperada ──────────────────────────────────────

-- Equação SAPS 3 customizada para Central-South America
-- (Moreno et al., Intensive Care Med 2005;31:1345-55).
--
-- ATENÇÃO: as fontes publicam a constante SEM o sinal negativo. Com sinal
-- positivo a curva satura em ~100% para qualquer escore, o que produz SMR
-- absurdamente baixo sem quebrar nada. O sinal negativo abaixo foi deduzido
-- pela forma da curva (escore 30 → 2,9% | 50 → 24,4% | 70 → 70,9% | 90 → 93,3%).
--
-- PENDENTE DE VALIDAÇÃO: comparar com casos reais já pontuados pelo Dr. Flaubert
-- antes de considerar o SMR confiável.
create or replace function public.saps3_mortalidade_esperada(p_score numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_score is null or p_score < 0 then null
    else exp(-64.5990 + ln(p_score + 71.0599) * 13.2322)
       / (1 + exp(-64.5990 + ln(p_score + 71.0599) * 13.2322))
  end
$$;

-- ── 3. Contagens do mês ───────────────────────────────────────────────────

-- Devolve UMA linha com as contagens brutas do mês — o equivalente à linha da
-- aba "Dados Mensais" da planilha do Dr. Flaubert, para conferência lado a lado.
-- As fórmulas (razões/percentuais) ficam no TypeScript, não aqui.
--
-- Leitos-dia e nº de leitos NÃO saem daqui: vêm de lib/config.ts (fonte única).
--
-- Convenção de pacientes-dia: o dia da admissão conta, o dia da saída não.
-- Dias futuros nunca contam (mês corrente fecha em current_date).
--
-- O drop é necessário para a migração ser re-executável: `create or replace`
-- não muda o tipo de retorno quando as colunas de OUT mudam.
drop function if exists public.contagens_mes(date);

create function public.contagens_mes(p_mes date)
returns table (
  pacientes_dia                            bigint,
  admissoes                                bigint,
  saidas                                   bigint,
  saidas_altas                             bigint,
  saidas_obitos                            bigint,
  saidas_transferencias                    bigint,
  dias_permanencia_saidas                  bigint,
  obitos_ate_24h                           bigint,
  obitos_apos_24h                          bigint,
  obitos_paliativos                        bigint,
  saidas_paliativos                        bigint,
  obitos_oncologicos                       bigint,
  saidas_oncologicos                       bigint,
  soma_mortalidade_esperada                numeric,
  saidas_com_saps3                         bigint,
  obitos_com_saps3                         bigint,
  reinternacoes_48h                        bigint,
  reinternacoes_30d                        bigint,
  pacientes_internados_mes                 bigint,
  ventilador_dia                           bigint,
  pacientes_hemodialise                    bigint,
  pacientes_hipoglicemia                   bigint,
  pacientes_hiperglicemia                  bigint,
  pacientes_monitorados_glicemia           bigint,
  pacientes_disfuncao_glicemica            bigint,
  pacientes_disfuncao_glicemica_corticoide bigint
)
language sql
stable
security invoker
as $$
with
  bounds as (
    select p_mes as ini,
           (p_mes + interval '1 month')::date as fim_excl,
           least((p_mes + interval '1 month' - interval '1 day')::date, current_date) as ultimo_dia
  ),
  dias as (
    select generate_series(b.ini, b.ultimo_dia, '1 day')::date as dia
      from bounds b
     where b.ini <= b.ultimo_dia
  ),
  -- Uma linha de `pacientes` = uma internação (a reinternação cria paciente novo).
  estadias as (
    select p.id,
           p.data_internacao as entrada,
           (select (r.data_alta at time zone 'America/Sao_Paulo')::date
              from public.resumos_alta r
             where r.paciente_id = p.id and r.tipo_saida is not null
             order by r.data_alta desc
             limit 1) as saida
      from public.pacientes p
  ),
  censo as (
    select d.dia, e.id
      from dias d
      join estadias e
        on d.dia >= e.entrada
       and (e.saida is null or d.dia < e.saida)
  ),
  -- Saídas do mês, com o instante exato da admissão para o corte de <24h.
  saidas_mes as (
    select r.id,
           r.tipo_saida,
           r.data_alta,
           r.data_internacao,
           ((r.data_internacao::text || ' ' ||
             coalesce(substring(r.paciente_snapshot->>'hora_internacao' from 1 for 5), '12:00')
             || ':00')::timestamp at time zone 'America/Sao_Paulo') as admissao_ts,
           coalesce((r.paciente_snapshot->>'paliativo')::boolean, false)  as paliativo,
           coalesce((r.paciente_snapshot->>'oncologico')::boolean, false) as oncologico,
           nullif(r.paciente_snapshot->>'saps3', '')::numeric            as saps3
      from public.resumos_alta r, bounds b
     where r.tipo_saida is not null
       and (r.data_alta at time zone 'America/Sao_Paulo')::date >= b.ini
       and (r.data_alta at time zone 'America/Sao_Paulo')::date <  b.fim_excl
  ),
  -- Reinternações: admitidos no mês que apontam para uma alta anterior.
  reinternacoes as (
    select extract(epoch from (
             ((p.data_internacao + coalesce(p.hora_internacao, time '12:00'))
                at time zone 'America/Sao_Paulo')
             - ant.data_alta)) / 3600.0 as horas_desde_alta
      from public.pacientes p
      join public.resumos_alta ant on ant.id = p.readmissao_de
         , bounds b
     where p.data_internacao >= b.ini
       and p.data_internacao <  b.fim_excl
  ),
  glicemia as (
    select sv.paciente_id,
           bool_or(sv.hgt is not null)  as monitorado,
           bool_or(sv.hgt < 70)         as hipo,
           bool_or(sv.hgt > 180)        as hiper
      from public.sinais_vitais sv, bounds b
     where (sv.horario at time zone 'America/Sao_Paulo')::date >= b.ini
       and (sv.horario at time zone 'America/Sao_Paulo')::date <  b.fim_excl
     group by sv.paciente_id
  ),
  -- Corticoide: em uso agora OU marcado como em uso em algum momento do mês
  -- (a auditoria registra cada mudança do campo).
  corticoide as (
    select ch.paciente_id
      from public.cuidados_horizontais ch
     where ch.corticoide_em_uso
    union
    select a.paciente_id
      from public.auditoria_intensivista a, bounds b
     where a.tabela = 'cuidados_horizontais'
       and (a.dados_novos->>'corticoide_em_uso')::boolean
       and (a.changed_at at time zone 'America/Sao_Paulo')::date >= b.ini
       and (a.changed_at at time zone 'America/Sao_Paulo')::date <  b.fim_excl
  )
select
  (select count(*) from censo),
  (select count(*) from public.pacientes p, bounds b
    where p.data_internacao >= b.ini and p.data_internacao < b.fim_excl),
  (select count(*) from saidas_mes),
  (select count(*) from saidas_mes where tipo_saida = 'alta'),
  (select count(*) from saidas_mes where tipo_saida = 'obito'),
  (select count(*) from saidas_mes where tipo_saida = 'transferencia'),
  (select coalesce(sum((data_alta at time zone 'America/Sao_Paulo')::date - data_internacao), 0)
     from saidas_mes),
  (select count(*) from saidas_mes
    where tipo_saida = 'obito' and data_alta < admissao_ts + interval '24 hours'),
  (select count(*) from saidas_mes
    where tipo_saida = 'obito' and data_alta >= admissao_ts + interval '24 hours'),
  (select count(*) from saidas_mes where tipo_saida = 'obito' and paliativo),
  (select count(*) from saidas_mes where paliativo),
  (select count(*) from saidas_mes where tipo_saida = 'obito' and oncologico),
  (select count(*) from saidas_mes where oncologico),
  (select coalesce(sum(public.saps3_mortalidade_esperada(saps3)), 0) from saidas_mes where saps3 is not null),
  (select count(*) from saidas_mes where saps3 is not null),
  -- Numerador do SMR: só os óbitos de quem tem SAPS 3, para observado e esperado
  -- virem da MESMA população. Contar todos os óbitos contra um denominador
  -- parcial infla o SMR — e aqui o SAPS 3 é opcional, então falta é o normal.
  (select count(*) from saidas_mes where tipo_saida = 'obito' and saps3 is not null),
  (select count(*) from reinternacoes where horas_desde_alta < 48),
  (select count(*) from reinternacoes where horas_desde_alta < 24 * 30),
  (select count(distinct id) from censo),
  (select count(*) from (
     select distinct sv.paciente_id, sv.data
       from public.suportes_ventilatorios sv, bounds b
      where sv.modalidade = 'ventilacao_mecanica'
        and sv.data >= b.ini and sv.data < b.fim_excl) t),
  (select count(distinct pb.paciente_id) from public.periodos_balanco pb, bounds b
    where pb.dialise > 0
      and (pb.inicio at time zone 'America/Sao_Paulo')::date >= b.ini
      and (pb.inicio at time zone 'America/Sao_Paulo')::date <  b.fim_excl),
  (select count(*) from glicemia where hipo),
  (select count(*) from glicemia where hiper),
  (select count(*) from glicemia where monitorado),
  (select count(*) from glicemia where hipo or hiper),
  (select count(*) from glicemia g where (g.hipo or g.hiper)
     and exists (select 1 from corticoide c where c.paciente_id = g.paciente_id))
$$;

-- A tela /indicadores é restrita ao chefe (Médico Intensivista) pela UI, no mesmo
-- modelo de confiança do resto do app: o banco aceita a chamada de qualquer
-- usuário autenticado. Trocar isso por um guard de `staff.role = 'chefe'` aqui é
-- possível, mas travaria quem ainda não tem registro em `staff`.
revoke all on function public.contagens_mes(date) from public, anon;
grant execute on function public.contagens_mes(date) to authenticated;
