-- Cria um período hemodinâmico para pacientes com DVAs ativas sem período
-- vinculado (dado legado de antes do controle de turnos existir), e associa
-- essas DVAs a ele — evita que sumam da nova UI de turnos.
DO $$
DECLARE
  pid uuid;
  novo_periodo_id uuid;
  turno_atual text;
BEGIN
  FOR pid IN
    SELECT DISTINCT paciente_id FROM dvas WHERE periodo_id IS NULL AND ativo = true
  LOOP
    turno_atual := CASE WHEN EXTRACT(HOUR FROM now() AT TIME ZONE 'America/Sao_Paulo') BETWEEN 7 AND 18
                        THEN 'diurno' ELSE 'noturno' END;

    INSERT INTO periodos_hemodinamica (paciente_id, turno, data, inicio, fim)
    VALUES (
      pid, turno_atual, (now() AT TIME ZONE 'America/Sao_Paulo')::date, now(),
      now() + interval '12 hours'
    )
    RETURNING id INTO novo_periodo_id;

    UPDATE dvas SET periodo_id = novo_periodo_id
    WHERE paciente_id = pid AND periodo_id IS NULL AND ativo = true;
  END LOOP;
END $$;
