-- Run in Supabase SQL Editor ou via `supabase db query --linked --file`

-- ══════════════════════════════════════════════════════════════════════════
-- Escala FOUR (Full Outline of UnResponsiveness) como terceira opção de
-- avaliação neurológica, ao lado de RASS e Glasgow. Cada componente vai de
-- 0 a 4 (total 0-16):
--   Ocular       (E) — abertura/rastreamento ocular
--   Motor        (M) — melhor resposta motora
--   Tronco       (B) — reflexos de tronco cerebral (pupilar/corneano)
--   Respiratório (R) — padrão respiratório / drive ventilatório
-- Preferida ao Glasgow em paciente intubado/sedado, já que não depende de
-- resposta verbal e captura reflexo de tronco e padrão respiratório.
-- ══════════════════════════════════════════════════════════════════════════

begin;

alter table public.avaliacoes_neurologicas drop constraint if exists avaliacoes_neurologicas_escala_check;
alter table public.avaliacoes_neurologicas add constraint avaliacoes_neurologicas_escala_check
  check (escala in ('RASS', 'GLASGOW', 'FOUR'));

alter table public.avaliacoes_neurologicas
  add column if not exists four_ocular       integer check (four_ocular between 0 and 4),
  add column if not exists four_motor        integer check (four_motor between 0 and 4),
  add column if not exists four_tronco       integer check (four_tronco between 0 and 4),
  add column if not exists four_respiratorio integer check (four_respiratorio between 0 and 4);

commit;
