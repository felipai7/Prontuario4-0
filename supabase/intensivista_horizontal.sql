-- Run in Supabase SQL Editor ou via `supabase db query --linked`

-- ──────────────────────────────────────────
-- PACIENTES: novos campos de cabeçalho
-- ──────────────────────────────────────────
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS saps3 numeric(4,1);
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS paliativo boolean DEFAULT false NOT NULL;

-- ──────────────────────────────────────────
-- ATBs (histórico + múltiplos simultâneos, padrão igual a dvas)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS atbs (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id    uuid        NOT NULL REFERENCES pacientes(id),
  droga          text        NOT NULL,
  data_inicio    date        NOT NULL,
  dias_previstos numeric,
  foco           text,
  ativo          boolean     DEFAULT true,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atbs_paciente_id_idx ON atbs(paciente_id);

ALTER TABLE atbs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage atbs"
  ON atbs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────
-- CUIDADOS HORIZONTAIS (1 registro por paciente — estado atual)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuidados_horizontais (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id           uuid        NOT NULL UNIQUE REFERENCES pacientes(id),
  previsao_alta         date,

  ibp_em_uso            boolean     DEFAULT false NOT NULL,
  ibp_via               text        CHECK (ibp_via IN ('Oral', 'Endovenoso')),
  ibp_dose_valor        numeric,
  ibp_dose_unidade      text,
  ibp_objetivo          text        CHECK (ibp_objetivo IN ('profilatico', 'terapeutico')),

  anticoag_em_uso       boolean     DEFAULT false NOT NULL,
  anticoag_droga        text        CHECK (anticoag_droga IN ('Enoxaparina', 'Heparina Não Fracionada', 'Apixabana', 'Rivaroxabana', 'Outro')),
  anticoag_droga_outro  text,
  anticoag_via          text        CHECK (anticoag_via IN ('Subcutâneo', 'Endovenoso', 'Oral')),
  anticoag_dose_valor   numeric,
  anticoag_dose_unidade text,
  anticoag_objetivo     text        CHECK (anticoag_objetivo IN ('profilatico', 'terapeutico')),

  pendencias            text,
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cuidados_horizontais_paciente_id_idx ON cuidados_horizontais(paciente_id);

ALTER TABLE cuidados_horizontais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage cuidados_horizontais"
  ON cuidados_horizontais FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_cuidados_horizontais_updated_at
  BEFORE UPDATE ON cuidados_horizontais
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ──────────────────────────────────────────
-- REALTIME
-- ──────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE atbs;
ALTER PUBLICATION supabase_realtime ADD TABLE cuidados_horizontais;
