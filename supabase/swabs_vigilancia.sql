-- Run in Supabase SQL Editor ou via `supabase db query --linked --file`
--
-- SWABS DE VIGILÂNCIA
--
-- Marca a coleta e fica pendente (sem resultado) até alguém marcar que o
-- resultado chegou. O resultado em si é lançado na aba de Exames Laboratoriais
-- como sempre — esta tabela só controla o "está pendente ou não", pra gerar o
-- alerta. Nenhum link automático com `exames` por enquanto.

create table if not exists public.swabs_vigilancia (
  id                    uuid primary key default uuid_generate_v4(),
  paciente_id           uuid not null references public.pacientes(id) on delete cascade,
  data_coleta           date not null,
  resultado_disponivel  boolean not null default false,
  data_resultado        date,
  criado_em             timestamptz not null default now(),
  criado_por            uuid references auth.users(id) on delete set null,
  constraint swabs_vigilancia_resultado_check
    check (resultado_disponivel = (data_resultado is not null))
);

create index if not exists swabs_vigilancia_paciente_idx on public.swabs_vigilancia(paciente_id);
create index if not exists swabs_vigilancia_pendentes_idx on public.swabs_vigilancia(paciente_id)
  where not resultado_disponivel;

comment on table public.swabs_vigilancia is
  'Coleta de swab de vigilância e status do resultado — alimenta o alerta diário de pendência enquanto resultado_disponivel = false.';

-- Mesma regra de RLS das outras tabelas-filhas de paciente (ver
-- posso_ver_paciente em multiunidade_2_rls.sql): só quem está na unidade do
-- paciente enxerga a linha.
alter table public.swabs_vigilancia enable row level security;

drop policy if exists "Equipe da unidade do paciente" on public.swabs_vigilancia;
create policy "Equipe da unidade do paciente" on public.swabs_vigilancia
  for all to authenticated
  using (public.posso_ver_paciente(paciente_id))
  with check (public.posso_ver_paciente(paciente_id));
