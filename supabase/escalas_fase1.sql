-- ============================================================
-- MÓDULO DE ESCALAS — FASE 1: Fundação (tipos de turno, pagamento,
-- mês padrão, publicação, escala executada)
-- ============================================================

-- ──────────────────────────────────────────
-- SHIFT_TYPES — tipos de turno por unidade (ex: Diurno 07h-19h)
-- ──────────────────────────────────────────
create table public.shift_types (
  id              uuid default uuid_generate_v4() primary key,
  unit_id         uuid not null references public.units(id) on delete cascade,
  name            text not null,
  start_time      time not null,
  end_time        time not null,
  duration_hours  numeric(4,2) not null default 12,
  active          boolean default true not null,
  created_at      timestamptz default now() not null
);

create index shift_types_unit_id_idx on public.shift_types(unit_id);

-- ──────────────────────────────────────────
-- PAY_SETTINGS — valor de diária por unidade
-- ──────────────────────────────────────────
create table public.pay_settings (
  unit_id        uuid primary key references public.units(id) on delete cascade,
  weekday_value  numeric(10,2) not null default 1000,
  weekend_value  numeric(10,2) not null default 1100,
  updated_at     timestamptz default now() not null
);

-- ──────────────────────────────────────────
-- SCHEDULE_TEMPLATE_SHIFTS — mês padrão (35 dias fixos por unidade)
-- ──────────────────────────────────────────
create table public.schedule_template_shifts (
  id             uuid default uuid_generate_v4() primary key,
  unit_id        uuid not null references public.units(id) on delete cascade,
  day_number     int not null check (day_number between 1 and 35),
  shift_type_id  uuid not null references public.shift_types(id) on delete cascade,
  staff_id       uuid not null references public.staff(id) on delete cascade,
  created_at     timestamptz default now() not null,
  unique (unit_id, day_number, shift_type_id, staff_id)
);

create index schedule_template_shifts_unit_id_idx on public.schedule_template_shifts(unit_id);

-- ──────────────────────────────────────────
-- PUBLISHED_MONTHS — controla quais meses já foram publicados (não republicáveis)
-- ──────────────────────────────────────────
create table public.published_months (
  unit_id       uuid not null references public.units(id) on delete cascade,
  month         date not null, -- sempre dia 1 do mês
  published_at  timestamptz default now() not null,
  published_by  uuid references auth.users(id),
  primary key (unit_id, month)
);

-- ──────────────────────────────────────────
-- SHIFTS — escala executada (visível a todos os membros da unidade)
-- ──────────────────────────────────────────
create table public.shifts (
  id                    uuid default uuid_generate_v4() primary key,
  unit_id               uuid not null references public.units(id) on delete cascade,
  shift_type_id         uuid references public.shift_types(id),
  staff_id              uuid references public.staff(id),          -- ocupante atual (executado)
  original_staff_id     uuid references public.staff(id),          -- ocupante publicado (planejado)
  source_template_day   int,
  date                  date not null,
  status                text not null default 'scheduled' check (status in ('scheduled', 'swapped', 'cancelled')),
  created_by            uuid references auth.users(id),
  created_at            timestamptz default now() not null,
  unique (shift_type_id, date, staff_id)
);

create index shifts_unit_id_date_idx on public.shifts(unit_id, date);

-- ──────────────────────────────────────────
-- SHIFT_PAYMENTS — pagamento, tabela separada com visibilidade restrita
-- ──────────────────────────────────────────
create table public.shift_payments (
  shift_id        uuid primary key references public.shifts(id) on delete cascade,
  payment_value   numeric(10,2) not null,
  payment_status  text not null default 'pending' check (payment_status in ('pending', 'paid')),
  paid_at         timestamptz
);

-- ──────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────
alter table public.shift_types              enable row level security;
alter table public.pay_settings             enable row level security;
alter table public.schedule_template_shifts enable row level security;
alter table public.published_months         enable row level security;
alter table public.shifts                   enable row level security;
alter table public.shift_payments           enable row level security;

-- shift_types: leitura para membros da unidade, escrita só chefe
create policy "Leitura de shift_types para membros da unidade"
on public.shift_types for select to authenticated
using (public.is_staff(auth.uid(), unit_id) or public.is_chefe(auth.uid(), unit_id));

create policy "Escrita de shift_types só para chefe da unidade"
on public.shift_types for all to authenticated
using (public.is_chefe(auth.uid(), unit_id))
with check (public.is_chefe(auth.uid(), unit_id));

-- pay_settings: leitura e escrita só chefe (plantonista vê o valor final em shift_payments)
create policy "Acesso a pay_settings só para chefe da unidade"
on public.pay_settings for all to authenticated
using (public.is_chefe(auth.uid(), unit_id))
with check (public.is_chefe(auth.uid(), unit_id));

-- schedule_template_shifts: leitura membros, escrita só chefe
create policy "Leitura do mês padrão para membros da unidade"
on public.schedule_template_shifts for select to authenticated
using (public.is_staff(auth.uid(), unit_id) or public.is_chefe(auth.uid(), unit_id));

create policy "Escrita do mês padrão só para chefe da unidade"
on public.schedule_template_shifts for all to authenticated
using (public.is_chefe(auth.uid(), unit_id))
with check (public.is_chefe(auth.uid(), unit_id));

-- published_months: leitura membros, escrita só chefe
create policy "Leitura de published_months para membros da unidade"
on public.published_months for select to authenticated
using (public.is_staff(auth.uid(), unit_id) or public.is_chefe(auth.uid(), unit_id));

create policy "Escrita de published_months só para chefe da unidade"
on public.published_months for all to authenticated
using (public.is_chefe(auth.uid(), unit_id))
with check (public.is_chefe(auth.uid(), unit_id));

-- shifts: leitura para qualquer membro ativo da unidade (precisa pra trocas);
-- escrita só chefe (nesta fase — Fase 5 vai liberar troca via RPC transacional)
create policy "Leitura de shifts para membros da unidade"
on public.shifts for select to authenticated
using (public.is_staff(auth.uid(), unit_id) or public.is_chefe(auth.uid(), unit_id));

create policy "Escrita de shifts só para chefe da unidade"
on public.shifts for all to authenticated
using (public.is_chefe(auth.uid(), unit_id))
with check (public.is_chefe(auth.uid(), unit_id));

-- shift_payments: só o dono do shift (via staff.user_id) ou o chefe da unidade veem/editam
create policy "Dono ou chefe vê pagamento"
on public.shift_payments for select to authenticated
using (
  exists (
    select 1 from public.shifts s
    join public.staff st on st.id = s.staff_id
    where s.id = shift_payments.shift_id
      and (st.user_id = auth.uid() or public.is_chefe(auth.uid(), s.unit_id))
  )
);

create policy "Só chefe escreve pagamento"
on public.shift_payments for insert to authenticated
with check (
  exists (
    select 1 from public.shifts s
    where s.id = shift_payments.shift_id and public.is_chefe(auth.uid(), s.unit_id)
  )
);

create policy "Só chefe atualiza pagamento"
on public.shift_payments for update to authenticated
using (
  exists (
    select 1 from public.shifts s
    where s.id = shift_payments.shift_id and public.is_chefe(auth.uid(), s.unit_id)
  )
)
with check (
  exists (
    select 1 from public.shifts s
    where s.id = shift_payments.shift_id and public.is_chefe(auth.uid(), s.unit_id)
  )
);

create policy "Só chefe exclui pagamento"
on public.shift_payments for delete to authenticated
using (
  exists (
    select 1 from public.shifts s
    where s.id = shift_payments.shift_id and public.is_chefe(auth.uid(), s.unit_id)
  )
);

-- ──────────────────────────────────────────
-- REALTIME
-- ──────────────────────────────────────────
alter publication supabase_realtime add table public.shift_types;
alter publication supabase_realtime add table public.pay_settings;
alter publication supabase_realtime add table public.schedule_template_shifts;
alter publication supabase_realtime add table public.published_months;
alter publication supabase_realtime add table public.shifts;
alter publication supabase_realtime add table public.shift_payments;
