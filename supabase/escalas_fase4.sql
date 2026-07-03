-- ============================================================
-- MÓDULO DE ESCALAS — FASE 4: checagem de plantão duplicado
-- ============================================================
--
-- Impede que o mesmo profissional fique escalado em dois turnos cujos
-- horários se sobrepõem, no mesmo dia — tanto no mês padrão quanto na
-- escala publicada. Enforced como trigger no banco (não só na UI), para
-- valer também em edições diretas/futuras (ex: trocas da Fase 5).
--
-- Escopo: verifica sobreposição dentro da MESMA unidade. Um profissional
-- que atue em duas unidades diferentes (staff.user_id repetido em outra
-- unit_id) não é checado aqui — ficaria para uma extensão futura que
-- agrupe por user_id entre unidades.

-- ──────────────────────────────────────────
-- Dois intervalos de horário (com suporte a virada de meia-noite) se
-- sobrepõem? Usa uma data fixa como referência só para a aritmética.
-- ──────────────────────────────────────────
create or replace function public.periodos_se_sobrepoem(p_inicio1 time, p_fim1 time, p_inicio2 time, p_fim2 time)
returns boolean
language sql
immutable
as $$
  select
    ('2000-01-01'::date + p_inicio1) < (case when p_fim2 <= p_inicio2 then '2000-01-02'::date + p_fim2 else '2000-01-01'::date + p_fim2 end)
    and
    ('2000-01-01'::date + p_inicio2) < (case when p_fim1 <= p_inicio1 then '2000-01-02'::date + p_fim1 else '2000-01-01'::date + p_fim1 end);
$$;

-- ──────────────────────────────────────────
-- Mês padrão: mesmo staff, mesmo day_number, tipos de turno diferentes
-- com horários sobrepostos → bloqueia.
-- ──────────────────────────────────────────
create or replace function public.check_template_overlap()
returns trigger
language plpgsql
as $$
declare
  v_conflito text;
begin
  select st2.name into v_conflito
  from public.schedule_template_shifts t
  join public.shift_types st1 on st1.id = new.shift_type_id
  join public.shift_types st2 on st2.id = t.shift_type_id
  where t.unit_id = new.unit_id
    and t.day_number = new.day_number
    and t.staff_id = new.staff_id
    and t.shift_type_id <> new.shift_type_id
    and (tg_op <> 'UPDATE' or t.id <> new.id)
    and public.periodos_se_sobrepoem(st1.start_time, st1.end_time, st2.start_time, st2.end_time)
  limit 1;

  if v_conflito is not null then
    raise exception 'Este profissional já está escalado no turno "%" neste mesmo dia (horários se sobrepõem).', v_conflito;
  end if;

  return new;
end;
$$;

create trigger trg_check_template_overlap
before insert or update on public.schedule_template_shifts
for each row execute function public.check_template_overlap();

-- ──────────────────────────────────────────
-- Escala publicada: mesmo staff, mesma data, tipos de turno diferentes
-- com horários sobrepostos → bloqueia.
-- ──────────────────────────────────────────
create or replace function public.check_shift_overlap()
returns trigger
language plpgsql
as $$
declare
  v_conflito text;
begin
  if new.staff_id is null then
    return new;
  end if;

  select st2.name into v_conflito
  from public.shifts s
  join public.shift_types st1 on st1.id = new.shift_type_id
  join public.shift_types st2 on st2.id = s.shift_type_id
  where s.unit_id = new.unit_id
    and s.date = new.date
    and s.staff_id = new.staff_id
    and s.status <> 'cancelled'
    and s.shift_type_id <> new.shift_type_id
    and (tg_op <> 'UPDATE' or s.id <> new.id)
    and public.periodos_se_sobrepoem(st1.start_time, st1.end_time, st2.start_time, st2.end_time)
  limit 1;

  if v_conflito is not null then
    raise exception 'Este profissional já está escalado no turno "%" nesta mesma data (horários se sobrepõem).', v_conflito;
  end if;

  return new;
end;
$$;

create trigger trg_check_shift_overlap
before insert or update on public.shifts
for each row execute function public.check_shift_overlap();
