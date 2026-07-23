-- ══════════════════════════════════════════════════════════════════════════
-- LIMPEZA DOS DADOS DE TESTE (antes de rodar com pacientes reais)
--
-- ⚠️  DESTRUTIVO E IRREVERSÍVEL. Apaga TODOS os pacientes e tudo que pende
--     deles. Rode só quando os dados existentes forem fictícios.
--
-- O QUE APAGA: pacientes e todo o dado clínico (exames, balanço, sinais,
-- hemodinâmica, ATBs, cuidados, neuro, ventilatório, intercorrências,
-- pendências, registros, fisio, dispositivos, LPP, nutrição, IRAS, sepse),
-- resumos de alta e a trilha de auditoria.
--
-- O QUE PRESERVA: staff, units, shift_types, pay_settings, o espelho da escala
-- (schedule_template_shifts) e as contagens mensais lançadas à mão. Ou seja, a
-- configuração da unidade e da equipe fica intacta.
--
-- ORDEM IMPORTA: 8 tabelas referenciam `pacientes` com NO ACTION (atbs,
-- cuidados_horizontais, dvas, exames_imagem, intercorrencias,
-- pendencias_intensivista, registros_intensivista, sinais_vitais) — um
-- "delete from pacientes" direto FALHA por violação de chave estrangeira.
-- Elas precisam sair antes. As demais têm ON DELETE CASCADE e saem sozinhas.
--
-- resumos_alta usa ON DELETE SET NULL e auditoria_intensivista não tem FK
-- nenhuma: as duas virariam órfãs, então são apagadas explicitamente.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- 1. Filhos sem cascade — precisam sair antes de `pacientes`.
delete from public.atbs;
delete from public.cuidados_horizontais;
delete from public.dvas;
delete from public.exames_imagem;
delete from public.intercorrencias;
delete from public.pendencias_intensivista;
delete from public.registros_intensivista;
delete from public.sinais_vitais;

-- 2. Sem FK / com SET NULL — ficariam órfãos.
delete from public.resumos_alta;
delete from public.auditoria_intensivista;

-- 3. Pacientes. O cascade leva junto: exames, periodos_balanco,
--    periodos_hemodinamica, avaliacoes_neurologicas, suportes_ventilatorios,
--    fisio_eventos, fisio_avaliacoes_diarias, dispositivos, lpp_eventos,
--    nutricao_avaliacoes, nutricao_dia, iras_eventos, iras_sepse_choque.
delete from public.pacientes;

commit;
