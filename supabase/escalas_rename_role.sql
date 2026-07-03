-- Renomeia o cargo 'intensivista' para 'plantonista' na tabela staff.
-- 'chefe' continua representando o cargo "Médico Intensivista" (quem
-- administra a escala); o outro cargo passa a se chamar 'plantonista'
-- para bater com a nomenclatura real usada no restante do app
-- ("Médico Plantonista" / "Médico Intensivista").
alter table public.staff drop constraint staff_role_check;
update public.staff set role = 'plantonista' where role = 'intensivista';
alter table public.staff add constraint staff_role_check check (role in ('plantonista', 'chefe'));
