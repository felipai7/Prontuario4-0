-- ══════════════════════════════════════════════════════════════════════════
-- CONTAGENS MENSAIS LANÇADAS À MÃO
--
-- Guarda uma linha da aba "Dados Mensais" da planilha do Dr. Flaubert — os
-- meses anteriores ao app, e os campos que o app ainda não calcula.
--
-- Serve a dois propósitos:
--   1. História: o app abre com a série dele dentro, não vazio.
--   2. Migração: enquanto Nutrição/Fisio/Enfermagem não existem, ele continua
--      lançando esses campos à mão. Cada módulo novo assume a sua fatia, e a
--      planilha é absorvida coluna a coluna em vez de substituída de uma vez.
--
-- `valores` é jsonb e não 77 colunas de propósito: o conjunto de campos ainda
-- vai mudar conforme os módulos chegam, e uma coluna por campo viraria uma
-- migração a cada mudança. As chaves seguem os nomes de ContagensMes (types/index.ts).
--
-- Uma linha por mês: o banco é de um cliente só (um Supabase por unidade).
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.contagens_mensais_manuais (
  mes         date primary key,
  valores     jsonb not null default '{}'::jsonb,
  fonte       text not null default 'planilha' check (fonte in ('planilha', 'manual')),
  observacao  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

comment on table public.contagens_mensais_manuais is
  'Linhas de "Dados Mensais" lançadas à mão: meses históricos e campos que o app ainda não calcula.';
comment on column public.contagens_mensais_manuais.valores is
  'Chaves = nomes de ContagensMes. Campo ausente ≠ zero: significa "não sei", e o indicador fica pendente.';

alter table public.contagens_mensais_manuais enable row level security;

-- Dado de gestão, mesmo recorte da tela de indicadores: só o Médico Intensivista.
-- Aqui vale um guard de verdade no banco, e não só na UI, porque estes números
-- viram o histórico oficial da unidade — não podem ser reescritos por engano.
create or replace function public.sou_medico_intensivista()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.staff
     where user_id = auth.uid()
       and profissao = 'medico' and nivel = 'chefe' and active = true
  )
$$;

grant execute on function public.sou_medico_intensivista() to authenticated;

drop policy if exists "Contagens manuais só para o intensivista" on public.contagens_mensais_manuais;
create policy "Contagens manuais só para o intensivista"
on public.contagens_mensais_manuais for all
to authenticated
using (public.sou_medico_intensivista())
with check (public.sou_medico_intensivista());

create or replace function public.touch_contagens_manuais()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_contagens_manuais on public.contagens_mensais_manuais;
create trigger trg_touch_contagens_manuais
  before update on public.contagens_mensais_manuais
  for each row execute function public.touch_contagens_manuais();
