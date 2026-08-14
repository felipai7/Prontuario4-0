-- Run in Supabase SQL Editor ou via `supabase db query --linked --file`

-- ══════════════════════════════════════════════════════════════════════════
-- TOT/TQT viram dispositivos de enfermagem (via aérea), casados com o
-- suporte ventilatório: TOT implica VM; TQT não implica VM obrigatoriamente
-- (paciente pode estar desmamado, respirando em TQT). O alerta bidirecional
-- (enfermagem ↔ ventilatório) é calculado no frontend a partir do estado
-- atual das duas tabelas — não precisa de coluna nova aqui.
-- ══════════════════════════════════════════════════════════════════════════

begin;

alter table public.dispositivos drop constraint if exists dispositivos_tipo_check;
alter table public.dispositivos add constraint dispositivos_tipo_check
  check (tipo in ('CVC', 'SVD', 'PAI', 'CDL', 'DRENO', 'TOT', 'TQT', 'OUTRO'));

-- Ventilação mecânica passa a ser tácita: uma vez registrada, o app repete o
-- registro automaticamente turno a turno (ver PacienteModal.loadVentilatorio)
-- sem o médico/fisio precisar reabrir o formulário. Isso continua alimentando
-- o indicador de ventilador-dia (que conta por linha data+turno em
-- indicadores_fase1.sql), só que sem toque manual — daí a necessidade de uma
-- constraint que impeça duas sessões simultâneas de duplicar o mesmo turno.
alter table public.suportes_ventilatorios
  add constraint suportes_ventilatorios_paciente_data_turno_key
  unique (paciente_id, data, turno);

commit;
