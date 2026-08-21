-- Acrescenta GTT (gastrostomia) e PICC (cateter central de inserção
-- periférica) aos tipos de dispositivo — mesmo padrão de
-- dispositivos_avp.sql/dispositivos_cistostomia.sql: dropa e recria o check
-- constraint com o valor novo.

alter table public.dispositivos drop constraint if exists dispositivos_tipo_check;
alter table public.dispositivos add constraint dispositivos_tipo_check
  check (tipo in ('CVC', 'SVD', 'PAI', 'CDL', 'DRENO', 'TOT', 'TQT', 'AVP', 'CISTO', 'GTT', 'PICC', 'OUTRO'));
