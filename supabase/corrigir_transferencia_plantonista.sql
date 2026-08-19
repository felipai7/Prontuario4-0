-- ══════════════════════════════════════════════════════════════════════════
-- CORRIGE: transferência interna UTI<->Hospital só funcionava pra quem tinha
-- vínculo de staff pessoal nas DUAS unidades (só o chefe, na prática) — a
-- função exigia sou_da_unidade(destino), quando quem já pode ver o paciente
-- (posso_ver_paciente, checado logo acima) já tem toda a autorização
-- necessária: é staff da unidade de ORIGEM, de onde o paciente está saindo.
-- Exigir vínculo também no destino não faz sentido operacional.
-- ══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.transferir_paciente(p_paciente_id uuid, p_unit_destino uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paciente record;
  v_ala_rotativo text;
  v_leito text;
  v_tipo_origem text;
  v_tipo_saida text;
begin
  if not public.posso_ver_paciente(p_paciente_id) then
    raise exception 'Você não pode acessar este paciente.';
  end if;

  if not exists (select 1 from public.units where id = p_unit_destino and active) then
    raise exception 'Unidade destino inválida.';
  end if;

  select * into v_paciente from public.pacientes where id = p_paciente_id and ativo;
  if not found then
    raise exception 'Paciente não encontrado ou não está ativo.';
  end if;

  if v_paciente.unit_id = p_unit_destino then
    raise exception 'Paciente já está nesta unidade.';
  end if;

  select a.codigo into v_ala_rotativo
    from public.alas a where a.unit_id = p_unit_destino and a.rotativo and a.ativa
   limit 1;
  if v_ala_rotativo is null then
    raise exception 'A unidade destino não tem uma ala de trânsito (rotativo) configurada.';
  end if;

  select l.numero into v_leito
    from public.leitos l
    join public.alas a on a.id = l.ala_id
   where a.unit_id = p_unit_destino and a.codigo = v_ala_rotativo
     and l.ativo_desde <= current_date and (l.ativo_ate is null or l.ativo_ate >= current_date)
     and not exists (
       select 1 from public.pacientes p
        where p.unit_id = p_unit_destino and p.ala_id = v_ala_rotativo
          and p.numero_leito = l.numero and p.ativo)
   order by l.numero
   limit 1;

  if v_leito is null then
    raise exception 'Sem leito livre na ala de trânsito da unidade destino.';
  end if;

  select tipo_unidade into v_tipo_origem from public.units where id = v_paciente.unit_id;
  v_tipo_saida := case when v_tipo_origem = 'uti' then 'alta_uti_hospital' else 'alta_hospital_uti' end;

  -- Antes do update de unit_id: herda a unidade de ORIGEM via
  -- resumos_alta_herda_unidade (multiunidade_2_rls.sql), fechando as contas
  -- de saída/SMR da UTI daquele mês exatamente como uma alta de verdade.
  insert into public.resumos_alta (
    paciente_nome, data_internacao, paciente_snapshot, tipo_saida, paciente_id, data_alta
  ) values (
    v_paciente.nome, v_paciente.data_internacao, to_jsonb(v_paciente), v_tipo_saida, v_paciente.id, now()
  );

  update public.pacientes
     set unit_id = p_unit_destino, ala_id = v_ala_rotativo, numero_leito = v_leito
   where id = p_paciente_id;
end $$;

commit;
