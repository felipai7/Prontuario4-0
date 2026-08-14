-- ══════════════════════════════════════════════════════════════════════════
-- HISTÓRICO PATOLÓGICO PREGRESSO E MEDICAÇÕES DE USO CONTÍNUO
--
-- Texto livre por paciente, editável no Painel do Plantão — não é dado por
-- turno (como balanço/sinais vitais), é contexto da internação como um todo,
-- por isso mora direto em `pacientes` e não numa tabela filha com histórico.
-- ══════════════════════════════════════════════════════════════════════════

begin;

alter table public.pacientes
  add column if not exists historico_patologico_pregresso text,
  add column if not exists medicacoes_uso_continuo text;

commit;
