-- Run in Supabase SQL Editor ou via `supabase db query --linked --file`

-- ══════════════════════════════════════════════════════════════════════════
-- Planos de saúde deixam de ser uma lista fixa em lib/config.ts e viram um
-- array por unidade, editável pelo chefe (médico intensivista) dentro de
-- /unidade — mesmo espírito de `requer_saps3`: cada unidade pode ter um
-- conjunto diferente, e não depende mais de deploy pra crescer.
--
-- "Outros" continua fora do array de propósito: é o sentinela de texto livre
-- no formulário (lib/config.ts), sempre acrescentado por último na UI — não é
-- um plano de verdade, então não faz sentido virar item removível pelo chefe.
-- ══════════════════════════════════════════════════════════════════════════

begin;

alter table public.units
  add column if not exists planos_saude text[] not null default array['IPASGO', 'Unimed', 'Particular', 'Bradesco'];

-- Levantamento dos planos que hoje só existem como texto livre em "Outros"
-- entre os pacientes já com alta (todos da UTI IMEC): padroniza como opção.
update public.units
   set planos_saude = array['IPASGO', 'Unimed', 'Particular', 'Bradesco', 'CELGMED', 'IMEC Colaboradora', 'Saúde Caixa']
 where name = 'UTI IMEC';

commit;
