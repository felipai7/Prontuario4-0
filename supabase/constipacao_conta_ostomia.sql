-- Débito de ostomia deve contar como evacuação para todos os efeitos —
-- também no indicador de qualidade "% pacientes constipados" da Nutrição
-- (public.contagens_nutricao_mes), que até aqui só olhava periodos_balanco.evacuacao.
-- Quem tem ostomia não evacua pelo reto: o débito da bolsa É a evacuação dele,
-- e sem essa correção o indicador marcava esses pacientes como constipados
-- indevidamente. Corpo idêntico ao definido em indicadores_por_unidade.sql,
-- só com `pb.ostomia` incluído na CTE `balanco` e no filtro de `evacuacoes`.

create or replace function public.contagens_nutricao_mes(p_mes date, p_unit_id uuid)
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
           pb.ostomia,
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
    select paciente_id, dia from balanco where evacuacao > 0 or ostomia > 0
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
