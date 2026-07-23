-- ══════════════════════════════════════════════════════════════════════════
-- MULTI-UNIDADE — ETAPA 1: a planta da UTI sai do código e vai para o banco
--
-- PROBLEMA QUE RESOLVE
-- Hoje a planta física da unidade (2 alas, 19 leitos) está escrita em
-- lib/config.ts (ALAS) e espelhada numa check constraint em pacientes.ala_id.
-- Vender para uma segunda UTI exigiria editar código, buildar e publicar — e
-- as duas unidades nunca poderiam coexistir na mesma instalação.
--
-- Depois desta etapa, cadastrar uma unidade nova é INSERT, não deploy.
--
-- DECISÕES
--
-- 1. `pacientes.ala_id` continua sendo TEXT com o código da ala ('uti-01'), e
--    não vira uuid. Motivo: o índice `one_active_patient_per_bed` e dezenas de
--    queries usam (ala_id, numero_leito). Trocar por uuid daria uma migração
--    muito maior sem ganho — o código já é único dentro da unidade. A garantia
--    de integridade vem da FK composta (unit_id, ala_id) → alas(unit_id, codigo).
--
-- 2. Leitos viram LINHAS, não um range calculado. Só assim dá para desativar um
--    leito (interdição, reforma) e ter o histórico certo.
--
-- 3. Leito tem VIGÊNCIA (ativo_desde / ativo_ate). Sem isso, uma UTI que passa
--    de 19 para 25 leitos em março reescreveria retroativamente a taxa de
--    ocupação de janeiro — os leitos-dia do passado passariam a ser contados
--    com o número de leitos de hoje. Com vigência, cada dia usa o número de
--    leitos que valia NAQUELE dia.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── ALAS ──────────────────────────────────────────────────────────────────
create table if not exists public.alas (
  id         uuid default uuid_generate_v4() primary key,
  unit_id    uuid not null references public.units(id) on delete cascade,
  codigo     text not null,
  nome       text not null,
  ordem      integer not null default 0,
  ativa      boolean not null default true,
  created_at timestamptz not null default now(),
  unique (unit_id, codigo)
);

create index if not exists alas_unit_id_idx on public.alas(unit_id);

comment on table public.alas is
  'Alas de uma unidade. Substitui a constante ALAS de lib/config.ts.';
comment on column public.alas.codigo is
  'Código curto usado em pacientes.ala_id (ex.: uti-01). Único dentro da unidade.';

-- ── LEITOS ────────────────────────────────────────────────────────────────
create table if not exists public.leitos (
  id          uuid default uuid_generate_v4() primary key,
  ala_id      uuid not null references public.alas(id) on delete cascade,
  numero      integer not null,
  ativo_desde date not null default '2000-01-01',
  ativo_ate   date,
  created_at  timestamptz not null default now(),
  unique (ala_id, numero),
  constraint leito_vigencia_coerente check (ativo_ate is null or ativo_ate >= ativo_desde)
);

create index if not exists leitos_ala_id_idx on public.leitos(ala_id);

comment on table public.leitos is
  'Um leito por linha, com vigência. ativo_ate null = ativo até hoje.';
comment on column public.leitos.ativo_desde is
  'Data em que o leito passou a existir/operar. Antes disso ele não conta nos leitos-dia.';

-- ── PACIENTES GANHAM UNIDADE ──────────────────────────────────────────────
alter table public.pacientes
  add column if not exists unit_id uuid references public.units(id) on delete restrict;

comment on column public.pacientes.unit_id is
  'Unidade dona do paciente. É o único ponto de tenancy do lado clínico: as
   outras 21 tabelas chegam na unidade por paciente_id.';

-- ── SEED: a UTI atual, exatamente como estava em lib/config.ts ────────────
--
-- Idempotente: rodar de novo não duplica. Se já houver alas cadastradas para a
-- unidade, o bloco não faz nada — a planta passou a ser editável no app e o
-- código não deve sobrescrever o que a unidade configurou.
do $$
declare
  v_unit  uuid;
  v_ala1  uuid;
  v_ala2  uuid;
begin
  select id into v_unit from public.units order by created_at limit 1;
  if v_unit is null then
    raise notice 'Nenhuma unidade cadastrada — seed de alas/leitos pulado.';
    return;
  end if;

  if exists (select 1 from public.alas where unit_id = v_unit) then
    raise notice 'Unidade % já tem alas — seed pulado.', v_unit;
  else
    insert into public.alas (unit_id, codigo, nome, ordem)
    values (v_unit, 'uti-01', 'UTI 01', 1) returning id into v_ala1;
    insert into public.alas (unit_id, codigo, nome, ordem)
    values (v_unit, 'uti-02', 'UTI 02', 2) returning id into v_ala2;

    -- UTI 01: leitos 1–9. UTI 02: leitos 10–19. Igual ao ALAS de lib/config.ts.
    insert into public.leitos (ala_id, numero)
    select v_ala1, n from generate_series(1, 9) n;
    insert into public.leitos (ala_id, numero)
    select v_ala2, n from generate_series(10, 19) n;
  end if;

  -- Pacientes existentes (se houver) pertencem à unidade original.
  update public.pacientes set unit_id = v_unit where unit_id is null;
end $$;

-- Só agora a coluna pode ser obrigatória: o backfill acima já rodou.
do $$
begin
  if not exists (select 1 from public.pacientes where unit_id is null) then
    alter table public.pacientes alter column unit_id set not null;
  else
    raise warning 'Há pacientes sem unit_id — coluna deixada nullable. Corrija e rode: alter table public.pacientes alter column unit_id set not null;';
  end if;
end $$;

create index if not exists pacientes_unit_id_idx on public.pacientes(unit_id);

-- ── A CHECK CONSTRAINT DE ala_id DÁ LUGAR À FK ────────────────────────────
--
-- Era ela que travava tudo: `check (ala_id in ('uti-01','uti-02'))` significa
-- que nenhuma outra UTI poderia usar este banco sem um ALTER TABLE.
alter table public.pacientes drop constraint if exists pacientes_ala_id_check;

-- Chave candidata que a FK composta precisa referenciar.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pacientes_unidade_ala_fkey'
       and conrelid = 'public.pacientes'::regclass
  ) then
    alter table public.pacientes
      add constraint pacientes_unidade_ala_fkey
      foreign key (unit_id, ala_id) references public.alas(unit_id, codigo)
      on update cascade;
  end if;
end $$;

-- O índice de "um paciente ativo por leito" precisa considerar a unidade:
-- duas UTIs diferentes podem ter, cada uma, um paciente no leito 5 da uti-01.
drop index if exists public.one_active_patient_per_bed;
create unique index if not exists one_active_patient_per_bed
  on public.pacientes(unit_id, ala_id, numero_leito)
  where ativo = true;

-- ── LEITOS-DIA VÊM DO BANCO, NÃO DO TYPESCRIPT ────────────────────────────
--
-- Substitui calcularLeitosDia() de lib/indicadores/formulas.ts, que multiplicava
-- um número fixo de leitos pelos dias do mês. Aqui cada dia é contado com os
-- leitos que estavam vigentes naquele dia, e o mês corrente para no dia de hoje
-- (senão a ocupação do mês em curso sairia diluída pelos dias que ainda não
-- aconteceram).
create or replace function public.leitos_dia_mes(p_unit_id uuid, p_mes date)
returns bigint
language sql
stable
security invoker
as $$
  with dias as (
    select d::date as dia
      from generate_series(
             p_mes,
             least((p_mes + interval '1 month' - interval '1 day')::date, current_date),
             interval '1 day') d
  )
  select coalesce(count(*), 0)
    from dias
    join public.leitos l on l.ativo_desde <= dias.dia
                        and (l.ativo_ate is null or l.ativo_ate >= dias.dia)
    join public.alas  a on a.id = l.ala_id and a.ativa
   where a.unit_id = p_unit_id;
$$;

comment on function public.leitos_dia_mes(uuid, date) is
  'Leitos-dia do mês para a unidade, respeitando a vigência de cada leito.';

/** Leitos vigentes hoje (denominador de indicadores instantâneos, como giro). */
create or replace function public.leitos_ativos(p_unit_id uuid, p_dia date default current_date)
returns integer
language sql
stable
security invoker
as $$
  select coalesce(count(*), 0)::integer
    from public.leitos l
    join public.alas a on a.id = l.ala_id and a.ativa
   where a.unit_id = p_unit_id
     and l.ativo_desde <= p_dia
     and (l.ativo_ate is null or l.ativo_ate >= p_dia);
$$;

-- ── RLS DAS TABELAS NOVAS ─────────────────────────────────────────────────
alter table public.alas   enable row level security;
alter table public.leitos enable row level security;

drop policy if exists "Leitura de alas para a equipe da unidade" on public.alas;
create policy "Leitura de alas para a equipe da unidade"
on public.alas for select to authenticated
using (public.is_staff(auth.uid(), unit_id) or public.is_chefe(auth.uid(), unit_id));

drop policy if exists "Escrita de alas só para o chefe da unidade" on public.alas;
create policy "Escrita de alas só para o chefe da unidade"
on public.alas for all to authenticated
using (public.is_chefe(auth.uid(), unit_id))
with check (public.is_chefe(auth.uid(), unit_id));

-- Leito não tem unit_id próprio: a unidade vem pela ala.
drop policy if exists "Leitura de leitos para a equipe da unidade" on public.leitos;
create policy "Leitura de leitos para a equipe da unidade"
on public.leitos for select to authenticated
using (exists (
  select 1 from public.alas a
   where a.id = leitos.ala_id
     and (public.is_staff(auth.uid(), a.unit_id) or public.is_chefe(auth.uid(), a.unit_id))
));

drop policy if exists "Escrita de leitos só para o chefe da unidade" on public.leitos;
create policy "Escrita de leitos só para o chefe da unidade"
on public.leitos for all to authenticated
using (exists (
  select 1 from public.alas a where a.id = leitos.ala_id and public.is_chefe(auth.uid(), a.unit_id)
))
with check (exists (
  select 1 from public.alas a where a.id = leitos.ala_id and public.is_chefe(auth.uid(), a.unit_id)
));

commit;
