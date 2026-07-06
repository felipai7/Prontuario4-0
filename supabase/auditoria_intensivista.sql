-- ============================================================
-- Auditoria da aba Médico Intensivista: registra quem mudou o quê em
-- cuidados_horizontais, atbs, pendencias_intensivista e
-- registros_intensivista. Preenchida por trigger (não burlável pela UI).
-- ============================================================

create table public.auditoria_intensivista (
  id                uuid default uuid_generate_v4() primary key,
  paciente_id       uuid not null,
  tabela            text not null,
  acao              text not null check (acao in ('INSERT', 'UPDATE', 'DELETE')),
  changed_by        uuid,
  changed_by_email  text,
  dados_antigos     jsonb,
  dados_novos       jsonb,
  changed_at        timestamptz default now() not null
);

create index auditoria_intensivista_paciente_idx on public.auditoria_intensivista(paciente_id, changed_at desc);

alter table public.auditoria_intensivista enable row level security;

-- Leitura para qualquer autenticado (transparência da equipe);
-- nenhuma policy de escrita — só o trigger (security definer) insere.
create policy "Leitura de auditoria para autenticados"
on public.auditoria_intensivista for select to authenticated
using (true);

create or replace function public.log_auditoria_intensivista()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.auditoria_intensivista
    (paciente_id, tabela, acao, changed_by, changed_by_email, dados_antigos, dados_novos)
  values (
    coalesce(new.paciente_id, old.paciente_id),
    tg_table_name,
    tg_op,
    auth.uid(),
    nullif(auth.jwt() ->> 'email', ''),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_audit_cuidados
after insert or update or delete on public.cuidados_horizontais
for each row execute function public.log_auditoria_intensivista();

create trigger trg_audit_atbs
after insert or update or delete on public.atbs
for each row execute function public.log_auditoria_intensivista();

create trigger trg_audit_pendencias
after insert or update or delete on public.pendencias_intensivista
for each row execute function public.log_auditoria_intensivista();

create trigger trg_audit_registros
after insert or update or delete on public.registros_intensivista
for each row execute function public.log_auditoria_intensivista();
