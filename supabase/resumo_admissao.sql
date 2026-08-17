-- ══════════════════════════════════════════════════════════════════════════
-- RESUMO DE ADMISSÃO
--
-- Mesmo padrão de historico_medicacoes.sql: texto livre por paciente, editável
-- no Painel do Plantão junto com HPP/Medicações — contexto da internação como
-- um todo, não por turno, por isso mora direto em `pacientes`.
-- ══════════════════════════════════════════════════════════════════════════

begin;

alter table public.pacientes
  add column if not exists resumo_admissao text;

commit;
