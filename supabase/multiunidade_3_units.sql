-- ══════════════════════════════════════════════════════════════════════════
-- MULTI-UNIDADE — ETAPA 3: fechar a última política aberta
--
-- `units` ainda tinha `using (true)`: qualquer pessoa logada lia a lista de
-- TODAS as unidades. Numa instalação com um cliente só isso era inofensivo;
-- com vários, é a carteira de clientes exposta a cada um deles — o hospital A
-- consegue enumerar o nome de todos os hospitais B, C, D.
--
-- A política nova mostra só as unidades em que a pessoa é staff ativo, que é
-- exatamente o que o seletor de unidade precisa listar.
-- ══════════════════════════════════════════════════════════════════════════

begin;

drop policy if exists "Leitura de units para autenticados" on public.units;
drop policy if exists "Leitura das minhas unidades" on public.units;

create policy "Leitura das minhas unidades"
on public.units for select to authenticated
using (public.sou_da_unidade(id));

commit;
