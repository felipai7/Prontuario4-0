-- ══════════════════════════════════════════════════════════════════════════
-- MULTI-UNIDADE — ETAPA 2: isolamento real entre unidades
--
-- ⚠️  ESTA É A ETAPA QUE MUDA QUEM VÊ O QUÊ. Leia antes de rodar.
--
-- O PROBLEMA
-- Todas as 23 tabelas clínicas têm hoje a mesma política:
--     for all to authenticated using (true) with check (true)
-- Ou seja: QUALQUER pessoa logada vê e edita TODOS os pacientes. Numa única
-- UTI isso é aceitável (é uma equipe só). Com duas unidades no mesmo banco,
-- é vazamento de prontuário entre hospitais concorrentes.
--
-- A SOLUÇÃO
-- `pacientes.unit_id` (etapa 1) é o único ponto de tenancy: as outras 22
-- tabelas chegam na unidade por `paciente_id`. Então a regra é uma só —
-- "você vê o paciente se é staff ativo da unidade dele" — aplicada 23 vezes.
--
-- DUAS TABELAS SOBREVIVEM AO PACIENTE e por isso ganham unit_id próprio:
--   • resumos_alta (paciente_id é ON DELETE SET NULL)
--   • auditoria_intensivista (não tem FK nenhuma)
-- Sem unit_id próprio, uma alta ou um registro de auditoria ficaria invisível
-- e ineditável para sempre no dia em que o paciente fosse removido.
--
-- ANTES DE RODAR — RISCO DE TRANCAR USUÁRIO PARA FORA
-- Quem não tem linha em `staff` hoje enxerga tudo (porque a política é `true`);
-- depois desta etapa, enxerga NADA. O bloco de seed abaixo cria staff para todo
-- auth.users órfão, na unidade padrão, como medico/plantonista — que é
-- exatamente o acesso que essas pessoas já têm hoje (indicadores continuam
-- restritos ao intensivista). Revise a lista depois.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── SEED DEFENSIVO: ninguém perde acesso ao rodar esta migração ───────────
do $$
declare
  v_unit uuid;
  v_n    integer;
begin
  select id into v_unit from public.units order by created_at limit 1;
  if v_unit is null then
    raise exception 'Nenhuma unidade cadastrada — abortando: o RLS trancaria todo mundo para fora.';
  end if;

  insert into public.staff (user_id, unit_id, full_name, profissao, nivel, active)
  select u.id, v_unit, coalesce(split_part(u.email, '@', 1), 'Sem nome'), 'medico', 'plantonista', true
    from auth.users u
   where not exists (select 1 from public.staff s where s.user_id = u.id)
  on conflict (user_id, unit_id) do nothing;

  get diagnostics v_n = row_count;
  if v_n > 0 then
    raise warning 'Criadas % linhas de staff para usuários órfãos (medico/plantonista na unidade padrão). REVISE cargo e unidade de cada um.', v_n;
  end if;
end $$;

-- ── TABELAS QUE SOBREVIVEM AO PACIENTE GANHAM UNIDADE PRÓPRIA ────────────
alter table public.resumos_alta
  add column if not exists unit_id uuid references public.units(id) on delete restrict;
alter table public.auditoria_intensivista
  add column if not exists unit_id uuid references public.units(id) on delete restrict;

-- contagens_mensais_manuais é lançamento à mão do mês: era global, vira por unidade.
alter table public.contagens_mensais_manuais
  add column if not exists unit_id uuid references public.units(id) on delete cascade;

do $$
declare v_unit uuid;
begin
  select id into v_unit from public.units order by created_at limit 1;

  -- Preferir a unidade do paciente; cair na padrão só para linhas já órfãs.
  update public.resumos_alta r set unit_id = coalesce(
    (select p.unit_id from public.pacientes p where p.id = r.paciente_id), v_unit)
   where r.unit_id is null;

  update public.auditoria_intensivista a set unit_id = coalesce(
    (select p.unit_id from public.pacientes p where p.id = a.paciente_id), v_unit)
   where a.unit_id is null;

  update public.contagens_mensais_manuais set unit_id = v_unit where unit_id is null;
end $$;

-- PK de contagens manuais era só `mes` — duas unidades não podiam lançar o
-- mesmo mês. Passa a ser (unit_id, mes).
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.contagens_mensais_manuais'::regclass and contype = 'p'
                and pg_get_constraintdef(oid) = 'PRIMARY KEY (mes)') then
    alter table public.contagens_mensais_manuais drop constraint contagens_mensais_manuais_pkey;
    alter table public.contagens_mensais_manuais alter column unit_id set not null;
    alter table public.contagens_mensais_manuais add primary key (unit_id, mes);
  end if;
end $$;

-- Novas linhas herdam a unidade do paciente automaticamente: nenhuma tela
-- precisa lembrar de preencher unit_id.
create or replace function public.herdar_unidade_do_paciente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.unit_id is null and new.paciente_id is not null then
    select p.unit_id into new.unit_id from public.pacientes p where p.id = new.paciente_id;
  end if;
  return new;
end $$;

drop trigger if exists resumos_alta_herda_unidade on public.resumos_alta;
create trigger resumos_alta_herda_unidade
  before insert on public.resumos_alta
  for each row execute function public.herdar_unidade_do_paciente();

drop trigger if exists auditoria_herda_unidade on public.auditoria_intensivista;
create trigger auditoria_herda_unidade
  before insert on public.auditoria_intensivista
  for each row execute function public.herdar_unidade_do_paciente();

-- ── HELPERS ──────────────────────────────────────────────────────────────
--
-- security definer é obrigatório: chamadas de dentro de uma policy de
-- `pacientes` fariam RLS recursivo se lessem `pacientes` como invoker.

/** Sou staff ativo da unidade? (qualquer profissão, qualquer nível) */
create or replace function public.sou_da_unidade(p_unit_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.staff s
     where s.user_id = auth.uid() and s.unit_id = p_unit_id and s.active
  );
$$;

/** Posso acessar este paciente? Usado pelas 21 tabelas filhas. */
create or replace function public.posso_ver_paciente(p_paciente_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.pacientes p
      join public.staff s on s.unit_id = p.unit_id
     where p.id = p_paciente_id and s.user_id = auth.uid() and s.active
  );
$$;

-- ── PACIENTES ────────────────────────────────────────────────────────────
drop policy if exists "Equipe - pacientes" on public.pacientes;
drop policy if exists "Equipe da unidade - pacientes" on public.pacientes;
create policy "Equipe da unidade - pacientes"
on public.pacientes for all to authenticated
using (public.sou_da_unidade(unit_id))
with check (public.sou_da_unidade(unit_id));

-- ── AS 21 TABELAS FILHAS ─────────────────────────────────────────────────
--
-- Geradas em laço em vez de 21 blocos copiados: a regra é literalmente a mesma
-- para todas, e copiar convida a divergência silenciosa numa delas — que é
-- exatamente onde o vazamento passaria despercebido.
do $$
declare
  t text;
  filhas text[] := array[
    'atbs', 'avaliacoes_neurologicas', 'cuidados_horizontais', 'dispositivos',
    'dvas', 'exames', 'exames_imagem', 'fisio_avaliacoes_diarias', 'fisio_eventos',
    'intercorrencias', 'iras_eventos', 'iras_sepse_choque', 'lpp_eventos',
    'nutricao_avaliacoes', 'nutricao_dia', 'pendencias_intensivista',
    'periodos_balanco', 'periodos_hemodinamica', 'registros_intensivista',
    'sinais_vitais', 'suportes_ventilatorios'
  ];
  pol record;
begin
  foreach t in array filhas loop
    -- Fora as políticas antigas (nomes variam entre as migrações originais).
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);
    execute format($f$
      create policy "Equipe da unidade do paciente" on public.%I
        for all to authenticated
        using (public.posso_ver_paciente(paciente_id))
        with check (public.posso_ver_paciente(paciente_id))
    $f$, t);
  end loop;
end $$;

-- ── AS DUAS QUE TÊM unit_id PRÓPRIO ──────────────────────────────────────
do $$
declare pol record;
begin
  for pol in select policyname, tablename from pg_policies
              where schemaname='public' and tablename in ('resumos_alta','auditoria_intensivista') loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy "Equipe da unidade - resumos_alta"
on public.resumos_alta for all to authenticated
using (public.sou_da_unidade(unit_id))
with check (public.sou_da_unidade(unit_id));

create policy "Equipe da unidade - auditoria"
on public.auditoria_intensivista for all to authenticated
using (public.sou_da_unidade(unit_id))
with check (public.sou_da_unidade(unit_id));

-- ── CONTAGENS MANUAIS ────────────────────────────────────────────────────
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
              where schemaname='public' and tablename='contagens_mensais_manuais' loop
    execute format('drop policy %I on public.contagens_mensais_manuais', pol.policyname);
  end loop;
end $$;

create policy "Equipe da unidade - contagens manuais"
on public.contagens_mensais_manuais for all to authenticated
using (public.sou_da_unidade(unit_id))
with check (public.sou_da_unidade(unit_id));

-- ── A VIEW PRECISA RESPEITAR O RLS DE QUEM CHAMA ─────────────────────────
--
-- ARMADILHA CENTRAL DESTA MIGRAÇÃO: por padrão uma view roda com os direitos
-- do DONO dela (postgres), e portanto IGNORA o RLS das tabelas de baixo. Como
-- as 6 RPCs de indicadores são `security invoker` mas leem `censo_diario`, sem
-- esta linha todas elas continuariam contando os pacientes-dia de TODAS as
-- unidades — os indicadores de um cliente incluiriam os pacientes do outro,
-- silenciosamente e sem erro nenhum.
-- unit_id entra no FIM da lista de colunas de propósito: `create or replace
-- view` só aceita acrescentar colunas ao final — no meio, o Postgres recusa
-- ("cannot change name of view column"), e aí só um DROP resolveria.
create or replace view public.censo_diario
with (security_invoker = true) as
select p.id as paciente_id, d.dia::date as dia, p.unit_id
  from public.pacientes p
  cross join lateral generate_series(
    p.data_internacao,
    least(
      coalesce(
        (select (r.data_alta at time zone 'America/Sao_Paulo')::date - 1
           from public.resumos_alta r
          where r.paciente_id = p.id and r.tipo_saida is not null
          order by r.data_alta desc
          limit 1),
        current_date),
      current_date),
    interval '1 day') as d(dia);

comment on view public.censo_diario is
  'Uma linha por (paciente, dia internado). Fonte única de pacientes-dia para contagens_mes e qualidade_mes. security_invoker: respeita o RLS da unidade de quem chama.';

commit;
