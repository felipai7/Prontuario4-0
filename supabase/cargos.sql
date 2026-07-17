-- ══════════════════════════════════════════════════════════════════════════
-- CARGOS: profissão × nível
--
-- O modelo tem duas dimensões de propósito. Um enum plano
-- ('medico_intensivista', 'enfermeiro', ...) funcionaria hoje, mas o dia em que
-- houver enfermeiro-chefe vira 'enfermeiro_chefe' + 'enfermeiro_plantonista', e
-- toda regra que pergunta "é chefe?" passa a precisar conhecer a lista inteira.
-- Com duas colunas, esse dia é um update.
--
--   profissao: medico | enfermeiro | fisioterapeuta | nutricionista
--   nivel:     chefe  | plantonista
--
-- Hoje: médico+chefe = Médico Intensivista (chefe da unidade, edita tudo);
--       médico+plantonista = Médico Plantonista;
--       as demais profissões só existem em nível plantonista.
--
-- Regra de edição no prontuário (aplicada na UI, em lib/modules.tsx):
--   médico+chefe edita tudo; todos os outros veem tudo e editam só a própria aba.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.staff
  add column if not exists profissao text not null default 'medico';

alter table public.staff
  drop constraint if exists staff_profissao_check;
alter table public.staff
  add constraint staff_profissao_check
  check (profissao in ('medico', 'enfermeiro', 'fisioterapeuta', 'nutricionista'));

-- `nivel` substitui `role`. Backfill antes de tornar obrigatório.
alter table public.staff add column if not exists nivel text;
update public.staff set nivel = role where nivel is null;
alter table public.staff alter column nivel set not null;

alter table public.staff drop constraint if exists staff_nivel_check;
alter table public.staff
  add constraint staff_nivel_check check (nivel in ('chefe', 'plantonista'));

-- ── Helpers ───────────────────────────────────────────────────────────────

-- is_chefe controla as ESCALAS, que hoje são só dos médicos. Exigir
-- profissao='medico' aqui evita que um futuro enfermeiro-chefe ganhe, de
-- brinde, o direito de editar a escala médica. Quando as escalas abrirem para
-- outras profissões, o escopo passa a ser por profissão, não por unidade só.
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
      and nivel = 'chefe'
      and profissao = 'medico'
      and active = true
  )
$$;

-- Cargo do usuário logado, para a UI decidir o que ele edita.
-- security definer: lê o próprio staff sem depender da política de leitura.
create or replace function public.meu_cargo()
returns table (profissao text, nivel text)
language sql
security definer
set search_path = public
stable
as $$
  select s.profissao, s.nivel
    from public.staff s
   where s.user_id = auth.uid() and s.active = true
   -- Se a pessoa tiver cargo em mais de uma unidade, o mais permissivo vence.
   order by (s.nivel = 'chefe') desc
   limit 1
$$;

grant execute on function public.meu_cargo() to authenticated;

-- Políticas que olhavam `role` passam a olhar `nivel` + `profissao`.
drop policy if exists "Escrita de units só para chefes" on public.units;
create policy "Escrita de units só para chefes"
on public.units for all
to authenticated
using (exists (select 1 from public.staff
                where user_id = auth.uid() and nivel = 'chefe'
                  and profissao = 'medico' and active = true))
with check (exists (select 1 from public.staff
                where user_id = auth.uid() and nivel = 'chefe'
                  and profissao = 'medico' and active = true));

create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
stable
as $$
  select case when exists (
    select 1 from public.staff
     where user_id = auth.uid() and nivel = 'chefe'
       and profissao = 'medico' and active = true
  ) then (select id from auth.users where email = lower(trim(p_email)) limit 1)
  end
$$;

-- `role` sai de cena: duas fontes de verdade para a mesma coisa é pior que uma
-- migração. Roda por último, quando nada mais depende dela.
alter table public.staff drop column if exists role;
