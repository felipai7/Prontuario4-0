-- ══════════════════════════════════════════════════════════════════════════
-- MÓDULO DE ENFERMAGEM
--
-- Alimenta:
--   Densidade de LPP        = LPP adquiridas na UTI / pacientes-dia × 1000
--   Taxa de utilização CVC  = CVC-dia / pacientes-dia × 100
--   Taxa de utilização SVD  = SVD-dia / pacientes-dia × 100
--   ... e os DENOMINADORES de DI IPCS (CVC-dia) e DI ITU (SVD-dia), cujos
--   numeradores são diagnóstico de infecção — médico, não da enfermagem.
--
-- DISPOSITIVOS COMO PERÍODO, NÃO COMO MARCAÇÃO DIÁRIA
-- Registrar inserção e retirada custa 2 toques por dispositivo; marcar presença
-- todo dia custa 1 por paciente por dia (~570/mês numa UTI de 19 leitos). Além
-- de menos trabalho, o período não tem furo: um dia que ninguém marcou vira dia
-- sem dispositivo e subestima o denominador.
--
-- O risco oposto — esquecer de registrar a retirada — inflaria CVC-dia e faria
-- a densidade de infecção parecer MELHOR do que é, que é a direção perigosa num
-- indicador de qualidade. Duas travas contra isso:
--   1. Os dias são cruzados com censo_diario: dispositivo nunca conta depois da
--      alta, mesmo com retirada não registrada.
--   2. qualidade_mes expõe dispositivos abertos há muito tempo (ver abaixo).
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.dispositivos (
  id             uuid primary key default uuid_generate_v4(),
  paciente_id    uuid not null references public.pacientes(id) on delete cascade,
  tipo           text not null check (tipo in ('CVC', 'SVD')),
  data_insercao  date not null,
  data_remocao   date,           -- null = ainda instalado
  observacao     text,
  criado_em      timestamptz not null default now(),
  criado_por     uuid references auth.users(id) on delete set null,
  constraint dispositivos_periodo_check check (data_remocao is null or data_remocao >= data_insercao)
);

create index if not exists dispositivos_paciente_idx on public.dispositivos(paciente_id);
create index if not exists dispositivos_insercao_idx on public.dispositivos(data_insercao);

comment on table public.dispositivos is
  'Períodos de CVC/SVD. Dias-dispositivo derivam daqui, cruzados com censo_diario.';
comment on column public.dispositivos.data_remocao is
  'Null = instalado. O dia da retirada NÃO conta, como no pacientes-dia (o dia da alta não conta).';

-- ── Lesão por pressão ─────────────────────────────────────────────────────
--
-- `adquirida_na_uti` separa o que é falha de cuidado desta unidade do que o
-- paciente já trouxe. A densidade de LPP conta só as adquiridas — contar as de
-- admissão puniria a UTI por lesão de outro serviço.
create table if not exists public.lpp_eventos (
  id               uuid primary key default uuid_generate_v4(),
  paciente_id      uuid not null references public.pacientes(id) on delete cascade,
  data             date not null,
  estagio          text not null check (estagio in ('1', '2', '3', '4', 'Não classificável', 'Tissular profunda')),
  local            text,
  adquirida_na_uti boolean not null default true,
  observacao       text,
  criado_em        timestamptz not null default now(),
  criado_por       uuid references auth.users(id) on delete set null
);

create index if not exists lpp_eventos_paciente_idx on public.lpp_eventos(paciente_id);
create index if not exists lpp_eventos_data_idx     on public.lpp_eventos(data);

alter table public.dispositivos enable row level security;
alter table public.lpp_eventos  enable row level security;

drop policy if exists "Dispositivos: autenticados" on public.dispositivos;
create policy "Dispositivos: autenticados"
  on public.dispositivos for all to authenticated using (true) with check (true);

drop policy if exists "LPP: autenticados" on public.lpp_eventos;
create policy "LPP: autenticados"
  on public.lpp_eventos for all to authenticated using (true) with check (true);

-- ── Contagens do mês ──────────────────────────────────────────────────────

drop function if exists public.contagens_enfermagem_mes(date);

create function public.contagens_enfermagem_mes(p_mes date)
returns table (
  cvc_dia               bigint,
  svd_dia               bigint,
  lpp_adquiridas_uti    bigint,
  lpp_total             bigint,
  dispositivos_abertos  bigint
)
language sql
stable
security invoker
as $$
with
  bounds as (
    select p_mes as ini, (p_mes + interval '1 month')::date as fim_excl
  ),
  censo as (
    select c.* from public.censo_diario c, bounds b
     where c.dia >= b.ini and c.dia < b.fim_excl
  ),
  -- Dias-dispositivo: o join com censo garante que nada conte fora da
  -- internação, mesmo se a retirada não tiver sido registrada.
  dias_disp as (
    select distinct d.tipo, c.paciente_id, c.dia
      from censo c
      join public.dispositivos d
        on d.paciente_id = c.paciente_id
       and c.dia >= d.data_insercao
       and (d.data_remocao is null or c.dia < d.data_remocao)
  ),
  lpp as (
    select l.* from public.lpp_eventos l, bounds b
     where l.data >= b.ini and l.data < b.fim_excl
  )
select
  (select count(*) from dias_disp where tipo = 'CVC'),
  (select count(*) from dias_disp where tipo = 'SVD'),
  (select count(*) from lpp where adquirida_na_uti),
  (select count(*) from lpp),
  -- Dispositivos sem retirada em paciente que já saiu: retirada esquecida.
  -- Não afeta a contagem (o censo já corta), mas indica dado mal registrado.
  (select count(*)
     from public.dispositivos d
     join public.pacientes p on p.id = d.paciente_id
    where d.data_remocao is null and not p.ativo)
$$;

revoke all on function public.contagens_enfermagem_mes(date) from public, anon;
grant execute on function public.contagens_enfermagem_mes(date) to authenticated;
