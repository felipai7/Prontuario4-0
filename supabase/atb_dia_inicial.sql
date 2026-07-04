-- Run in Supabase SQL Editor ou via `supabase db query --linked --file`

-- Marca se a data de início do ATB deve ser contada como D0 (dose não
-- completada no primeiro dia) ou D1 (dose completa desde o início).
ALTER TABLE atbs ADD COLUMN IF NOT EXISTS dia_inicial smallint NOT NULL DEFAULT 0
  CHECK (dia_inicial IN (0, 1));
