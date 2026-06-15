-- ============================================================
-- SCHEMA COMPLETO - Sistema UTI
-- Cole e execute no Supabase: SQL Editor → New query → Run
-- ============================================================

-- Extensão UUID
create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────
-- PACIENTES
-- ──────────────────────────────────────────
create table public.pacientes (
  id               uuid default uuid_generate_v4() primary key,
  nome             text not null,
  data_nascimento  date not null,
  plano_saude      text not null,
  data_internacao  date not null,
  hora_internacao  time not null,
  peso_kg          numeric(5,1),
  hipoteses        text,
  ala_id           text not null check (ala_id in ('uti-01', 'uti-02')),
  numero_leito     integer not null,
  ativo            boolean default true not null,
  created_at       timestamptz default now() not null,
  updated_at       timestamptz default now() not null
);

-- Garante que não haja dois pacientes ativos no mesmo leito
create unique index one_active_patient_per_bed
  on public.pacientes(ala_id, numero_leito)
  where ativo = true;

-- ──────────────────────────────────────────
-- EXAMES LABORATORIAIS
-- ──────────────────────────────────────────
create table public.exames (
  id            uuid default uuid_generate_v4() primary key,
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  tipo_exame    text not null default 'Exame',
  data_exame    text,
  resultados    jsonb,   -- ResultadoExame[]
  observacoes   text,
  raw_text      text,
  nome_arquivo  text,
  created_at    timestamptz default now() not null
);

-- ──────────────────────────────────────────
-- BALANÇO HÍDRICO (um registro por turno)
-- ──────────────────────────────────────────
create table public.periodos_balanco (
  id                  uuid default uuid_generate_v4() primary key,
  paciente_id         uuid not null references public.pacientes(id) on delete cascade,
  inicio              timestamptz not null,
  fim                 timestamptz not null,
  turno               text not null check (turno in ('diurno', 'noturno')),
  horas_periodo       numeric(4,2) not null,
  -- Ganhos (mL)
  venoso              numeric(8,1) default 0 not null,
  oral_enteral        numeric(8,1) default 0 not null,
  agua_endogena       numeric(8,1) default 0 not null,
  -- Perdas (mL)
  diurese             numeric(8,1) default 0 not null,
  dialise             numeric(8,1) default 0 not null,
  febre               numeric(8,1) default 0 not null,
  evacuacao           numeric(8,1) default 0 not null,
  dreno               numeric(8,1) default 0 not null,
  vomitos             numeric(8,1) default 0 not null,
  sne_sng             numeric(8,1) default 0 not null,
  ostomia             numeric(8,1) default 0 not null,
  perdas_insensiveis  numeric(8,1) default 0 not null,
  created_at          timestamptz default now() not null,
  updated_at          timestamptz default now() not null
);

-- ──────────────────────────────────────────
-- RESUMOS DE ALTA (histórico arquivado)
-- ──────────────────────────────────────────
create table public.resumos_alta (
  id                 uuid default uuid_generate_v4() primary key,
  paciente_nome      text not null,
  data_internacao    date not null,
  data_alta          timestamptz default now() not null,
  paciente_snapshot  jsonb not null,
  exames_snapshot    jsonb,
  balanco_snapshot   jsonb,
  texto_resumo       text,
  created_at         timestamptz default now() not null
);

-- ──────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────
alter table public.pacientes         enable row level security;
alter table public.exames            enable row level security;
alter table public.periodos_balanco  enable row level security;
alter table public.resumos_alta      enable row level security;

-- Política: qualquer médico autenticado acessa tudo (sistema compartilhado de equipe)
create policy "Equipe - pacientes" on public.pacientes
  for all to authenticated using (true) with check (true);

create policy "Equipe - exames" on public.exames
  for all to authenticated using (true) with check (true);

create policy "Equipe - periodos_balanco" on public.periodos_balanco
  for all to authenticated using (true) with check (true);

create policy "Equipe - resumos_alta" on public.resumos_alta
  for all to authenticated using (true) with check (true);

-- ──────────────────────────────────────────
-- TRIGGER: updated_at automático
-- ──────────────────────────────────────────
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_pacientes_updated_at
  before update on public.pacientes
  for each row execute procedure public.handle_updated_at();

create trigger trg_balanco_updated_at
  before update on public.periodos_balanco
  for each row execute procedure public.handle_updated_at();

-- ──────────────────────────────────────────
-- REALTIME: habilitar para tabelas principais
-- ──────────────────────────────────────────
alter publication supabase_realtime add table public.pacientes;
alter publication supabase_realtime add table public.exames;
alter publication supabase_realtime add table public.periodos_balanco;
