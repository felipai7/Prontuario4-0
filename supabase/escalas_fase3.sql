-- ============================================================
-- MÓDULO DE ESCALAS — FASE 3: Publicação do mês
-- ============================================================
--
-- O "mês padrão" tem 35 dias fixos (schedule_template_shifts.day_number
-- 1..35) que se repetem em ciclo contínuo, independente do calendário —
-- um mês de 30 dias consome 30 posições do ciclo, o próximo mês
-- continua de onde parou (dia 31, 32, ...), voltando a 1 após o 35.
-- unit_template_cursor guarda, por unidade, em qual posição do ciclo
-- de 35 dias começa o próximo mês a ser publicado.

create table public.unit_template_cursor (
  unit_id         uuid primary key references public.units(id) on delete cascade,
  next_day_number int not null default 1 check (next_day_number between 1 and 35)
);

alter table public.unit_template_cursor enable row level security;

create policy "Acesso ao cursor do ciclo só para chefe da unidade"
on public.unit_template_cursor for all to authenticated
using (public.is_chefe(auth.uid(), unit_id))
with check (public.is_chefe(auth.uid(), unit_id));

-- ──────────────────────────────────────────
-- Mapeia cada data do mês para a posição (day_number) no ciclo de 35 dias
-- ──────────────────────────────────────────
create or replace function public.compute_month_mapping(p_unit_id uuid, p_month date)
returns table(pub_date date, day_number int)
language sql
stable
as $$
  with c as (
    select coalesce((select next_day_number from public.unit_template_cursor where unit_id = p_unit_id), 1) as start_day
  ), days as (
    select generate_series(p_month, (p_month + interval '1 month - 1 day')::date, interval '1 day')::date as d
  )
  select d as pub_date,
         (((start_day - 1) + (d - p_month)) % 35) + 1 as day_number
  from days, c;
$$;

-- ──────────────────────────────────────────
-- Prévia da publicação: para cada dia × tipo de turno ativo, quem está
-- escalado no mês padrão e quantas vagas (de 2) estão preenchidas
-- ──────────────────────────────────────────
create or replace function public.preview_publish_month(p_unit_id uuid, p_month date)
returns table(pub_date date, day_number int, shift_type_id uuid, shift_type_name text, staff_names text[], vagas int)
language plpgsql
stable
as $$
begin
  if not public.is_chefe(auth.uid(), p_unit_id) then
    raise exception 'Apenas chefe pode revisar a publicação.';
  end if;

  return query
  select m.pub_date, m.day_number, st.id, st.name,
         coalesce(array_agg(s.full_name order by s.full_name) filter (where s.full_name is not null), '{}'),
         count(s.full_name)::int
  from public.compute_month_mapping(p_unit_id, p_month) m
  cross join public.shift_types st
  left join public.schedule_template_shifts tpl
    on tpl.unit_id = p_unit_id and tpl.day_number = m.day_number and tpl.shift_type_id = st.id
  left join public.staff s on s.id = tpl.staff_id
  where st.unit_id = p_unit_id and st.active = true
  group by m.pub_date, m.day_number, st.id, st.name
  order by m.pub_date, st.name;
end;
$$;

-- ──────────────────────────────────────────
-- Publica o mês: gera shifts + shift_payments a partir do mês padrão.
-- Bloqueia republicação e bloqueia turnos totalmente vazios (vagas = 0).
-- ──────────────────────────────────────────
create or replace function public.publish_month(p_unit_id uuid, p_month date)
returns void
language plpgsql
as $$
declare
  v_row record;
  v_shift_id uuid;
  v_pay public.pay_settings%rowtype;
  v_empty_count int;
  v_days_in_month int;
  v_next_day int;
begin
  if not public.is_chefe(auth.uid(), p_unit_id) then
    raise exception 'Apenas chefe pode publicar.';
  end if;

  if exists (select 1 from public.published_months where unit_id = p_unit_id and month = p_month) then
    raise exception 'Este mês já foi publicado.';
  end if;

  select count(*) into v_empty_count
  from public.preview_publish_month(p_unit_id, p_month)
  where vagas = 0;

  if v_empty_count > 0 then
    raise exception 'Existem % turno(s) sem nenhum profissional atribuído no mês padrão. Preencha o editor antes de publicar.', v_empty_count;
  end if;

  select * into v_pay from public.pay_settings where unit_id = p_unit_id;
  if not found then
    raise exception 'Configure o valor da diária antes de publicar.';
  end if;

  insert into public.published_months (unit_id, month, published_by)
  values (p_unit_id, p_month, auth.uid());

  for v_row in
    select m.pub_date, m.day_number, tpl.shift_type_id, tpl.staff_id
    from public.compute_month_mapping(p_unit_id, p_month) m
    join public.schedule_template_shifts tpl
      on tpl.unit_id = p_unit_id and tpl.day_number = m.day_number
  loop
    insert into public.shifts (unit_id, shift_type_id, staff_id, original_staff_id, source_template_day, date, status, created_by)
    values (p_unit_id, v_row.shift_type_id, v_row.staff_id, v_row.staff_id, v_row.day_number, v_row.pub_date, 'scheduled', auth.uid())
    returning id into v_shift_id;

    insert into public.shift_payments (shift_id, payment_value, payment_status)
    values (
      v_shift_id,
      case when extract(dow from v_row.pub_date) in (0, 6) then v_pay.weekend_value else v_pay.weekday_value end,
      'pending'
    );
  end loop;

  v_days_in_month := (p_month + interval '1 month')::date - p_month;
  select ((coalesce((select next_day_number from public.unit_template_cursor where unit_id = p_unit_id), 1) - 1 + v_days_in_month) % 35) + 1
    into v_next_day;

  insert into public.unit_template_cursor (unit_id, next_day_number)
  values (p_unit_id, v_next_day)
  on conflict (unit_id) do update set next_day_number = excluded.next_day_number;
end;
$$;

alter publication supabase_realtime add table public.unit_template_cursor;
