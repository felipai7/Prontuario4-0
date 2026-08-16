-- ══════════════════════════════════════════════════════════════════════════
-- AUTOATENDIMENTO: perfil próprio, primeiro acesso, gestão de vínculo de e-mail
--
-- staff só pode ser escrito por um chefe (is_chefe, ver cargos.sql) — não há
-- policy que deixe a própria pessoa alterar sua linha, de propósito (evita
-- autopromoção). Por isso as quatro funções abaixo são `security definer`
-- estreitas, cada uma validando exatamente o que autoriza, no mesmo padrão
-- de meu_cargo()/find_user_id_by_email()/criar_unidade() já existentes.
-- ══════════════════════════════════════════════════════════════════════════

-- Lista e-mails de TODAS as contas do Supabase Auth do projeto — mesmo gate
-- de find_user_id_by_email (chamador é chefe+médico ativo em qualquer
-- unidade), agora como enumeração em vez de busca por e-mail exato. Usada
-- para popular o seletor de "trocar vínculo" na tela de Equipe.
create or replace function public.listar_contas_supabase()
returns table (id uuid, email text)
language sql
security definer
set search_path = public, auth
stable
as $$
  select u.id, u.email
    from auth.users u
   where exists (
     select 1 from public.staff
      where user_id = auth.uid() and nivel = 'chefe'
        and profissao = 'medico' and active = true
   )
   order by u.email
$$;
grant execute on function public.listar_contas_supabase() to authenticated;

-- Unidades ativas para a tela de primeiro acesso. `units` SELECT é restrito
-- a sou_da_unidade(id) — quem ainda não é staff de nenhuma unidade não
-- enxergaria nenhuma linha na query direta, nem para escolher onde entrar.
create or replace function public.listar_unidades_ativas()
returns table (id uuid, name text)
language sql
security definer
set search_path = public
stable
as $$
  select id, name from public.units where active = true order by name
$$;
grant execute on function public.listar_unidades_ativas() to authenticated;

-- Primeiro acesso: a própria pessoa cria seu vínculo de staff. Nível trava
-- em 'plantonista' no corpo da função (não é parâmetro) — virar chefe
-- continua exigindo promoção manual por quem já é chefe da unidade.
create or replace function public.registrar_meu_acesso(p_unit_id uuid, p_full_name text, p_profissao text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if trim(coalesce(p_full_name, '')) = '' then
    raise exception 'Informe seu nome completo';
  end if;
  if not exists (select 1 from public.units where id = p_unit_id and active = true) then
    raise exception 'Unidade inválida';
  end if;
  if exists (select 1 from public.staff where user_id = auth.uid() and unit_id = p_unit_id) then
    raise exception 'Você já tem vínculo com esta unidade — peça a um chefe para reativar, se necessário';
  end if;

  insert into public.staff (user_id, unit_id, full_name, profissao, nivel, active)
  values (auth.uid(), p_unit_id, trim(p_full_name), p_profissao, 'plantonista', true)
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.registrar_meu_acesso(uuid, text, text) to authenticated;

-- Autoperfil: atualiza o próprio nome em TODAS as unidades onde a pessoa é
-- staff (nome é por linha de staff, não um perfil único) — mantém
-- consistente quem atende mais de uma unidade.
create or replace function public.atualizar_meu_nome(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if trim(coalesce(p_full_name, '')) = '' then
    raise exception 'Informe seu nome completo';
  end if;
  update public.staff set full_name = trim(p_full_name) where user_id = auth.uid();
end;
$$;
grant execute on function public.atualizar_meu_nome(text) to authenticated;
