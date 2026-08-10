-- Migration: Retencao de logs - configuravel, com previa, e DESLIGADA por padrao
-- Data: 2026-08-09
--
-- Estudo: docs/planos/2026-08-09-auditoria-logs-retencao.md (Fase F)
--
-- ANTES DE MAIS NADA: NAO HA PROBLEMA DE ESPACO A RESOLVER
--   Medido em producao em 09/08/2026: o sistema INTEIRO tem 18,3 MB, e todos os logs somados
--   crescem ~14 MB/ano. Expurgar economizaria menos que uma foto de celular por mes.
--
--   O que cresce de verdade e marcacoes_ponto: 36 MB/ano, e vai multiplicar quando o REP entrar e
--   as outras 11 unidades passarem a usar o terminal. Mas marcacoes_ponto NAO E LOG - e registro
--   de ponto, INSERT-only por trigger, e nao pode ser apagado.
--
--   Esta migration existe porque a opcao foi pedida, nao porque o volume exige. Por isso ela e
--   conservadora ao extremo.
--
-- DESLIGADA POR PADRAO
--   Nenhuma categoria e expurgada enquanto a chave correspondente nao existir em
--   configuracoes_globais. Aplicar esta migration NAO APAGA NADA. Zero e tratado como "guardar
--   para sempre", nao como "apagar tudo" - a ambiguidade dessa convencao ja destruiu dado em
--   sistema demais.
--
-- SO TRES CATEGORIAS SAO EXPURGAVEIS, E NENHUMA E REGISTRO DE PONTO
--   retencao_login_meses          -> logs_sistema, apenas LOGIN/LOGOUT
--   retencao_webhook_dias         -> logs_webhook_whatsapp
--   retencao_fila_enviados_dias   -> avisos_ponto_fila, apenas status 'enviado'
--
-- O QUE NUNCA E TOCADO, E POR QUE
--   rep_afd_registros            evidencia bruta do REP-C, com cadeia de hash. A Portaria 671
--                                proibe o PTRP de alterar ou eliminar o dado original.
--   marcacoes_ponto              o fato registrado pelo servidor. INSERT-only por trigger.
--   marcacoes_tratamentos        o juizo do coordenador sobre o fato. Append-only.
--   escala_diaria, escala_mensal base do calculo de jornada.
--   folha_ponto                  o documento oficial.
--   logs_preferencia_aviso_ponto prova de consentimento LGPD - some junto com o direito de
--                                comprova-lo.
--   logs_tentativas_presenca     ja foi usada para RECUPERAR horario real de batida recusada por
--                                bug (20260807010000). E evidencia, nao ruido.
--   logs_sobreaviso              ciclo de acionamento; a grade e os relatorios leem.
--   logs_sistema (demais acoes)  a trilha de auditoria propriamente dita.
--   historico_transferencias     linha do tempo de lotacao.
--
--   Prazo de referencia para tudo acima: 5 anos, pela prescricao trabalhista (CF Art. 7, XXIX).
--   Para servidor estatutario o prontuario funcional costuma exigir mais. NAO ha expurgo
--   automatico desses - so arquivamento, que e assunto de backup.


-- ============================================================================
-- 1. EXPURGO, COM PREVIA POR PADRAO
-- ============================================================================
-- p_simular = TRUE por padrao de proposito: chamar a funcao sem argumento NAO apaga. Quem quiser
-- apagar precisa dizer isso explicitamente. Operacao destrutiva em producao nao deve ser o
-- comportamento acidental.

CREATE OR REPLACE FUNCTION public.fn_expurgar_logs(p_simular boolean DEFAULT true)
RETURNS TABLE (categoria text, retencao text, linhas integer, acao text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_login_meses  integer;
    v_webhook_dias integer;
    v_fila_dias    integer;
    v_n            integer;
BEGIN
    -- Chave ausente => NULL => categoria desligada. Zero tambem desliga, e e leitura explicita
    -- de "guardar para sempre" - a convencao oposta (zero = apagar tudo) ja destruiu dado em
    -- sistema demais para ser aceitavel aqui.
    SELECT NULLIF((valor#>>'{}')::text, '')::integer INTO v_login_meses
      FROM public.configuracoes_globais WHERE chave = 'retencao_login_meses';
    SELECT NULLIF((valor#>>'{}')::text, '')::integer INTO v_webhook_dias
      FROM public.configuracoes_globais WHERE chave = 'retencao_webhook_dias';
    SELECT NULLIF((valor#>>'{}')::text, '')::integer INTO v_fila_dias
      FROM public.configuracoes_globais WHERE chave = 'retencao_fila_enviados_dias';

    -- ---- LOGIN / LOGOUT ---------------------------------------------------
    -- Sao 40% do volume de logs_sistema e o de menor valor de auditoria: dizem que alguem entrou,
    -- nao o que fez. Toda acao consequente tem entrada propria.
    IF COALESCE(v_login_meses, 0) > 0 THEN
        SELECT count(*) INTO v_n FROM public.logs_sistema
         WHERE acao IN ('LOGIN', 'LOGOUT')
           AND created_at < now() - make_interval(months => v_login_meses);

        IF NOT p_simular AND v_n > 0 THEN
            DELETE FROM public.logs_sistema
             WHERE acao IN ('LOGIN', 'LOGOUT')
               AND created_at < now() - make_interval(months => v_login_meses);
        END IF;

        RETURN QUERY SELECT 'logs_sistema (LOGIN/LOGOUT)',
                            v_login_meses || ' meses', v_n,
                            CASE WHEN p_simular THEN 'simulado' ELSE 'apagado' END;
    ELSE
        RETURN QUERY SELECT 'logs_sistema (LOGIN/LOGOUT)', 'desligado', 0, 'nada a fazer';
    END IF;

    -- ---- WEBHOOK ----------------------------------------------------------
    -- Diagnostico. Mesmo com o filtro de 20260809120000 guarda texto de mensagem.
    IF COALESCE(v_webhook_dias, 0) > 0 THEN
        SELECT count(*) INTO v_n FROM public.logs_webhook_whatsapp
         WHERE recebido_em < now() - make_interval(days => v_webhook_dias);

        IF NOT p_simular AND v_n > 0 THEN
            DELETE FROM public.logs_webhook_whatsapp
             WHERE recebido_em < now() - make_interval(days => v_webhook_dias);
        END IF;

        RETURN QUERY SELECT 'logs_webhook_whatsapp',
                            v_webhook_dias || ' dias', v_n,
                            CASE WHEN p_simular THEN 'simulado' ELSE 'apagado' END;
    ELSE
        RETURN QUERY SELECT 'logs_webhook_whatsapp', 'desligado', 0, 'nada a fazer';
    END IF;

    -- ---- FILA JA ENVIADA --------------------------------------------------
    -- APENAS status 'enviado'. As FALHAS ficam: sao elas que respondem "nao recebi o aviso de
    -- ontem", e sao o que a aba de auditoria mostra no topo.
    IF COALESCE(v_fila_dias, 0) > 0 THEN
        SELECT count(*) INTO v_n FROM public.avisos_ponto_fila
         WHERE status = 'enviado'
           AND processado_em IS NOT NULL
           AND processado_em < now() - make_interval(days => v_fila_dias);

        IF NOT p_simular AND v_n > 0 THEN
            DELETE FROM public.avisos_ponto_fila
             WHERE status = 'enviado'
               AND processado_em IS NOT NULL
               AND processado_em < now() - make_interval(days => v_fila_dias);
        END IF;

        RETURN QUERY SELECT 'avisos_ponto_fila (enviados)',
                            v_fila_dias || ' dias', v_n,
                            CASE WHEN p_simular THEN 'simulado' ELSE 'apagado' END;
    ELSE
        RETURN QUERY SELECT 'avisos_ponto_fila (enviados)', 'desligado', 0, 'nada a fazer';
    END IF;

    -- Registra o expurgo real na propria trilha. Apagar log sem deixar registro de que se apagou
    -- e o tipo de coisa que uma auditoria pergunta e ninguem sabe responder.
    IF NOT p_simular THEN
        INSERT INTO public.logs_sistema (acao, entidade, entidade_id, origem, detalhes)
        VALUES ('LOGS_EXPURGADOS', 'configuracao', 'retencao', 'rotina',
                jsonb_build_object('login_meses', v_login_meses,
                                   'webhook_dias', v_webhook_dias,
                                   'fila_dias', v_fila_dias));

        INSERT INTO public.configuracoes_globais (chave, valor, updated_at)
        VALUES ('retencao_ultimo_expurgo', to_jsonb(now()::text), now())
        ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();
    END IF;
END;
$fn$;

COMMENT ON FUNCTION public.fn_expurgar_logs(boolean) IS
    'Expurga as tres categorias configuraveis. SIMULA por padrao - apagar exige p_simular=false. '
    'Categoria sem chave em configuracoes_globais, ou com zero, nunca e tocada. Registro de ponto '
    'jamais entra aqui.';

GRANT EXECUTE ON FUNCTION public.fn_expurgar_logs(boolean) TO service_role;


-- ============================================================================
-- 2. GATILHO DIARIO PARA O WORKER
-- ============================================================================
-- O worker de avisos roda a cada minuto. Sem controle proprio, o expurgo rodaria 1.440 vezes por
-- dia - inofensivo, porque DELETE filtrado que nao casa nada e barato, mas desnecessario. Esta
-- funcao so deixa passar uma vez a cada 24 h, entao o worker pode chama-la sempre sem pensar.

CREATE OR REPLACE FUNCTION public.fn_expurgar_logs_se_devido()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_ultimo timestamptz;
    v_total  integer := 0;
BEGIN
    SELECT ((valor#>>'{}')::text)::timestamptz INTO v_ultimo
      FROM public.configuracoes_globais WHERE chave = 'retencao_ultimo_expurgo';

    IF v_ultimo IS NOT NULL AND v_ultimo > now() - interval '24 hours' THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(sum(linhas), 0) INTO v_total
      FROM public.fn_expurgar_logs(false);

    RETURN v_total;

EXCEPTION WHEN OTHERS THEN
    -- Nunca pode derrubar o worker: despachar aviso e mais importante que limpar log.
    RAISE WARNING 'fn_expurgar_logs_se_devido falhou: %', SQLERRM;
    RETURN 0;
END;
$fn$;

COMMENT ON FUNCTION public.fn_expurgar_logs_se_devido() IS
    'Chamavel a cada minuto pelo worker; so executa o expurgo uma vez a cada 24 h.';

GRANT EXECUTE ON FUNCTION public.fn_expurgar_logs_se_devido() TO service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. NADA foi apagado e tudo esta desligado (esperado: 3 linhas "desligado"):
--
--      SELECT * FROM public.fn_expurgar_logs();
--
--   2. Antes de ligar, veja quanto SERIA apagado. Configure e simule:
--
--      INSERT INTO configuracoes_globais (chave, valor) VALUES
--        ('retencao_login_meses', '12'::jsonb),
--        ('retencao_webhook_dias', '90'::jsonb),
--        ('retencao_fila_enviados_dias', '90'::jsonb)
--      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;
--
--      SELECT * FROM public.fn_expurgar_logs();   -- ainda SIMULA
--
--      -- Em 09/08/2026 o esperado e zero em todas: o log mais antigo e de 23/05/2026, entao
--      -- nem os LOGIN/LOGOUT de 12 meses venceram. A rotina so tera efeito em 2027.
--
--   3. Para desligar de novo, basta zerar:
--
--      UPDATE configuracoes_globais SET valor = '0'::jsonb WHERE chave LIKE 'retencao_%dias'
--                                                             OR chave = 'retencao_login_meses';
--
--   4. O expurgo real deixa rastro na propria trilha:
--
--      SELECT created_at, acao, detalhes FROM logs_sistema
--       WHERE acao = 'LOGS_EXPURGADOS' ORDER BY created_at DESC;
