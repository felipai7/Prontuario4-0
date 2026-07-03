-- ============================================================
-- MÓDULO DE ESCALAS — FASE 5: Trocas de plantão
-- ============================================================

create table public.swap_requests (
  id               uuid default uuid_generate_v4() primary key,
  unit_id          uuid not null references public.units(id) on delete cascade,
  shift_id         uuid not null references public.shifts(id) on delete cascade,
  requester_id     uuid not null references public.staff(id),
  target_staff_id  uuid not null references public.staff(id),
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  reason           text,
  created_at       timestamptz default now() not null,
  resolved_at      timestamptz
);

create index swap_requests_unit_id_idx on public.swap_requests(unit_id);
create index swap_requests_shift_id_idx on public.swap_requests(shift_id);

alter table public.swap_requests enable row level security;

-- Leitura: qualquer membro da unidade vê as trocas (precisa saber quem pediu o quê pra quem)
create policy "Leitura de swap_requests para membros da unidade"
on public.swap_requests for select to authenticated
using (public.is_staff(auth.uid(), unit_id) or public.is_chefe(auth.uid(), unit_id));

-- Criação: o próprio solicitante (dono atual do plantão) ou o chefe da unidade
create policy "Criação de swap_requests pelo dono do plantão ou chefe"
on public.swap_requests for insert to authenticated
with check (
  public.is_chefe(auth.uid(), unit_id)
  or (
    exists (select 1 from public.staff st where st.id = requester_id and st.user_id = auth.uid() and st.active)
    and exists (select 1 from public.shifts s where s.id = shift_id and s.staff_id = requester_id and s.unit_id = unit_id)
  )
);

-- Atualização (cancelar/rejeitar direto na tabela): solicitante, convidado ou chefe.
-- A transição para 'accepted' (que também atualiza shifts) só acontece via a função accept_swap.
create policy "Atualização de swap_requests por solicitante, convidado ou chefe"
on public.swap_requests for update to authenticated
using (
  public.is_chefe(auth.uid(), unit_id)
  or exists (select 1 from public.staff st where st.id = requester_id and st.user_id = auth.uid())
  or exists (select 1 from public.staff st where st.id = target_staff_id and st.user_id = auth.uid())
)
with check (
  public.is_chefe(auth.uid(), unit_id)
  or exists (select 1 from public.staff st where st.id = requester_id and st.user_id = auth.uid())
  or exists (select 1 from public.staff st where st.id = target_staff_id and st.user_id = auth.uid())
);

alter publication supabase_realtime add table public.swap_requests;

-- ──────────────────────────────────────────
-- Aceitar troca — transacional: trava a troca e o plantão envolvido,
-- confirma que ninguém mexeu antes, só então efetiva. security definer
-- porque a escrita em `shifts` normalmente é restrita a chefe — aqui,
-- a própria função garante que só o profissional convidado pode
-- executar a troca, então pode elevar privilégio com segurança.
-- ──────────────────────────────────────────
create or replace function public.accept_swap(p_swap_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_swap  public.swap_requests%rowtype;
  v_shift public.shifts%rowtype;
begin
  select * into v_swap from public.swap_requests where id = p_swap_id for update;
  if not found then
    raise exception 'Troca não encontrada.';
  end if;

  if not exists (select 1 from public.staff st where st.id = v_swap.target_staff_id and st.user_id = auth.uid()) then
    raise exception 'Só o profissional convidado pode aceitar esta troca.';
  end if;

  if v_swap.status <> 'pending' then
    raise exception 'Esta troca não está mais pendente.';
  end if;

  select * into v_shift from public.shifts where id = v_swap.shift_id for update;

  if v_shift.staff_id <> v_swap.requester_id then
    raise exception 'O plantão já foi alterado por outra troca.';
  end if;

  update public.shifts
  set staff_id = v_swap.target_staff_id, status = 'swapped'
  where id = v_shift.id;

  update public.swap_requests
  set status = 'accepted', resolved_at = now()
  where id = p_swap_id;

  -- rejeita automaticamente qualquer outra troca pendente pro mesmo plantão
  update public.swap_requests
  set status = 'rejected', resolved_at = now()
  where shift_id = v_shift.id and id <> p_swap_id and status = 'pending';
end;
$$;
