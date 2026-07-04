-- ============================================================
-- MÓDULO DE ESCALAS — FASE 0: Multi-unidade + Staff
-- ============================================================

-- ──────────────────────────────────────────
-- UNITS
-- ──────────────────────────────────────────
create table public.units (
  id         uuid default uuid_generate_v4() primary key,
  name       text not null,
  active     boolean default true not null,
  created_at timestamptz default now() not null
);

-- ──────────────────────────────────────────
-- STAFF — vincula um auth.users a uma unidade com um papel
-- ──────────────────────────────────────────
create table public.staff (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references auth.users(id) on delete set null,
  unit_id    uuid not null references public.units(id) on delete cascade,
  full_name  text not null,
  role       text not null check (role in ('intensivista', 'chefe')),
  active     boolean default true not null,
  created_at timestamptz default now() not null,
  unique (user_id, unit_id)
);

create index staff_user_id_idx on public.staff(user_id);
create index staff_unit_id_idx on public.staff(unit_id);

-- ──────────────────────────────────────────
-- FUNÇÃO AUXILIAR: is_chefe(user, unit)
-- security definer para poder ser usada dentro de policies de outras tabelas
-- sem recursão de RLS na própria tabela staff
-- ──────────────────────────────────────────
create or replace function public.is_chefe(p_user_id uuid, p_unit_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.staff
    where user_id = p_user_id
      and unit_id = p_unit_id
      and role = 'chefe'
      and active = true
  );
$$;

-- Uma pessoa é "staff" de uma unidade (qualquer papel ativo) — usado pra leitura geral
create or replace function public.is_staff(p_user_id uuid, p_unit_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.staff
    where user_id = p_user_id
      and unit_id = p_unit_id
      and active = true
  );
$$;

-- ──────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────
alter table public.units enable row level security;
alter table public.staff enable row level security;

-- Units: qualquer autenticado pode ler (precisa pra popular seletor de unidade);
-- só chefe de QUALQUER unidade pode criar/editar/desativar unidades.
create policy "Leitura de units para autenticados"
on public.units for select
to authenticated
using (true);

create policy "Escrita de units só para chefes"
on public.units for all
to authenticated
using (exists (select 1 from public.staff where user_id = auth.uid() and role = 'chefe' and active = true))
with check (exists (select 1 from public.staff where user_id = auth.uid() and role = 'chefe' and active = true));

-- Staff: leitura para qualquer membro ativo da mesma unidade (precisa pra montar escala/trocas);
-- escrita só para chefe da unidade em questão.
create policy "Leitura de staff para membros da unidade"
on public.staff for select
to authenticated
using (public.is_staff(auth.uid(), unit_id) or public.is_chefe(auth.uid(), unit_id));

create policy "Escrita de staff só para chefe da unidade"
on public.staff for insert
to authenticated
with check (public.is_chefe(auth.uid(), unit_id));

create policy "Atualização de staff só para chefe da unidade"
on public.staff for update
to authenticated
using (public.is_chefe(auth.uid(), unit_id))
with check (public.is_chefe(auth.uid(), unit_id));

create policy "Exclusão de staff só para chefe da unidade"
on public.staff for delete
to authenticated
using (public.is_chefe(auth.uid(), unit_id));

-- ──────────────────────────────────────────
-- REALTIME
-- ──────────────────────────────────────────
alter publication supabase_realtime add table public.units;
alter publication supabase_realtime add table public.staff;

-- ──────────────────────────────────────────
-- SEED: unidade padrão + o usuário atual como chefe
-- (ajuste o e-mail abaixo se necessário antes de rodar)
-- ──────────────────────────────────────────
insert into public.units (name) values ('UTI Adulto') on conflict do nothing;
