-- Run in Supabase SQL Editor ou via `supabase db query --linked --file`
--
-- MÊS PADRÃO: day_number passa a significar "dia da semana + ocorrência no
-- mês", não mais "posição num ciclo contínuo de 35 dias".
--
-- A tela do espelho (TemplateEditor.tsx) já mostra os 35 dias numa grade de
-- 7 colunas (Dom..Sáb) × 5 linhas — ou seja, a POSIÇÃO já significava
-- "1º Domingo, 1ª Segunda, ..., 5º Sábado" pra quem preenche. Mas a função
-- que publicava o mês (compute_month_mapping) ignorava isso: tratava
-- day_number como um contador sequencial que girava num ciclo de 35 dias
-- via unit_template_cursor, sem nenhuma relação com o calendário real.
-- Resultado: o que a Ju/Felipe via na tela (coluna = dia da semana) nunca
-- foi o que a publicação de fato usava.
--
-- Nova regra, por mês (sem cursor, sem estado entre meses — cada mês é
-- recalculado do zero a partir do próprio calendário):
--   ocorrência = em que semana do mês aquela data cai (1ª a 5ª)
--   dia_semana = extract(dow from data), 0=domingo .. 6=sábado
--   day_number = (ocorrência - 1) * 7 + dia_semana + 1
--
-- Ex.: 1º sábado do mês → day_number 7. 2º domingo → day_number 8.
-- Todo mês tem no máximo 31 dias, então ocorrência nunca passa de 5 e
-- day_number nunca passa de 35 — os mesmos 35 slots continuam bastando.
--
-- unit_template_cursor fica sem uso: cada mês agora se resolve sozinho a
-- partir do calendário, não precisa lembrar onde o mês anterior parou.

create or replace function public.compute_month_mapping(p_unit_id uuid, p_month date)
returns table(pub_date date, day_number int)
language sql
stable
as $$
  select d::date as pub_date,
         (((extract(day from d)::int - 1) / 7) * 7 + extract(dow from d)::int + 1) as day_number
  from generate_series(p_month, (p_month + interval '1 month - 1 day')::date, interval '1 day') as d
$$;

create or replace function public.publish_month(p_unit_id uuid, p_month date)
returns void
language plpgsql
as $$
declare
  v_row record;
  v_shift_id uuid;
  v_pay public.pay_settings%rowtype;
  v_empty_count int;
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
end;
$$;

-- unit_template_cursor não é mais lido nem escrito por nenhuma função —
-- nenhum código TypeScript o referencia (só as duas funções acima). Fora,
-- pra não deixar estado morto que confunda o próximo diagnóstico.
drop table if exists public.unit_template_cursor;
