-- ============================================================================
-- CONFERENCIA — roda junto e ABORTA a migration se qualquer assercao falhar
-- ============================================================================
-- Ela EXECUTA as funcoes (armadilha 42: conferir que a funcao EXISTE nao prova nada — plpgsql so
-- resolve nome de coluna, de funcao e de operador no momento em que o statement roda; e o proprio
-- fn_avisos_ponto_pendentes ja foi para producao "criado com sucesso" e quebrado).
--
-- Confere os DOIS sentidos. Só o primeiro nao serviria: uma regra que dispara sempre "corrige" o
-- caso do vigia e move junto o Plantao diurno em jornada noturna, que o NIVEL 2-A poe no dia civil
-- de proposito. Afrouxar aqui troca um erro silencioso por outro.
--
-- Nada e' fixado em matricula, servidor ou unidade: homologacao e producao tem conteudos
-- diferentes (armadilha 3), e assercao presa a um dado que so existe num dos bancos reprova a
-- migration pelo motivo errado.
DO $conf$
DECLARE
    v_falhas text[] := ARRAY[]::text[];
    v_n      bigint;
    v_serv   uuid;
    v_data   date;
    v_forma  bigint;
    v_mudam  bigint;
BEGIN
    -- ------------------------------------------------------------------
    -- 1. TABELA-VERDADE da regra pura. Sem dado nenhum: so numeros.
    --    (hora, duracao, reg_ini, reg_fim, esperado, o que e')
    -- ------------------------------------------------------------------
    -- DISPARA: a hora extra de passagem de turno do vigia, nas duas jornadas noturnas do catalogo.
    IF NOT public.fn_hora_prevista_dia_seguinte(6, 1, 18, 6) THEN
        v_falhas := v_falhas || 'extra 1h @06:00 em 18H AS 06H deveria subir um dia';
    END IF;
    IF NOT public.fn_hora_prevista_dia_seguinte(7, 1, 19, 7) THEN
        v_falhas := v_falhas || 'extra 1h @07:00 em 19H AS 07H deveria subir um dia';
    END IF;
    -- Duracao maior continua solta antes da jornada: continua subindo.
    IF NOT public.fn_hora_prevista_dia_seguinte(6, 2, 18, 6) THEN
        v_falhas := v_falhas || 'extra 2h @06:00 em 18H AS 06H deveria subir um dia';
    END IF;

    -- NAO DISPARA: Plantao MT de 12h as 07:00 em 19H AS 07H. Emenda dos dois lados — ambiguo, e o
    -- NIVEL 2-A ja o poe no dia civil. E a unica linha desta forma medida em producao.
    IF public.fn_hora_prevista_dia_seguinte(7, 12, 19, 7) THEN
        v_falhas := v_falhas || 'plantao 12h @07:00 em 19H AS 07H NAO pode subir de dia (ambiguo)';
    END IF;
    -- NAO DISPARA: jornada diurna. E' a maioria da base (844 linhas medidas) e nada pode mudar la.
    IF public.fn_hora_prevista_dia_seguinte(13, 2, 7, 13) THEN
        v_falhas := v_falhas || 'jornada diurna 07H AS 13H nunca pode subir de dia';
    END IF;
    IF public.fn_hora_prevista_dia_seguinte(14, 4, 8, 18) THEN
        v_falhas := v_falhas || 'jornada diurna 08H AS 18H nunca pode subir de dia';
    END IF;
    -- NAO DISPARA: hora da madrugada que NAO e' o fim da jornada. Deliberado — ver "NAO AFROUXAR".
    IF public.fn_hora_prevista_dia_seguinte(2, 1, 18, 6) THEN
        v_falhas := v_falhas || 'hora da madrugada fora do fim da jornada nao pode ser adivinhada';
    END IF;
    IF public.fn_hora_prevista_dia_seguinte(5, 1, 18, 6) THEN
        v_falhas := v_falhas || 'hora da madrugada fora do fim da jornada nao pode ser adivinhada';
    END IF;
    -- NAO DISPARA: hora que ja esta na parte noturna do eixo (>= inicio da jornada).
    IF public.fn_hora_prevista_dia_seguinte(19, 1, 18, 6) THEN
        v_falhas := v_falhas || 'hora depois do inicio da jornada ja esta no eixo certo';
    END IF;
    -- NAO DISPARA: sem duracao, ou com numero faltando, nao ha o que afirmar.
    IF public.fn_hora_prevista_dia_seguinte(6, 0,    18, 6)   THEN v_falhas := v_falhas || 'duracao zero nao pode subir de dia';   END IF;
    IF public.fn_hora_prevista_dia_seguinte(6, NULL, 18, 6)   THEN v_falhas := v_falhas || 'duracao nula nao pode subir de dia';   END IF;
    IF public.fn_hora_prevista_dia_seguinte(NULL, 1, 18, 6)   THEN v_falhas := v_falhas || 'hora nula nao pode subir de dia';      END IF;
    IF public.fn_hora_prevista_dia_seguinte(6, 1, NULL, 6)    THEN v_falhas := v_falhas || 'jornada desconhecida nao pode subir';  END IF;
    IF public.fn_hora_prevista_dia_seguinte(6, 1, 18, NULL)   THEN v_falhas := v_falhas || 'jornada desconhecida nao pode subir';  END IF;

    -- ------------------------------------------------------------------
    -- 2. O ENVELOPE, executado sobre as linhas REAIS da base.
    -- ------------------------------------------------------------------
    -- Hora nula continua nula: e' o que faz o COALESCE da cascata seguir descendo os niveis.
    IF public.fn_hora_prevista_no_eixo_do_dia(NULL, 1, NULL, 1) IS NOT NULL THEN
        v_falhas := v_falhas || 'hora nula tem que devolver NULL para a cascata continuar';
    END IF;
    -- Sem Regular no dia (escala_mensal inexistente) devolve a hora crua, nunca erro.
    IF public.fn_hora_prevista_no_eixo_do_dia(
           '00000000-0000-0000-0000-000000000000'::uuid, 1, '06:00'::time, 1) <> 6 THEN
        v_falhas := v_falhas || 'sem Regular no dia a hora informada tem que sair crua';
    END IF;

    -- Toda linha que MUDA de dia tem que ter exatamente a forma prevista. Se aparecer uma que sobe
    -- sem o Regular cruzar a meia-noite, ou sem a hora ser a do fim dele, a regra vazou.
    SELECT count(*) INTO v_n
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    CROSS JOIN LATERAL (
        SELECT public.fn_obter_horario_regular_dia(em.id, ed.dia) AS reg
    ) r
    WHERE ed.hora_inicio_prevista IS NOT NULL
      AND ed.categoria <> 'Regular'
      AND public.fn_hora_prevista_no_eixo_do_dia(em.id, ed.dia, ed.hora_inicio_prevista, dt.horas_computadas) >= 24
      AND NOT (
            r.reg IS NOT NULL
        AND (r.reg->>'end_hour')::integer < (r.reg->>'start_hour')::integer
        AND extract(hour from ed.hora_inicio_prevista)::integer = (r.reg->>'end_hour')::integer
      );
    IF v_n > 0 THEN
        v_falhas := v_falhas || format('%s linha(s) sobem de dia FORA da forma prevista', v_n);
    END IF;

    -- O outro sentido: onde a forma existe, a regra precisa MESMO disparar. Sem isto a migration
    -- passaria com uma funcao que devolve sempre a hora crua — que e' exatamente o bug de hoje.
    SELECT count(*) INTO v_forma
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    CROSS JOIN LATERAL (SELECT public.fn_obter_horario_regular_dia(em.id, ed.dia) AS reg) r
    WHERE ed.hora_inicio_prevista IS NOT NULL
      AND ed.categoria <> 'Regular'
      AND r.reg IS NOT NULL
      AND (r.reg->>'end_hour')::integer < (r.reg->>'start_hour')::integer
      AND extract(hour from ed.hora_inicio_prevista)::integer = (r.reg->>'end_hour')::integer
      AND extract(hour from ed.hora_inicio_prevista)::integer + COALESCE(dt.horas_computadas, 0)
          < (r.reg->>'start_hour')::integer;

    SELECT count(*) INTO v_mudam
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    WHERE ed.hora_inicio_prevista IS NOT NULL
      AND ed.categoria <> 'Regular'
      AND public.fn_hora_prevista_no_eixo_do_dia(em.id, ed.dia, ed.hora_inicio_prevista, dt.horas_computadas) >= 24;

    IF v_mudam <> v_forma THEN
        v_falhas := v_falhas || format('%s linha(s) com a forma do vigia, mas %s sobem de dia', v_forma, v_mudam);
    END IF;
    RAISE NOTICE 'linhas que passam a resolver no dia seguinte: % (de % com hora informada)',
        v_mudam, (SELECT count(*) FROM public.escala_diaria WHERE hora_inicio_prevista IS NOT NULL);

    -- ------------------------------------------------------------------
    -- 3. As TRES funcoes recopiadas continuam EXECUTANDO.
    -- ------------------------------------------------------------------
    -- fn_blocos_previstos_dia e' a unica das tres que da para chamar sem escrever nada. As outras
    -- duas gravam presenca, entao aqui so se confere que o corpo delas foi aceito; quem as exercita
    -- de verdade e' o ensaio em homologacao, revertido.
    SELECT em.servidor_id, make_date(em.ano, em.mes, ed.dia)
      INTO v_serv, v_data
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    WHERE ed.categoria = 'Regular'
      AND ed.dia BETWEEN 1 AND 28
    ORDER BY em.ano DESC, em.mes DESC, ed.dia DESC
    LIMIT 1;

    IF v_serv IS NOT NULL THEN
        PERFORM * FROM public.fn_blocos_previstos_dia(v_serv, v_data);
        RAISE NOTICE 'fn_blocos_previstos_dia executou para % em %', v_serv, v_data;
    ELSE
        RAISE NOTICE 'sem escala Regular na base: fn_blocos_previstos_dia nao pode ser executada aqui';
    END IF;

    -- ------------------------------------------------------------------
    -- 4. Privilegios, nos DOIS sentidos (armadilhas 24 e 39).
    -- ------------------------------------------------------------------
    IF has_function_privilege('anon',
        'public.fn_hora_prevista_dia_seguinte(integer, numeric, integer, integer)', 'EXECUTE') THEN
        v_falhas := v_falhas || 'fn_hora_prevista_dia_seguinte ficou aberta a anon';
    END IF;
    IF has_function_privilege('anon',
        'public.fn_hora_prevista_no_eixo_do_dia(uuid, integer, time, numeric)', 'EXECUTE') THEN
        v_falhas := v_falhas || 'fn_hora_prevista_no_eixo_do_dia ficou aberta a anon';
    END IF;
    -- E o inverso: a grade chama fn_blocos_previstos_mes -> fn_blocos_previstos_dia com a sessao do
    -- coordenador. Revogar demais aqui deixa a tela de escala sem previsto nenhum.
    IF NOT has_function_privilege('authenticated',
        'public.fn_blocos_previstos_dia(uuid, date)', 'EXECUTE') THEN
        v_falhas := v_falhas || 'fn_blocos_previstos_dia PERDEU execute de authenticated';
    END IF;

    IF array_length(v_falhas, 1) > 0 THEN
        RAISE EXCEPTION 'CONFERENCIA REPROVADA: %', array_to_string(v_falhas, ' | ');
    END IF;
    RAISE NOTICE 'conferencia OK';
END;
$conf$;
