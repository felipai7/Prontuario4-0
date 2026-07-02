-- ============================================================
-- MIGRATION 001 — Avaliação Neurológica + Suporte Ventilatório
-- Como aplicar: copie TODO este arquivo e execute no Supabase:
--   SQL Editor → New query → colar → Run
-- ============================================================

-- ──────────────────────────────────────────
-- AVALIAÇÕES NEUROLÓGICAS (1 registro por paciente — estado atual, padrão upsert)
-- ──────────────────────────────────────────
create table public.avaliacoes_neurologicas (
  id                uuid default uuid_generate_v4() primary key,
  paciente_id       uuid not null unique references public.pacientes(id) on delete cascade,
  escala            text check (escala in ('RASS', 'GLASGOW')),
  rass              integer check (rass between -5 and 4),
  glasgow_ao        integer check (glasgow_ao between 1 and 4),
  glasgow_rv        integer check (glasgow_rv between 1 and 5),
  glasgow_rm        integer check (glasgow_rm between 1 and 6),
  sedacao_em_uso    boolean default false not null,
  sedativos         text[],
  sedativo_outro    text,
  despertar_diario  boolean,
  created_at        timestamptz default now() not null,
  updated_at        timestamptz default now() not null
);

create index if not exists avaliacoes_neurologicas_paciente_id_idx
  on public.avaliacoes_neurologicas(paciente_id);

alter table public.avaliacoes_neurologicas enable row level security;

create policy "Authenticated users can manage avaliacoes_neurologicas"
  on public.avaliacoes_neurologicas for all to authenticated
  using (true) with check (true);

create trigger trg_avaliacoes_neurologicas_updated_at
  before update on public.avaliacoes_neurologicas
  for each row execute procedure public.handle_updated_at();

-- ──────────────────────────────────────────
-- SUPORTES VENTILATÓRIOS (1 registro por paciente — estado atual, padrão upsert)
-- ──────────────────────────────────────────
create table public.suportes_ventilatorios (
  id              uuid default uuid_generate_v4() primary key,
  paciente_id     uuid not null unique references public.pacientes(id) on delete cascade,
  modalidade      text check (modalidade in ('ar_ambiente', 'o2_suplementar', 'ventilacao_mecanica')),
  o2_dispositivo  text check (o2_dispositivo in ('Cateter nasal', 'Máscara facial', 'Máscara com reservatório', 'CNAF', 'VNI', 'Outro')),
  o2_fluxo_l_min  numeric(4,1),
  vm_data_inicio  date,
  vm_via          text check (vm_via in ('TOT', 'TQT')),
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

create index if not exists suportes_ventilatorios_paciente_id_idx
  on public.suportes_ventilatorios(paciente_id);

alter table public.suportes_ventilatorios enable row level security;

create policy "Authenticated users can manage suportes_ventilatorios"
  on public.suportes_ventilatorios for all to authenticated
  using (true) with check (true);

create trigger trg_suportes_ventilatorios_updated_at
  before update on public.suportes_ventilatorios
  for each row execute procedure public.handle_updated_at();

-- ──────────────────────────────────────────
-- SNAPSHOT NA ALTA: novos campos em resumos_alta
-- ──────────────────────────────────────────
alter table public.resumos_alta add column if not exists neuro_snapshot        jsonb;
alter table public.resumos_alta add column if not exists ventilatorio_snapshot jsonb;

-- ──────────────────────────────────────────
-- REALTIME
-- ──────────────────────────────────────────
alter publication supabase_realtime add table public.avaliacoes_neurologicas;
alter publication supabase_realtime add table public.suportes_ventilatorios;
