-- Run in Supabase SQL Editor
-- Registro de intercorrências e condutas do plantão (módulo Médico Plantonista)

CREATE TABLE IF NOT EXISTS intercorrencias (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id  uuid        NOT NULL REFERENCES pacientes(id),
  horario      timestamptz NOT NULL DEFAULT now(),
  descricao    text        NOT NULL,
  conduta      text,
  autor_email  text        NOT NULL,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intercorrencias_paciente_id_idx ON intercorrencias(paciente_id);

ALTER TABLE intercorrencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage intercorrencias"
  ON intercorrencias FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE intercorrencias;
