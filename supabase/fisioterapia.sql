-- ══════════════════════════════════════════════════════════════════════════
-- MÓDULO DE FISIOTERAPIA
--
-- Desenhado de trás para frente, a partir dos 6 indicadores respiratórios:
--
--   Sucesso de desmame   = extubados com sucesso / tentativas de extubação
--   Falha de extubação   = reintubações <48h / extubações planejadas
--   Desmame difícil      = desmame difícil com sucesso / pacientes com desmame difícil
--   VNI evita IOT        = VNI que evitou IOT / VNI com objetivo de evitar IOT
--   Decanulação TQT      = decanulados na UTI / traqueostomizados elegíveis
--   % VM protetora       = dias em VM protetora / ventilador-dia
--
-- Ventilador-dia NÃO é capturado aqui: já sai da aba Ventilatório (dias com
-- modalidade = ventilacao_mecanica). O módulo não redigita o que já existe.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Eventos ───────────────────────────────────────────────────────────────
--
-- Um evento = um episódio datado. Contar eventos do mês dá numerador e
-- denominador direto, sem inferência.

create table if not exists public.fisio_eventos (
  id          uuid primary key default uuid_generate_v4(),
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  tipo        text not null check (tipo in ('extubacao', 'desmame_dificil', 'vni', 'traqueostomia')),
  data        date not null,

  -- extubacao
  -- `planejada`: extubação programada, não acidental/autoextubação. É o
  -- denominador de "falha de extubação" — reintubar após autoextubação não é
  -- falha de julgamento da equipe.
  planejada         boolean,
  sucesso           boolean,   -- não precisou reintubar em 48h
  reintubou_48h     boolean,

  -- desmame_dificil: desfecho do processo (sucesso = desmamou)
  -- vni: objetivo e desfecho
  objetivo_evitar_iot boolean,
  evitou_iot          boolean,

  -- traqueostomia
  elegivel_decanulacao boolean, -- julgamento da fisio (definição do Dr. Flaubert)
  decanulado_na_uti    boolean,

  observacao  text,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references auth.users(id) on delete set null
);

create index if not exists fisio_eventos_paciente_idx on public.fisio_eventos(paciente_id);
create index if not exists fisio_eventos_data_idx     on public.fisio_eventos(data);

comment on column public.fisio_eventos.planejada is
  'Extubação programada (não acidental). Denominador de falha de extubação: reintubar após autoextubação não é falha de julgamento.';

-- ── Avaliação diária ──────────────────────────────────────────────────────
--
-- Uma linha por (paciente, dia). Só o que muda todo dia e não cabe em evento.
-- `vm_protetora` é sim/não por decisão do Dr. Felipe — calcular por volume
-- corrente × peso predito exigiria altura, que fica para o prontuário completo.

create table if not exists public.fisio_avaliacoes_diarias (
  id           uuid primary key default uuid_generate_v4(),
  paciente_id  uuid not null references public.pacientes(id) on delete cascade,
  data         date not null,
  vm_protetora boolean,
  observacao   text,
  criado_em    timestamptz not null default now(),
  criado_por   uuid references auth.users(id) on delete set null,
  unique (paciente_id, data)
);

create index if not exists fisio_avaliacoes_data_idx on public.fisio_avaliacoes_diarias(data);

alter table public.fisio_eventos             enable row level security;
alter table public.fisio_avaliacoes_diarias  enable row level security;

-- Todo mundo lê (o app inteiro é assim: quem cuida do paciente vê tudo).
-- A restrição de escrita por profissão é da UI, no mesmo modelo de confiança
-- do resto do prontuário.
drop policy if exists "Fisio eventos: autenticados" on public.fisio_eventos;
create policy "Fisio eventos: autenticados"
  on public.fisio_eventos for all to authenticated using (true) with check (true);

drop policy if exists "Fisio diarias: autenticados" on public.fisio_avaliacoes_diarias;
create policy "Fisio diarias: autenticados"
  on public.fisio_avaliacoes_diarias for all to authenticated using (true) with check (true);

-- ── Contagens do mês ──────────────────────────────────────────────────────

drop function if exists public.contagens_fisio_mes(date);

create function public.contagens_fisio_mes(p_mes date)
returns table (
  extubados_com_sucesso        bigint,
  tentativas_extubacao         bigint,
  reintubacoes_48h             bigint,
  extubacoes_planejadas        bigint,
  desmame_dificil_sucesso      bigint,
  pacientes_desmame_dificil    bigint,
  vni_evitou_iot               bigint,
  vni_objetivo_evitar_iot      bigint,
  decanulados_na_uti           bigint,
  traqueo_elegiveis            bigint,
  dias_vm_protetora            bigint
)
language sql
stable
security invoker
as $$
with bounds as (
  select p_mes as ini, (p_mes + interval '1 month')::date as fim_excl
),
ev as (
  select e.* from public.fisio_eventos e, bounds b
   where e.data >= b.ini and e.data < b.fim_excl
)
select
  (select count(*) from ev where tipo = 'extubacao' and sucesso),
  (select count(*) from ev where tipo = 'extubacao'),
  -- Numerador e denominador da falha de extubação são ambos restritos às
  -- planejadas: sem isso, uma autoextubação reintubada inflaria a falha.
  (select count(*) from ev where tipo = 'extubacao' and planejada and reintubou_48h),
  (select count(*) from ev where tipo = 'extubacao' and planejada),
  (select count(*) from ev where tipo = 'desmame_dificil' and sucesso),
  (select count(distinct paciente_id) from ev where tipo = 'desmame_dificil'),
  (select count(*) from ev where tipo = 'vni' and objetivo_evitar_iot and evitou_iot),
  (select count(*) from ev where tipo = 'vni' and objetivo_evitar_iot),
  (select count(*) from ev where tipo = 'traqueostomia' and decanulado_na_uti),
  (select count(*) from ev where tipo = 'traqueostomia' and elegivel_decanulacao),
  -- VM protetora só conta em dia que houve VM de fato: o denominador é
  -- ventilador-dia, e marcar protetora fora de VM inflaria o indicador acima
  -- de 100%.
  (select count(*)
     from public.fisio_avaliacoes_diarias a, bounds b
    where a.vm_protetora
      and a.data >= b.ini and a.data < b.fim_excl
      and exists (
        select 1 from public.suportes_ventilatorios sv
         where sv.paciente_id = a.paciente_id
           and sv.data = a.data
           and sv.modalidade = 'ventilacao_mecanica'))
$$;

revoke all on function public.contagens_fisio_mes(date) from public, anon;
grant execute on function public.contagens_fisio_mes(date) to authenticated;
