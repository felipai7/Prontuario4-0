-- ══════════════════════════════════════════════════════════════════════════
-- POSOLOGIA DE IBP E ANTICOAGULANTE
--
-- Guarda a frequência/intervalo da dose (ex.: "1x/dia", "12/12h"), que faltava:
-- só havia dose e via. Texto livre de propósito — a tela oferece as posologias
-- comuns num combobox, mas o intensivista pode digitar qualquer intervalo.
--
-- Colunas nullable: compatível com o código já em produção, que simplesmente
-- as ignora até o deploy novo entrar. Nenhum indicador usa estes campos.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.cuidados_horizontais
  add column if not exists ibp_frequencia      text,
  add column if not exists anticoag_frequencia text;

comment on column public.cuidados_horizontais.ibp_frequencia is
  'Posologia do IBP (ex.: 1x/dia, 12/12h). Texto livre.';
comment on column public.cuidados_horizontais.anticoag_frequencia is
  'Posologia do anticoagulante (ex.: 1x/dia, 12/12h). Texto livre.';
