-- ══════════════════════════════════════════════════════════════════════════
-- MULTI-UNIDADE — ETAPA 4: criar unidade sem se trancar para fora
--
-- O PROBLEMA
-- Depois da etapa 3, `units` tem escrita liberada para chefes mas leitura
-- restrita a `sou_da_unidade(id)`. Um chefe consegue INSERT numa unidade nova
-- e ela desaparece da vista dele no mesmo instante — ele não é staff dela. E
-- ele também não consegue se adicionar: a policy de `staff` exige
-- is_chefe(auth.uid(), unit_id) para a unidade NOVA, que ele ainda não é.
-- Impasse: a unidade fica órfã, sem dono, invisível para todos.
--
-- A SOLUÇÃO
-- Uma função `security definer` que cria a unidade E o vínculo de chefe do
-- criador na mesma transação. Atômico de propósito: uma unidade sem chefe é
-- exatamente o estado impossível de consertar pela interface.
-- ══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.criar_unidade(p_nome text, p_meu_nome text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit uuid;
  v_uid  uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;

  -- security definer ignora RLS, então a checagem de permissão precisa ser
  -- explícita aqui: só quem já é chefe de alguma unidade pode abrir outra.
  if not exists (
    select 1 from public.staff
     where user_id = v_uid and nivel = 'chefe' and profissao = 'medico' and active
  ) then
    raise exception 'Apenas o médico intensivista (chefe) pode criar unidades.';
  end if;

  if coalesce(trim(p_nome), '') = '' then
    raise exception 'O nome da unidade é obrigatório.';
  end if;

  insert into public.units (name) values (trim(p_nome)) returning id into v_unit;

  insert into public.staff (user_id, unit_id, full_name, profissao, nivel, active)
  values (
    v_uid, v_unit,
    coalesce(nullif(trim(p_meu_nome), ''),
             (select full_name from public.staff where user_id = v_uid and active order by created_at limit 1),
             'Chefe'),
    'medico', 'chefe', true);

  return v_unit;
end $$;

comment on function public.criar_unidade(text, text) is
  'Cria unidade e já vincula quem chamou como chefe. Sem isso a unidade nasce órfã e invisível.';

revoke all on function public.criar_unidade(text, text) from public;
grant execute on function public.criar_unidade(text, text) to authenticated;

commit;
