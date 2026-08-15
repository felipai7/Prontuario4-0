-- ══════════════════════════════════════════════════════════════════════════
-- CORRIGE pacientes_registra_periodo(): ALTA E "DESFAZER ALTA" TAMBÉM MEXEM
-- NO PERÍODO, NÃO SÓ TRANSFERÊNCIA/FINALIZAR ADMISSÃO.
--
-- O gatilho original (registro_unico_transferencia.sql) só fechava/abria
-- período quando unit_id/ala_id mudavam. Uma alta de verdade (ativo vira
-- false) não muda nenhum dos dois — o período ficava aberto (ate=null) pra
-- sempre, mesmo com o paciente inativo. censo_diario não quebra com isso (o
-- corte por pacientes.ativo já limita a série), mas o histórico de
-- internações (buscar_historico_paciente, /auditoria) mostrava "até: atual"
-- pra quem já saiu. E "desfazer alta" (CadastroForm.tsx: handleDesfazerAlta,
-- reativa ativo=false→true no mesmo registro) nunca abria um período novo.
-- ══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.pacientes_registra_periodo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conta boolean;
begin
  if TG_OP = 'INSERT' then
    select not coalesce(a.rotativo, false) into v_conta
      from public.alas a where a.unit_id = new.unit_id and a.codigo = new.ala_id;
    insert into public.pacientes_unidades_historico (paciente_id, unit_id, ala_id, conta_indicador, desde)
    values (
      new.id, new.unit_id, new.ala_id, coalesce(v_conta, true),
      ((new.data_internacao + coalesce(new.hora_internacao, time '12:00'))
         at time zone 'America/Sao_Paulo')
    );
    return new;
  end if;

  -- Alta de verdade: fecha o período aberto, não abre outro.
  if TG_OP = 'UPDATE' and new.ativo = false and old.ativo = true then
    update public.pacientes_unidades_historico
       set ate = now()
     where paciente_id = new.id and ate is null;
    return new;
  end if;

  -- Reativação ("desfazer alta") OU transferência/finalização com o paciente
  -- já ativo: fecha o período aberto (se sobrou algum) e abre um novo.
  if TG_OP = 'UPDATE' and new.ativo and (
       old.ativo = false
       or new.unit_id is distinct from old.unit_id
       or new.ala_id  is distinct from old.ala_id
     ) then
    update public.pacientes_unidades_historico
       set ate = now()
     where paciente_id = new.id and ate is null;

    select not coalesce(a.rotativo, false) into v_conta
      from public.alas a where a.unit_id = new.unit_id and a.codigo = new.ala_id;

    insert into public.pacientes_unidades_historico (paciente_id, unit_id, ala_id, conta_indicador, desde)
    values (new.id, new.unit_id, new.ala_id, coalesce(v_conta, true), now());
  end if;

  return new;
end $$;

drop trigger if exists trg_pacientes_registra_periodo on public.pacientes;
create trigger trg_pacientes_registra_periodo
  after insert or update of unit_id, ala_id, ativo on public.pacientes
  for each row execute function public.pacientes_registra_periodo();

commit;
