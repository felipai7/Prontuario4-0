-- Run in Supabase SQL Editor ou via `supabase db query --linked --file`

-- ══════════════════════════════════════════════════════════════════════════
-- UTI e Hospital sempre aceitaram os mesmos convênios — manter uma lista de
-- planos por unidade (supabase/planos_saude.sql) era duplicação sem motivo,
-- e deixava as duas listas livres pra divergir com o tempo. Planos de saúde
-- viram catálogo único, editável pelo chefe em /unidade independente de qual
-- unidade estiver selecionada na tela.
-- ══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.planos_saude (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  created_at timestamptz not null default now()
);

alter table public.planos_saude enable row level security;

create policy "Authenticated users can manage planos_saude"
  on public.planos_saude for all to authenticated
  using (true) with check (true);

-- União do que já existia nas duas unidades vira o catálogo único.
insert into public.planos_saude (nome)
values ('IPASGO'), ('Unimed'), ('Particular'), ('Bradesco'),
       ('CELGMED'), ('IMEC Colaboradora'), ('Saúde Caixa')
on conflict (nome) do nothing;

alter table public.units drop column if exists planos_saude;

commit;
