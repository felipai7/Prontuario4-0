-- ══════════════════════════════════════════════════════════════════════════
-- INDICADORES POR UNIDADE
--
-- Nenhuma das 6 RPCs de indicadores (contagens_mes, qualidade_mes,
-- contagens_fisio_mes, contagens_enfermagem_mes, contagens_nutricao_mes,
-- contagens_iras_mes) recebia unidade como parâmetro — dependiam só do RLS
-- (`security invoker`) pra decidir quais pacientes contar. RLS libera
-- qualquer unidade em que a pessoa é staff, não "a unidade selecionada no
-- momento". Enquanto só existia uma unidade por cliente, isso era invisível;
-- agora que UTI e Hospital são a mesma instituição com staff compartilhado
-- (ex.: o chefe é staff das duas), os indicadores da UTI vinham somando
-- pacientes do Hospital junto — mortalidade, SMR, giro de leito, ocupação,
-- tudo contaminado, silenciosamente.
--
-- `leitos_dia_mes` (multiunidade_1_estrutura.sql) já recebia p_unit_id
-- explícito — o mesmo tratamento que faltava nestas 6. RLS continua
-- protegendo o caso real que motivou `security invoker` (dois CLIENTES
-- diferentes na mesma plataforma nunca se enxergam); p_unit_id resolve o
-- caso novo (um cliente, duas unidades, mesmo chefe nas duas).
--
-- Padrão aplicado nas 6: `censo` (onde já existia) ganha
-- `and c.unit_id = p_unit_id`; toda subquery que lia uma tabela base só com
-- filtro de data (sem passar por `censo`) ganha um `exists` contra `censo`
-- pareando paciente+dia — é o que garante que um evento só conta pra unidade
-- em que o paciente estava NAQUELE dia, mesmo se ele transitou no mês.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. contagens_mes ─────────────────────────────────────────────────────
drop function if exists public.contagens_mes(date);

create function public.contagens_mes(p_mes date, p_unit_id uuid)
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
       and c.unit_id = p_unit_id
  ),
  -- Precisa do histórico INTEIRO (sem filtro de unidade) pra achar de verdade
  -- o primeiro período de cada paciente — senão um paciente que já passou por
  -- outra unidade antes pareceria "admitido de novo" aqui.
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
       and r.unit_id = p_unit_id
       and (r.data_alta at time zone 'America/Sao_Paulo')::date >= b.ini
       and (r.data_alta at time zone 'America/Sao_Paulo')::date <  b.fim_excl
  ),
  -- Reinternações: primeiro período do mês NESTA unidade que aponta para uma alta anterior.
  reinternacoes as (
    select extract(epoch from (pp.desde - ant.data_alta)) / 3600.0 as horas_desde_alta
      from primeiros_periodos pp
      join public.pacientes p on p.id = pp.paciente_id
      join public.resumos_alta ant on ant.id = p.readmissao_de
         , bounds b
     where pp.unit_id = p_unit_id
       and (pp.desde at time zone 'America/Sao_Paulo')::date >= b.ini
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
       and exists (select 1 from censo c
                    where c.id = sv.paciente_id
                      and c.dia = (sv.horario at time zone 'America/Sao_Paulo')::date)
     group by sv.paciente_id
  ),
  corticoide as (
    select ch.paciente_id from public.cuidados_horizontais ch where ch.corticoide_em_uso
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
    where pp.unit_id = p_unit_id
      and (pp.desde at time zone 'America/Sao_Paulo')::date >= b.ini
      and (pp.desde at time zone 'America/Sao_Paulo')::date < b.fim_excl),
  (select count(*) from saidas_mes),
  (select count(*) from saidas_mes where tipo_saida in ('alta_casa', 'alta_pedido', 'alta_uti_hospital', 'alta_hospital_uti')),
  (select count(*) from saidas_mes where tipo_saida = 'obito'),
  (select count(*) from saidas_mes where tipo_saida = 'transferencia_hospitalar'),
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
        and sv.data >= b.ini and sv.data < b.fim_excl
        and exists (select 1 from censo c where c.id = sv.paciente_id and c.dia = sv.data)) t),
  (select count(distinct pb.paciente_id) from public.periodos_balanco pb, bounds b
    where pb.dialise > 0
      and (pb.inicio at time zone 'America/Sao_Paulo')::date >= b.ini
      and (pb.inicio at time zone 'America/Sao_Paulo')::date <  b.fim_excl
      and exists (select 1 from censo c
                   where c.id = pb.paciente_id
                     and c.dia = (pb.inicio at time zone 'America/Sao_Paulo')::date)),
  (select count(*) from glicemia where hipo),
  (select count(*) from glicemia where hiper),
  (select count(*) from glicemia where monitorado),
  (select count(*) from glicemia where hipo or hiper),
  (select count(*) from glicemia g where (g.hipo or g.hiper)
     and exists (select 1 from corticoide c where c.paciente_id = g.paciente_id))
$$;

revoke all on function public.contagens_mes(date, uuid) from public, anon;
grant execute on function public.contagens_mes(date, uuid) to authenticated;

-- ── 2. qualidade_mes ─────────────────────────────────────────────────────
drop function if exists public.qualidade_mes(date);

create function public.qualidade_mes(p_mes date, p_unit_id uuid)
returns table (
  pacientes_ativos_sem_saps3 bigint,
  saidas_sem_saps3           bigint,
  saidas_sem_tipo            bigint,
  corticoide_sem_hgt         bigint,
  saps3_ate_24h              bigint,
  saps3_pontuados            bigint,
  pacientes_com_hgt          bigint,
  pacientes_internados       bigint,
  pacientes_dia_com_balanco  bigint,
  pacientes_dia              bigint
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
    select c.paciente_id, c.dia from public.censo_diario c, bounds b
     where c.dia >= b.ini and c.dia < b.fim_excl
       and c.unit_id = p_unit_id
  ),
  saidas_mes as (
    select r.id, r.paciente_id, r.tipo_saida,
           coalesce(p.saps3, nullif(r.paciente_snapshot->>'saps3','')::numeric) as saps3,
           p.saps3_calculado_em,
           (p.data_internacao + coalesce(p.hora_internacao, time '12:00'))
             at time zone 'America/Sao_Paulo' as admissao_ts
      from public.resumos_alta r
      left join public.pacientes p on p.id = r.paciente_id
         , bounds b
     where r.unit_id = p_unit_id
       and (r.data_alta at time zone 'America/Sao_Paulo')::date >= b.ini
       and (r.data_alta at time zone 'America/Sao_Paulo')::date <  b.fim_excl
  ),
  corticoide as (
    select ch.paciente_id from public.cuidados_horizontais ch where ch.corticoide_em_uso
    union
    select a.paciente_id
      from public.auditoria_intensivista a, bounds b
     where a.tabela = 'cuidados_horizontais'
       and (a.dados_novos->>'corticoide_em_uso')::boolean
       and (a.changed_at at time zone 'America/Sao_Paulo')::date >= b.ini
       and (a.changed_at at time zone 'America/Sao_Paulo')::date <  b.fim_excl
  ),
  com_hgt as (
    select distinct sv.paciente_id
      from public.sinais_vitais sv, bounds b
     where sv.hgt is not null
       and (sv.horario at time zone 'America/Sao_Paulo')::date >= b.ini
       and (sv.horario at time zone 'America/Sao_Paulo')::date <  b.fim_excl
  )
select
  (select count(*) from public.pacientes where ativo and saps3 is null and unit_id = p_unit_id),
  (select count(*) from saidas_mes where tipo_saida is not null and saps3 is null),
  (select count(*) from saidas_mes where tipo_saida is null),
  (select count(distinct c.paciente_id)
     from corticoide c
    where exists (select 1 from censo ce where ce.paciente_id = c.paciente_id)
      and not exists (select 1 from com_hgt h where h.paciente_id = c.paciente_id)),
  (select count(*) from saidas_mes
    where saps3_calculado_em is not null
      and saps3_calculado_em <= admissao_ts + interval '24 hours'),
  (select count(*) from saidas_mes where saps3_calculado_em is not null),
  (select count(*) from com_hgt h
    where exists (select 1 from censo c where c.paciente_id = h.paciente_id)),
  (select count(distinct paciente_id) from censo),
  (select count(*) from (
     select distinct c.paciente_id, c.dia
       from censo c
       join public.periodos_balanco pb
         on pb.paciente_id = c.paciente_id
        and (pb.inicio at time zone 'America/Sao_Paulo')::date = c.dia) t),
  (select count(*) from censo)
$$;

revoke all on function public.qualidade_mes(date, uuid) from public, anon;
grant execute on function public.qualidade_mes(date, uuid) to authenticated;

-- ── 3. contagens_fisio_mes ───────────────────────────────────────────────
drop function if exists public.contagens_fisio_mes(date);

create function public.contagens_fisio_mes(p_mes date, p_unit_id uuid)
returns table (
  extubados_com_sucesso        bigint,
  tentativas_extubacao         bigint,
  reintubacoes_48h             bigint,
  extubacoes_planejadas        bigint,
  desmame_dificil_sucesso      bigint,
  pacientes_desmame_dificil    bigint,
  vni_evitou_iot               bigint,
  vni_objetivo_evitar_iot      bigint,
  decanulados_na_uti           bigint,
  traqueo_elegiveis            bigint,
  dias_vm_protetora            bigint
)
language sql
stable
security invoker
as $$
with bounds as (
  select p_mes as ini, (p_mes + interval '1 month')::date as fim_excl
),
censo as (
  select c.paciente_id, c.dia from public.censo_diario c, bounds b
   where c.dia >= b.ini and c.dia < b.fim_excl
     and c.unit_id = p_unit_id
),
ev as (
  select e.* from public.fisio_eventos e, bounds b
   where e.data >= b.ini and e.data < b.fim_excl
     and exists (select 1 from censo c where c.paciente_id = e.paciente_id and c.dia = e.data)
)
select
  (select count(*) from ev where tipo = 'extubacao' and sucesso),
  (select count(*) from ev where tipo = 'extubacao'),
  (select count(*) from ev where tipo = 'extubacao' and planejada and reintubou_48h),
  (select count(*) from ev where tipo = 'extubacao' and planejada),
  (select count(*) from ev where tipo = 'desmame_dificil' and sucesso),
  (select count(distinct paciente_id) from ev where tipo = 'desmame_dificil'),
  (select count(*) from ev where tipo = 'vni' and objetivo_evitar_iot and evitou_iot),
  (select count(*) from ev where tipo = 'vni' and objetivo_evitar_iot),
  (select count(*) from ev where tipo = 'traqueostomia' and decanulado_na_uti),
  (select count(*) from ev where tipo = 'traqueostomia' and elegivel_decanulacao),
  (select count(*)
     from public.fisio_avaliacoes_diarias a, bounds b
    where a.vm_protetora
      and a.data >= b.ini and a.data < b.fim_excl
      and exists (select 1 from censo c where c.paciente_id = a.paciente_id and c.dia = a.data)
      and exists (
        select 1 from public.suportes_ventilatorios sv
         where sv.paciente_id = a.paciente_id
           and sv.data = a.data
           and sv.modalidade = 'ventilacao_mecanica'))
$$;

revoke all on function public.contagens_fisio_mes(date, uuid) from public, anon;
grant execute on function public.contagens_fisio_mes(date, uuid) to authenticated;

-- ── 4. contagens_enfermagem_mes ──────────────────────────────────────────
drop function if exists public.contagens_enfermagem_mes(date);

create function public.contagens_enfermagem_mes(p_mes date, p_unit_id uuid)
returns table (
  cvc_dia               bigint,
  svd_dia               bigint,
  lpp_adquiridas_uti    bigint,
  lpp_total             bigint,
  dispositivos_abertos  bigint
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
    select c.paciente_id, c.dia from public.censo_diario c, bounds b
     where c.dia >= b.ini and c.dia < b.fim_excl
       and c.unit_id = p_unit_id
  ),
  dias_disp as (
    select distinct d.tipo, c.paciente_id, c.dia
      from censo c
      join public.dispositivos d
        on d.paciente_id = c.paciente_id
       and c.dia >= d.data_insercao
       and (d.data_remocao is null or c.dia < d.data_remocao)
  ),
  lpp as (
    select l.* from public.lpp_eventos l, bounds b
     where l.data >= b.ini and l.data < b.fim_excl
       and exists (select 1 from censo c where c.paciente_id = l.paciente_id and c.dia = l.data)
  )
select
  (select count(*) from dias_disp where tipo = 'CVC'),
  (select count(*) from dias_disp where tipo = 'SVD'),
  (select count(*) from lpp where adquirida_na_uti),
  (select count(*) from lpp),
  (select count(*)
     from public.dispositivos d
     join public.pacientes p on p.id = d.paciente_id
    where d.data_remocao is null and not p.ativo and p.unit_id = p_unit_id)
$$;

revoke all on function public.contagens_enfermagem_mes(date, uuid) from public, anon;
grant execute on function public.contagens_enfermagem_mes(date, uuid) to authenticated;

-- ── 5. contagens_nutricao_mes ────────────────────────────────────────────
drop function if exists public.contagens_nutricao_mes(date);

create function public.contagens_nutricao_mes(p_mes date, p_unit_id uuid)
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
    select c.paciente_id, c.dia from public.censo_diario c, bounds b
     where c.dia >= b.ini and c.dia < b.fim_excl
       and c.unit_id = p_unit_id
  ),
  dia as (
    select n.* from public.nutricao_dia n, bounds b
     where n.data >= b.ini and n.data < b.fim_excl
       and exists (select 1 from censo c where c.paciente_id = n.paciente_id and c.dia = n.data)
  ),
  admissoes as (
    select p.id, p.data_internacao
      from public.pacientes p, bounds b
     where p.data_internacao >= b.ini and p.data_internacao < b.fim_excl
       and p.unit_id = p_unit_id
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
  vm_dias as (
    select distinct sv.paciente_id, sv.data as dia
      from public.suportes_ventilatorios sv, bounds b
     where sv.modalidade = 'ventilacao_mecanica'
       and sv.data >= b.ini and sv.data < b.fim_excl
       and exists (select 1 from censo c where c.paciente_id = sv.paciente_id and c.dia = sv.data)
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
       and exists (select 1 from censo c
                    where c.paciente_id = pb.paciente_id
                      and c.dia = (pb.inicio at time zone 'America/Sao_Paulo')::date)
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

revoke all on function public.contagens_nutricao_mes(date, uuid) from public, anon;
grant execute on function public.contagens_nutricao_mes(date, uuid) to authenticated;

-- ── 6. contagens_iras_mes ────────────────────────────────────────────────
drop function if exists public.contagens_iras_mes(date);

create function public.contagens_iras_mes(p_mes date, p_unit_id uuid)
returns table (
  total_iras          bigint,
  pacientes_com_iras  bigint,
  pav                 bigint,
  itu_svd             bigint,
  ipcs_lab            bigint,
  ipcs_clinica        bigint,
  pneumonia           bigint,
  traqueite           bigint,
  outra               bigint,
  sepse_choque        bigint
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
    select c.paciente_id, c.dia from public.censo_diario c, bounds b
     where c.dia >= b.ini and c.dia < b.fim_excl
       and c.unit_id = p_unit_id
  ),
  ev as (
    select e.* from public.iras_eventos e, bounds b
     where e.data >= b.ini and e.data < b.fim_excl
       and exists (select 1 from censo c where c.paciente_id = e.paciente_id and c.dia = e.data)
  )
select
  (select count(*) from ev),
  (select count(distinct paciente_id) from ev),
  (select count(*) from ev where tipo = 'pav'),
  (select count(*) from ev where tipo = 'itu_svd'),
  (select count(*) from ev where tipo = 'ipcs_lab'),
  (select count(*) from ev where tipo = 'ipcs_clinica'),
  (select count(*) from ev where tipo = 'pneumonia'),
  (select count(*) from ev where tipo = 'traqueite'),
  (select count(*) from ev where tipo = 'outra'),
  (select count(*)
     from public.iras_sepse_choque s, bounds b
    where s.data >= b.ini and s.data < b.fim_excl
      and exists (select 1 from censo c where c.paciente_id = s.paciente_id and c.dia = s.data))
$$;

revoke all on function public.contagens_iras_mes(date, uuid) from public, anon;
grant execute on function public.contagens_iras_mes(date, uuid) to authenticated;

commit;
