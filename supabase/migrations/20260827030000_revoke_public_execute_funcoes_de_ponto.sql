-- ============================================================================
-- ANON EXECUTAVA AS FUNCOES DE PRESENCA — REVOKE DE **PUBLIC**, nao de anon
-- ============================================================================
-- 27/08/2026
--
-- O QUE FOI MEDIDO
--   Logo apos aplicar 20260827000000 em producao, o teste de conferencia dela falhou:
--   fn_confirmar_presenca continuava respondendo 200 para a chave ANON. Uma varredura das
--   funcoes sensiveis, com a anon key e sem nenhum login, devolveu:
--
--     fn_confirmar_presenca               200  ANON EXECUTOU
--     fn_confirmar_presenca_manual        200  ANON EXECUTOU
--     fn_confirmar_presenca_manual_bulk   200  ANON EXECUTOU
--     fn_atestar_jornada_bulk             200  ANON EXECUTOU
--     fn_atestar_passos_autorizados_bulk  200  ANON EXECUTOU
--     fn_registrar_ponto                  200  ANON EXECUTOU
--
--   Ou seja: sem sessao nenhuma dava para gravar presenca em folha de ponto, bastando conhecer
--   matricula e PIN (ou, no caso das funcoes manuais, nem isso).
--
-- POR QUE O REVOKE ANTERIOR NAO PEGOU
--   No PostgreSQL, CREATE FUNCTION ja concede EXECUTE a **PUBLIC** por padrao. A
--   20260827000000 revogou de `anon, authenticated` — que continuam herdando o privilegio de
--   PUBLIC. Revogar do papel nomeado nao tira o que veio do papel implicito.
--
--   E isto NAO e' um defeito daquela migration apenas: nenhuma migration deste projeto revoga de
--   PUBLIC. O padrao usado ate' hoje, `GRANT EXECUTE ... TO authenticated, service_role`, e'
--   inofensivo mas tambem inutil como restricao — quem nao aparece na lista continua entrando
--   por PUBLIC. A unica funcao que ja' estava fechada, fn_registrar_ponto_terminal_local, e'
--   exatamente a que escreveu `REVOKE ALL ... FROM PUBLIC, anon, authenticated`.
--
-- O QUE ESTA MIGRATION FAZ - E O QUE NAO FAZ
--   Fecha as funcoes de PRESENCA. Nao varre o schema inteiro: ha' 74 RPCs chamadas pelo
--   aplicativo, e parte do que o Portal do Servidor usa depende de acesso sem sessao Supabase
--   (ele autentica por matricula + PIN). Revogar em massa sem mapear caso a caso derrubaria o
--   portal. A varredura completa fica registrada como trabalho proprio.
--
-- POR QUE POR NOME, E NAO POR ASSINATURA
--   fn_confirmar_presenca ja' existiu com (text,text,uuid) e (text,text,uuid,timestamptz) — as
--   migrations 20260528210000 e 20260611190000 dropam as duas. Uma sobrecarga esquecida seria a
--   porta continuar aberta.
-- ============================================================================


-- ============================================================================
-- 1. GRUPO A - nem anon nem authenticated precisam
-- ============================================================================
-- Nenhum codigo do aplicativo chama estas tres direto (conferido por grep em src/): quem as usa
-- sao envelopes SECURITY DEFINER (fn_registrar_ponto, fn_validar_presenca_manual,
-- fn_atestar_jornada_bulk, fn_atestar_passos_autorizados_bulk), que executam como donos da
-- funcao e por isso NAO sao afetados por este REVOKE.

DO $revoke$
DECLARE
    r record;
    v_nome text;
BEGIN
    FOREACH v_nome IN ARRAY ARRAY[
        'fn_confirmar_presenca',
        'fn_confirmar_presenca_manual',
        'fn_confirmar_presenca_manual_bulk'
    ] LOOP
        FOR r IN
            SELECT p.oid::regprocedure AS assinatura
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = v_nome
        LOOP
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.assinatura);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.assinatura);
            RAISE NOTICE 'fechada para anon/authenticated: %', r.assinatura;
        END LOOP;
    END LOOP;
END;
$revoke$;


-- ============================================================================
-- 2. GRUPO B - o aplicativo chama com sessao real; so' anon perde
-- ============================================================================
-- Estas sao chamadas da grade e do terminal, sempre com usuario logado. O GRANT nominal a
-- `authenticated` e' reafirmado logo apos o REVOKE de PUBLIC — sem ele, revogar de PUBLIC
-- derrubaria tambem quem esta' logado.
--
-- ⚠️ fn_registrar_ponto continua alcancavel por authenticated de proposito: e' assim que o
-- terminal classico registra ponto onde ele ainda esta' habilitado. Quem barra o canal
-- desligado e' o guard de 20260827000000, dentro da funcao.

DO $revoke$
DECLARE
    r record;
    v_nome text;
BEGIN
    FOREACH v_nome IN ARRAY ARRAY[
        'fn_registrar_ponto',
        'fn_registrar_presenca_informada',
        'fn_validar_presenca_manual',
        'fn_atestar_jornada_bulk',
        'fn_atestar_passos_autorizados_bulk',
        'fn_conceder_autorizacao_ponto_coletivo',
        'fn_revogar_autorizacao_ponto_coletivo',
        'fn_autorizacao_ponto_coletivo_vigente'
    ] LOOP
        FOR r IN
            SELECT p.oid::regprocedure AS assinatura
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = v_nome
        LOOP
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.assinatura);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.assinatura);
            RAISE NOTICE 'fechada para anon: %', r.assinatura;
        END LOOP;
    END LOOP;
END;
$revoke$;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) Nenhuma das funcoes acima pode continuar com EXECUTE para PUBLIC ou anon:
--
--   SELECT p.oid::regprocedure::text AS funcao,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS autenticado,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('fn_confirmar_presenca','fn_confirmar_presenca_manual',
--                        'fn_confirmar_presenca_manual_bulk','fn_registrar_ponto',
--                        'fn_registrar_presenca_informada','fn_validar_presenca_manual',
--                        'fn_atestar_jornada_bulk','fn_atestar_passos_autorizados_bulk',
--                        'fn_conceder_autorizacao_ponto_coletivo',
--                        'fn_revogar_autorizacao_ponto_coletivo',
--                        'fn_autorizacao_ponto_coletivo_vigente')
--    ORDER BY 1;
--
--   -- esperado: anon = false em TODAS.
--   -- esperado: autenticado = false nas tres do grupo A, true nas do grupo B.
--
--   2) Pela REST, com a chave ANON (sem login), cada uma tem de deixar de responder 200:
--
--   curl -s -o /dev/null -w "%{http_code}\n" -X POST \
--     "$SUPABASE_URL/rest/v1/rpc/fn_confirmar_presenca" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"p_matricula":"x","p_pin_servidor":"0","p_coordenador_id":null}'
--   -- esperado: 404 (invisivel para anon) — antes era 200
--
--   3) O caminho REAL nao pode ter quebrado. Com um coordenador logado na grade:
--      - validar em massa um dia (fn_atestar_jornada_bulk) tem de continuar funcionando;
--      - o modal de validacao manual (fn_validar_presenca_manual) idem.
--      Se qualquer um devolver "permission denied for function", o GRANT do grupo B nao foi
--      reaplicado — rode de novo esta migration, que e' idempotente.
