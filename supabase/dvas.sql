-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS dvas (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id          uuid        NOT NULL REFERENCES pacientes(id),
  droga                text        NOT NULL,
  concentracao_valor   numeric     NOT NULL,
  concentracao_unidade text        NOT NULL,
  concentracao_label   text        NOT NULL,
  fluxo_ml_h           numeric     NOT NULL,
  ativo                boolean     DEFAULT true,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dvas_paciente_id_idx ON dvas(paciente_id);

ALTER TABLE dvas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage dvas"
  ON dvas FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE dvas;
