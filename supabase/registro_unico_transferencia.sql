-- ══════════════════════════════════════════════════════════════════════════
-- TRANSFERÊNCIA UTI ↔ HOSPITAL COM PACIENTE ÚNICO
--
-- Substitui a tentativa anterior (paciente novo por unidade, ligado por
-- origem_uti_alta_id — ver transferencia_hospital.sql/historico_origem.sql,
-- nunca aplicadas). Naquele desenho o histórico clínico ficava preso no
-- registro antigo: a ficha nova nascia vazia. Aqui o paciente é UM SÓ
-- registro do início ao fim — transferir só move unit_id/ala_id/
-- numero_leito do mesmo paciente, então todas as 21 tabelas filhas
-- (exames, periodos_balanco, sinais_vitais...) continuam funcionando
-- exatamente como já funcionam, porque é o mesmo paciente_id de sempre.
--
-- O preço disso: censo_diario (multiunidade_2_rls.sql) carimba CADA DIA da
-- internação com o unit_id ATUAL do paciente. Sem correção, transferir
-- reescreveria retroativamente a ocupação/admissões de meses já fechados
-- da UTI. A correção é uma tabela de histórico de unidade POR PERÍODO,
-- mantida por trigger, que censo_diario e mais duas contagens (que tinham
-- o mesmo problema, achadas por grep: admissões/reinternações em
-- contagens_mes, e admissões em contagens_nutricao_mes) passam a usar.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1a. Ala de trânsito ("rotativo") ────────────────────────────────────────
alter table public.alas add column if not exists rotativo boolean not null default false;

comment on column public.alas.rotativo is
  'Ala de trânsito (leito suspenso): só recebe paciente por transferir_paciente, some do indicador enquanto o paciente está nela, e o dashboard só a mostra com >=1 paciente.';

-- ── 1b. Tipo de unidade (decide módulos/rótulos no frontend) ───────────────
alter table public.units add column if not exists tipo_unidade text not null default 'uti'
  check (tipo_unidade in ('uti', 'enfermaria'));

comment on column public.units.tipo_unidade is
  'uti = 5 módulos com nomes atuais. enfermaria = só Médico + Internos (renomeados), Enfermagem realocada dentro de Internos. Ver lib/modules.tsx.';

-- ── 1c/1d/1e. Histórico de unidade por período + trigger + backfill ────────
create table public.pacientes_unidades_historico (
  id              uuid primary key default uuid_generate_v4(),
  paciente_id     uuid not null references public.pacientes(id) on delete cascade,
  unit_id         uuid not null references public.units(id),
  ala_id          text not null,
  -- Congelado no momento do período — nunca junta com alas.rotativo "ao
  -- vivo": se a marcação da ala mudasse depois, períodos passados não podem
  -- mudar de categoria retroativamente.
  conta_indicador boolean not null,
  desde           timestamptz not null,
  ate             timestamptz,
  created_at      timestamptz not null default now()
);

create unique index pacientes_unidades_historico_aberto_idx
  on public.pacientes_unidades_historico(paciente_id) where ate is null;
create index pacientes_unidades_historico_paciente_idx
  on public.pacientes_unidades_historico(paciente_id, desde);

comment on table public.pacientes_unidades_historico is
  'Um período por trecho em que o paciente ficou numa unidade/ala. Fonte única de "qual unidade valia em cada dia" para censo_diario e as contagens de admissão/reinternação — nunca ler pacientes.unit_id direto para isso, ele é só a localização ATUAL.';

alter table public.pacientes_unidades_historico enable row level security;
create policy "Equipe da unidade - historico periodos"
on public.pacientes_unidades_historico for select to authenticated
using (public.sou_da_unidade(unit_id));

create or replace function public.pacientes_registra_periodo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conta boolean;
begin
  if TG_OP = 'INSERT' then
    select not coalesce(a.rotativo, false) into v_conta
      from public.alas a where a.unit_id = new.unit_id and a.codigo = new.ala_id;
    insert into public.pacientes_unidades_historico (paciente_id, unit_id, ala_id, conta_indicador, desde)
    values (
      new.id, new.unit_id, new.ala_id, coalesce(v_conta, true),
      ((new.data_internacao + coalesce(new.hora_internacao, time '12:00'))
         at time zone 'America/Sao_Paulo')
    );
    return new;
  end if;

  if TG_OP = 'UPDATE'
     and (new.unit_id is distinct from old.unit_id or new.ala_id is distinct from old.ala_id) then
    update public.pacientes_unidades_historico
       set ate = now()
     where paciente_id = new.id and ate is null;

    select not coalesce(a.rotativo, false) into v_conta
      from public.alas a where a.unit_id = new.unit_id and a.codigo = new.ala_id;

    insert into public.pacientes_unidades_historico (paciente_id, unit_id, ala_id, conta_indicador, desde)
    values (new.id, new.unit_id, new.ala_id, coalesce(v_conta, true), now());
  end if;

  return new;
end $$;

drop trigger if exists trg_pacientes_registra_periodo on public.pacientes;
create trigger trg_pacientes_registra_periodo
  after insert or update of unit_id, ala_id on public.pacientes
  for each row execute function public.pacientes_registra_periodo();

comment on function public.pacientes_registra_periodo() is
  'Mantém pacientes_unidades_historico sozinho — nenhuma tela precisa lembrar de gravar histórico ao transferir ou finalizar admissão.';

-- Backfill: pacientes já existentes ganham o período inicial na unidade atual.
insert into public.pacientes_unidades_historico (paciente_id, unit_id, ala_id, conta_indicador, desde)
select p.id, p.unit_id, p.ala_id,
       not coalesce((select a.rotativo from public.alas a
                       where a.unit_id = p.unit_id and a.codigo = p.ala_id), false),
       ((p.data_internacao + coalesce(p.hora_internacao, time '12:00')) at time zone 'America/Sao_Paulo')
  from public.pacientes p
 where not exists (
   select 1 from public.pacientes_unidades_historico h where h.paciente_id = p.id);

-- ── 1f. censo_diario passa a respeitar o histórico por período ─────────────
--
-- Duas mudanças em relação à versão anterior (multiunidade_2_rls.sql):
-- 1. O limite inferior da série de dias vira o PRIMEIRO período do paciente
--    (min(desde)), não pacientes.data_internacao — porque finalizar_admissao
--    pode reescrever data_internacao (é a admissão da unidade ATUAL, depois
--    de sair do rotativo), e isso não pode encolher retroativamente os dias
--    já censados antes da correção.
-- 2. O limite superior para quando a série pára: enquanto pacientes.ativo,
--    vai até hoje (mesmo tendo passado por uma transferência no meio,
--    que grava resumos_alta mas não desativa o paciente); só pára na
--    última alta REAL quando o paciente não está mais ativo.
-- 3. Cada dia busca, no histórico, qual período estava vigente e SÓ ENTRA
--    se esse período tinha conta_indicador=true (join, não left join —
--    dias na ala rotativo somem da série, de propósito).
create or replace view public.censo_diario
with (security_invoker = true) as
select p.id as paciente_id, d.dia::date as dia, h.unit_id
  from public.pacientes p
  cross join lateral generate_series(
    coalesce(
      (select (min(h0.desde) at time zone 'America/Sao_Paulo')::date
         from public.pacientes_unidades_historico h0 where h0.paciente_id = p.id),
      p.data_internacao),
    least(
      case when p.ativo then current_date
           else coalesce(
             (select (r.data_alta at time zone 'America/Sao_Paulo')::date - 1
                from public.resumos_alta r
               where r.paciente_id = p.id and r.tipo_saida is not null
               order by r.data_alta desc
               limit 1),
             current_date)
      end,
      current_date),
    interval '1 day') as d(dia)
  join lateral (
    select h.unit_id
      from public.pacientes_unidades_historico h
     where h.paciente_id = p.id
       and (h.desde at time zone 'America/Sao_Paulo')::date <= d.dia
       and (h.ate is null or d.dia < (h.ate at time zone 'America/Sao_Paulo')::date)
       and h.conta_indicador
     order by h.desde desc
     limit 1
  ) h on true;

comment on view public.censo_diario is
  'Uma linha por (paciente, dia internado, unidade daquele dia). Fonte única de pacientes-dia para contagens_mes/qualidade_mes/contagens_nutricao_mes. security_invoker: respeita o RLS de quem chama. Dias na ala rotativo não aparecem aqui.';

-- ── 1g. Corrigir as 2 contagens de contagens_mes que liam unit_id ao vivo ──
--
-- admissoes e reinternacoes liam `from public.pacientes p` — sob RLS
-- (security invoker), isso filtra pela unidade ATUAL do paciente, não pela
-- unidade em que ele foi de fato admitido/readmitido. Um paciente admitido
-- na UTI em julho e transferido em setembro sumiria da contagem de
-- admissões de julho da UTI. Correção: ler o PRIMEIRO período do paciente
-- em pacientes_unidades_historico (congelado, correto historicamente).
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
    select p_mes as ini, (p_mes + interval '1 month')::date as fim_excl
  ),
  censo as (
    select c.paciente_id as id, c.dia
      from public.censo_diario c, bounds b
     where c.dia >= b.ini and c.dia < b.fim_excl
  ),
  primeiros_periodos as (
    select h.paciente_id, h.unit_id, h.desde
      from public.pacientes_unidades_historico h
     where not exists (
       select 1 from public.pacientes_unidades_historico h2
        where h2.paciente_id = h.paciente_id and h2.desde < h.desde)
  ),
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
  -- Reinternações: primeiro período do mês que aponta para uma alta anterior.
  reinternacoes as (
    select extract(epoch from (pp.desde - ant.data_alta)) / 3600.0 as horas_desde_alta
      from primeiros_periodos pp
      join public.pacientes p on p.id = pp.paciente_id
      join public.resumos_alta ant on ant.id = p.readmissao_de
         , bounds b
     where (pp.desde at time zone 'America/Sao_Paulo')::date >= b.ini
       and (pp.desde at time zone 'America/Sao_Paulo')::date <  b.fim_excl
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
  (select count(*) from primeiros_periodos pp, bounds b
    where (pp.desde at time zone 'America/Sao_Paulo')::date >= b.ini
      and (pp.desde at time zone 'America/Sao_Paulo')::date < b.fim_excl),
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

revoke all on function public.contagens_mes(date) from public, anon;
grant execute on function public.contagens_mes(date) to authenticated;

-- ── 1g (cont.). Mesma correção em contagens_nutricao_mes ───────────────────
drop function if exists public.contagens_nutricao_mes(date);

create function public.contagens_nutricao_mes(p_mes date)
returns table (
  avaliados                    bigint,
  avaliados_ate_24h            bigint,
  admissoes_elegiveis_24h      bigint,
  deficit_risco                bigint,
  elegiveis_ne                 bigint,
  elegiveis_tn                 bigint,
  elegiveis_tn_receberam       bigint,
  dias_np                      bigint,
  dias_ne                      bigint,
  dias_vo                      bigint,
  dias_np_adequado             bigint,
  dias_ne_adequado             bigint,
  dias_vo_adequado             bigint,
  dias_elegiveis_tn            bigint,
  dias_proteica_adequada       bigint,
  pacientes_proteica_media_ok  bigint,
  pacientes_proteica_avaliados bigint,
  dias_vm_com_nutricao         bigint,
  dias_vm_nutricao_adequada    bigint,
  jejum_maior_24h              bigint,
  ne_iniciada_ate_48h          bigint,
  elegiveis_inicio_ne          bigint,
  pacientes_ne                 bigint,
  pacientes_vo                 bigint,
  pacientes_diarreia_ne        bigint,
  pacientes_diarreia_vo        bigint,
  episodios_diarreia_ne        bigint,
  dias_diarreia_ne             bigint,
  constipados                  bigint,
  avaliados_constipacao        bigint,
  constipados_opioide          bigint,
  pacientes_opioide            bigint,
  constipacao_vm               bigint,
  intolerancia_gi              bigint,
  interrupcao_tn               bigint,
  hipoglicemia_tn              bigint,
  dias_discutidos_round        bigint,
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
  -- Admissões do mês (primeiro período de cada paciente) que sobreviveram
  -- tempo suficiente pra serem avaliadas. Flaubert: óbitos, altas e
  -- transferências precoces não entram.
  admissoes as (
    select h.paciente_id as id, (h.desde at time zone 'America/Sao_Paulo')::date as data_internacao
      from public.pacientes_unidades_historico h, bounds b
     where not exists (
             select 1 from public.pacientes_unidades_historico h2
              where h2.paciente_id = h.paciente_id and h2.desde < h.desde)
       and (h.desde at time zone 'America/Sao_Paulo')::date >= b.ini
       and (h.desde at time zone 'America/Sao_Paulo')::date <  b.fim_excl
       and not exists (
         select 1 from public.resumos_alta r
          where r.paciente_id = h.paciente_id and r.tipo_saida is not null
            and (r.data_alta at time zone 'America/Sao_Paulo')::date
                < (h.desde at time zone 'America/Sao_Paulo')::date + 1)
  ),
  av as (
    select a.* from public.nutricao_avaliacoes a
     where exists (select 1 from censo c where c.paciente_id = a.paciente_id)
  ),
  vm_dias as (
    select distinct sv.paciente_id, sv.data as dia
      from public.suportes_ventilatorios sv, bounds b
     where sv.modalidade = 'ventilacao_mecanica'
       and sv.data >= b.ini and sv.data < b.fim_excl
  ),
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

-- ── 1h. Leitos-dia/leitos ativos não contam a ala de trânsito ──────────────
create or replace function public.leitos_dia_mes(p_unit_id uuid, p_mes date)
returns bigint
language sql
stable
security invoker
as $$
  with dias as (
    select d::date as dia
      from generate_series(
             p_mes,
             least((p_mes + interval '1 month' - interval '1 day')::date, current_date),
             interval '1 day') d
  )
  select coalesce(count(*), 0)
    from dias
    join public.leitos l on l.ativo_desde <= dias.dia
                        and (l.ativo_ate is null or l.ativo_ate >= dias.dia)
    join public.alas  a on a.id = l.ala_id and a.ativa and not a.rotativo
   where a.unit_id = p_unit_id;
$$;

create or replace function public.leitos_ativos(p_unit_id uuid, p_dia date default current_date)
returns integer
language sql
stable
security invoker
as $$
  select coalesce(count(*), 0)::integer
    from public.leitos l
    join public.alas a on a.id = l.ala_id and a.ativa and not a.rotativo
   where a.unit_id = p_unit_id
     and l.ativo_desde <= p_dia
     and (l.ativo_ate is null or l.ativo_ate >= p_dia);
$$;

-- ── 2. Transferência (bidirecional, sempre via rotativo) ────────────────────
create or replace function public.transferir_paciente(p_paciente_id uuid, p_unit_destino uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paciente record;
  v_ala_rotativo text;
  v_leito text;
begin
  if not public.posso_ver_paciente(p_paciente_id) then
    raise exception 'Você não pode acessar este paciente.';
  end if;

  if not public.sou_da_unidade(p_unit_destino) then
    raise exception 'Você não é staff da unidade destino.';
  end if;

  select * into v_paciente from public.pacientes where id = p_paciente_id and ativo;
  if not found then
    raise exception 'Paciente não encontrado ou não está ativo.';
  end if;

  if v_paciente.unit_id = p_unit_destino then
    raise exception 'Paciente já está nesta unidade.';
  end if;

  select a.codigo into v_ala_rotativo
    from public.alas a where a.unit_id = p_unit_destino and a.rotativo and a.ativa
   limit 1;
  if v_ala_rotativo is null then
    raise exception 'A unidade destino não tem uma ala de trânsito (rotativo) configurada.';
  end if;

  select l.numero into v_leito
    from public.leitos l
    join public.alas a on a.id = l.ala_id
   where a.unit_id = p_unit_destino and a.codigo = v_ala_rotativo
     and l.ativo_desde <= current_date and (l.ativo_ate is null or l.ativo_ate >= current_date)
     and not exists (
       select 1 from public.pacientes p
        where p.unit_id = p_unit_destino and p.ala_id = v_ala_rotativo
          and p.numero_leito = l.numero and p.ativo)
   order by l.numero
   limit 1;

  if v_leito is null then
    raise exception 'Sem leito livre na ala de trânsito da unidade destino.';
  end if;

  -- Antes do update de unit_id: herda a unidade de ORIGEM via
  -- resumos_alta_herda_unidade (multiunidade_2_rls.sql), fechando as contas
  -- de saída/SMR da UTI daquele mês exatamente como uma alta de verdade.
  insert into public.resumos_alta (
    paciente_nome, data_internacao, paciente_snapshot, tipo_saida, paciente_id, data_alta
  ) values (
    v_paciente.nome, v_paciente.data_internacao, to_jsonb(v_paciente), 'transferencia', v_paciente.id, now()
  );

  update public.pacientes
     set unit_id = p_unit_destino, ala_id = v_ala_rotativo, numero_leito = v_leito
   where id = p_paciente_id;
end $$;

comment on function public.transferir_paciente(uuid, uuid) is
  'Transfere o paciente (mesmo registro) para a ala de trânsito da unidade destino. Gera resumos_alta tipo_saida=transferencia, igual uma alta, sem desativar o paciente — pacientes.ativo nunca muda aqui.';

revoke all on function public.transferir_paciente(uuid, uuid) from public;
grant execute on function public.transferir_paciente(uuid, uuid) to authenticated;

-- ── 3. Finalizar admissão (sair do rotativo pro leito definitivo) ──────────
create or replace function public.finalizar_admissao(
  p_paciente_id uuid,
  p_ala_destino text,
  p_numero_leito text,
  p_data_internacao date,
  p_hora_internacao time,
  p_saps3 integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paciente record;
  v_ala_atual_rotativo boolean;
  v_ala_destino_rotativo boolean;
  v_ocupado boolean;
begin
  if not public.posso_ver_paciente(p_paciente_id) then
    raise exception 'Você não pode acessar este paciente.';
  end if;

  select * into v_paciente from public.pacientes where id = p_paciente_id and ativo;
  if not found then
    raise exception 'Paciente não encontrado ou não está ativo.';
  end if;

  select a.rotativo into v_ala_atual_rotativo
    from public.alas a where a.unit_id = v_paciente.unit_id and a.codigo = v_paciente.ala_id;
  if not coalesce(v_ala_atual_rotativo, false) then
    raise exception 'Este paciente não está numa ala de trânsito.';
  end if;

  select a.rotativo into v_ala_destino_rotativo
    from public.alas a where a.unit_id = v_paciente.unit_id and a.codigo = p_ala_destino;
  if coalesce(v_ala_destino_rotativo, false) then
    raise exception 'O leito definitivo não pode ser na própria ala de trânsito.';
  end if;

  select exists (
    select 1 from public.pacientes p
     where p.unit_id = v_paciente.unit_id and p.ala_id = p_ala_destino
       and p.numero_leito = p_numero_leito and p.ativo and p.id <> p_paciente_id
  ) into v_ocupado;
  if v_ocupado then
    raise exception 'Leito ocupado.';
  end if;

  update public.pacientes
     set ala_id = p_ala_destino,
         numero_leito = p_numero_leito,
         data_internacao = p_data_internacao,
         hora_internacao = p_hora_internacao,
         saps3 = coalesce(p_saps3, saps3),
         saps3_calculado_em = case when p_saps3 is not null then now() else saps3_calculado_em end
   where id = p_paciente_id;
end $$;

comment on function public.finalizar_admissao(uuid, text, text, date, time, integer) is
  'Move o paciente da ala de trânsito para um leito definitivo NA MESMA unidade, corrigindo data/hora de admissão e SAPS-3 — é a admissão de verdade daquela unidade (ver decisão 4 do plano).';

revoke all on function public.finalizar_admissao(uuid, text, text, date, time, integer) from public;
grant execute on function public.finalizar_admissao(uuid, text, text, date, time, integer) to authenticated;

-- ── 4 (apoio). Histórico de internações — visível a qualquer staff que já
-- vê o paciente, mesmo que algum período tenha sido em unidade que não é a
-- ativa da sessão agora. security definer contorna a exigência de unidade
-- ativa de propósito — autorização real é posso_ver_paciente. ────────────
create or replace function public.buscar_historico_paciente(p_paciente_id uuid)
returns table (
  unit_id uuid, unit_nome text, ala_id text, conta_indicador boolean, desde timestamptz, ate timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select h.unit_id, u.name, h.ala_id, h.conta_indicador, h.desde, h.ate
    from public.pacientes_unidades_historico h
    join public.units u on u.id = h.unit_id
   where h.paciente_id = p_paciente_id
     and public.posso_ver_paciente(p_paciente_id)
   order by h.desde;
$$;

revoke all on function public.buscar_historico_paciente(uuid) from public;
grant execute on function public.buscar_historico_paciente(uuid) to authenticated;

create or replace function public.buscar_altas_paciente(p_paciente_id uuid)
returns setof public.resumos_alta
language sql
security definer
set search_path = public
stable
as $$
  select r.* from public.resumos_alta r
   where r.paciente_id = p_paciente_id
     and public.posso_ver_paciente(p_paciente_id)
   order by r.data_alta;
$$;

revoke all on function public.buscar_altas_paciente(uuid) from public;
grant execute on function public.buscar_altas_paciente(uuid) to authenticated;

-- ── 6. Auditoria geral (chefe) ──────────────────────────────────────────────
-- Mesmo modelo de confiança de contagens_mes: a UI restringe a rota ao
-- chefe, o banco não tem uma policy de cargo (travaria quem ainda não tem
-- cadastro em staff). Ignora RLS de unidade de propósito.
create or replace function public.auditoria_pacientes()
returns table (
  id uuid,
  nome text,
  unit_id uuid,
  unit_nome text,
  ativo boolean,
  data_internacao date,
  hora_internacao time
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.nome, p.unit_id, u.name, p.ativo, p.data_internacao, p.hora_internacao
    from public.pacientes p
    join public.units u on u.id = p.unit_id
   order by p.data_internacao desc, p.hora_internacao desc;
$$;

comment on function public.auditoria_pacientes() is
  'Todos os pacientes de todas as unidades — restrito na UI ao chefe, mesmo modelo de confiança de contagens_mes.';

revoke all on function public.auditoria_pacientes() from public, anon;
grant execute on function public.auditoria_pacientes() to authenticated;

create or replace function public.auditoria_detalhe_paciente(p_paciente_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'historico', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit_id', h.unit_id, 'unit_nome', u.name, 'ala_id', h.ala_id,
        'conta_indicador', h.conta_indicador, 'desde', h.desde, 'ate', h.ate) order by h.desde)
        from public.pacientes_unidades_historico h
        join public.units u on u.id = h.unit_id
       where h.paciente_id = p_paciente_id), '[]'::jsonb),
    'altas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tipo_saida', r.tipo_saida, 'data_alta', r.data_alta, 'unit_id', r.unit_id) order by r.data_alta)
        from public.resumos_alta r
       where r.paciente_id = p_paciente_id), '[]'::jsonb)
  );
$$;

comment on function public.auditoria_detalhe_paciente(uuid) is
  'Histórico de período + altas de UM paciente, para a linha expandida da tela /auditoria. Mesmo modelo de confiança de auditoria_pacientes — não usar fora dessa tela.';

revoke all on function public.auditoria_detalhe_paciente(uuid) from public, anon;
grant execute on function public.auditoria_detalhe_paciente(uuid) to authenticated;

commit;
