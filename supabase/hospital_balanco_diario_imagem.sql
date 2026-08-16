-- ══════════════════════════════════════════════════════════════════════════
-- HOSPITAL: balanço diário próprio + escopo por unidade + exame de imagem
-- crítico.
--
-- a) periodos_balanco.turno ganha 'diario' — o Hospital lança 1 registro por
--    dia (não por turno de 12h como a UTI), retroativo (hoje anota o de
--    ontem). O front zera agua_endogena/perdas_insensiveis nesses registros
--    e não calcula acumulado/saldo — não precisa de coluna nem função nova
--    pra isso, calcBalanco() já soma "ganhos − perdas" dos campos que vierem
--    preenchidos.
-- b) periodos_balanco ganha unit_id — hoje o escopo por unidade do balanço é
--    implícito (segue o paciente). Ao transferir um paciente entre UTI e
--    Hospital, sem essa coluna o balanço da unidade anterior se misturaria
--    com o da nova. Nullable + backfill pela unidade atual do paciente;
--    novos INSERTs do front passam a gravar explicitamente. Não afeta
--    nenhum indicador — censo/contagens leem balanço por DATA cruzada com
--    pacientes_unidades_historico, nunca por um unit_id na própria linha.
-- c) exames_imagem ganha `critico` — marca lançada pela equipe pra destacar
--    um achado grave no Painel do Plantão / Resumo, até alguém desmarcar.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- a) balanço diário: novo valor de turno
alter table public.periodos_balanco drop constraint periodos_balanco_turno_check;
alter table public.periodos_balanco add constraint periodos_balanco_turno_check
  check (turno in ('diurno', 'noturno', 'diario'));

-- b) escopo por unidade (nullable; backfill = unidade atual do paciente)
alter table public.periodos_balanco add column if not exists unit_id uuid references public.units(id);
update public.periodos_balanco pb
   set unit_id = p.unit_id
  from public.pacientes p
 where pb.paciente_id = p.id and pb.unit_id is null;

-- c) imagem: resultado crítico
alter table public.exames_imagem add column if not exists critico boolean not null default false;

commit;
