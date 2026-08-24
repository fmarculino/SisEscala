-- Migration: fn_desfecho_evento_dia - a classificacao unica de plantao e sobreaviso
-- Data: 2026-08-24
-- Plano: docs/planos/2026-08-23-desfecho-de-plantao-e-sobreaviso.md (fase 0, migration 3 de 3)
--
-- O QUE ESTA FUNCAO DECIDE
--   Em que estado esta um evento de Plantao ou Sobreaviso:
--
--     previsto      o dia ainda nao aconteceu - nao se julga o que nao passou
--     registrado    o ponto provou: entrada E saida gravadas
--     validado      alguem decidiu que foi cumprido (coordenador), ou a prontidao correu sem
--                   acionamento nenhum
--     falta         nao foi cumprido - por decisao do coordenador, por decurso de prazo, ou
--                   porque o acionamento de sobreaviso falhou
--     em_avaliacao  o dia passou, o ponto nao provou e ninguem decidiu
--
--   `em_avaliacao` e o estado que nao existia. Hoje esse evento simplesmente SOMA no anexo com
--   a observacao "Em validacao" - 1.377h de 2.107h em 08/2026 (65%).
--
-- ESTA E A FONTE UNICA. NAO REPLICAR NO FRONTEND.
--   Anexo, relatorio de plantao/sobreaviso, fila de justificativas e gate de fechamento leem
--   daqui. Mesma disciplina de fn_projecao_marcacoes_dia (fonte unica de reconciliar e
--   conferir): se cada consumidor derivar por conta propria, o portao deixa de validar o que
--   sera impresso.
--
-- PRECEDENCIA (a ordem importa e e deliberada)
--   1. dia futuro                -> previsto. Nunca julgar dia que nao aconteceu.
--   2. desfecho explicito        -> vence tudo, inclusive o ponto. E a decisao de uma pessoa,
--                                   com autor e data; o sistema nao a contradiz.
--   3. Plantao: ponto completo   -> registrado
--      Sobreaviso: acionamentos  -> validado / falta
--   4. resto                     -> em_avaliacao
--
-- CATEGORIAS FORA DE ESCOPO
--   Regular e Extra devolvem 'nao_aplicavel'. Extra aparece na fila de justificativas junto de
--   Plantao e Sobreaviso, mas o cumprimento dele ja e medido pela folha de ponto (o dia do
--   Extra tem turno Regular, entao passa pela falta automatica de resolverFaltaAutomatica).
--   Trazer Extra para ca duplicaria o julgamento do mesmo dia em dois documentos.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_desfecho_evento_dia(uuid, date);
DROP FUNCTION IF EXISTS public.fn_desfecho_eventos_escalas(uuid[], date);

CREATE OR REPLACE FUNCTION public.fn_desfecho_evento_dia(
    p_escala_diaria_id uuid,
    p_hoje             date
)
RETURNS TABLE (estado text, motivo text, horas numeric, fonte text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_categoria     text;
    v_dia           integer;
    v_servidor_id   uuid;
    v_escala_mensal uuid;
    v_unidade_id    uuid;
    v_mes           integer;
    v_ano           integer;
    v_horas         numeric;
    v_entrada       timestamptz;
    v_saida         timestamptz;
    v_ent_manual    boolean;
    v_sai_manual    boolean;
    v_just_manual   text;
    v_resultado     text;
    v_res_origem    text;
    v_data_evento   date;
    v_tem_acion     boolean;
    v_tem_falha     boolean;
    v_tem_andamento boolean;
    v_motivo_falha  text;
BEGIN
    SELECT ed.categoria::text, ed.dia,
           em.servidor_id, em.id, em.unidade_id, em.mes, em.ano,
           COALESCE(dt.horas_computadas, 0)::numeric,
           ed.presenca_entrada_em, ed.presenca_saida_em,
           COALESCE(ed.presenca_entrada_manual, false),
           COALESCE(ed.presenca_saida_manual, false),
           ed.justificativa_manual
      INTO v_categoria, v_dia,
           v_servidor_id, v_escala_mensal, v_unidade_id, v_mes, v_ano,
           v_horas, v_entrada, v_saida, v_ent_manual, v_sai_manual, v_just_manual
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
      LEFT JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
     WHERE ed.id = p_escala_diaria_id;

    IF v_categoria IS NULL THEN
        RETURN;  -- linha inexistente devolve conjunto vazio, nao um estado inventado
    END IF;

    -- ESCOPO. Mesmo guard de fn_blocos_previstos_dia (20260812130000), pela mesma razao: sem
    -- ele, qualquer authenticated consulta o desfecho de qualquer servidor sabendo so o UUID.
    -- service_role bypassa (auth.uid() IS NULL) porque o anexo roda com createAdminClient().
    -- fn_unidade_no_escopo sozinha nao basta - so verifica profile_unidades; quem tem acesso
    -- apenas por profile_setores (piloto da TI) precisa de fn_unidade_alcancavel_por_setor.
    IF auth.uid() IS NOT NULL
       AND NOT (public.fn_unidade_no_escopo(v_unidade_id)
                OR public.fn_unidade_alcancavel_por_setor(v_unidade_id)) THEN
        RAISE EXCEPTION 'Sem permissão para acessar o desfecho deste evento.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_categoria NOT IN ('Plantão', 'Sobreaviso') THEN
        RETURN QUERY SELECT 'nao_aplicavel'::text, NULL::text, v_horas, 'categoria'::text;
        RETURN;
    END IF;

    -- 1. DIA FUTURO
    -- Estritamente anterior a hoje, mesmo criterio de diaJaPassou em folha-ponto/actions.ts.
    -- Turno que cruza a meia-noite e julgado no dia em que COMECOU; entre a meia-noite e o fim
    -- dele o evento aparece como em_avaliacao mesmo ainda correndo. E inofensivo de proposito:
    -- em_avaliacao nao e acusacao, e o auto-fechamento (fase 5) so roda dias apos o fim do mes.
    v_data_evento := make_date(v_ano, v_mes, v_dia);
    IF v_data_evento >= p_hoje THEN
        RETURN QUERY SELECT 'previsto'::text, NULL::text, v_horas, 'calendario'::text;
        RETURN;
    END IF;

    -- 2. DESFECHO EXPLICITO VENCE TUDO
    -- Inclusive o ponto completo: se alguem decidiu, com autor e data, o sistema nao contradiz.
    -- A fila so oferece a escolha para evento em avaliacao, entao na pratica isto nao disputa
    -- com o relogio - mas se disputar, a pessoa ganha.
    SELECT je.resultado, je.resultado_origem
      INTO v_resultado, v_res_origem
      FROM public.justificativas_eventos je
     WHERE je.servidor_id = v_servidor_id
       AND je.dia = v_dia AND je.mes = v_mes AND je.ano = v_ano
       AND (je.categoria = v_categoria OR lower(je.categoria) = lower(v_categoria))
       AND je.resultado IS NOT NULL
     LIMIT 1;

    IF v_resultado = 'falta' THEN
        RETURN QUERY SELECT 'falta'::text,
            CASE WHEN v_res_origem = 'decurso_de_prazo'
                 THEN 'Sem registro e sem justificativa ate o fechamento da competencia'
                 ELSE 'Falta registrada pelo coordenador' END,
            v_horas, COALESCE(v_res_origem, 'coordenador')::text;
        RETURN;
    ELSIF v_resultado = 'validado' THEN
        RETURN QUERY SELECT 'validado'::text, 'Validado pelo coordenador'::text,
                            v_horas, 'coordenador'::text;
        RETURN;
    END IF;

    -- 3-A. SOBREAVISO
    IF v_categoria = 'Sobreaviso' THEN
        SELECT bool_or(true),
               bool_or(st.estado IN ('falhou_aceite', 'falhou_chegada', 'recusado')),
               bool_or(st.estado = 'em_andamento'),
               max(st.motivo) FILTER (WHERE st.estado IN ('falhou_aceite', 'falhou_chegada', 'recusado'))
          INTO v_tem_acion, v_tem_falha, v_tem_andamento, v_motivo_falha
          FROM public.logs_sobreaviso l
          CROSS JOIN LATERAL public.fn_status_acionamento_sobreaviso(
                 l.status::text, l.created_at, l.data_hora_acionamento,
                 l.data_hora_aceite, l.data_hora_chegada, now()) st
         WHERE l.servidor_id     = v_servidor_id
           AND l.escala_mensal_id = v_escala_mensal
           AND l.dia             = v_dia
           -- categoria NULL e historico anterior a coluna existir; 'Sobreaviso' e o acionamento
           -- de verdade. Sem este filtro, artefato de Plantao vira acionamento de Sobreaviso -
           -- e exatamente o bug que o anexo tem hoje (1 caso medido em 08/2026).
           AND (l.categoria = 'Sobreaviso' OR l.categoria IS NULL)
           AND public.fn_acionamento_sobreaviso_real(l.acionado_por, l.motivo_acionamento);

        -- Prontidao cumprida sem chamado nenhum. E o caso dominante: 72 dos 79 sobreavisos de
        -- 08/2026. Ate aqui, TODOS os 79 entravam na fila de justificativas como pendentes.
        IF NOT COALESCE(v_tem_acion, false) THEN
            RETURN QUERY SELECT 'validado'::text,
                'Periodo de prontidao cumprido, sem acionamento'::text,
                v_horas, 'sem_acionamento'::text;
            RETURN;
        END IF;

        -- Falha em QUALQUER estagio e falta, sem passar por em_avaliacao (decisao do usuario em
        -- 23/08/2026). E mais forte do que a regra do plantao de proposito: no plantao o
        -- silencio pode ser batida de transicao recusada pelo terminal; aqui o silencio e a
        -- propria pessoa nao ter aceitado nem comparecido, que e o fato.
        IF COALESCE(v_tem_falha, false) THEN
            RETURN QUERY SELECT 'falta'::text,
                COALESCE(v_motivo_falha, 'Falha no atendimento do acionamento')::text,
                v_horas, 'acionamento'::text;
            RETURN;
        END IF;

        IF COALESCE(v_tem_andamento, false) THEN
            RETURN QUERY SELECT 'previsto'::text, 'Acionamento em andamento'::text,
                                v_horas, 'acionamento'::text;
            RETURN;
        END IF;

        RETURN QUERY SELECT 'validado'::text, 'Acionamento atendido'::text,
                            v_horas, 'acionamento'::text;
        RETURN;
    END IF;

    -- 3-B. PLANTAO
    -- Registrado exige os DOIS extremos. Sem saida nao se sabe quanto a pessoa ficou; sem
    -- entrada nao se sabe se comecou. Medido em 08/2026: 86 de 217 plantoes passados tem os
    -- dois, 70 tem so um e 61 nao tem nenhum.
    IF v_entrada IS NOT NULL AND v_saida IS NOT NULL THEN
        -- A EXCECAO DO AJUSTE AUTOMATICO.
        -- Ao marcar dias passados e salvar, handleSave (ScaleGrid.tsx:3044) FABRICA os horarios
        -- a partir do previsto e grava a frase enlatada abaixo - ninguem digitou nada sobre
        -- aquele dia. O modal de validacao manual e o oposto: os quatro caminhos
        -- (ScaleGrid.tsx:2352, :2551, :2648, :2720) recusam texto vazio antes de chamar a RPC.
        --
        -- Medido em 08/2026, dos 86 plantoes completos: 67 batida real, 18 validacao manual com
        -- texto digitado, 1 ajuste automatico. No mes inteiro a frase aparece em 1.847 linhas,
        -- 1.836 delas Regular - o caminho e intenso no expediente e mal tocou plantao ainda.
        -- Sem esta excecao, o dia em que alguem usar "validar dias passados" sobre a linha de
        -- plantao dissolve a regra inteira em um clique.
        IF (v_ent_manual OR v_sai_manual)
           AND COALESCE(v_just_manual, '') ILIKE 'Ajuste autom%' THEN
            RETURN QUERY SELECT 'em_avaliacao'::text,
                'Presenca aplicada em lote a partir do previsto, sem declaracao sobre o dia'::text,
                v_horas, 'ajuste_automatico'::text;
            RETURN;
        END IF;

        RETURN QUERY SELECT 'registrado'::text, NULL::text, v_horas,
            CASE WHEN v_ent_manual OR v_sai_manual THEN 'validacao_manual' ELSE 'ponto' END;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'em_avaliacao'::text,
        CASE
            WHEN v_entrada IS NULL AND v_saida IS NULL THEN 'Sem registro de entrada e de saida'
            WHEN v_saida   IS NULL                     THEN 'Sem registro de saida'
            ELSE                                            'Sem registro de entrada'
        END,
        v_horas, 'ponto'::text;
END;
$fn$;

COMMENT ON FUNCTION public.fn_desfecho_evento_dia(uuid, date) IS
    'Fonte unica do estado de um evento de Plantao/Sobreaviso: previsto, registrado, validado, '
    'falta, em_avaliacao. Consumida pelo anexo, pelo relatorio de plantao, pela fila de '
    'justificativas e pelo gate de fechamento - NAO replicar a regra no frontend. Desfecho '
    'explicito (justificativas_eventos.resultado) vence o ponto; dia futuro nunca e julgado.';

GRANT EXECUTE ON FUNCTION public.fn_desfecho_evento_dia(uuid, date) TO authenticated, service_role;


-- ============================================================================
-- ENVELOPE POR ESCALA - o anexo e o relatorio precisam do mes inteiro de uma vez
-- ============================================================================
-- Mesmo padrao de fn_blocos_previstos_mes sobre fn_blocos_previstos_dia: LATERAL puro, sem
-- guard proprio - herda a checagem de escopo da funcao de dentro, linha a linha.
CREATE OR REPLACE FUNCTION public.fn_desfecho_eventos_escalas(
    p_escala_mensal_ids uuid[],
    p_hoje              date
)
RETURNS TABLE (
    escala_diaria_id uuid,
    escala_mensal_id uuid,
    dia              integer,
    categoria        text,
    estado           text,
    motivo           text,
    horas            numeric,
    fonte            text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT ed.id, ed.escala_mensal_id, ed.dia, ed.categoria::text,
           d.estado, d.motivo, d.horas, d.fonte
      FROM public.escala_diaria ed
      CROSS JOIN LATERAL public.fn_desfecho_evento_dia(ed.id, p_hoje) d
     WHERE ed.escala_mensal_id = ANY (p_escala_mensal_ids)
       AND ed.categoria IN ('Plantão'::public.escala_categoria,
                            'Sobreaviso'::public.escala_categoria)
     ORDER BY ed.dia
$$;

COMMENT ON FUNCTION public.fn_desfecho_eventos_escalas(uuid[], date) IS
    'Envelope LATERAL de fn_desfecho_evento_dia para um conjunto de escalas mensais. Sem guard '
    'proprio de proposito: herda o escopo da funcao de dentro, exatamente como '
    'fn_blocos_previstos_mes herda o de fn_blocos_previstos_dia.';

GRANT EXECUTE ON FUNCTION public.fn_desfecho_eventos_escalas(uuid[], date) TO authenticated, service_role;

COMMIT;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar; nao faz parte da migration)
-- ============================================================================
--
-- 1. O PORTAO DA FASE 0. Competencia 08/2026, tratada como se hoje fosse 23/08/2026:
--
--    SELECT d.categoria, d.estado, count(*), sum(d.horas) AS horas
--      FROM public.escala_mensal em
--      CROSS JOIN LATERAL public.fn_desfecho_eventos_escalas(ARRAY[em.id], DATE '2026-08-23') d
--     WHERE em.mes = 8 AND em.ano = 2026 AND em.ativo IS TRUE
--     GROUP BY d.categoria, d.estado
--     ORDER BY d.categoria, d.estado;
--
--    Esperado, conferido por simulacao sobre os dados reais em 23/08/2026 com
--    `node scratchpad/sim_desfecho_evento.js` (portao OK, os quatro numeros bateram):
--
--      Plantão    | registrado    |  85 | 718h   <- 67 por ponto + 18 por validacao manual
--      Plantão    | em_avaliacao  | 132 | 1389h  <- 131 por falta de registro + 1 ajuste automatico
--      Plantão    | previsto      |  91 |  828h  <- dias 23 a 31
--      Plantão    | falta         |   0
--      Plantão    | validado      |   0
--      Sobreaviso | validado      |  61 |  852h  <- 56 sem acionamento + 5 acionamento atendido
--      Sobreaviso | previsto      |  18 |  288h
--      Sobreaviso | falta         |   0
--
--    O QUE CONFIRMA O PORTAO: registrado + em_avaliacao = 217 plantoes e 2.107h - exatamente
--    o conjunto e o total que o anexo imprime hoje, agora repartido em provado e nao provado.
--
-- 2. NENHUMA FALTA NASCE DESTA MIGRATION, nas duas categorias. Sobreaviso com falha nao existe
--    em producao: os 8 acionamentos reais terminaram todos em 'Chegou'.
--
-- 3. Competencias fechadas mudam pouco - e o esperado, porque 06 e 07/2026 sao os meses da
--    validacao em massa antiga, que gravava horario em tudo (CLAUDE.md, armadilha 5):
--
--    -- consulta 1 com mes = 6, hoje = DATE '2026-07-01' -> registrado 153, em_avaliacao 27
--    -- consulta 1 com mes = 7, hoje = DATE '2026-08-01' -> registrado 153, em_avaliacao  1
--
-- 4. O guard de escopo esta ativo para sessao de usuario e inerte para service_role:
--
--    -- com service role: a consulta 1 roda inteira
--    -- com JWT de coordenador de outra unidade: insufficient_privilege
