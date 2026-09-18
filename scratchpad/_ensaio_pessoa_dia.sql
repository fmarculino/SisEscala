-- ENSAIO REVERTIDO da 20260917170000 (fn_reconciliar_pessoa_dia), em HOMOLOGACAO.
-- Monta dois cadastros IRMAOS sinteticos (mesmo CPF, dentro da transacao), prova os DOIS
-- sentidos e desfaz tudo com RAISE EXCEPTION. A saida esperada e o erro 'ENSAIO CONCLUIDO'.
DO $conf$
DECLARE
    v_a       uuid;   -- cadastro que RECEBE a batida (o do vinculo)
    v_b       uuid;   -- cadastro IRMAO, que tem a escala do dia
    v_cpf     text;
    v_prof    uuid;
    v_em_b    uuid;
    v_uni     uuid;
    v_turno   uuid;
    v_ed_b    uuid;
    v_marc    uuid;
    v_disp    uuid;
    v_data    date;
    v_dia     integer;
    v_r       jsonb;
    v_irm     jsonb;
    v_ent     timestamptz;
    v_sai     timestamptz;
    v_n       integer;
    v_ok      integer := 0;
BEGIN
    SELECT id INTO v_prof FROM public.profiles WHERE role = 'super_admin' LIMIT 1;

    -- 1. CENARIO: escala aberta, dia passado. O dono da escala e o cadastro B.
    SELECT em.id, em.servidor_id, em.unidade_id, make_date(em.ano, em.mes, 6)
      INTO v_em_b, v_b, v_uni, v_data
      FROM public.escala_mensal em
     WHERE em.status <> 'Fechada'
       AND make_date(em.ano, em.mes, 6) < current_date
       AND NOT public.fn_competencia_encerrada(em.mes, em.ano)
     ORDER BY em.ano DESC, em.mes DESC
     LIMIT 1;
    IF v_em_b IS NULL THEN
        RAISE EXCEPTION 'ABORTADO: homologacao nao tem escala aberta com dia passado.';
    END IF;
    v_dia := extract(day from v_data)::integer;

    -- 2. O IRMAO. Nao ha par de cadastros com o mesmo CPF garantido em homologacao, entao ele
    --    e FABRICADO dentro da transacao: um outro servidor Ativo recebe o CPF de B. E o mesmo
    --    criterio que fn_cadastros_irmaos usa (CPF de 11 digitos, Ativo, nao mesclado).
    SELECT regexp_replace(COALESCE(cpf,''), '\D', '', 'g') INTO v_cpf FROM public.servidores WHERE id = v_b;
    IF length(v_cpf) < 11 THEN
        RAISE EXCEPTION 'ABORTADO: o servidor da escala escolhida nao tem CPF de 11 digitos.';
    END IF;

    SELECT id INTO v_a FROM public.servidores
     WHERE id <> v_b AND status = 'Ativo' AND mesclado_em_servidor_id IS NULL LIMIT 1;
    IF v_a IS NULL THEN
        RAISE EXCEPTION 'ABORTADO: sem segundo servidor Ativo para fabricar o irmao.';
    END IF;
    UPDATE public.servidores SET cpf = v_cpf WHERE id = v_a;

    SELECT count(*) INTO v_n FROM public.fn_cadastros_irmaos(ARRAY[v_a]) WHERE irmao_id = v_b;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ABORTADO: o par de irmaos nao foi reconhecido por fn_cadastros_irmaos.';
    END IF;

    -- 3. A escala do dia, no cadastro B, com a presenca VAZIA.
    SELECT id INTO v_turno FROM public.dicionario_turnos
     WHERE horario_inicio IS NOT NULL ORDER BY codigo LIMIT 1;
    DELETE FROM public.escala_diaria WHERE escala_mensal_id = v_em_b AND dia = v_dia AND categoria = 'Plantão';
    INSERT INTO public.escala_diaria (escala_mensal_id, dia, categoria, dicionario_turnos_id)
    VALUES (v_em_b, v_dia, 'Plantão', v_turno)
    RETURNING id INTO v_ed_b;

    -- 4. A batida cai no cadastro A -- que NAO tem escala neste dia. E o caso RAIDANES.
    --
    -- 🚨 TEM DE SER ORIGEM 'rep', e a primeira versao deste ensaio usou 'terminal' e "passou"
    --    pelo motivo errado. A decisao 1 da 20260909130000 e explicita: SO A BATIDA DE RELOGIO
    --    DO IRMAO DISPUTA -- em origem `terminal`, marcacoes_ponto.unidade_id e a LOTACAO do
    --    servidor, nao o lugar da batida, e sem lugar confiavel nao da para afirmar que as duas
    --    matriculas disputam a mesma batida fisica.
    --
    -- chk_marcacao_rep_completa exige dispositivo_id E nsr (nao exige afd_registro_id), e o
    -- dispositivo precisa ser da MESMA unidade da escala: desde a 20260908150000 o casamento
    -- batida<->passo nao atravessa unidade.
    INSERT INTO public.dispositivos_rep (unidade_id, nome, ponto_valido_desde)
    VALUES (v_uni, 'ENSAIO 20260917170000', v_data - 1)
    RETURNING id INTO v_disp;

    INSERT INTO public.marcacoes_ponto
        (servidor_id, origem, ocorrido_em, unidade_id, sintetica, observacao, dispositivo_id, nsr)
    VALUES (v_a, 'rep',
            (v_data::timestamp + (SELECT horario_inicio FROM public.dicionario_turnos WHERE id = v_turno)
                               + interval '3 minutes')::timestamptz,
            v_uni, false, 'ENSAIO 20260917170000', v_disp, 999999001)
    RETURNING id INTO v_marc;

    -- ------------------------------------------------------------------
    -- SENTIDO A -- a funcao ANTIGA nao alcancaria o irmao.
    -- ------------------------------------------------------------------
    PERFORM public.fn_reconciliar_marcacoes_dia(v_a, v_data);
    SELECT presenca_entrada_em INTO v_ent FROM public.escala_diaria WHERE id = v_ed_b;
    IF v_ent IS NOT NULL THEN
        RAISE EXCEPTION 'ABORTADO(A): fn_reconciliar_marcacoes_dia alcancou o irmao -- o ensaio nao esta provando nada.';
    END IF;
    v_ok := v_ok + 1;

    -- ------------------------------------------------------------------
    -- SENTIDO B -- fn_reconciliar_pessoa_dia PREENCHE o irmao (acrescimo puro).
    -- ------------------------------------------------------------------
    v_r := public.fn_reconciliar_pessoa_dia(v_a, v_data);
    IF jsonb_array_length(v_r->'irmaos') <> 1 THEN
        RAISE EXCEPTION 'ABORTADO(B): esperava 1 irmao no retorno, veio %.', v_r->'irmaos';
    END IF;
    v_ok := v_ok + 1;

    v_irm := v_r->'irmaos'->0;
    IF v_irm->>'status' <> 'ok' OR (v_irm->>'campos')::integer < 1 THEN
        RAISE EXCEPTION 'ABORTADO(B): irmao nao foi preenchido: %', v_irm;
    END IF;
    v_ok := v_ok + 1;

    SELECT presenca_entrada_em INTO v_ent FROM public.escala_diaria WHERE id = v_ed_b;
    IF v_ent IS NULL THEN
        RAISE EXCEPTION 'ABORTADO(B): o retorno disse ok mas a celula do irmao continua vazia.';
    END IF;
    RAISE NOTICE '[B] irmao preenchido: entrada=% (%)', v_ent, v_irm->>'campos';
    v_ok := v_ok + 1;

    -- ------------------------------------------------------------------
    -- SENTIDO C -- IDEMPOTENTE: rodar de novo nao muda nada e nao mente.
    -- ------------------------------------------------------------------
    v_r := public.fn_reconciliar_pessoa_dia(v_a, v_data);
    v_irm := v_r->'irmaos'->0;
    IF v_irm->>'status' <> 'sem_mudanca' THEN
        RAISE EXCEPTION 'ABORTADO(C): segunda passagem devolveu % (esperado sem_mudanca).', v_irm->>'status';
    END IF;
    v_ok := v_ok + 1;

    -- ------------------------------------------------------------------
    -- SENTIDO D -- CONFLITO: horario ja gravado que a projecao MUDARIA nao e tocado.
    --   E a defesa medida: dos 425 pares de 09/2026, 13 sao troca e 4 sao perda.
    -- ------------------------------------------------------------------
    PERFORM set_config('sisescala.reconciliacao', 'on', true);
    UPDATE public.escala_diaria
       SET presenca_entrada_em = v_ent - interval '4 hours',
           presenca_entrada_origem = 'ajuste_coordenador'::public.marcacao_origem,
           presenca_entrada_manual = true
     WHERE id = v_ed_b;
    PERFORM set_config('sisescala.reconciliacao', 'off', true);

    v_r := public.fn_reconciliar_pessoa_dia(v_a, v_data);
    v_irm := v_r->'irmaos'->0;
    IF v_irm->>'status' <> 'conflito' THEN
        RAISE EXCEPTION 'ABORTADO(D): dia com horario divergente devolveu % (esperado conflito).', v_irm->>'status';
    END IF;
    v_ok := v_ok + 1;

    SELECT presenca_entrada_em INTO v_sai FROM public.escala_diaria WHERE id = v_ed_b;
    IF v_sai <> v_ent - interval '4 hours' THEN
        RAISE EXCEPTION 'ABORTADO(D): o horario ja gravado foi SOBRESCRITO apesar do conflito (% -> %).',
            v_ent - interval '4 hours', v_sai;
    END IF;
    v_ok := v_ok + 1;

    -- ------------------------------------------------------------------
    -- SENTIDO E -- sem irmao, nada muda no formato do retorno.
    -- ------------------------------------------------------------------
    UPDATE public.servidores SET cpf = NULL WHERE id = v_a;
    v_r := public.fn_reconciliar_pessoa_dia(v_a, v_data);
    IF jsonb_array_length(v_r->'irmaos') <> 0 OR v_r->'proprio' IS NULL THEN
        RAISE EXCEPTION 'ABORTADO(E): sem irmao o retorno ficou %', v_r;
    END IF;
    v_ok := v_ok + 1;

    RAISE EXCEPTION 'ENSAIO CONCLUIDO: % de 8 asseveracoes passaram. Tudo revertido.', v_ok;
END;
$conf$;
