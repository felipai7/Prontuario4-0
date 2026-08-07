-- ══════════════════════════════════════════════════════════════════════════
-- MÓDULO HOSPITAL — leito vira texto, e o resto que a expansão exige
--
-- Leito era inteiro porque a UTI só tinha leitos numerados. O Piso 02 do
-- hospital tem leitos com código real de porta ("01A", "02C"...) — inteiro
-- não representa isso, então numero_leito/leitos.numero viram texto em toda
-- a base. O índice único parcial (unit_id, ala_id, numero_leito) continua
-- funcionando igual com texto.
--
-- Aproveitando a migração: origem_uti_alta_id (rastreia de qual alta da UTI
-- veio um paciente transferido para o hospital — deliberadamente separado de
-- readmissao_de, que alimenta reinternacoes_48h/30d e não deve ser inflado
-- por uma transferência de rotina) e requer_saps3 (algumas unidades, como o
-- Hospital, não pontuam SAPS-3 — sem isso a alta desses pacientes ficaria
-- bloqueada para sempre).
-- ══════════════════════════════════════════════════════════════════════════

begin;

alter table public.leitos    alter column numero       type text using numero::text;
alter table public.pacientes alter column numero_leito type text using numero_leito::text;

alter table public.pacientes
  add column if not exists origem_uti_alta_id uuid references public.resumos_alta(id);

alter table public.units
  add column if not exists requer_saps3 boolean not null default true;

commit;
