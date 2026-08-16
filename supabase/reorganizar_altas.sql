-- ══════════════════════════════════════════════════════════════════════════
-- REORGANIZAR ALTAS: 5 tipos de saída, transferência interna dentro da Alta
--
-- Hoje resumos_alta.tipo_saida só tem 3 valores ('alta','obito',
-- 'transferencia'), e o mesmo 'transferencia' serve tanto pro movimento
-- interno UTI<->Hospital (paciente continua ativo, só muda de unidade,
-- feito hoje pelo botão "Transferir" via transferir_paciente) quanto pra
-- uma transferência de verdade pra fora do sistema (paciente desativado).
-- Isso deixa a auditoria ambígua. Passa a ter 6 valores (5 categorias
-- visíveis pro usuário — "Alta da UTI para o Hospital" e seu espelho "Alta
-- do Hospital para a UTI" são a mesma ideia em direções opostas, cada tela
-- só mostra a que faz sentido pra unidade onde o paciente está):
--
--   alta_casa                 -> Alta Hospitalar para Casa
--   alta_pedido                -> Alta a Pedido
--   alta_uti_hospital          -> Alta da UTI para o Hospital (transfere de verdade)
--   alta_hospital_uti          -> Alta do Hospital para a UTI (transfere de verdade)
--   transferencia_hospitalar  -> Transferência Hospitalar (saída de verdade, fora do sistema)
--   obito                      -> Óbito
--
-- Para indicadores (decisão do Felipe): óbito e transferência (agora só a
-- hospitalar) contam exatamente como hoje; as 4 primeiras (inclusive as
-- duas transferências internas) contam todas como "alta".
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Solta a constraint antiga pra liberar os valores novos no backfill ──
alter table public.resumos_alta drop constraint if exists resumos_alta_tipo_saida_check;

-- ── 2. Backfill determinístico dos registros existentes ────────────────────
-- 'alta' -> 'alta_casa' (não dá pra saber retroativamente quais eram "a pedido").
update public.resumos_alta
   set tipo_saida = 'alta_casa'
 where tipo_saida = 'alta';

-- 'transferencia': paciente ainda ativo = foi um movimento interno (o botão
-- Transferir/transferir_paciente já não desativa o paciente) — direção pela
-- unidade de ORIGEM herdada em resumos_alta.unit_id (trigger
-- resumos_alta_herda_unidade, multiunidade_2_rls.sql). Paciente já inativo =
-- saída de verdade, anterior ao botão Transferir existir.
update public.resumos_alta r
   set tipo_saida = case
     when p.ativo and (select tipo_unidade from public.units where id = r.unit_id) = 'uti'        then 'alta_uti_hospital'
     when p.ativo and (select tipo_unidade from public.units where id = r.unit_id) = 'enfermaria'  then 'alta_hospital_uti'
     else 'transferencia_hospitalar'
   end
  from public.pacientes p
 where r.tipo_saida = 'transferencia' and r.paciente_id = p.id;

-- Sobra rara: 'transferencia' sem paciente_id (não dá pra cruzar com
-- pacientes/units) — cai no bucket "saída de verdade" por segurança.
update public.resumos_alta
   set tipo_saida = 'transferencia_hospitalar'
 where tipo_saida = 'transferencia';

-- 'obito' não muda.

-- ── 3. Nova constraint com os 6 valores ─────────────────────────────────────
alter table public.resumos_alta add constraint resumos_alta_tipo_saida_check
  check (tipo_saida in (
    'alta_casa', 'alta_pedido', 'obito',
    'transferencia_hospitalar', 'alta_uti_hospital', 'alta_hospital_uti'
  ));

-- ── 4. transferir_paciente: tipo_saida agora depende da direção ────────────
-- Corpo idêntico ao de registro_unico_transferencia.sql:555-618, só trocando
-- o 'transferencia' hardcoded do INSERT por um valor calculado a partir do
-- tipo_unidade da unidade de ORIGEM do paciente.
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
  v_tipo_origem text;
  v_tipo_saida text;
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

  select tipo_unidade into v_tipo_origem from public.units where id = v_paciente.unit_id;
  v_tipo_saida := case when v_tipo_origem = 'uti' then 'alta_uti_hospital' else 'alta_hospital_uti' end;

  -- Antes do update de unit_id: herda a unidade de ORIGEM via
  -- resumos_alta_herda_unidade (multiunidade_2_rls.sql), fechando as contas
  -- de saída/SMR da UTI daquele mês exatamente como uma alta de verdade.
  insert into public.resumos_alta (
    paciente_nome, data_internacao, paciente_snapshot, tipo_saida, paciente_id, data_alta
  ) values (
    v_paciente.nome, v_paciente.data_internacao, to_jsonb(v_paciente), v_tipo_saida, v_paciente.id, now()
  );

  update public.pacientes
     set unit_id = p_unit_destino, ala_id = v_ala_rotativo, numero_leito = v_leito
   where id = p_paciente_id;
end $$;

comment on function public.transferir_paciente(uuid, uuid) is
  'Transfere o paciente (mesmo registro) para a ala de trânsito da unidade destino. Gera resumos_alta com tipo_saida direcional (alta_uti_hospital/alta_hospital_uti conforme a origem), igual uma alta, sem desativar o paciente — pacientes.ativo nunca muda aqui.';

revoke all on function public.transferir_paciente(uuid, uuid) from public;
grant execute on function public.transferir_paciente(uuid, uuid) to authenticated;

-- ── 5. contagens_mes: buckets de saída atualizados ──────────────────────────
-- Corpo idêntico ao de registro_unico_transferencia.sql:180-317, só trocando
-- as 3 linhas de contagem por tipo (alta/obito/transferencia) pelos buckets
-- novos (decisão do Felipe: transferências internas contam como "alta").
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

-- ── 6. auditoria_pacientes: tipo de saída mais recente ──────────────────────
-- returns table mudou (coluna nova) — create or replace não permite trocar o
-- tipo de retorno, precisa dropar antes.
drop function if exists public.auditoria_pacientes();

create function public.auditoria_pacientes()
returns table (
  id uuid,
  nome text,
  unit_id uuid,
  unit_nome text,
  ativo boolean,
  data_internacao date,
  hora_internacao time,
  ultimo_tipo_saida text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.nome, p.unit_id, u.name, p.ativo, p.data_internacao, p.hora_internacao,
    (select r.tipo_saida from public.resumos_alta r
      where r.paciente_id = p.id order by r.data_alta desc limit 1)
    from public.pacientes p
    join public.units u on u.id = p.unit_id
   order by p.data_internacao desc, p.hora_internacao desc;
$$;

comment on function public.auditoria_pacientes() is
  'Todos os pacientes de todas as unidades — restrito na UI ao chefe, mesmo modelo de confiança de contagens_mes. ultimo_tipo_saida é o tipo_saida do resumos_alta mais recente do paciente, usado na coluna Status quando ativo=false.';

revoke all on function public.auditoria_pacientes() from public, anon;
grant execute on function public.auditoria_pacientes() to authenticated;

commit;
