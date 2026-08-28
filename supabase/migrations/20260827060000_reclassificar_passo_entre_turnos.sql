-- ============================================================================
-- C4 - MOVER BATIDA REAL ENTRE TURNOS DO MESMO DIA
-- ============================================================================
-- 27/08/2026 - plano em docs/planos/2026-08-23-turno-regular-emendado-com-plantao.md (item C4,
-- o unico que ficou aberto; C1, C2 e C3 sairam em 23/08/2026).
--
-- O QUE FALTAVA
--   fn_reclassificar_passo_presenca (20260812150000) move batida real entre passos, mas o
--   proprio comentario dela declara o limite: "Origem e destino tem que ser passos da MESMA
--   linha de escala_diaria - nao move entre turnos/categorias diferentes do mesmo dia."
--
--   Num dia de Regular emendado com Plantao e' exatamente entre as duas LINHAS que a batida
--   precisa andar: a saida das 18:02 classificada no expediente, quando pertencia ao plantao.
--
-- ESTADO MEDIDO EM PRODUCAO (27/08/2026, competencia 08/2026)
--   301 pares (escala, dia) com 2+ turnos de trabalho. Destes, **66 tem alguma linha pela
--   metade** (55 linhas com entrada e sem saida; 41 com saida e sem entrada) e **55 desses dias
--   tem ao menos uma batida REAL** - ou seja, ha o que mover. Nos 11 restantes nao ha batida
--   real no dia e o caminho e' a validacao manual, nao esta funcao.
--
-- POR QUE ISTO NAO FABRICA HORARIO
--   marcacoes_ponto (a batida real, imutavel) NAO e tocada. So se corrige em qual LINHA e em
--   qual CAMPO aquele horario real esta classificado. Mesmo principio juridico da v1 e de
--   "Selecao da batida real" (v1.26.0): tratamento autorizado pelo Art. 82, paragrafo unico -
--   o coordenador corrigindo classificacao automatica errada, com justificativa e rastro. Nao e'
--   o sistema decidindo sozinho (vedacao 2 da Portaria 671/2021).
--
-- POR QUE UMA FUNCAO NOVA E NAO UMA v2 DA EXISTENTE
--   A v1 esta em uso e funciona; trocar a assinatura dela quebraria o chamador atual
--   (reclassificarPassoPresenca em folha-ponto/actions.ts). Esta e' autocontida e a v1 segue
--   valendo para o caso de uma linha so.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_reclassificar_passo_entre_turnos(
    p_origem_escala_diaria_id  uuid,
    p_passo_origem             text,
    p_destino_escala_diaria_id uuid,
    p_passo_destino            text,
    p_justificativa            text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_unidade_id   uuid;
    v_setor_id     uuid;
    v_servidor_id  uuid;
    v_dia          integer;
    v_mes          integer;
    v_ano          integer;
    v_cat_origem   text;

    v_unidade_dest uuid;
    v_servidor_dest uuid;
    v_dia_dest     integer;
    v_cat_destino  text;

    v_role                  text;
    v_acesso_todas_unidades boolean;
    v_acesso_todos_setores  boolean;
    v_tem_acesso            boolean := false;

    v_valor_em          timestamptz;
    v_valor_manual      boolean;
    v_valor_origem_txt  public.marcacao_origem;
    v_valor_marcacao_id uuid;
    v_destino_atual     timestamptz;

    v_encerradas jsonb;
BEGIN
    -- 1. Parametros ---------------------------------------------------------
    IF p_passo_origem NOT IN ('entrada', 'intervalo_saida', 'intervalo_retorno', 'saida')
    OR p_passo_destino NOT IN ('entrada', 'intervalo_saida', 'intervalo_retorno', 'saida') THEN
        RAISE EXCEPTION 'Passo invalido. Use entrada, intervalo_saida, intervalo_retorno ou saida.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_origem_escala_diaria_id = p_destino_escala_diaria_id
       AND p_passo_origem = p_passo_destino THEN
        RAISE EXCEPTION 'Origem e destino sao o mesmo passo da mesma linha.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_justificativa IS NULL OR length(trim(p_justificativa)) < 5 THEN
        RAISE EXCEPTION 'Justificativa obrigatoria (minimo 5 caracteres).'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 2. As duas linhas -----------------------------------------------------
    SELECT em.unidade_id, em.setor_id, em.servidor_id, ed.dia, em.mes, em.ano, ed.categoria::text
      INTO v_unidade_id, v_setor_id, v_servidor_id, v_dia, v_mes, v_ano, v_cat_origem
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.id = p_origem_escala_diaria_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Linha de origem nao encontrada.' USING ERRCODE = 'no_data_found';
    END IF;

    SELECT em.unidade_id, em.servidor_id, ed.dia, ed.categoria::text
      INTO v_unidade_dest, v_servidor_dest, v_dia_dest, v_cat_destino
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.id = p_destino_escala_diaria_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Linha de destino nao encontrada.' USING ERRCODE = 'no_data_found';
    END IF;

    -- MESMO servidor e MESMO dia. Sem isto, a funcao viraria uma forma de carregar uma batida
    -- para outro dia ou para outra pessoa - que e' fabricar ponto, nao reclassificar.
    IF v_servidor_id IS DISTINCT FROM v_servidor_dest OR v_dia IS DISTINCT FROM v_dia_dest THEN
        RAISE EXCEPTION 'Origem e destino precisam ser do mesmo servidor e do mesmo dia.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Sobreaviso NAO marca presenca e tem ciclo proprio em logs_sobreaviso (armadilha 6 do
    -- CLAUDE.md, e o CHECK chk_sobreaviso_sem_presenca recusaria a escrita de qualquer forma).
    IF v_cat_origem = 'Sobreaviso' OR v_cat_destino = 'Sobreaviso' THEN
        RAISE EXCEPTION 'Sobreaviso nao registra presenca - nao ha passo para mover.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 3. Competencia aberta -------------------------------------------------
    -- A v1 nao checava isto; o plano pediu explicitamente. Mexer em mes fechado e' mexer em
    -- folha ja assinada.
    SELECT valor INTO v_encerradas
      FROM public.configuracoes_globais WHERE chave = 'competencias_encerradas';

    IF v_encerradas IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_encerradas) AS c
         WHERE (c->>'mes')::integer = v_mes AND (c->>'ano')::integer = v_ano
    ) THEN
        RAISE EXCEPTION 'Competencia %/% esta encerrada - os dados estao congelados para auditoria.',
            v_mes, v_ano USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 4. Guard de escopo ----------------------------------------------------
    -- Replica hasSectorAccess (src/utils/permissions.ts), igual a v1: a RPC e' GRANTada a
    -- authenticated e chamavel direto por REST, entao checar so na Server Action nao basta
    -- (armadilha 12 do CLAUDE.md).
    SELECT p.role::text, COALESCE(p.acesso_todas_unidades, false), COALESCE(p.acesso_todos_setores, false)
      INTO v_role, v_acesso_todas_unidades, v_acesso_todos_setores
      FROM public.profiles p
     WHERE p.id = auth.uid();

    IF v_role IN ('super_admin', 'rh') THEN
        v_tem_acesso := true;
    ELSIF v_acesso_todos_setores AND v_acesso_todas_unidades THEN
        v_tem_acesso := true;
    ELSIF v_acesso_todos_setores AND public.fn_unidade_no_escopo(v_unidade_id) THEN
        v_tem_acesso := true;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM public.profile_setores ps
             WHERE ps.profile_id = auth.uid() AND ps.setor_id = v_setor_id
        ) INTO v_tem_acesso;
    END IF;

    IF NOT v_tem_acesso THEN
        RAISE EXCEPTION 'Sem permissao para corrigir a presenca deste servidor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 5. O passo de ORIGEM tem batida, e ela e' REAL ------------------------
    SELECT
        CASE p_passo_origem
            WHEN 'entrada'           THEN presenca_entrada_em
            WHEN 'intervalo_saida'   THEN presenca_intervalo_saida_em
            WHEN 'intervalo_retorno' THEN presenca_intervalo_retorno_em
            WHEN 'saida'             THEN presenca_saida_em
        END,
        CASE p_passo_origem
            WHEN 'entrada'           THEN presenca_entrada_manual
            WHEN 'intervalo_saida'   THEN presenca_intervalo_saida_manual
            WHEN 'intervalo_retorno' THEN presenca_intervalo_retorno_manual
            WHEN 'saida'             THEN presenca_saida_manual
        END,
        CASE p_passo_origem
            WHEN 'entrada'           THEN presenca_entrada_origem
            WHEN 'intervalo_saida'   THEN presenca_intervalo_saida_origem
            WHEN 'intervalo_retorno' THEN presenca_intervalo_retorno_origem
            WHEN 'saida'             THEN presenca_saida_origem
        END,
        CASE p_passo_origem
            WHEN 'entrada'           THEN presenca_entrada_marcacao_id
            WHEN 'intervalo_saida'   THEN presenca_intervalo_saida_marcacao_id
            WHEN 'intervalo_retorno' THEN presenca_intervalo_retorno_marcacao_id
            WHEN 'saida'             THEN presenca_saida_marcacao_id
        END
      INTO v_valor_em, v_valor_manual, v_valor_origem_txt, v_valor_marcacao_id
      FROM public.escala_diaria
     WHERE id = p_origem_escala_diaria_id;

    IF v_valor_em IS NULL THEN
        RAISE EXCEPTION 'Nao ha marcacao no passo de origem para mover.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF v_valor_manual THEN
        RAISE EXCEPTION 'Este horario foi digitado manualmente, nao e uma batida real - edite o '
            'valor direto na folha em vez de mover.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 6. O passo de DESTINO esta vazio (sem swap, igual a v1) ---------------
    SELECT
        CASE p_passo_destino
            WHEN 'entrada'           THEN presenca_entrada_em
            WHEN 'intervalo_saida'   THEN presenca_intervalo_saida_em
            WHEN 'intervalo_retorno' THEN presenca_intervalo_retorno_em
            WHEN 'saida'             THEN presenca_saida_em
        END
      INTO v_destino_atual
      FROM public.escala_diaria
     WHERE id = p_destino_escala_diaria_id;

    IF v_destino_atual IS NOT NULL THEN
        RAISE EXCEPTION 'O passo de destino ja tem uma marcacao - mover so e permitido para um '
            'passo vazio.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 7. Escreve no destino -------------------------------------------------
    UPDATE public.escala_diaria
       SET presenca_entrada_em      = CASE WHEN p_passo_destino = 'entrada' THEN v_valor_em ELSE presenca_entrada_em END,
           presenca_entrada_manual  = CASE WHEN p_passo_destino = 'entrada' THEN v_valor_manual ELSE presenca_entrada_manual END,
           presenca_entrada_origem  = CASE WHEN p_passo_destino = 'entrada' THEN v_valor_origem_txt ELSE presenca_entrada_origem END,
           presenca_entrada_marcacao_id = CASE WHEN p_passo_destino = 'entrada' THEN v_valor_marcacao_id ELSE presenca_entrada_marcacao_id END,

           presenca_intervalo_saida_em     = CASE WHEN p_passo_destino = 'intervalo_saida' THEN v_valor_em ELSE presenca_intervalo_saida_em END,
           presenca_intervalo_saida_manual = CASE WHEN p_passo_destino = 'intervalo_saida' THEN v_valor_manual ELSE presenca_intervalo_saida_manual END,
           presenca_intervalo_saida_origem = CASE WHEN p_passo_destino = 'intervalo_saida' THEN v_valor_origem_txt ELSE presenca_intervalo_saida_origem END,
           presenca_intervalo_saida_marcacao_id = CASE WHEN p_passo_destino = 'intervalo_saida' THEN v_valor_marcacao_id ELSE presenca_intervalo_saida_marcacao_id END,

           presenca_intervalo_retorno_em     = CASE WHEN p_passo_destino = 'intervalo_retorno' THEN v_valor_em ELSE presenca_intervalo_retorno_em END,
           presenca_intervalo_retorno_manual = CASE WHEN p_passo_destino = 'intervalo_retorno' THEN v_valor_manual ELSE presenca_intervalo_retorno_manual END,
           presenca_intervalo_retorno_origem = CASE WHEN p_passo_destino = 'intervalo_retorno' THEN v_valor_origem_txt ELSE presenca_intervalo_retorno_origem END,
           presenca_intervalo_retorno_marcacao_id = CASE WHEN p_passo_destino = 'intervalo_retorno' THEN v_valor_marcacao_id ELSE presenca_intervalo_retorno_marcacao_id END,

           presenca_saida_em      = CASE WHEN p_passo_destino = 'saida' THEN v_valor_em ELSE presenca_saida_em END,
           presenca_saida_manual  = CASE WHEN p_passo_destino = 'saida' THEN v_valor_manual ELSE presenca_saida_manual END,
           presenca_saida_origem  = CASE WHEN p_passo_destino = 'saida' THEN v_valor_origem_txt ELSE presenca_saida_origem END,
           presenca_saida_marcacao_id = CASE WHEN p_passo_destino = 'saida' THEN v_valor_marcacao_id ELSE presenca_saida_marcacao_id END
     WHERE id = p_destino_escala_diaria_id;

    -- 8. Limpa a origem -----------------------------------------------------
    -- Depois de escrever, nunca antes: se o UPDATE do destino falhar (CHECK, trigger), a
    -- transacao inteira volta e a batida continua onde estava. Limpar primeiro arriscaria
    -- perder a classificacao sem ter gravado a nova.
    UPDATE public.escala_diaria
       SET presenca_entrada_em      = CASE WHEN p_passo_origem = 'entrada' THEN NULL ELSE presenca_entrada_em END,
           presenca_entrada_manual  = CASE WHEN p_passo_origem = 'entrada' THEN false ELSE presenca_entrada_manual END,
           presenca_entrada_origem  = CASE WHEN p_passo_origem = 'entrada' THEN NULL ELSE presenca_entrada_origem END,
           presenca_entrada_marcacao_id = CASE WHEN p_passo_origem = 'entrada' THEN NULL ELSE presenca_entrada_marcacao_id END,

           presenca_intervalo_saida_em     = CASE WHEN p_passo_origem = 'intervalo_saida' THEN NULL ELSE presenca_intervalo_saida_em END,
           presenca_intervalo_saida_manual = CASE WHEN p_passo_origem = 'intervalo_saida' THEN false ELSE presenca_intervalo_saida_manual END,
           presenca_intervalo_saida_origem = CASE WHEN p_passo_origem = 'intervalo_saida' THEN NULL ELSE presenca_intervalo_saida_origem END,
           presenca_intervalo_saida_marcacao_id = CASE WHEN p_passo_origem = 'intervalo_saida' THEN NULL ELSE presenca_intervalo_saida_marcacao_id END,

           presenca_intervalo_retorno_em     = CASE WHEN p_passo_origem = 'intervalo_retorno' THEN NULL ELSE presenca_intervalo_retorno_em END,
           presenca_intervalo_retorno_manual = CASE WHEN p_passo_origem = 'intervalo_retorno' THEN false ELSE presenca_intervalo_retorno_manual END,
           presenca_intervalo_retorno_origem = CASE WHEN p_passo_origem = 'intervalo_retorno' THEN NULL ELSE presenca_intervalo_retorno_origem END,
           presenca_intervalo_retorno_marcacao_id = CASE WHEN p_passo_origem = 'intervalo_retorno' THEN NULL ELSE presenca_intervalo_retorno_marcacao_id END,

           presenca_saida_em      = CASE WHEN p_passo_origem = 'saida' THEN NULL ELSE presenca_saida_em END,
           presenca_saida_manual  = CASE WHEN p_passo_origem = 'saida' THEN false ELSE presenca_saida_manual END,
           presenca_saida_origem  = CASE WHEN p_passo_origem = 'saida' THEN NULL ELSE presenca_saida_origem END,
           presenca_saida_marcacao_id = CASE WHEN p_passo_origem = 'saida' THEN NULL ELSE presenca_saida_marcacao_id END
     WHERE id = p_origem_escala_diaria_id;

    INSERT INTO public.logs_sistema (user_id, acao, detalhes, unidade_id, setor_id)
    VALUES (auth.uid(), 'PRESENCA_RECLASSIFICADA_ENTRE_TURNOS', jsonb_build_object(
        'servidor_id', v_servidor_id,
        'dia', v_dia,
        'mes', v_mes,
        'ano', v_ano,
        'de', jsonb_build_object('escala_diaria_id', p_origem_escala_diaria_id,
                                 'categoria', v_cat_origem, 'passo', p_passo_origem),
        'para', jsonb_build_object('escala_diaria_id', p_destino_escala_diaria_id,
                                   'categoria', v_cat_destino, 'passo', p_passo_destino),
        'horario', v_valor_em,
        'justificativa', trim(p_justificativa)
    ), v_unidade_id, v_setor_id);

    RETURN jsonb_build_object(
        'success', true,
        'servidor_id', v_servidor_id,
        'dia', v_dia,
        'de',   jsonb_build_object('categoria', v_cat_origem,  'passo', p_passo_origem),
        'para', jsonb_build_object('categoria', v_cat_destino, 'passo', p_passo_destino),
        'horario', v_valor_em);
END;
$fn$;

COMMENT ON FUNCTION public.fn_reclassificar_passo_entre_turnos(uuid, text, uuid, text, text) IS
    'C4: move uma batida REAL entre LINHAS de escala_diaria do mesmo servidor e do mesmo dia '
    '(ex.: a saida classificada no expediente quando pertencia ao plantao). Nao toca '
    'marcacoes_ponto; exige destino vazio, batida real, competencia aberta e escopo. '
    'fn_reclassificar_passo_presenca continua valendo para o caso de uma linha so.';

-- ⚠️ REVOKE de PUBLIC na MESMA migration que cria a funcao - armadilha 24 do CLAUDE.md.
-- `GRANT ... TO authenticated` sozinho nao restringe nada: CREATE FUNCTION ja concede EXECUTE a
-- PUBLIC, e anon entraria por ali.
REVOKE EXECUTE ON FUNCTION public.fn_reclassificar_passo_entre_turnos(uuid, text, uuid, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reclassificar_passo_entre_turnos(uuid, text, uuid, text, text)
    TO authenticated, service_role;

DO $conferir$
DECLARE
    v_oid oid;
BEGIN
    SELECT p.oid INTO v_oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_reclassificar_passo_entre_turnos';

    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'anon ainda executa a funcao nova (banco=%, usuario=%)',
            current_database(), current_user;
    END IF;

    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated NAO executa a funcao nova - a tela nao conseguiria usa-la';
    END IF;
END;
$conferir$;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) Privilegios (esperado: anon=false, autenticado=true):
--
--   SELECT has_function_privilege('anon','public.fn_reclassificar_passo_entre_turnos(uuid,text,uuid,text,text)'::regprocedure,'EXECUTE') AS anon,
--          has_function_privilege('authenticated','public.fn_reclassificar_passo_entre_turnos(uuid,text,uuid,text,text)'::regprocedure,'EXECUTE') AS autenticado;
--
--   2) Os dias onde ela se aplica hoje (esperado: 66 pares em 08/2026, 55 com batida real):
--
--   WITH dias AS (
--     SELECT ed.escala_mensal_id, ed.dia,
--            count(*) FILTER (WHERE ed.categoria IN ('Regular','Extra','Plantão')) AS turnos,
--            count(*) FILTER (WHERE ed.presenca_entrada_em IS NOT NULL AND ed.presenca_saida_em IS NULL) AS sem_saida,
--            count(*) FILTER (WHERE ed.presenca_entrada_em IS NULL AND ed.presenca_saida_em IS NOT NULL) AS sem_entrada
--       FROM public.escala_diaria ed
--       JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--      WHERE em.mes = 8 AND em.ano = 2026
--      GROUP BY 1, 2)
--   SELECT count(*) FROM dias WHERE turnos >= 2 AND (sem_saida > 0 OR sem_entrada > 0);
--
--   3) Um movimento real, de ponta a ponta (use um dia da consulta 2, com a tela ou pela RPC):
--
--   SELECT public.fn_reclassificar_passo_entre_turnos(
--       '<escala_diaria_do_Regular>', 'saida',
--       '<escala_diaria_do_Plantao>', 'saida',
--       'Saida pertence ao plantao, nao ao expediente');
--
--   -- esperado: a linha do Regular fica com presenca_saida_em NULL e a do Plantao recebe o
--   -- horario, com a MESMA origem e o MESMO presenca_saida_marcacao_id (nada e recriado).
--   SELECT id, categoria, presenca_saida_em, presenca_saida_origem, presenca_saida_marcacao_id
--     FROM public.escala_diaria WHERE id IN ('<origem>', '<destino>');
--
--   4) marcacoes_ponto NAO pode ter mudado (e' o ponto do desenho):
--
--   SELECT count(*) FROM public.marcacoes_ponto WHERE registrado_em > now() - interval '5 min';
--   -- esperado: 0
--
--   5) O rastro ficou registrado:
--
--   SELECT acao, detalhes FROM public.logs_sistema
--    WHERE acao = 'PRESENCA_RECLASSIFICADA_ENTRE_TURNOS' ORDER BY created_at DESC LIMIT 3;
