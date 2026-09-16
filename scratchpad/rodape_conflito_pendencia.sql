

-- ============================================================================
-- CONFERENCIA - roda junto e ABORTA se falhar
-- ============================================================================
-- Armadilha 42: conferir que a funcao EXISTE nao serve - a de 30/08/2026 existia e estava
-- quebrada. Esta EXECUTA as duas.
--
-- Armadilha da 20260909170000: migration roda como service_role (auth.uid() = NULL), onde todo
-- guard de papel bypassa. Para exercitar o caminho de verdade a conferencia PUBLICA um JWT
-- sintetico com set_config(..., true) - local a transacao.
--
-- Confere os DOIS sentidos em cada ponto. Afrouxar demais aqui e tao ruim quanto nao corrigir:
-- a deteccao existe para RECUSAR o cadastro novo sem confirmacao.
DO $conf$
DECLARE
    v_super       uuid;
    v_pend        uuid;
    v_pend_nome   text;
    v_unidade     uuid;
    v_setor       uuid;
    v_linha       record;
    v_ok_leitura  boolean := false;
    v_ok_papel    boolean := false;
    v_outro       uuid;
    v_ok_recusa   boolean := false;
BEGIN
    -- ------------------------------------------------------------------
    -- 1) Estrutura de fn_promover_pendencia_rh (a copia mecanica)
    -- ------------------------------------------------------------------
    PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'fn_promover_pendencia_rh'
        AND p.prosrc LIKE '%fn_cpf_ja_cadastrado(v_cpf_final)%';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ABORTADO: fn_promover_pendencia_rh nao passou a checar o CPF final.';
    END IF;

    PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'fn_promover_pendencia_rh'
        AND p.prosrc LIKE '%fn_cpf_ja_cadastrado(v_pend.cpf_normalizado)%';
    IF FOUND THEN
        RAISE EXCEPTION 'ABORTADO: sobrou checagem de CPF sobre v_pend.cpf_normalizado - CPF '
                        'digitado na tela voltaria a escapar da checagem.';
    END IF;

    -- Os guards que a copia nao pode ter perdido (armadilha 1).
    PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'fn_promover_pendencia_rh'
        AND p.prosrc LIKE '%fn_servidor_por_matricula(v_pend.matricula)%'
        AND p.prosrc LIKE '%fn_unidade_no_escopo(p_unidade_id)%'
        AND p.prosrc LIKE '%fn_cpf_digito_valido(v_cpf_final)%'
        AND p.prosrc LIKE '%CPF e obrigatorio para concluir o cadastro%';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ABORTADO: fn_promover_pendencia_rh perdeu um dos guards (matricula, '
                        'escopo de unidade, digito do CPF ou CPF obrigatorio).';
    END IF;

    -- ------------------------------------------------------------------
    -- 2) Privilegio da funcao nova (armadilha 24: o que restringe e o REVOKE)
    -- ------------------------------------------------------------------
    IF has_function_privilege('anon', 'public.fn_conflito_pendencia_rh(uuid, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon continua executando fn_conflito_pendencia_rh.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_conflito_pendencia_rh(uuid, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated perdeu fn_conflito_pendencia_rh - a tela de '
                        'Pendencias de Cadastro pararia inteira.';
    END IF;

    -- ------------------------------------------------------------------
    -- 3) Comportamento: a linha que a RLS derrubava passa a ser lida
    -- ------------------------------------------------------------------
    SELECT id INTO v_super FROM public.profiles WHERE role = 'super_admin' AND ativo IS NOT FALSE LIMIT 1;

    -- O caso exato do defeito: pendencia aberta, SEM unidade resolvida (invisivel a RLS de quem
    -- nao tem acesso total) e COM CPF que ja pertence a outro cadastro.
    SELECT ip.id, ip.nome INTO v_pend, v_pend_nome
      FROM public.importacao_rh_pendentes ip
     WHERE ip.promovido_em IS NULL
       AND ip.unidade_id IS NULL
       AND ip.cpf_normalizado IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.fn_cpf_ja_cadastrado(ip.cpf_normalizado))
       AND NOT EXISTS (SELECT 1 FROM public.fn_servidor_por_matricula(ip.matricula))
     LIMIT 1;

    IF v_super IS NULL OR v_pend IS NULL THEN
        RAISE NOTICE 'CONFERENCIA PARCIAL: sem super_admin ativo ou sem pendencia no caso do '
                     'defeito (sem unidade + com CPF colidindo). A estrutura e os privilegios '
                     'acima passaram.';
        RETURN;
    END IF;

    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);

    SELECT * INTO v_linha FROM public.fn_conflito_pendencia_rh(v_pend) LIMIT 1;
    -- Tem que devolver o CPF da pendencia (era isto que a tela nunca via, e por isso pedia um
    -- CPF que ja estava la) E apontar o conflito como 'cpf' (o unico tipo que pode virar
    -- vinculo adicional).
    v_ok_leitura := (v_linha.cpf_pendencia IS NOT NULL AND v_linha.tipo = 'cpf'
                     AND v_linha.servidor_id IS NOT NULL AND v_linha.alvo_no_escopo IS NOT NULL);

    -- ------------------------------------------------------------------
    -- 4) Sentido inverso: a promocao CONTINUA recusando sem confirmacao
    -- ------------------------------------------------------------------
    -- Executa de verdade. Se por engano ela promover, a SENTINELA abaixo reverte o savepoint
    -- implicito deste bloco - nenhum cadastro sobra.
    SELECT u.id INTO v_unidade FROM public.unidades u WHERE u.ativo IS NOT FALSE ORDER BY u.nome LIMIT 1;
    SELECT s.id INTO v_setor FROM public.setores s WHERE s.unidade_id = v_unidade LIMIT 1;

    IF v_unidade IS NOT NULL AND v_setor IS NOT NULL THEN
        BEGIN
            PERFORM public.fn_promover_pendencia_rh(v_pend, v_unidade, v_setor, 'CONFERENCIA', false, NULL);
            RAISE EXCEPTION 'SENTINELA_PROMOVEU';
        EXCEPTION
            WHEN others THEN
                IF SQLERRM LIKE '%CPF ja cadastrado%' THEN
                    v_ok_recusa := true;
                ELSIF SQLERRM = 'SENTINELA_PROMOVEU' THEN
                    v_ok_recusa := false;
                ELSE
                    RAISE EXCEPTION 'ABORTADO: fn_promover_pendencia_rh falhou por outro motivo '
                                    'na conferencia: %', SQLERRM;
                END IF;
        END;
    ELSE
        v_ok_recusa := true;  -- sem unidade/setor para exercitar; a estrutura ja passou
    END IF;

    -- ------------------------------------------------------------------
    -- 5) E o guard de papel da funcao nova recusa quem nao tem papel
    -- ------------------------------------------------------------------
    -- Sessao cujo sub nao existe em profiles: get_my_role() = NULL. Com o `NOT IN` puro das
    -- funcoes vizinhas isto NAO recusaria (NULL NOT IN (...) = NULL, e o IF nao dispara) - foi
    -- esta assercao que abortou a primeira aplicacao em producao e obrigou o guard a tratar
    -- NULL. Nao afrouxe: esta funcao le a tabela por fora da RLS.
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', '00000000-0000-0000-0000-000000000000',
                                         'role', 'authenticated')::text, true);
    BEGIN
        PERFORM public.fn_conflito_pendencia_rh(v_pend);
        v_ok_papel := false;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_ok_papel := true;
    END;

    -- E papel REAL fora da lista (Portal do Servidor) tambem e recusado, quando existir um.
    SELECT id INTO v_outro FROM public.profiles
     WHERE role NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role,
                        'coordenador'::public.user_role, 'rh'::public.user_role,
                        'rh_unidade'::public.user_role)
     LIMIT 1;
    IF v_outro IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', v_outro::text, 'role', 'authenticated')::text, true);
        BEGIN
            PERFORM public.fn_conflito_pendencia_rh(v_pend);
            v_ok_papel := false;
        EXCEPTION
            WHEN insufficient_privilege THEN
                NULL;  -- continua true
        END;
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);

    RAISE NOTICE 'pendencia % (%) | le fora do escopo: % | promocao ainda recusa sem confirmar: % | papel fechado: %',
        v_pend, v_pend_nome, v_ok_leitura, v_ok_recusa, v_ok_papel;

    IF NOT v_ok_leitura THEN
        RAISE EXCEPTION 'ABORTADO: fn_conflito_pendencia_rh nao enxergou a pendencia fora do '
                        'escopo - o defeito continua.';
    END IF;
    IF NOT v_ok_recusa THEN
        RAISE EXCEPTION 'ABORTADO: fn_promover_pendencia_rh criou cadastro SEM confirmacao de '
                        'vinculo adicional - a duplicata voltaria a nascer em silencio.';
    END IF;
    IF NOT v_ok_papel THEN
        RAISE EXCEPTION 'ABORTADO: fn_conflito_pendencia_rh responde a quem nao tem papel.';
    END IF;

    RAISE NOTICE 'CONFERENCIA OK.';
END;
$conf$;
