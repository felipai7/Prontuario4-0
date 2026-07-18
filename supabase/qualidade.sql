-- ══════════════════════════════════════════════════════════════════════════
-- PAINEL DE QUALIDADE DO DADO
--
-- Um indicador vale o que vale a cobertura dele. Este painel mostra o que
-- sustenta (ou não) os números da tela de indicadores.
--
-- A separação em três grupos não é cosmética — é o que decide se o painel é
-- usado ou ignorado:
--
--   PENDÊNCIA      — obrigatório sem exceção clínica. Não existe paciente que
--                    dispense SAPS 3 ou tipo de saída. Some quando resolvido.
--   CONTRADIÇÃO    — o app sabe que o dado deveria existir (corticoide sem HGT).
--   COBERTURA      — fato, sem juízo. Não aferir HGT em paciente não diabético,
--                    sem dieta restrita e sem corticoide é decisão clínica
--                    correta, não falha. Acusar isso todo dia ensinaria a
--                    equipe a ignorar o painel — justamente antes do dia em que
--                    ele estivesse certo.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Censo diário: uma linha por (paciente, dia internado) ─────────────────
--
-- Extraído para view porque contagens_mes e qualidade_mes PRECISAM concordar
-- sobre o que é "pacientes-dia": se divergirem, as porcentagens de cobertura
-- do painel viram ficção sem ninguém notar.
--
-- Convenção: o dia da admissão conta, o dia da saída não. Dia futuro nunca conta.
create or replace view public.censo_diario as
select p.id as paciente_id, d.dia::date as dia
  from public.pacientes p
  cross join lateral generate_series(
    p.data_internacao,
    least(
      coalesce(
        (select (r.data_alta at time zone 'America/Sao_Paulo')::date - 1
           from public.resumos_alta r
          where r.paciente_id = p.id and r.tipo_saida is not null
          order by r.data_alta desc
          limit 1),
        current_date),
      current_date),
    interval '1 day') as d(dia);

comment on view public.censo_diario is
  'Uma linha por (paciente, dia internado). Fonte única de pacientes-dia para contagens_mes e qualidade_mes.';

-- ── Qualidade do mês ──────────────────────────────────────────────────────

drop function if exists public.qualidade_mes(date);

create function public.qualidade_mes(p_mes date)
returns table (
  -- Pendências
  pacientes_ativos_sem_saps3 bigint,
  saidas_sem_saps3           bigint,
  saidas_sem_tipo            bigint,
  -- Contradições
  corticoide_sem_hgt         bigint,
  -- Cobertura
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
    select c.* from public.censo_diario c, bounds b
     where c.dia >= b.ini and c.dia < b.fim_excl
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
     where (r.data_alta at time zone 'America/Sao_Paulo')::date >= b.ini
       and (r.data_alta at time zone 'America/Sao_Paulo')::date <  b.fim_excl
  ),
  -- Corticoide: em uso agora OU em algum momento do mês (via auditoria).
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
  (select count(*) from public.pacientes where ativo and saps3 is null),
  -- Sem SAPS 3, a saída fica fora do SMR para sempre.
  (select count(*) from saidas_mes where tipo_saida is not null and saps3 is null),
  -- Sem tipo, a saída é invisível para todo o bloco de mortalidade.
  (select count(*) from saidas_mes where tipo_saida is null),
  -- Corticoide eleva glicemia: sem nenhum HGT, uma disglicemia passaria batida.
  (select count(distinct c.paciente_id)
     from corticoide c
    where exists (select 1 from censo ce where ce.paciente_id = c.paciente_id)
      and not exists (select 1 from com_hgt h where h.paciente_id = c.paciente_id)),
  -- Pontuado dentro da janela em que ainda não se conhece o desfecho.
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

revoke all on function public.qualidade_mes(date) from public, anon;
grant execute on function public.qualidade_mes(date) to authenticated;
