-- Permite que um chefe encontre o user_id de uma conta existente pelo e-mail,
-- para vinculá-la a uma unidade em `staff`. Não expõe nada além do id —
-- só quem já é chefe de alguma unidade pode chamar.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_is_chefe boolean;
  v_user_id uuid;
begin
  select exists (
    select 1 from public.staff where user_id = auth.uid() and role = 'chefe' and active = true
  ) into v_caller_is_chefe;

  if not v_caller_is_chefe then
    raise exception 'Apenas chefes podem buscar usuários.';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(p_email);
  return v_user_id;
end;
$$;
