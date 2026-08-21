-- ATB não tinha nenhuma data de encerramento — só o flag `ativo`. Sem uma
-- data, não dava pra corrigir quando alguém encerra um ATB por engano (ou no
-- dia errado) e precisa reabrir/corrigir sem perder o histórico.
alter table public.atbs add column if not exists data_fim date;
