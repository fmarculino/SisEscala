-- ENSAIO REVERTIDO da 20260917140000, para rodar em HOMOLOGACAO pela ponte _deploy_run.
-- Monta um cenario sintetico, prova os DOIS sentidos e desfaz tudo com RAISE EXCEPTION.
-- Nao deixa nada no banco: o RAISE no fim e proposital e a saida esperada e o erro
-- 'ENSAIO CONCLUIDO'.
DO $conf$
DECLARE
    v_srv     uuid;
    v_prof    uuid;
    v_em      uuid;
    v_uni     uuid;
    v_turno   uuid;
    v_ed      uuid;
    v_marc    uuid;
    v_data    date;
    v_dia     integer;
    v_n       integer;
    v_r       jsonb;
    v_linhas  integer;
    v_diag    integer;
    v_ok      integer := 0;
BEGIN
    -- ------------------------------------------------------------------
    -- 0. SESSAO SIMULADA. Migration e ensaio rodam como service_role, onde
    --    fn_pode_reconciliar_presenca devolve NULL/false -- sem JWT o ensaio
    --    exercitaria o caminho de 'acesso_negado' e "passaria" sem testar nada.
    -- ------------------------------------------------------------------
    SELECT id INTO v_prof FROM public.profiles WHERE role = 'super_admin' LIMIT 1;
    IF v_prof IS NULL THEN
        RAISE EXCEPTION 'ABORTADO: homologacao nao tem profile super_admin para a sessao simulada.';
    END IF;
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_prof::text, 'role', 'authenticated')::text, true);

    IF public.get_my_role()::text <> 'super_admin' THEN
        RAISE EXCEPTION 'ABORTADO: sessao simulada nao pegou (get_my_role = %).', public.get_my_role();
    END IF;

    -- ------------------------------------------------------------------
    -- 1. CENARIO: escala aberta, dia passado, turno lancado, presenca VAZIA.
    -- ------------------------------------------------------------------
    SELECT em.id, em.servidor_id, em.unidade_id, make_date(em.ano, em.mes, 5)
      INTO v_em, v_srv, v_uni, v_data
      FROM public.escala_mensal em
     WHERE em.status <> 'Fechada'
       AND make_date(em.ano, em.mes, 5) < current_date
       AND NOT public.fn_competencia_encerrada(em.mes, em.ano)
     ORDER BY em.ano DESC, em.mes DESC
     LIMIT 1;

    IF v_em IS NULL THEN
        RAISE EXCEPTION 'ABORTADO: homologacao nao tem escala aberta com dia passado.';
    END IF;
    v_dia := extract(day from v_data)::integer;

    SELECT id INTO v_turno FROM public.dicionario_turnos
     WHERE codigo = 'MT' AND horario_inicio IS NOT NULL LIMIT 1;
    IF v_turno IS NULL THEN
        SELECT id INTO v_turno FROM public.dicionario_turnos WHERE horario_inicio IS NOT NULL LIMIT 1;
    END IF;
    IF v_turno IS NULL THEN
        RAISE EXCEPTION 'ABORTADO: nenhum turno ancorado no dicionario.';
    END IF;

    DELETE FROM public.escala_diaria
     WHERE escala_mensal_id = v_em AND dia = v_dia AND categoria = 'Plantão';

    INSERT INTO public.escala_diaria (escala_mensal_id, dia, categoria, dicionario_turnos_id)
    VALUES (v_em, v_dia, 'Plantão', v_turno)
    RETURNING id INTO v_ed;

    -- Batida FISICA daquele dia, no meio do turno.
    -- ⚠️ origem 'terminal' nao-sintetica, nao 'rep': a CHECK chk_marcacao_rep_completa exige
    --    dispositivo_id, nsr e afd_registro_id para origem 'rep', e forjar um registro de AFD
    --    so para o ensaio seria fabricar artefato legal. Para o que esta sendo provado as duas
    --    sao equivalentes -- fn_batida_fisica trata as duas como batida, e os quatro sentidos
    --    do predicado (inclusive 'rep') ja sao exercitados na conferencia 4.2 da migration.
    INSERT INTO public.marcacoes_ponto
        (servidor_id, origem, ocorrido_em, unidade_id, sintetica, observacao)
    VALUES (v_srv, 'terminal', (v_data::timestamp + time '08:03')::timestamptz, v_uni, false,
            'ENSAIO 20260917140000')
    RETURNING id INTO v_marc;

    -- ------------------------------------------------------------------
    -- 2. SENTIDO A -- batida EM CIRCULACAO: nao ha nada retido.
    -- ------------------------------------------------------------------
    SELECT count(*) INTO v_n FROM public.fn_batidas_retidas_dia(v_srv, v_data);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'ABORTADO(A): batida em circulacao contada como retida (% ).', v_n;
    END IF;
    v_ok := v_ok + 1;

    v_r := public.fn_reconciliar_dia_pendente(v_srv, v_data);
    IF v_r->>'status' = 'batida_retida' THEN
        RAISE EXCEPTION 'ABORTADO(A): dia SEM batida retida respondeu batida_retida.';
    END IF;
    RAISE NOTICE '[A] batida viva -> status=% (esperado ok/sem_mudanca/conflito)', v_r->>'status';
    v_ok := v_ok + 1;

    -- ------------------------------------------------------------------
    -- 3. SENTIDO B -- a reversao tira a batida de circulacao.
    -- ------------------------------------------------------------------
    INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)
    VALUES (v_marc, 'desconsiderar', 'ENSAIO: presenca revertida', v_prof);

    SELECT count(*) INTO v_n FROM public.fn_batidas_retidas_dia(v_srv, v_data);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ABORTADO(B): fn_batidas_retidas_dia devolveu % (esperado 1).', v_n;
    END IF;
    v_ok := v_ok + 1;

    -- Esta e a prova do defeito: antes da migration, este dia respondia "sem_mudanca".
    v_r := public.fn_reconciliar_dia_pendente(v_srv, v_data);
    IF v_r->>'status' <> 'batida_retida' THEN
        RAISE EXCEPTION 'ABORTADO(B): esperado status batida_retida, veio % (%).',
            v_r->>'status', v_r->>'motivo';
    END IF;
    IF (v_r->>'batidas_retidas')::integer <> 1 THEN
        RAISE EXCEPTION 'ABORTADO(B): batidas_retidas = % (esperado 1).', v_r->>'batidas_retidas';
    END IF;
    RAISE NOTICE '[B] batida retida -> status=% motivo=%', v_r->>'status', v_r->>'motivo';
    v_ok := v_ok + 1;

    -- ------------------------------------------------------------------
    -- 4. A PREVIA mostra o dia, com a linha de diagnostico.
    -- ------------------------------------------------------------------
    SELECT count(*), count(*) FILTER (WHERE tipo = 'batida_retida')
      INTO v_linhas, v_diag
      FROM public.fn_reconciliacao_pendente_escala(ARRAY[v_em]::uuid[])
     WHERE data = v_data;

    IF v_diag < 1 THEN
        RAISE EXCEPTION 'ABORTADO(B): a previa nao emitiu linha de diagnostico (linhas=%, diag=%).',
            v_linhas, v_diag;
    END IF;
    v_ok := v_ok + 1;

    SELECT count(*) INTO v_n
      FROM public.fn_reconciliacao_pendente_escala(ARRAY[v_em]::uuid[])
     WHERE data = v_data AND tipo = 'batida_retida' AND (dia_elegivel IS TRUE OR batidas_retidas <> 1);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'ABORTADO(B): linha de diagnostico com dia_elegivel TRUE ou contagem errada.';
    END IF;
    v_ok := v_ok + 1;

    -- ------------------------------------------------------------------
    -- 5. SENTIDO C -- restaurar devolve a batida a circulacao.
    --    Prova junto que created_at desempata (clock_timestamp, 20260917110000):
    --    com now() os dois tratamentos empatariam e o desconsiderar venceria sempre.
    -- ------------------------------------------------------------------
    INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)
    VALUES (v_marc, 'restaurar', 'ENSAIO: batida devolvida a circulacao', v_prof);

    SELECT count(*) INTO v_n FROM public.fn_batidas_retidas_dia(v_srv, v_data);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'ABORTADO(C): restaurar nao devolveu a batida (ainda % retida).', v_n;
    END IF;
    v_ok := v_ok + 1;

    v_r := public.fn_reconciliar_dia_pendente(v_srv, v_data);
    IF v_r->>'status' = 'batida_retida' THEN
        RAISE EXCEPTION 'ABORTADO(C): depois de restaurar, o dia ainda responde batida_retida.';
    END IF;
    v_ok := v_ok + 1;

    -- ------------------------------------------------------------------
    -- 6. SENTIDO D -- marcacao SINTETICA nao conta como batida.
    -- ------------------------------------------------------------------
    INSERT INTO public.marcacoes_ponto
        (servidor_id, origem, ocorrido_em, unidade_id, sintetica, observacao)
    VALUES (v_srv, 'terminal', (v_data::timestamp + time '12:00')::timestamptz, v_uni, true,
            'ENSAIO sintetica')
    RETURNING id INTO v_marc;
    INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)
    VALUES (v_marc, 'desconsiderar', 'ENSAIO: sintetica revertida', v_prof);

    SELECT count(*) INTO v_n FROM public.fn_batidas_retidas_dia(v_srv, v_data);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'ABORTADO(D): horario FABRICADO contou como batida retida (%).', v_n;
    END IF;
    v_ok := v_ok + 1;

    RAISE EXCEPTION 'ENSAIO CONCLUIDO: % de 9 asseveracoes passaram. Tudo revertido.', v_ok;
END;
$conf$;
