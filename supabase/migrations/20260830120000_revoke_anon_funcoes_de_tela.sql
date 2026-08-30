-- ============================================================================
-- Fechar `anon` nas funcoes que servem TELA AUTENTICADA (item 13 da auditoria)
-- ============================================================================
-- 30/08/2026 - continuacao das 20260827030000/040000/050000, que fecharam o nucleo de presenca.
--
-- 🚨 O QUE FOI MEDIDO EM PRODUCAO, COM A CHAVE ANON (a que vai no bundle do navegador)
--
--     POST /rest/v1/rpc/fn_tentativas_negadas_diagnostico   {}   ->  HTTP 200, 684 LINHAS
--
--   Devolvendo `servidor_id`, `servidor_nome`, `matricula`, `unidade_nome` e `setor_nome` de
--   servidor publico. SEM LOGIN NENHUM. `fn_tentativas_negadas_resumo` idem, em forma agregada
--   (586 tentativas, 240 servidores-dia). Isso e' exposicao de dado pessoal, nao so higiene.
--
-- ⚠️ E O RESTO CONFIRMOU A HIPOTESE DA 20260827050000, o que muda o escopo desta migration.
--   Sondadas com anon, as funcoes que conferem escopo sozinhas RECUSAM de verdade:
--       get_my_role()            -> null
--       fn_unidade_no_escopo()   -> false
--       fn_setores_no_escopo()   -> array vazio
--       fn_pendencias_biometria()-> array vazio
--   Ou seja: estar "aberta a anon" nao e', por si so', vazamento. O que vaza e' a funcao que
--   NAO filtra por escopo. Por isso esta migration fecha as funcoes de TELA e deixa de fora as
--   de calculo puro (fn_cpf_digito_valido, fn_precedencia_origem, fn_intervalo_minimo_legal...),
--   que nao tocam em dado.
--
-- ⚠️ QUATRO FUNCOES FICAM DELIBERADAMENTE INTOCADAS, e mexer nelas derruba a aplicacao:
--       get_my_role · fn_unidade_no_escopo · fn_unidade_alcancavel_por_setor · fn_setores_no_escopo
--   Elas sao chamadas DE DENTRO de policies de RLS (`get_my_role` aparece em 38 migrations). A
--   policy e avaliada com os privilegios de QUEM CONSULTA: tirar EXECUTE de `authenticated` ali
--   faz TODA consulta daquele papel falhar. Nao e degradacao, e a aplicacao parando. E as quatro
--   ja' devolvem vazio/false para anon, medido acima.
--
-- ⚠️ AS 252 FUNCOES DO POSTGIS TAMBEM FICAM. Elas dominam a contagem de "funcoes visiveis a
--   anon" (252 de 321) e sao geometria pura, sem acesso a dado. Alem disso pertencem a extensao:
--   nao somos o dono, e `REVOKE` de quem nao e' dono so' emite WARNING (armadilha 24) — a
--   migration "aplicaria com sucesso" sem mudar nada. Fechar o schema do PostGIS, se um dia for
--   desejado, e' outra decisao, com outro metodo.
--
-- IDEMPOTENTE: REVOKE/GRANT sao repetiveis.
-- ============================================================================

DO $fecha$
DECLARE
    -- Funcoes chamadas pela APLICACAO com a sessao do usuario (`createClient()`), nunca por
    -- pagina publica. Todas conferidas uma a uma contra os chamadores em src/.
    -- Resolvidas por NOME e nao por assinatura: assinatura envelhece a cada parametro novo, e
    -- uma sobrecarga esquecida deixaria a porta aberta em silencio.
    c_nomes constant text[] := ARRAY[
        -- 🚨 as duas que vazam dado pessoal hoje
        'fn_tentativas_negadas_diagnostico',
        'fn_tentativas_negadas_resumo',
        -- cadastro / pendencias de RH
        'fn_atualizar_cadastro_via_pendencia_rh',
        'fn_buscar_pendencia_rh_por_termo',
        'fn_cpf_ja_cadastrado',
        'fn_pendencia_rh_por_cpf',
        'fn_promover_pendencia_rh',
        -- relogio de ponto / marcacoes
        'fn_cobertura_ponto_dispositivo',
        'fn_cobertura_ponto_resumo',
        'fn_enfileirar_cadastros_rep',
        'fn_enfileirar_remocao_usuarios_dispositivo',
        'fn_gerar_token_dispositivo_rep',
        'fn_gerar_token_terminal_local',
        'fn_higiene_usuarios_dispositivo',
        'fn_pendencias_biometria',
        -- sobreaviso (o PAINEL, que e' da tela interna; o ciclo do link magico fica aberto)
        'fn_contato_acionamento_sobreaviso',
        'fn_painel_sobreaviso_dia'
    ];
    v_nome  text;
    v_proc  record;
    v_total integer := 0;
BEGIN
    FOREACH v_nome IN ARRAY c_nomes LOOP
        FOR v_proc IN
            SELECT p.oid::regprocedure AS assinatura
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname = v_nome
               AND p.prokind = 'f'          -- funcao comum; trigger nao e exposta como RPC
        LOOP
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_proc.assinatura);
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon',   v_proc.assinatura);
            -- REAFIRMA authenticated: e a tela do coordenador que chama estas funcoes.
            EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated, service_role', v_proc.assinatura);
            v_total := v_total + 1;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Privilegios ajustados em % funcao(oes)/sobrecarga(s).', v_total;

    IF v_total < array_length(c_nomes, 1) THEN
        RAISE EXCEPTION
            'ABORTADO: % nomes na lista mas so % funcao(oes) encontradas em pg_proc. '
            'Alguma foi renomeada ou nao existe neste banco (armadilha 3: os schemas divergem).',
            array_length(c_nomes, 1), v_total;
    END IF;
END
$fecha$;


-- ============================================================================
-- VERIFICACAO - aborta se o resultado divergir, NOS DOIS SENTIDOS
-- ============================================================================
-- ⚠️ "Aplicou sem erro" nao e' prova: REVOKE de quem nao e' dono da funcao apenas emite WARNING
-- e segue (foi assim que a 20260827030000 nao mudou nada). E revogar DEMAIS quebra em silencio,
-- que e a licao da 20260827050000. Por isso as duas direcoes sao conferidas.
DO $verifica$
DECLARE
    v_abertas   text;
    v_perdidas  text;
    v_dono      text;
BEGIN
    -- 1) nenhuma pode continuar executavel por anon/PUBLIC
    SELECT string_agg(DISTINCT p.proname, ', ')
      INTO v_abertas
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proname IN (
             'fn_tentativas_negadas_diagnostico','fn_tentativas_negadas_resumo',
             'fn_atualizar_cadastro_via_pendencia_rh','fn_buscar_pendencia_rh_por_termo',
             'fn_cpf_ja_cadastrado','fn_pendencia_rh_por_cpf','fn_promover_pendencia_rh',
             'fn_cobertura_ponto_dispositivo','fn_cobertura_ponto_resumo',
             'fn_enfileirar_cadastros_rep','fn_enfileirar_remocao_usuarios_dispositivo',
             'fn_gerar_token_dispositivo_rep','fn_gerar_token_terminal_local',
             'fn_higiene_usuarios_dispositivo','fn_pendencias_biometria',
             'fn_contato_acionamento_sobreaviso','fn_painel_sobreaviso_dia')
       AND has_function_privilege('anon', p.oid, 'EXECUTE');

    IF v_abertas IS NOT NULL THEN
        SELECT string_agg(DISTINCT pg_get_userbyid(p.proowner), ', ') INTO v_dono
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'fn_tentativas_negadas_resumo';
        RAISE EXCEPTION
            'ABORTADO: ainda executaveis por anon: %. Banco=%, usuario=%, dono=%. '
            'REVOKE de quem nao e dono so emite WARNING - rode como o dono.',
            v_abertas, current_database(), current_user, v_dono;
    END IF;

    -- 2) o outro sentido: a tela do coordenador PRECISA continuar chamando
    SELECT string_agg(DISTINCT p.proname, ', ')
      INTO v_perdidas
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proname IN (
             'fn_tentativas_negadas_diagnostico','fn_tentativas_negadas_resumo',
             'fn_cobertura_ponto_dispositivo','fn_cobertura_ponto_resumo',
             'fn_pendencias_biometria','fn_painel_sobreaviso_dia',
             'fn_gerar_token_dispositivo_rep','fn_gerar_token_terminal_local')
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');

    IF v_perdidas IS NOT NULL THEN
        RAISE EXCEPTION
            'ABORTADO: estas perderam EXECUTE de authenticated e a tela para de funcionar: %',
            v_perdidas;
    END IF;

    -- 3) as quatro de RLS NAO podem ter sido tocadas - se perderem authenticated, toda consulta
    --    daquele papel falha, porque a policy chama a funcao com os privilegios de quem consulta.
    SELECT string_agg(DISTINCT p.proname, ', ')
      INTO v_perdidas
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('get_my_role','fn_unidade_no_escopo',
                         'fn_unidade_alcancavel_por_setor','fn_setores_no_escopo')
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');

    IF v_perdidas IS NOT NULL THEN
        RAISE EXCEPTION
            'ABORTADO: funcao usada DENTRO de policy de RLS perdeu authenticated: %. '
            'Isso derruba toda consulta desse papel.', v_perdidas;
    END IF;

    RAISE NOTICE 'OK: 17 funcoes de tela fechadas para anon; authenticated preservado; RLS intacta.';
END
$verifica$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) O teste que vale, com a chave ANON. ANTES devolvia HTTP 200 com 684 linhas de dado pessoal:
--
--      POST /rest/v1/rpc/fn_tentativas_negadas_diagnostico   {}
--      -- esperado agora: 404 (sai do schema exposto) ou 401/403
--
--    Script pronto:  node scratchpad/an_anon_vaza.mjs
--
-- 2) A contagem de RPCs visiveis a anon tem que cair de 321 para ~304:
--
--      node scratchpad/an_anon_rpcs.mjs
--
-- 3) A TELA nao pode ter quebrado (o outro sentido). Com um usuario logado:
--      /auditoria  -> aba "Tentativas Negadas" continua listando
--      /marcacoes  -> abas "Cobertura da Escala" e "Biometria Pendente" continuam listando,
--                     e "Gerar token" do dispositivo REP continua funcionando
--      /servidores/pendencias -> busca por termo/CPF continua respondendo
--      dashboard   -> painel de Sobreaviso do dia continua aparecendo
