-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS sinais_vitais (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id   uuid        NOT NULL REFERENCES pacientes(id),
  horario       timestamptz NOT NULL,
  turno         text        NOT NULL CHECK (turno IN ('diurno', 'noturno')),
  temperatura   numeric(4,1),
  pas           integer,
  pad           integer,
  pam           integer,
  fc            integer,
  fr            integer,
  sato2         numeric(4,1),
  hgt           numeric(6,1),
  observacoes   text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sinais_vitais_paciente_id_idx ON sinais_vitais(paciente_id);
CREATE INDEX IF NOT EXISTS sinais_vitais_horario_idx     ON sinais_vitais(horario);

ALTER TABLE sinais_vitais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage sinais_vitais"
  ON sinais_vitais FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
