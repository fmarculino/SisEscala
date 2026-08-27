-- ============================================================================
-- REVOKE DE PUBLIC **QUE CONFERE O PROPRIO RESULTADO**
-- ============================================================================
-- 27/08/2026 - substitui 20260827030000, que foi aplicada e NAO teve efeito.
--
-- O QUE ACONTECEU
--   A 20260827030000 rodou sem erro e, medido logo depois com a chave anon, absolutamente nada
--   mudou: fn_confirmar_presenca, fn_confirmar_presenca_manual, fn_confirmar_presenca_manual_bulk,
--   fn_atestar_jornada_bulk, fn_atestar_passos_autorizados_bulk e fn_registrar_ponto continuavam
--   respondendo 200 para ANON, sem login nenhum.
--
--   Levantamento pelo OpenAPI do PostgREST (que lista o que cada papel enxerga): das 394 funcoes
--   do schema public, **369 sao alcancaveis por anon** e apenas 25 estao fechadas. E as 25
--   fechadas tem uma coisa em comum: o REVOKE delas foi escrito na MESMA migration que CRIOU a
--   funcao (fn_ingerir_afd, fn_autenticar_dispositivo_rep, fn_autenticar_terminal_local,
--   fn_registrar_ponto_terminal_local, fn_excluir_setor...).
--
-- A LICAO, QUE VALE PARA QUALQUER MIGRATION DE PRIVILEGIO
--   **REVOKE de quem nao e' dono da funcao nao falha: emite WARNING e segue em frente.** Uma
--   migration de privilegio pode "aplicar com sucesso" e nao ter mudado nada - foi exatamente o
--   que aconteceu. Por isso esta aqui CONFERE o resultado e ABORTA se ele nao for o esperado.
--
--   A conferencia tambem separa a outra hipotese: se esta migration for aplicada por engano no
--   banco de homologacao (armadilha 3 do CLAUDE.md - sao dois bancos), a mensagem de erro diz
--   qual banco e qual usuario estao executando.
--
-- COMO LER O ERRO, SE HOUVER
--   A excecao lista funcao, DONO e quem ainda executa. Se o dono for diferente do usuario que
--   esta rodando a migration, o REVOKE precisa ser executado por esse dono (ou por um superusuario
--   / role que o contenha) - no Supabase, normalmente `postgres` no SQL Editor do projeto.
-- ============================================================================

DO $seguranca$
DECLARE
    r            record;
    v_nome       text;
    v_pendentes  text := '';
    v_total      integer := 0;

    -- Grupo A: nem anon nem authenticated precisam. Nenhum codigo do aplicativo as chama direto
    -- (conferido por grep em src/) - quem as usa sao envelopes SECURITY DEFINER, que executam
    -- como donos e por isso NAO sao afetados.
    v_grupo_a text[] := ARRAY[
        'fn_confirmar_presenca',
        'fn_confirmar_presenca_manual',
        'fn_confirmar_presenca_manual_bulk',
        'fn_salvar_saida_bloco'
    ];

    -- Grupo B: o aplicativo chama com usuario logado. So' anon perde; o GRANT nominal a
    -- authenticated e' reafirmado logo apos o REVOKE, senao a grade cairia junto.
    v_grupo_b text[] := ARRAY[
        'fn_registrar_ponto',
        'fn_registrar_presenca_informada',
        'fn_validar_presenca_manual',
        'fn_aceitar_marcacao_pendente',
        'fn_aceitar_tentativa_recusada',
        'fn_atestar_jornada_bulk',
        'fn_atestar_passos_autorizados_bulk',
        'fn_conceder_autorizacao_ponto_coletivo',
        'fn_revogar_autorizacao_ponto_coletivo',
        'fn_autorizacao_ponto_coletivo_vigente',
        'fn_reverter_presenca_manual',
        'fn_reclassificar_passo_presenca',
        'fn_solicitar_ajuste_ponto'
    ];
BEGIN
    RAISE NOTICE 'Executando em banco=% como usuario=%', current_database(), current_user;

    -- ---- Grupo A ----------------------------------------------------------
    FOREACH v_nome IN ARRAY v_grupo_a LOOP
        FOR r IN
            SELECT p.oid, p.oid::regprocedure AS assinatura
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = v_nome
        LOOP
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.assinatura);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.assinatura);
        END LOOP;
    END LOOP;

    -- ---- Grupo B ----------------------------------------------------------
    FOREACH v_nome IN ARRAY v_grupo_b LOOP
        FOR r IN
            SELECT p.oid, p.oid::regprocedure AS assinatura
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = v_nome
        LOOP
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.assinatura);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.assinatura);
        END LOOP;
    END LOOP;

    -- ---- A CONFERENCIA, que e' a razao de existir desta migration ---------
    FOR r IN
        SELECT p.oid::regprocedure::text AS assinatura,
               pg_get_userbyid(p.proowner)                        AS dono,
               has_function_privilege('anon', p.oid, 'EXECUTE')   AS anon_executa,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa,
               p.proname
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = ANY(v_grupo_a || v_grupo_b)
    LOOP
        IF r.anon_executa
           OR (r.proname = ANY(v_grupo_a) AND r.auth_executa) THEN
            v_total := v_total + 1;
            v_pendentes := v_pendentes || format(
                E'\n  - %s (dono: %s) — anon=%s, authenticated=%s',
                r.assinatura, r.dono, r.anon_executa, r.auth_executa);
        END IF;
    END LOOP;

    IF v_total > 0 THEN
        RAISE EXCEPTION
            E'REVOKE nao teve efeito em % funcao(oes), em banco=% como usuario=%.%\n\n'
            'REVOKE de quem nao e dono nao falha - so avisa. Confira o DONO listado acima: se for '
            'diferente de "%", rode esta migration como aquele role (ou como superusuario).',
            v_total, current_database(), current_user, v_pendentes, current_user;
    END IF;

    RAISE NOTICE 'OK: todas as funcoes listadas estao fechadas para anon.';
END;
$seguranca$;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) O estado real, funcao a funcao (esperado: anon = false em TODAS):
--
--   SELECT p.oid::regprocedure::text AS funcao,
--          pg_get_userbyid(p.proowner) AS dono,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS autenticado
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname LIKE 'fn_%presenc%' OR p.proname LIKE 'fn_atestar%'
--    ORDER BY 1;
--
--   2) Quanto do schema ainda esta aberto a anon (diagnostico do problema maior):
--
--   SELECT count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')) AS abertas,
--          count(*) AS total
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f';
--   -- medido em 27/08/2026, ANTES desta migration: 369 abertas de 394.
--
--   3) O caminho REAL nao pode ter quebrado - com um coordenador logado na grade:
--      validar em massa um dia, e abrir o modal de validacao manual. Se algum devolver
--      "permission denied for function", o GRANT do grupo B nao pegou.
