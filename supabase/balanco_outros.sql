-- ══════════════════════════════════════════════════════════════════════════
-- BALANÇO HÍDRICO — categoria de perda "Outros"
--
-- Perda que não se encaixa nas categorias fixas (ex.: drenagem torácica,
-- paracentese) precisava ser somada em algum campo existente, distorcendo o
-- que aquele campo mede. `outros_nome` só é preenchido quando `outros` tem
-- volume — sem volume, não há o que nomear.
-- ══════════════════════════════════════════════════════════════════════════

begin;

alter table public.periodos_balanco
  add column if not exists outros numeric(8,1) not null default 0,
  add column if not exists outros_nome text;

commit;
