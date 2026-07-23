-- ══════════════════════════════════════════════════════════════════════════
-- MULTI-UNIDADE — ETAPA 5: quem atende duas UTIs vê uma de cada vez
--
-- O PROBLEMA
-- O RLS deixa a pessoa ver os pacientes de TODAS as unidades em que ela é
-- staff. Para o prontuário isso até faz sentido, mas para os INDICADORES é
-- errado e silencioso: as 6 RPCs são `security invoker`, então um intensivista
-- que chefia duas UTIs veria taxa de ocupação, mortalidade e densidade de IRAS
-- com os pacientes das duas somados — e nada na tela denunciaria isso.
--
-- POR QUE NÃO FILTRAR DENTRO DAS RPCs
-- Seriam ~17 pontos espalhados por 6 funções (censo, saídas, eventos de fisio,
-- dispositivos, nutrição, IRAS...). Um único ponto esquecido produz um número
-- errado que ninguém percebe. A regra é uma só, então mora num lugar só.
--
-- COMO FUNCIONA
-- O app manda o cabeçalho `x-unidade-ativa` (vem do cookie que o seletor de
-- unidade grava). O RLS estreita o que a pessoa vê para aquela unidade. Isso
-- só ESTREITA: sem cabeçalho, o comportamento é o de hoje. E estreitar para
-- uma unidade da qual a pessoa não é staff não é possível — nesse caso o
-- cabeçalho é simplesmente ignorado, então um cookie adulterado não dá acesso
-- a nada nem tranca ninguém para fora.
--
-- Alas, leitos, staff e units NÃO são estreitados: a tela de configuração
-- precisa enxergar as outras unidades para você poder trocar entre elas.
-- ══════════════════════════════════════════════════════════════════════════

begin;

/**
 * Unidade pedida pelo cabeçalho da requisição, ou null.
 *
 * O cast é defensivo: `request.headers` pode não existir (conexão fora do
 * PostgREST) e o valor pode vir com qualquer lixo. Um erro de cast aqui
 * quebraria TODA consulta do app, então o formato é conferido antes.
 */
create or replace function public.unidade_ativa()
returns uuid
language plpgsql
stable
as $$
declare
  v_txt text;
begin
  v_txt := nullif(current_setting('request.headers', true)::json->>'x-unidade-ativa', '');
  if v_txt is null then return null; end if;
  if v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_txt::uuid;
exception when others then
  return null;
end $$;

/**
 * Unidade padrão de quem chamou: a mais antiga das dela.
 *
 * Precisa ser a MESMA regra de carregarUnidade() em lib/unidade.ts (que ordena
 * por staff.created_at). Se divergirem, a tela diria "UTI Adulto" enquanto o
 * banco entregaria dados de outra — o pior tipo de erro, porque parece certo.
 */
create or replace function public.minha_unidade_padrao()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select unit_id from public.staff
   where user_id = auth.uid() and active
   order by created_at
   limit 1;
$$;

/**
 * Esta linha pertence à unidade que estou olhando agora?
 *
 * SEMPRE estreita para exatamente uma unidade — não só quando há cabeçalho.
 * Sem esse padrão, quem atende duas UTIs e ainda não tocou no seletor veria as
 * duas somadas: foi o que aconteceu no teste, o painel contou 2 leitos
 * ocupados e desenhou 1.
 *
 * O cabeçalho só é aceito se a pessoa for staff daquela unidade; um cookie
 * velho ou adulterado cai no padrão em vez de trancar a tela vazia.
 */
create or replace function public.na_unidade_ativa(p_unit_id uuid)
returns boolean
language sql
stable
as $$
  select p_unit_id = coalesce(
    case when public.sou_da_unidade(public.unidade_ativa())
         then public.unidade_ativa() end,
    public.minha_unidade_padrao());
$$;

-- ── PACIENTES ────────────────────────────────────────────────────────────
drop policy if exists "Equipe da unidade - pacientes" on public.pacientes;
create policy "Equipe da unidade - pacientes"
on public.pacientes for all to authenticated
using (public.sou_da_unidade(unit_id) and public.na_unidade_ativa(unit_id))
with check (public.sou_da_unidade(unit_id) and public.na_unidade_ativa(unit_id));

-- ── AS 21 FILHAS ─────────────────────────────────────────────────────────
-- Chegam na unidade por paciente_id, então basta ensinar posso_ver_paciente().
create or replace function public.posso_ver_paciente(p_paciente_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.pacientes p
      join public.staff s on s.unit_id = p.unit_id
     where p.id = p_paciente_id
       and s.user_id = auth.uid()
       and s.active
       and public.na_unidade_ativa(p.unit_id)
  );
$$;

-- ── AS QUE TÊM unit_id PRÓPRIO ───────────────────────────────────────────
drop policy if exists "Equipe da unidade - resumos_alta" on public.resumos_alta;
create policy "Equipe da unidade - resumos_alta"
on public.resumos_alta for all to authenticated
using (public.sou_da_unidade(unit_id) and public.na_unidade_ativa(unit_id))
with check (public.sou_da_unidade(unit_id) and public.na_unidade_ativa(unit_id));

drop policy if exists "Equipe da unidade - auditoria" on public.auditoria_intensivista;
create policy "Equipe da unidade - auditoria"
on public.auditoria_intensivista for all to authenticated
using (public.sou_da_unidade(unit_id) and public.na_unidade_ativa(unit_id))
with check (public.sou_da_unidade(unit_id) and public.na_unidade_ativa(unit_id));

drop policy if exists "Equipe da unidade - contagens manuais" on public.contagens_mensais_manuais;
create policy "Equipe da unidade - contagens manuais"
on public.contagens_mensais_manuais for all to authenticated
using (public.sou_da_unidade(unit_id) and public.na_unidade_ativa(unit_id))
with check (public.sou_da_unidade(unit_id) and public.na_unidade_ativa(unit_id));

commit;
