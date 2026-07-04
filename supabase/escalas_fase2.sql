-- ============================================================
-- MÓDULO DE ESCALAS — FASE 2: Editor do mês padrão + auditoria
-- ============================================================

-- ──────────────────────────────────────────
-- SCHEDULE_TEMPLATE_AUDIT — histórico de alterações no mês padrão
-- ──────────────────────────────────────────
create table public.schedule_template_audit (
  id             uuid default uuid_generate_v4() primary key,
  unit_id        uuid not null references public.units(id) on delete cascade,
  day_number     int not null,
  shift_type_id  uuid references public.shift_types(id),
  old_staff_id   uuid references public.staff(id),
  new_staff_id   uuid references public.staff(id),
  changed_by     uuid references auth.users(id),
  changed_at     timestamptz default now() not null
);

create index schedule_template_audit_unit_id_idx on public.schedule_template_audit(unit_id);

create or replace function public.log_template_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.schedule_template_audit (unit_id, day_number, shift_type_id, old_staff_id, new_staff_id, changed_by)
  values (
    coalesce(new.unit_id, old.unit_id),
    coalesce(new.day_number, old.day_number),
    coalesce(new.shift_type_id, old.shift_type_id),
    old.staff_id,
    new.staff_id,
    auth.uid()
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_template_audit
after insert or update or delete on public.schedule_template_shifts
for each row execute function public.log_template_change();

-- ──────────────────────────────────────────
-- RLS: leitura do histórico só para chefe
-- ──────────────────────────────────────────
alter table public.schedule_template_audit enable row level security;

create policy "Leitura de auditoria do mês padrão só para chefe"
on public.schedule_template_audit for select to authenticated
using (public.is_chefe(auth.uid(), unit_id));

-- ──────────────────────────────────────────
-- REALTIME
-- ──────────────────────────────────────────
alter publication supabase_realtime add table public.schedule_template_audit;
