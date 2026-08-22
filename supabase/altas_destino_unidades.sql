-- ══════════════════════════════════════════════════════════════════════════
-- Corrige: alta "UTI para Hospital" (e o inverso) ficava com o seletor de
-- unidade destino sempre vazio quando quem dava a alta não era staff da
-- unidade destino. AltaModal.tsx consultava `units` direto — mas
-- multiunidade_3_units.sql já havia fechado o SELECT de `units` para
-- `sou_da_unidade(id)`, contradizendo o comentário do próprio AltaModal.tsx
-- ("transferir daqui pra lá não exige ser staff de lá também"). A RPC
-- listar_unidades_ativas() (perfil_autoatendimento.sql) já contorna essa RLS
-- via security definer, mas só devolvia id/name — falta tipo_unidade para
-- filtrar o destino certo (UTI só recebe de Hospital e vice-versa).
-- ══════════════════════════════════════════════════════════════════════════

-- Muda o formato de retorno (nova coluna) — precisa dropar antes de recriar,
-- Postgres não deixa `create or replace` alterar o shape das OUT columns.
drop function if exists public.listar_unidades_ativas();

create function public.listar_unidades_ativas()
returns table (id uuid, name text, tipo_unidade text)
language sql
security definer
set search_path = public
stable
as $$
  select id, name, tipo_unidade from public.units where active = true order by name
$$;
grant execute on function public.listar_unidades_ativas() to authenticated;
