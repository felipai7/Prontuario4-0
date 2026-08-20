-- ══════════════════════════════════════════════════════════════════════════
-- AVP (Acesso Venoso Periférico) como tipo de dispositivo
--
-- Não entra em cvc_dia/svd_dia (indicadores_por_unidade.sql filtra por
-- tipo = 'CVC'/'SVD' explicitamente) — registrado só pra aparecer no
-- passômetro e na ficha do paciente, decisão do Felipe: "mesmo que não
-- alimente indicadores por hora".
-- ══════════════════════════════════════════════════════════════════════════

begin;

alter table public.dispositivos drop constraint if exists dispositivos_tipo_check;
alter table public.dispositivos add constraint dispositivos_tipo_check
  check (tipo in ('CVC', 'SVD', 'PAI', 'CDL', 'DRENO', 'TOT', 'TQT', 'AVP', 'OUTRO'));

commit;
