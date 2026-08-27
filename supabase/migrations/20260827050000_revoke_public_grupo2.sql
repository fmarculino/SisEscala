-- ============================================================================
-- FECHAR ANON — GRUPO 2 (escala, justificativas, avisos de ponto, biometria, logs)
-- ============================================================================
-- 27/08/2026 - continuacao de 20260827040000, que fechou o nucleo de presenca e CONFIRMOU o
-- mecanismo: medido depois dela, as funcoes daquela lista passaram de HTTP 200 para 401 com a
-- chave anon, e a contagem de funcoes visiveis a anon caiu de 369 para 353.
--
-- COMO CADA FUNCAO FOI CLASSIFICADA
--   1. Levantamento do que anon enxerga, pelo OpenAPI do PostgREST.
--   2. Corpo de cada funcao lido nas migrations: escreve? confere papel (get_my_role / auth.uid)?
--   3. Quem a chama no aplicativo, e com QUAL cliente:
--        - createAdminClient() = service_role  -> nao precisa de anon nem de authenticated
--        - createClient() no servidor/tela     -> precisa de authenticated
--        - createClient() do navegador SEM login -> precisa de anon (fica de fora)
--
--   Funcao que ja' confere papel sozinha (fn_gerar_token_dispositivo_rep,
--   fn_enfileirar_remocao_usuarios_dispositivo, fn_higiene_usuarios_dispositivo...) nao entra
--   aqui: com anon, get_my_role() e' NULL e elas recusam. Fechar tambem seria correto, mas o
--   ganho e' menor e o risco de errar um chamador, nao.
--
-- ⚠️ FICA DELIBERADAMENTE ABERTA: register_sobreaviso_arrival
--   A pagina /sobreaviso/[token] e' PUBLICA por desenho - o servidor recebe um link magico por
--   WhatsApp/e-mail e registra a chegada sem fazer login (createClient do NAVEGADOR, sem sessao).
--   Revogar de anon ali derrubaria o ciclo de sobreaviso inteiro. A defesa dela e' o token do
--   link e a conferencia de GPS contra o destino (20260808170000), nao o privilegio de execucao.
--
-- ⚠️ A VERIFICACAO AGORA OLHA OS DOIS LADOS
--   A 20260827040000 conferia apenas que anon perdeu o acesso. Esta confere tambem que o grupo D
--   MANTEVE `authenticated` — derrubar a tela do coordenador por um REVOKE largo demais seria
--   trocar um problema por outro pior, e em silencio.
-- ============================================================================

DO $seguranca$
DECLARE
    r           record;
    v_nome      text;
    v_erros     text := '';
    v_total     integer := 0;

    -- GRUPO C: sem nenhum chamador com sessao. Ou nao aparecem em src/, ou sao chamadas por
    -- rotas de API e helpers que usam service_role (/api/avisos-ponto/despachar protegida por
    -- CRON_SECRET, /api/rep/v1/biometria-copias pelo HMAC do coletor, reconciliacaoHelper e o
    -- Portal do Servidor com createAdminClient).
    v_grupo_c text[] := ARRAY[
        'fn_salvar_justificativa_evento',
        'fn_sugerir_justificativa_servidor',
        'fn_validar_sugestao_justificativa',
        'fn_alocar_marcacoes_dia',
        'fn_reconciliar_marcacoes_dia',
        'fn_reconciliar_presencas_negadas',
        'fn_corrigir_todas_anomalias_presenca',
        'fn_varredura_anomalias_presenca',
        'fn_verificar_integridade_afd',
        'fn_log_tentativa_negada',
        'fn_expurgar_logs',
        'fn_expurgar_logs_se_devido',
        'fn_avisos_ponto_pendentes',
        'fn_concluir_aviso_ponto',
        'fn_gerar_resumos_aviso_ponto',
        'fn_expirar_optin_aviso_ponto',
        'fn_telefone_aviso_ponto',
        'fn_biometria_faltante_dispositivo',
        'fn_registrar_copia_biometria'
    ];

    -- GRUPO D: a tela chama com usuario logado. So' anon perde.
    v_grupo_d text[] := ARRAY[
        'fn_acionar_sobreaviso',
        'fn_alterar_jornada_escala_mensal',
        'fn_alterar_turno_escala_diaria',
        'fn_marcacoes_pendentes_revisao',
        'fn_projecao_marcacoes_dia',
        'fn_estatistica_escala_setor',
        'fn_possiveis_duplicidades_servidor',
        'fn_servidor_por_matricula',
        'fn_desfecho_eventos_escalas',
        'fn_contar_pendencias_justificativa'
    ];
BEGIN
    RAISE NOTICE 'Executando em banco=% como usuario=%', current_database(), current_user;

    FOREACH v_nome IN ARRAY v_grupo_c LOOP
        FOR r IN
            SELECT p.oid::regprocedure AS assinatura
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = v_nome
        LOOP
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.assinatura);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.assinatura);
        END LOOP;
    END LOOP;

    FOREACH v_nome IN ARRAY v_grupo_d LOOP
        FOR r IN
            SELECT p.oid::regprocedure AS assinatura
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = v_nome
        LOOP
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.assinatura);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.assinatura);
        END LOOP;
    END LOOP;

    -- ---- Conferencia nos DOIS sentidos ------------------------------------
    FOR r IN
        SELECT p.oid::regprocedure::text AS assinatura,
               p.proname,
               pg_get_userbyid(p.proowner) AS dono,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = ANY(v_grupo_c || v_grupo_d)
    LOOP
        IF r.anon_executa THEN
            v_total := v_total + 1;
            v_erros := v_erros || format(E'\n  - %s (dono: %s) ainda executa como ANON', r.assinatura, r.dono);
        END IF;

        IF r.proname = ANY(v_grupo_c) AND r.auth_executa THEN
            v_total := v_total + 1;
            v_erros := v_erros || format(E'\n  - %s ainda executa como AUTHENTICATED (deveria ser so service_role)', r.assinatura);
        END IF;

        -- O lado que protege a tela: o grupo D TEM de continuar acessivel a quem esta logado.
        IF r.proname = ANY(v_grupo_d) AND NOT r.auth_executa THEN
            v_total := v_total + 1;
            v_erros := v_erros || format(E'\n  - %s PERDEU o acesso de AUTHENTICATED — isto quebraria a tela', r.assinatura);
        END IF;
    END LOOP;

    IF v_total > 0 THEN
        RAISE EXCEPTION E'Resultado inesperado em % item(ns), banco=%, usuario=%:%',
            v_total, current_database(), current_user, v_erros;
    END IF;

    RAISE NOTICE 'OK: grupo C fechado para anon e authenticated; grupo D fechado so para anon.';
END;
$seguranca$;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) Quanto do schema continua aberto a anon (era 369/394 antes da 20260827040000,
--      353 depois dela):
--
--   SELECT count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')) AS abertas,
--          count(*) AS total
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f';
--
--   2) O ciclo de sobreaviso NAO pode ter sido fechado (a pagina do link magico e' publica):
--
--   SELECT has_function_privilege('anon', 'public.register_sobreaviso_arrival(uuid,double precision,double precision)'::regprocedure, 'EXECUTE');
--   -- esperado: true. Se der false, alguem fechou por engano e o servidor de sobreaviso
--   -- deixa de conseguir registrar chegada pelo link.
--
--   3) Caminhos reais que precisam continuar funcionando, com usuario logado:
--      - acionar um sobreaviso pelo painel;
--      - trocar a jornada e trocar o turno de um dia na grade;
--      - abrir a aba Pendencias em /marcacoes;
--      - abrir /justificativas;
--      - rodar o Gerador Inteligente (usa fn_estatistica_escala_setor).
--
--   4) Caminhos de maquina (sem sessao) que precisam continuar funcionando:
--      - GET /api/avisos-ponto/despachar com o CRON_SECRET;
--      - o coletor REP enviando biometria (/api/rep/v1/biometria-copias).
