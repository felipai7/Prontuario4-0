-- Run in Supabase SQL Editor ou via `supabase db query --linked --file`

-- ══════════════════════════════════════════════════════════════════════════
-- 1. NEUROLÓGICO e VENTILATÓRIO viram histórico por turno (igual Balanço/SSVV)
-- ══════════════════════════════════════════════════════════════════════════

-- Remove a restrição de 1 registro por paciente
ALTER TABLE avaliacoes_neurologicas DROP CONSTRAINT IF EXISTS avaliacoes_neurologicas_paciente_id_key;
ALTER TABLE suportes_ventilatorios  DROP CONSTRAINT IF EXISTS suportes_ventilatorios_paciente_id_key;

-- Adiciona data/turno (nullable por enquanto, para poder backfillar os registros existentes)
ALTER TABLE avaliacoes_neurologicas ADD COLUMN IF NOT EXISTS data  date;
ALTER TABLE avaliacoes_neurologicas ADD COLUMN IF NOT EXISTS turno text;
ALTER TABLE suportes_ventilatorios  ADD COLUMN IF NOT EXISTS data  date;
ALTER TABLE suportes_ventilatorios  ADD COLUMN IF NOT EXISTS turno text;

-- Backfill: cada registro existente (1 por paciente) vira o 1º turno daquele paciente,
-- usando o horário do updated_at para inferir data/turno.
UPDATE avaliacoes_neurologicas
  SET data  = (updated_at AT TIME ZONE 'America/Sao_Paulo')::date,
      turno = CASE WHEN EXTRACT(HOUR FROM updated_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 7 AND 18
                   THEN 'diurno' ELSE 'noturno' END
  WHERE data IS NULL;

UPDATE suportes_ventilatorios
  SET data  = (updated_at AT TIME ZONE 'America/Sao_Paulo')::date,
      turno = CASE WHEN EXTRACT(HOUR FROM updated_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 7 AND 18
                   THEN 'diurno' ELSE 'noturno' END
  WHERE data IS NULL;

ALTER TABLE avaliacoes_neurologicas ALTER COLUMN data  SET NOT NULL;
ALTER TABLE avaliacoes_neurologicas ALTER COLUMN turno SET NOT NULL;
ALTER TABLE avaliacoes_neurologicas ADD CONSTRAINT avaliacoes_neurologicas_turno_check CHECK (turno IN ('diurno','noturno'));

ALTER TABLE suportes_ventilatorios ALTER COLUMN data  SET NOT NULL;
ALTER TABLE suportes_ventilatorios ALTER COLUMN turno SET NOT NULL;
ALTER TABLE suportes_ventilatorios ADD CONSTRAINT suportes_ventilatorios_turno_check CHECK (turno IN ('diurno','noturno'));

CREATE INDEX IF NOT EXISTS avaliacoes_neurologicas_paciente_id_idx ON avaliacoes_neurologicas(paciente_id);
CREATE INDEX IF NOT EXISTS suportes_ventilatorios_paciente_id_idx ON suportes_ventilatorios(paciente_id);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. HEMODINÂMICA: aposenta o modelo "abrir/fechar turno" — todo período já
--    nasce com fim definido (igual periodos_balanco). Backfilla os abertos.
-- ══════════════════════════════════════════════════════════════════════════

UPDATE periodos_hemodinamica
  SET fim = CASE WHEN turno = 'diurno'
                  THEN (data + time '19:00:00') AT TIME ZONE 'America/Sao_Paulo'
                  ELSE ((data + 1) + time '07:00:00') AT TIME ZONE 'America/Sao_Paulo'
             END
  WHERE fim IS NULL;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. PENDÊNCIAS viram checklist (itens individuais com resolvida/não)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pendencias_intensivista (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id  uuid        NOT NULL REFERENCES pacientes(id),
  texto        text        NOT NULL,
  resolvida    boolean     DEFAULT false NOT NULL,
  criado_em    timestamptz DEFAULT now(),
  resolvida_em timestamptz
);

CREATE INDEX IF NOT EXISTS pendencias_intensivista_paciente_id_idx ON pendencias_intensivista(paciente_id);

ALTER TABLE pendencias_intensivista ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage pendencias_intensivista"
  ON pendencias_intensivista FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Migra o texto livre já existente em cuidados_horizontais.pendencias (uma linha = um item)
INSERT INTO pendencias_intensivista (paciente_id, texto)
SELECT paciente_id, trim(linha)
FROM cuidados_horizontais, unnest(string_to_array(pendencias, E'\n')) AS linha
WHERE pendencias IS NOT NULL AND trim(linha) != '';

ALTER TABLE cuidados_horizontais DROP COLUMN IF EXISTS pendencias;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. ORIENTAÇÕES E CONDUTAS: novo histórico por data (só dia, sem turno —
--    não há visita noturna do intensivista)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS registros_intensivista (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id          uuid        NOT NULL REFERENCES pacientes(id),
  data                 date        NOT NULL,
  orientacoes_condutas text        NOT NULL,
  criado_em            timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registros_intensivista_paciente_id_idx ON registros_intensivista(paciente_id);

ALTER TABLE registros_intensivista ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage registros_intensivista"
  ON registros_intensivista FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_registros_intensivista_updated_at
  BEFORE UPDATE ON registros_intensivista
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- 5. REALTIME
-- ══════════════════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE pendencias_intensivista;
ALTER PUBLICATION supabase_realtime ADD TABLE registros_intensivista;
