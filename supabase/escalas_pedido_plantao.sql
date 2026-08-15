-- ══════════════════════════════════════════════════════════════════════════
-- ESCALAS: pedir o plantão de um colega (sentido inverso da oferta que já
-- existia). Antes, swap_requests só cobria "eu ofereço meu plantão a um
-- colega" (requester = dono atual, target = quem recebe e precisa aceitar).
-- Agora também cobre "eu peço o plantão de um colega" (requester = quem
-- quer o plantão, target = dono atual, que precisa aceitar abrir mão dele).
-- Em ambos os casos quem precisa aceitar continua sendo target_staff_id —
-- só muda quem fica com o plantão depois do aceite.
-- ══════════════════════════════════════════════════════════════════════════

begin;

alter table public.swap_requests
  add column if not exists tipo text not null default 'oferta' check (tipo in ('oferta', 'pedido'));

drop policy if exists "Criação de swap_requests pelo dono do plantão ou chefe" on public.swap_requests;
create policy "Criação de swap_requests pelo dono do plantão, convidado ou chefe"
on public.swap_requests for insert to authenticated
with check (
  public.is_chefe(auth.uid(), unit_id)
  or (
    tipo = 'oferta'
    and exists (select 1 from public.staff st where st.id = requester_id and st.user_id = auth.uid() and st.active)
    and exists (select 1 from public.shifts s where s.id = shift_id and s.staff_id = requester_id and s.unit_id = unit_id)
  )
  or (
    tipo = 'pedido'
    and exists (select 1 from public.staff st where st.id = requester_id and st.user_id = auth.uid() and st.active)
    and exists (select 1 from public.shifts s where s.id = shift_id and s.staff_id = target_staff_id and s.unit_id = unit_id and s.staff_id is distinct from requester_id)
  )
);

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

  if v_swap.tipo = 'oferta' then
    if v_shift.staff_id <> v_swap.requester_id then
      raise exception 'O plantão já foi alterado por outra troca.';
    end if;
    update public.shifts set staff_id = v_swap.target_staff_id, status = 'swapped' where id = v_shift.id;
  else -- pedido
    if v_shift.staff_id <> v_swap.target_staff_id then
      raise exception 'O plantão já foi alterado por outra troca.';
    end if;
    update public.shifts set staff_id = v_swap.requester_id, status = 'swapped' where id = v_shift.id;
  end if;

  update public.swap_requests
  set status = 'accepted', resolved_at = now()
  where id = p_swap_id;

  -- rejeita automaticamente qualquer outra troca pendente pro mesmo plantão
  update public.swap_requests
  set status = 'rejected', resolved_at = now()
  where shift_id = v_shift.id and id <> p_swap_id and status = 'pending';
end;
$$;

commit;
