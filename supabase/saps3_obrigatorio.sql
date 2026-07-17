-- ══════════════════════════════════════════════════════════════════════════
-- SAPS 3 obrigatório: marca QUANDO foi pontuado.
--
-- O SAPS 3 é definido sobre dados da primeira hora de internação. Se a
-- pontuação só for cobrada na alta, ela é feita já sabendo o desfecho — o que
-- contamina justamente a comparação que o SMR existe para fazer. Este campo
-- não impede isso, mas torna visível: dá para medir quantos foram pontuados
-- dentro da janela em que a pontuação ainda é honesta.
--
-- O bloqueio da alta sem SAPS 3 é feito na UI (AltaModal), no mesmo modelo de
-- confiança do resto do app.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.pacientes
  add column if not exists saps3_calculado_em timestamptz;

-- Backfill: quem já tem SAPS 3 ganha o updated_at como aproximação. Não é a
-- hora real da pontuação, mas evita que registros antigos apareçam como
-- "nunca pontuados" no painel de qualidade.
update public.pacientes
   set saps3_calculado_em = updated_at
 where saps3 is not null and saps3_calculado_em is null;

comment on column public.pacientes.saps3_calculado_em is
  'Quando o SAPS 3 foi pontuado. Comparar com data/hora de internação revela pontuação retrospectiva.';
