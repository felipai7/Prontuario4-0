-- ══════════════════════════════════════════════════════════════════════════
-- MÓDULO DE IRAS E VIGILÂNCIA (último módulo — fecha os 64 indicadores)
--
-- IRAS não é "ter infecção": é CLASSIFICAÇÃO DE VIGILÂNCIA. "Este caso conta
-- como PAV" segue critérios rígidos (VM >48h, novo infiltrado, etc.) e é um
-- julgamento, não uma observação de beira-leito. Por isso é registro deliberado
-- do Intensivista, e NÃO é derivado do foco dos antibióticos — tratar uma
-- pneumonia comunitária não é IRAS, e derivar dali contaria demais.
--
-- Alimenta 11 indicadores:
--   Densidade de IRAS      = total IRAS / pacientes-dia × 1000
--   Taxa de infecção       = total IRAS / admissões × 100
--   % pacientes com IRAS   = pacientes com ≥1 IRAS / internados × 100
--   DI pneumonia/traqueíte = tipo / pacientes-dia × 1000
--   DI IPCS (total/lab/cl) = IPCS / CVC-dia × 1000   (denominador da enfermagem)
--   DI ITU-SVD             = ITU / SVD-dia × 1000    (denominador da enfermagem)
--   DI PAV                 = PAV / ventilador-dia × 1000
--   Taxa de sepse/choque   = pacientes c/ sepse ou choque / admissões × 100
-- ══════════════════════════════════════════════════════════════════════════

-- Um evento = uma IRAS classificada, com tipo. Total de IRAS e "pacientes com
-- IRAS" saem daqui por soma/dedup. "outra" cobre IRAS fora das 6 monitoradas
-- (sítio cirúrgico, C. difficile, etc.) para o total não sair subestimado.
create table if not exists public.iras_eventos (
  id          uuid primary key default uuid_generate_v4(),
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  -- Tipos com indicador individual: pav, itu_svd, ipcs_lab, ipcs_clinica,
  -- pneumonia, traqueite. Os demais entram só no Total de IRAS e em "pacientes
  -- com IRAS" (viram indicador individual quando definirmos o denominador).
  tipo        text not null check (tipo in (
                'pav', 'itu_svd', 'ipcs_lab', 'ipcs_clinica',
                'pneumonia', 'traqueite',
                'flebite', 'colite_pseudomembranosa', 'isc', 'outra')),
  data        date not null,
  observacao  text,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references auth.users(id) on delete set null
);

create index if not exists iras_eventos_paciente_idx on public.iras_eventos(paciente_id);
create index if not exists iras_eventos_data_idx     on public.iras_eventos(data);

comment on column public.iras_eventos.tipo is
  'Classificação de vigilância. "outra" = IRAS fora das 6 monitoradas, para o total não ficar subestimado.';

-- Sepse/choque NÃO é IRAS: é gravidade, pode ser comunitária. Flag por paciente
-- (a presença da linha = teve). Denominador do indicador é admissões.
create table if not exists public.iras_sepse_choque (
  id          uuid primary key default uuid_generate_v4(),
  paciente_id uuid not null unique references public.pacientes(id) on delete cascade,
  data        date not null,
  observacao  text,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references auth.users(id) on delete set null
);

alter table public.iras_eventos      enable row level security;
alter table public.iras_sepse_choque enable row level security;

drop policy if exists "IRAS eventos: autenticados" on public.iras_eventos;
create policy "IRAS eventos: autenticados"
  on public.iras_eventos for all to authenticated using (true) with check (true);

drop policy if exists "IRAS sepse: autenticados" on public.iras_sepse_choque;
create policy "IRAS sepse: autenticados"
  on public.iras_sepse_choque for all to authenticated using (true) with check (true);

-- ── Contagens do mês ──────────────────────────────────────────────────────

drop function if exists public.contagens_iras_mes(date);

create function public.contagens_iras_mes(p_mes date)
returns table (
  total_iras          bigint,
  pacientes_com_iras  bigint,
  pav                 bigint,
  itu_svd             bigint,
  ipcs_lab            bigint,
  ipcs_clinica        bigint,
  pneumonia           bigint,
  traqueite           bigint,
  outra               bigint,
  sepse_choque        bigint
)
language sql
stable
security invoker
as $$
with
  bounds as (
    select p_mes as ini, (p_mes + interval '1 month')::date as fim_excl
  ),
  ev as (
    select e.* from public.iras_eventos e, bounds b
     where e.data >= b.ini and e.data < b.fim_excl
  )
select
  (select count(*) from ev),
  (select count(distinct paciente_id) from ev),
  (select count(*) from ev where tipo = 'pav'),
  (select count(*) from ev where tipo = 'itu_svd'),
  (select count(*) from ev where tipo = 'ipcs_lab'),
  (select count(*) from ev where tipo = 'ipcs_clinica'),
  (select count(*) from ev where tipo = 'pneumonia'),
  (select count(*) from ev where tipo = 'traqueite'),
  (select count(*) from ev where tipo = 'outra'),
  (select count(*) from public.iras_sepse_choque s, bounds b
    where s.data >= b.ini and s.data < b.fim_excl)
$$;

revoke all on function public.contagens_iras_mes(date) from public, anon;
grant execute on function public.contagens_iras_mes(date) to authenticated;
