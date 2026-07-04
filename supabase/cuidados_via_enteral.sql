-- ============================================================
-- Renomeia via "Oral" para "Enteral" (IBP e anticoagulante) e passa
-- a validar a combinação droga × via do anticoagulante no banco,
-- evitando registros clinicamente inconsistentes (ex: Enoxaparina VO).
-- ============================================================

-- ── IBP ──────────────────────────────────────────────────────────
alter table public.cuidados_horizontais drop constraint cuidados_horizontais_ibp_via_check;
update public.cuidados_horizontais set ibp_via = 'Enteral' where ibp_via = 'Oral';
alter table public.cuidados_horizontais
  add constraint cuidados_horizontais_ibp_via_check check (ibp_via in ('Enteral', 'Endovenoso'));

-- ── Anticoagulante ───────────────────────────────────────────────
alter table public.cuidados_horizontais drop constraint cuidados_horizontais_anticoag_via_check;
update public.cuidados_horizontais set anticoag_via = 'Enteral' where anticoag_via = 'Oral';
alter table public.cuidados_horizontais
  add constraint cuidados_horizontais_anticoag_via_check check (anticoag_via in ('Subcutâneo', 'Endovenoso', 'Enteral'));

-- Combinação droga × via clinicamente válida:
--   Enoxaparina             → Subcutâneo
--   Heparina Não Fracionada → Subcutâneo ou Endovenoso
--   Apixabana / Rivaroxabana → Enteral (via oral)
--   Outro                   → sem restrição (droga não especificada no sistema)
alter table public.cuidados_horizontais
  add constraint cuidados_horizontais_anticoag_via_droga_check check (
    anticoag_droga is null or anticoag_via is null or anticoag_droga = 'Outro' or
    (anticoag_droga = 'Enoxaparina' and anticoag_via = 'Subcutâneo') or
    (anticoag_droga = 'Heparina Não Fracionada' and anticoag_via in ('Subcutâneo', 'Endovenoso')) or
    (anticoag_droga in ('Apixabana', 'Rivaroxabana') and anticoag_via = 'Enteral')
  );
