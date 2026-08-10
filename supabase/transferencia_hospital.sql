-- ══════════════════════════════════════════════════════════════════════════
-- MÓDULO HOSPITAL — transferência entre unidades via RPC
--
-- Tentativa anterior (INSERT direto do cliente em pacientes de outra unidade)
-- falhava com 403: a policy de pacientes exige não só sou_da_unidade(unit_id)
-- mas também na_unidade_ativa(unit_id) (multiunidade_5_unidade_ativa.sql) —
-- de propósito, para quem atende duas unidades nunca escrever na errada por
-- engano. Isso barra até quem É staff da unidade destino, se ela não for a
-- unidade ativa da sessão no momento (e a alta acontece com a UTI ativa, não
-- o Hospital). A transferência é uma exceção deliberada a essa regra, então
-- precisa de uma função security definer com sua própria checagem — mesmo
-- padrão de criar_unidade (multiunidade_4_admin.sql).
-- ══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.transferir_para_unidade(
  p_nome                text,
  p_data_nascimento     date,
  p_plano_saude         text,
  p_peso_kg             numeric,
  p_hipoteses           text,
  p_unit_destino        uuid,
  p_ala_destino_codigo  text,
  p_origem_uti_alta_id  uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leito text;
  v_novo  uuid;
begin
  -- security definer ignora RLS (inclusive na_unidade_ativa), então a
  -- checagem de permissão precisa ser explícita aqui: só quem É staff ativo
  -- da unidade destino pode criar paciente nela.
  if not public.sou_da_unidade(p_unit_destino) then
    raise exception 'Você não é staff da unidade destino.';
  end if;

  -- Primeiro leito vigente da ala destino sem paciente ativo nela agora.
  select l.numero into v_leito
    from public.leitos l
    join public.alas a on a.id = l.ala_id
   where a.unit_id = p_unit_destino and a.codigo = p_ala_destino_codigo
     and l.ativo_desde <= current_date and (l.ativo_ate is null or l.ativo_ate >= current_date)
     and not exists (
       select 1 from public.pacientes p
        where p.unit_id = p_unit_destino and p.ala_id = p_ala_destino_codigo
          and p.numero_leito = l.numero and p.ativo)
   order by l.numero
   limit 1;

  if v_leito is null then
    raise exception 'Sem leito livre nessa ala.';
  end if;

  insert into public.pacientes (
    nome, data_nascimento, plano_saude, peso_kg, hipoteses,
    data_internacao, hora_internacao, ala_id, numero_leito, unit_id,
    origem_uti_alta_id, ativo
  ) values (
    p_nome, p_data_nascimento, p_plano_saude, p_peso_kg, p_hipoteses,
    (now() at time zone 'America/Sao_Paulo')::date,
    to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI'),
    p_ala_destino_codigo, v_leito, p_unit_destino, p_origem_uti_alta_id, true
  )
  returning id into v_novo;

  return v_novo;
end $$;

comment on function public.transferir_para_unidade(text, date, text, numeric, text, uuid, text, uuid) is
  'Cria um paciente em outra unidade (ex.: alta da UTI vira internação no Hospital), contornando na_unidade_ativa de propósito — checa staff da unidade destino explicitamente.';

revoke all on function public.transferir_para_unidade(text, date, text, numeric, text, uuid, text, uuid) from public;
grant execute on function public.transferir_para_unidade(text, date, text, numeric, text, uuid, text, uuid) to authenticated;

commit;
