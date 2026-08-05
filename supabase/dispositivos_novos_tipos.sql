-- Run in Supabase SQL Editor ou via `supabase db query --linked --file`

-- Amplia os tipos de dispositivo além de CVC/SVD:
--   PAI   = Cateter de Pressão Arterial Invasiva (1 por vez, como já valia p/ SVD)
--   CDL   = Cateter de Diálise (conta como CVC no indicador de dias-dispositivo,
--           por isso soma junto de CVC em contagens_enfermagem_mes)
--   DRENO = Dreno — campo de texto livre descreve qual/onde (múltiplos por vez)
--   OUTRO = Dispositivo não catalogado ainda — texto livre (múltiplos por vez)
--
-- `observacao` (já existente na tabela) passa a carregar o sítio de inserção
-- (CVC/PAI/CDL) ou a descrição livre (DRENO/OUTRO) — não é uma coluna nova.

alter table public.dispositivos drop constraint if exists dispositivos_tipo_check;
alter table public.dispositivos add constraint dispositivos_tipo_check
  check (tipo in ('CVC', 'SVD', 'PAI', 'CDL', 'DRENO', 'OUTRO'));

-- Recria a função de contagens: CDL passa a somar no mesmo bucket de CVC.
drop function if exists public.contagens_enfermagem_mes(date);

create function public.contagens_enfermagem_mes(p_mes date)
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
    select c.* from public.censo_diario c, bounds b
     where c.dia >= b.ini and c.dia < b.fim_excl
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
  )
select
  (select count(*) from dias_disp where tipo in ('CVC', 'CDL')),
  (select count(*) from dias_disp where tipo = 'SVD'),
  (select count(*) from lpp where adquirida_na_uti),
  (select count(*) from lpp),
  (select count(*)
     from public.dispositivos d
     join public.pacientes p on p.id = d.paciente_id
    where d.data_remocao is null and not p.ativo)
$$;

revoke all on function public.contagens_enfermagem_mes(date) from public, anon;
grant execute on function public.contagens_enfermagem_mes(date) to authenticated;
