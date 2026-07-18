-- ══════════════════════════════════════════════════════════════════════════
-- VNI é uso INTERMITENTE, não contínuo.
--
-- O evento de VNI representa um EPISÓDIO: o conjunto de sessões com o mesmo
-- objetivo clínico (ex.: evitar intubação numa descompensação), que costuma se
-- espalhar por vários dias em sessões de algumas horas.
--
-- Isso importa para o indicador: "VNI que evitou IOT / VNI com objetivo de
-- evitar IOT" conta EPISÓDIOS, não sessões. Registrar cada sessão como um
-- evento inflaria o denominador e diluiria o indicador — um paciente com 12
-- sessões viraria 12 tentativas de evitar intubação, quando foi uma só.
--
-- `data` continua sendo o início do episódio; `data_fim` é opcional (nulo =
-- episódio ainda em curso).
-- ══════════════════════════════════════════════════════════════════════════

alter table public.fisio_eventos
  add column if not exists data_fim date;

alter table public.fisio_eventos
  drop constraint if exists fisio_eventos_periodo_check;
alter table public.fisio_eventos
  add constraint fisio_eventos_periodo_check
  check (data_fim is null or data_fim >= data);

comment on column public.fisio_eventos.data is
  'Início do episódio. Para VNI, o primeiro dia do conjunto de sessões — não uma sessão isolada.';
comment on column public.fisio_eventos.data_fim is
  'Fim do episódio (opcional; nulo = em curso). Só faz sentido para eventos que se estendem, como VNI e desmame difícil.';

-- O indicador de VNI conta episódios pela data de INÍCIO: um episódio que
-- começou em julho e terminou em agosto pertence a julho, onde a decisão
-- clínica de tentar evitar a intubação foi tomada. A contagem já usa `data`,
-- então contagens_fisio_mes não muda.
