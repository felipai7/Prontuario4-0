-- ============================================================
-- 1. Tabela exames_imagem
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

CREATE TABLE IF NOT EXISTS exames_imagem (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id   uuid        NOT NULL REFERENCES pacientes(id),
  tipo_exame    text        NOT NULL,
  data_exame    text,
  arquivo_path  text,        -- path no bucket "exames-imagem"
  arquivo_nome  text,        -- nome original do arquivo
  resumo_ia     text,
  achados       jsonb,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exames_imagem_paciente_id_idx ON exames_imagem(paciente_id);

ALTER TABLE exames_imagem ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage exames_imagem"
  ON exames_imagem FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ============================================================
-- 2. Habilitar Realtime nas tabelas necessárias
-- Dashboard → Database → Replication → ativar para:
--   exames, periodos_balanco, sinais_vitais, exames_imagem, pacientes
-- OU via SQL:
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE exames;
ALTER PUBLICATION supabase_realtime ADD TABLE periodos_balanco;
ALTER PUBLICATION supabase_realtime ADD TABLE sinais_vitais;
ALTER PUBLICATION supabase_realtime ADD TABLE exames_imagem;
ALTER PUBLICATION supabase_realtime ADD TABLE pacientes;

-- ============================================================
-- 3. Criar bucket de storage "exames-imagem"
-- Dashboard → Storage → New bucket
--   Name: exames-imagem
--   Public: NÃO (privado)
-- Depois: Storage → Policies → New Policy para o bucket:
--   - Allowed operation: SELECT, INSERT, DELETE
--   - Policy definition: (auth.role() = 'authenticated')
-- ============================================================
