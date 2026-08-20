-- ══════════════════════════════════════════════════════════════════════════
-- Cistostomia como tipo de dispositivo — mesmo padrão do AVP
-- (supabase/dispositivos_avp.sql): não entra em cvc_dia/svd_dia
-- (indicadores_por_unidade.sql filtra por tipo = 'CVC'/'SVD' explicitamente),
-- serve pra rastreamento na Enfermagem e pra via da diurese do passômetro.
-- ══════════════════════════════════════════════════════════════════════════

begin;

alter table public.dispositivos drop constraint if exists dispositivos_tipo_check;
alter table public.dispositivos add constraint dispositivos_tipo_check
  check (tipo in ('CVC', 'SVD', 'PAI', 'CDL', 'DRENO', 'TOT', 'TQT', 'AVP', 'CISTO', 'OUTRO'));

commit;
