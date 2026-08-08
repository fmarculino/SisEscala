-- Migration: Sincroniza marcacoes_ponto a partir das escritas em escala_diaria (Fase 3)
-- Data: 2026-08-08
--
-- OBJETIVO
--   Fazer com que toda batida NOVA - do terminal ou de validacao manual - passe a gerar
--   tambem uma linha em marcacoes_ponto, para que as duas representacoes corram em paralelo
--   e possam ser comparadas diariamente antes da virada de chave da Fase 5.
--
-- POR QUE UM TRIGGER, E NAO UM PERFORM DENTRO DE fn_confirmar_presenca
--   O plano previa acrescentar um PERFORM ao final de fn_confirmar_presenca e de
--   fn_confirmar_presenca_manual. O trigger foi escolhido no lugar por tres razoes:
--
--   1. RISCO. fn_confirmar_presenca tem ~1.055 linhas e ja sofreu SEIS regressoes por
--      CREATE OR REPLACE descuidado (CLAUDE.md armadilha 1), cinco delas saidas de uma unica
--      migration. Um trigger nao a reescreve - ela permanece byte a byte como esta.
--
--   2. COBERTURA. Um PERFORM no fim de cada funcao nao capturaria fn_salvar_saida_bloco
--      (20260706115000), que escreve presenca por fora, nem qualquer caminho futuro. O trigger
--      observa a TABELA, entao pega todos.
--
--   3. SIMETRIA COM O BACKFILL. O backfill (20260808030000) derivou origem das flags
--      presenca_*_manual e sintetica dos segundos zerados, uma marcacao por
--      (linha de escala_diaria, passo). O trigger usa exatamente os mesmos criterios, entao
--      o historico e o corrente ficam com a mesma semantica - condicao para o diff da Fase 2
--      continuar valendo.
--
-- COMO A ORIGEM E DEDUZIDA
--   As duas funcoes ja deixam a pista na propria linha:
--     - fn_confirmar_presenca grava o horario e NAO toca em presenca_*_manual -> 'terminal'
--     - fn_confirmar_presenca_manual grava e marca a flag como true            -> 'ajuste_coordenador'
--   Nada precisa ser passado por parametro, e nenhuma das duas precisa saber que o trigger existe.
--
-- SEGURANCA OPERACIONAL
--   O trigger NUNCA pode impedir alguem de bater o ponto. Todo o corpo esta sob
--   EXCEPTION WHEN OTHERS: qualquer falha vira WARNING e a escrita em escala_diaria segue.
--   Em Fase 3 isso e o comportamento certo - marcacoes_ponto ainda e observacao paralela, e
--   perder uma linha dela e infinitamente melhor que travar o terminal de uma unidade.
--
-- ESTA MIGRATION MUDA COMPORTAMENTO?
--   Nao para o usuario. A grade, o terminal e a folha continuam lendo e escrevendo o mesmo.
--   O unico efeito e que marcacoes_ponto para de ser um retrato do passado e passa a acompanhar
--   o presente.


-- ============================================================================
-- 1. HELPER DE INSERCAO
-- ============================================================================
-- Ponto unico de escrita em marcacoes_ponto. A tabela tem INSERT revogado de todos os roles
-- de aplicacao (20260808010000); so funcoes SECURITY DEFINER como esta conseguem gravar.

CREATE OR REPLACE FUNCTION public.fn_registrar_marcacao(
    p_servidor_id         uuid,
    p_origem              public.marcacao_origem,
    p_ocorrido_em         timestamptz,
    p_unidade_id          uuid    DEFAULT NULL,
    p_setor_id            uuid    DEFAULT NULL,
    p_coordenador_id      uuid    DEFAULT NULL,
    p_registrado_por_id   uuid    DEFAULT NULL,
    p_justificativa       text    DEFAULT NULL,
    p_sintetica           boolean DEFAULT NULL,
    p_retroativa          boolean DEFAULT false,
    p_dispositivo_id      uuid    DEFAULT NULL,
    p_nsr                 bigint  DEFAULT NULL,
    p_afd_registro_id     uuid    DEFAULT NULL,
    p_identificador_bruto text    DEFAULT NULL,
    p_via_pendrive        boolean DEFAULT false,
    p_observacao          text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fnreg$
DECLARE
    v_id uuid;
BEGIN
    IF p_ocorrido_em IS NULL OR p_origem IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.marcacoes_ponto (
        servidor_id, origem, ocorrido_em,
        unidade_id, setor_id,
        coordenador_id, registrado_por_id, justificativa,
        -- Segundos exatamente zero = horario derivado da jornada, nao batido. Mesma heuristica
        -- do backfill (CLAUDE.md armadilha 5): batida real de terminal tem segundos e
        -- microssegundos; validacao manual e fn_salvar_saida_bloco geram :00:00.
        sintetica, retroativa,
        dispositivo_id, nsr, afd_registro_id, identificador_bruto, via_pendrive,
        observacao
    ) VALUES (
        p_servidor_id, p_origem, p_ocorrido_em,
        p_unidade_id, p_setor_id,
        p_coordenador_id, p_registrado_por_id, p_justificativa,
        COALESCE(p_sintetica, date_part('second', p_ocorrido_em) = 0), p_retroativa,
        p_dispositivo_id, p_nsr, p_afd_registro_id, p_identificador_bruto, p_via_pendrive,
        p_observacao
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$fnreg$;

COMMENT ON FUNCTION public.fn_registrar_marcacao IS
    'Ponto unico de insercao em marcacoes_ponto. Deriva sintetica dos segundos zerados quando '
    'nao informada. marcacoes_ponto e INSERT-only: nao existe funcao de alteracao por design.';

REVOKE ALL ON FUNCTION public.fn_registrar_marcacao FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_marcacao TO service_role;


-- ============================================================================
-- 2. TRIGGER DE SINCRONIZACAO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_sincronizar_marcacoes_escala_diaria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fnsync$
DECLARE
    v_servidor_id uuid;
    v_unidade_id  uuid;
    v_setor_id    uuid;
    v_origem      public.marcacao_origem;
    v_marcacao_id uuid;
    v_alvo        uuid;
BEGIN
    -- Guard anti-eco. A reconciliacao (Fase 5) escreve em escala_diaria a partir das
    -- marcacoes; sem esta saida, o trigger criaria marcacoes a partir da reconciliacao, que
    -- por sua vez alimentaria a proxima reconciliacao. Ver fn_reconciliar_marcacoes_dia,
    -- que declara SET LOCAL sisescala.reconciliacao = 'on'.
    IF COALESCE(current_setting('sisescala.reconciliacao', true), 'off') = 'on' THEN
        RETURN NEW;
    END IF;

    -- Saida rapida: a esmagadora maioria dos UPDATEs em escala_diaria e de escala, nao de
    -- presenca (montagem de grade, troca de turno, categoria).
    IF TG_OP = 'UPDATE'
       AND NEW.presenca_entrada_em           IS NOT DISTINCT FROM OLD.presenca_entrada_em
       AND NEW.presenca_intervalo_saida_em   IS NOT DISTINCT FROM OLD.presenca_intervalo_saida_em
       AND NEW.presenca_intervalo_retorno_em IS NOT DISTINCT FROM OLD.presenca_intervalo_retorno_em
       AND NEW.presenca_saida_em             IS NOT DISTINCT FROM OLD.presenca_saida_em THEN
        RETURN NEW;
    END IF;

    SELECT em.servidor_id, em.unidade_id, em.setor_id
      INTO v_servidor_id, v_unidade_id, v_setor_id
      FROM public.escala_mensal em
     WHERE em.id = NEW.escala_mensal_id;

    IF v_servidor_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- ---- ENTRADA ----------------------------------------------------------
    IF NEW.presenca_entrada_em IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.presenca_entrada_em IS DISTINCT FROM OLD.presenca_entrada_em) THEN
        v_origem := CASE WHEN COALESCE(NEW.presenca_entrada_manual, false)
                         THEN 'ajuste_coordenador'::public.marcacao_origem
                         ELSE 'terminal'::public.marcacao_origem END;
        v_marcacao_id := public.fn_registrar_marcacao(
            v_servidor_id, v_origem, NEW.presenca_entrada_em, v_unidade_id, v_setor_id,
            CASE WHEN v_origem = 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.justificativa_manual END,
            NULL, false, NULL, NULL, NULL, NULL, false,
            'Sincronizada de escala_diaria ' || NEW.id::text || ' passo entrada');
    END IF;

    -- ---- SAIDA PARA O INTERVALO -------------------------------------------
    IF NEW.presenca_intervalo_saida_em IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.presenca_intervalo_saida_em IS DISTINCT FROM OLD.presenca_intervalo_saida_em) THEN
        v_origem := CASE WHEN COALESCE(NEW.presenca_intervalo_saida_manual, false)
                         THEN 'ajuste_coordenador'::public.marcacao_origem
                         ELSE 'terminal'::public.marcacao_origem END;
        v_marcacao_id := public.fn_registrar_marcacao(
            v_servidor_id, v_origem, NEW.presenca_intervalo_saida_em, v_unidade_id, v_setor_id,
            CASE WHEN v_origem = 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.justificativa_manual END,
            NULL, false, NULL, NULL, NULL, NULL, false,
            'Sincronizada de escala_diaria ' || NEW.id::text || ' passo intervalo_saida');
    END IF;

    -- ---- RETORNO DO INTERVALO ---------------------------------------------
    IF NEW.presenca_intervalo_retorno_em IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.presenca_intervalo_retorno_em IS DISTINCT FROM OLD.presenca_intervalo_retorno_em) THEN
        v_origem := CASE WHEN COALESCE(NEW.presenca_intervalo_retorno_manual, false)
                         THEN 'ajuste_coordenador'::public.marcacao_origem
                         ELSE 'terminal'::public.marcacao_origem END;
        v_marcacao_id := public.fn_registrar_marcacao(
            v_servidor_id, v_origem, NEW.presenca_intervalo_retorno_em, v_unidade_id, v_setor_id,
            CASE WHEN v_origem = 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.justificativa_manual END,
            NULL, false, NULL, NULL, NULL, NULL, false,
            'Sincronizada de escala_diaria ' || NEW.id::text || ' passo intervalo_retorno');
    END IF;

    -- ---- SAIDA ------------------------------------------------------------
    IF NEW.presenca_saida_em IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.presenca_saida_em IS DISTINCT FROM OLD.presenca_saida_em) THEN
        v_origem := CASE WHEN COALESCE(NEW.presenca_saida_manual, false)
                         THEN 'ajuste_coordenador'::public.marcacao_origem
                         ELSE 'terminal'::public.marcacao_origem END;
        v_marcacao_id := public.fn_registrar_marcacao(
            v_servidor_id, v_origem, NEW.presenca_saida_em, v_unidade_id, v_setor_id,
            CASE WHEN v_origem = 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.justificativa_manual END,
            NULL, false, NULL, NULL, NULL, NULL, false,
            'Sincronizada de escala_diaria ' || NEW.id::text || ' passo saida');
    END IF;

    -- ---- REVERSAO ---------------------------------------------------------
    -- fn_reverter_presenca_manual zera o passo em escala_diaria. Sem tratar isso, a marcacao
    -- correspondente continuaria valendo e a reconciliacao a traria de volta.
    -- A marcacao NAO e apagada (a tabela e imutavel): registra-se um tratamento
    -- 'desconsiderar', que e exatamente o mecanismo previsto para isso.
    IF TG_OP = 'UPDATE' THEN
        FOR v_alvo IN
            SELECT m.id
              FROM public.marcacoes_ponto m
             WHERE m.servidor_id = v_servidor_id
               AND m.ocorrido_em IN (
                   SELECT t FROM unnest(ARRAY[
                       CASE WHEN NEW.presenca_entrada_em           IS NULL THEN OLD.presenca_entrada_em           END,
                       CASE WHEN NEW.presenca_intervalo_saida_em   IS NULL THEN OLD.presenca_intervalo_saida_em   END,
                       CASE WHEN NEW.presenca_intervalo_retorno_em IS NULL THEN OLD.presenca_intervalo_retorno_em END,
                       CASE WHEN NEW.presenca_saida_em             IS NULL THEN OLD.presenca_saida_em             END
                   ]) AS t WHERE t IS NOT NULL)
               AND NOT EXISTS (
                   SELECT 1 FROM public.marcacoes_tratamentos x
                    WHERE x.marcacao_id = m.id AND x.tipo = 'desconsiderar')
        LOOP
            IF NEW.confirmado_por_id IS NOT NULL OR OLD.confirmado_por_id IS NOT NULL THEN
                INSERT INTO public.marcacoes_tratamentos
                    (marcacao_id, tipo, justificativa, registrado_por_id)
                VALUES (v_alvo, 'desconsiderar',
                        'Presenca revertida em escala_diaria (sincronizacao automatica).',
                        COALESCE(NEW.confirmado_por_id, OLD.confirmado_por_id));
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    -- NUNCA travar a batida de ponto por causa da sincronizacao. Perder uma linha de
    -- marcacoes_ponto e recuperavel; impedir um servidor de registrar presenca nao e.
    RAISE WARNING 'fn_sincronizar_marcacoes_escala_diaria falhou para escala_diaria %: % (%)',
        NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$fnsync$;

DROP TRIGGER IF EXISTS trg_sincronizar_marcacoes ON public.escala_diaria;
CREATE TRIGGER trg_sincronizar_marcacoes
    AFTER INSERT OR UPDATE ON public.escala_diaria
    FOR EACH ROW EXECUTE FUNCTION public.fn_sincronizar_marcacoes_escala_diaria();

COMMENT ON FUNCTION public.fn_sincronizar_marcacoes_escala_diaria() IS
    'Espelha em marcacoes_ponto toda escrita de presenca em escala_diaria. Deriva a origem das '
    'flags presenca_*_manual, com os mesmos criterios do backfill 20260808030000. Nunca aborta '
    'a operacao original. Inerte durante a reconciliacao (guard sisescala.reconciliacao).';


-- CONFERENCIA APOS APLICAR
--
--   1) O trigger existe e e AFTER:
--
--   SELECT tgname, tgenabled, pg_get_triggerdef(oid)
--     FROM pg_trigger WHERE tgrelid = 'public.escala_diaria'::regclass AND NOT tgisinternal;
--
--   2) TESTE FUNCIONAL PRINCIPAL - bata o ponto no terminal (/presenca) com um servidor real
--      e confira que nasceu a marcacao correspondente:
--
--   SELECT ocorrido_em, origem, sintetica, registrado_em, observacao
--     FROM public.marcacoes_ponto
--    WHERE NOT retroativa
--    ORDER BY registrado_em DESC
--    LIMIT 10;
--
--   Esperado: origem = 'terminal', sintetica = false (batida real tem segundos).
--
--   3) TESTE DA VALIDACAO MANUAL - valide uma presenca pela grade e confira:
--
--   SELECT ocorrido_em, origem, sintetica, justificativa
--     FROM public.marcacoes_ponto
--    WHERE NOT retroativa AND origem = 'ajuste_coordenador'
--    ORDER BY registrado_em DESC LIMIT 10;
--
--   Esperado: sintetica = true (horario derivado da jornada) e a justificativa preenchida.
--
--   4) TESTE DA REVERSAO - reverta a validacao manual do passo anterior:
--
--   SELECT t.tipo, t.justificativa, t.created_at, m.ocorrido_em
--     FROM public.marcacoes_tratamentos t
--     JOIN public.marcacoes_ponto m ON m.id = t.marcacao_id
--    ORDER BY t.created_at DESC LIMIT 5;
--
--   Esperado: um 'desconsiderar'. A marcacao original CONTINUA existindo - e esse o ponto.
--
--   5) O terminal nao pode ter ficado mais lento nem passado a falhar. Bata algumas vezes e
--      confirme que a mensagem de sucesso continua igual.
--
--   6) ACOMPANHAMENTO DIARIO (rodar por uma semana antes da Fase 5) - o corrente tem que
--      espelhar escala_diaria:
--
--   SELECT count(*) FILTER (WHERE NOT retroativa) AS marcacoes_novas,
--          count(*) FILTER (WHERE NOT retroativa AND origem = 'terminal') AS do_terminal,
--          count(*) FILTER (WHERE NOT retroativa AND origem = 'ajuste_coordenador') AS manuais,
--          count(*) FILTER (WHERE NOT retroativa AND sintetica) AS sinteticas
--     FROM public.marcacoes_ponto;
--
--   E o diff da Fase 2 restrito ao periodo pos-trigger deve ficar estavel ou diminuir:
--   SELECT tipo_divergencia, count(*) FROM public.fn_conferir_reconciliacao(CURRENT_DATE - 1, CURRENT_DATE)
--    GROUP BY 1;
--
--   ROLLBACK, se algo der errado:
--   DROP TRIGGER trg_sincronizar_marcacoes ON public.escala_diaria;
