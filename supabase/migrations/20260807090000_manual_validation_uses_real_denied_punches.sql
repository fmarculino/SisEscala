-- Migration: Validacao manual passa a usar a batida real recusada e a preencher o intervalo
-- Data: 2026-08-07
--
-- REGRA PEDIDA
--   Ao validar manualmente com justificativa:
--     1. se existe uma tentativa de batida REAL recusada para aquele passo, a folha de ponto
--        recebe o horario da tentativa;
--     2. se nao existe, a folha recebe o horario previsto da jornada (comportamento atual);
--     3. o "Dia Completo" passa a marcar tambem os dois passos de intervalo, para que a grade
--        mostre os quatro segmentos verdes - e nao so entrada e saida.
--
-- POR QUE O INTERVALO NAO ERA PREENCHIDO
--   O 'completo' deixou de gravar intervalo por causa das 31 marcacoes indevidas limpas em
--   20260806010000. Mas o problema la eram jornadas de 4h e 6h, que NAO tem intervalo
--   intrajornada (CLT Art. 71). Agora a gravacao volta, condicionada a
--   fn_jornada_tem_intervalo - jornada de 9h como "08H AS 17H" fica com os 4 segmentos,
--   e jornada de ate 6h continua limpa. A grade ja espelha essa mesma regra ao escolher
--   entre 2 e 4 segmentos.
--
-- COMO A TENTATIVA E LIGADA AO PASSO (fn_batidas_reais_recusadas)
--   logs_tentativas_presenca nao tem campo de passo, entao a atribuicao e por proximidade
--   ao horario previsto, de forma gulosa: o par (passo, tentativa) de menor distancia e
--   fixado primeiro, e nem o passo nem a tentativa podem ser reaproveitados. Sobra sem
--   candidata -> horario previsto.
--
--   FILTRO DE ELEGIBILIDADE - a parte mais importante desta migration.
--   Nem toda linha de logs_tentativas_presenca prova que alguem estava presente. Auditoria
--   em producao (07/08/2026, 911 tentativas, 361 em agosto/2026):
--
--       378  Matricula ou PIN invalidos        <- identidade NAO confirmada
--        75  sem servidor_id                   <- idem
--        90  Nenhum plantao / Sem escala       <- nao havia escala no dia
--         x  Ja registrou entrada e saida      <- nada faltando
--       175  janela / erro interno             <- ELEGIVEL: pessoa identificada, recusada por bug
--
--   Usar uma tentativa de PIN invalido gravaria na folha o horario de um erro de digitacao,
--   possivelmente de outra pessoa. Por isso so entram tentativas com servidor_id preenchido
--   cuja mensagem indique janela de presenca ou erro interno do sistema.
--
--   TOLERANCIA: 90 minutos, calibrada nos dados reais de agosto/2026 (79 tentativas
--   elegiveis com horario previsto conhecido). Distancia ao passo mais proximo, ja com os
--   4 passos: p50=51min, p75=63min, p90=98min.
--
--       tolerancia  60min -> 68% das tentativas aproveitadas
--       tolerancia  90min -> 89%   <- escolhida
--       tolerancia 120min -> 95%
--       tolerancia 180min -> 99%
--
--   90min descarta os casos ambiguos que sobraram, como uma tentativa as 17:55 para jornada
--   que encerra as 14:00 (235min de distancia). Esses caem no horario previsto, que e o
--   comportamento seguro. Para afrouxar, mude o DEFAULT de p_tolerancia_min.
--
--   Foi a inclusao dos passos de INTERVALO que tornou isso viavel: varias tentativas ficam
--   por volta das 12h em jornadas 08:00-18:00 (almoco). Considerando so entrada e saida,
--   elas apareciam a 250-295min de distancia e seriam atribuidas ao passo errado.
--
-- ATENCAO AO RECRIAR fn_confirmar_presenca_manual NO FUTURO
--   Preserve: o cast ::public.escala_categoria, os COALESCE que protegem a batida real, as
--   flags presenca_*_manual, os guards de intervalo e de Sobreaviso, e a chamada a
--   fn_batidas_reais_recusadas. Ver CLAUDE.md armadilha 1.
--
-- Baseada em: 20260807080000, com 8 substituicoes pontuais aplicadas por script e conferidas
-- por diff. O corpo nao foi redigitado.


-- Atribui, para um servidor e um conjunto de horarios previstos, as batidas reais que foram
-- recusadas pelo terminal. Retorna NULL no passo que nao tiver candidata elegivel.
CREATE OR REPLACE FUNCTION public.fn_batidas_reais_recusadas(
    p_servidor_id uuid,
    p_prev_entrada timestamp with time zone,
    p_prev_int_saida timestamp with time zone,
    p_prev_int_retorno timestamp with time zone,
    p_prev_saida timestamp with time zone,
    p_tem_intervalo boolean DEFAULT true,
    p_tolerancia_min integer DEFAULT 90
)
RETURNS TABLE (
    entrada timestamp with time zone,
    int_saida timestamp with time zone,
    int_retorno timestamp with time zone,
    saida timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
    v_par RECORD;
    v_usados timestamp with time zone[] := ARRAY[]::timestamp with time zone[];
BEGIN
    entrada := NULL; int_saida := NULL; int_retorno := NULL; saida := NULL;

    IF p_servidor_id IS NULL THEN
        RETURN NEXT;
        RETURN;
    END IF;

    FOR v_par IN
        WITH passos(nome, previsto) AS (
            VALUES
                ('entrada'::text,     p_prev_entrada),
                ('int_saida'::text,   CASE WHEN p_tem_intervalo THEN p_prev_int_saida ELSE NULL END),
                ('int_retorno'::text, CASE WHEN p_tem_intervalo THEN p_prev_int_retorno ELSE NULL END),
                ('saida'::text,       p_prev_saida)
        )
        SELECT p.nome,
               lt.data_hora_tentativa AS quando,
               abs(extract(epoch FROM (lt.data_hora_tentativa - p.previsto))) AS dist
        FROM passos p
        JOIN public.logs_tentativas_presenca lt
          ON lt.servidor_id = p_servidor_id
         AND lt.data_hora_tentativa
             BETWEEN p.previsto - make_interval(mins => p_tolerancia_min)
                 AND p.previsto + make_interval(mins => p_tolerancia_min)
        WHERE p.previsto IS NOT NULL
          -- So tentativas que provam presenca fisica com identidade confirmada.
          -- PIN invalido, ausencia de escala e "ja registrou" ficam de fora de proposito.
          AND (lt.mensagem_erro ILIKE '%janela%' OR lt.mensagem_erro ILIKE '%erro interno%')
          AND lt.mensagem_erro NOT ILIKE '%matr_cula ou pin%'
        ORDER BY dist, lt.data_hora_tentativa
    LOOP
        -- Atribuicao gulosa: o par mais proximo vence, e nem o passo nem a tentativa
        -- podem ser usados de novo. Rajadas de tentativas repetidas caem fora naturalmente,
        -- porque a segunda batida encontra o passo ja preenchido.
        IF v_par.quando = ANY(v_usados) THEN
            CONTINUE;
        END IF;

        IF v_par.nome = 'entrada' AND entrada IS NULL THEN
            entrada := v_par.quando;
        ELSIF v_par.nome = 'int_saida' AND int_saida IS NULL THEN
            int_saida := v_par.quando;
        ELSIF v_par.nome = 'int_retorno' AND int_retorno IS NULL THEN
            int_retorno := v_par.quando;
        ELSIF v_par.nome = 'saida' AND saida IS NULL THEN
            saida := v_par.quando;
        ELSE
            CONTINUE;
        END IF;

        v_usados := v_usados || v_par.quando;
    END LOOP;

    RETURN NEXT;
END;
$fn$;

COMMENT ON FUNCTION public.fn_batidas_reais_recusadas(uuid, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, boolean, integer) IS
    'Casa tentativas recusadas em logs_tentativas_presenca com os passos previstos do dia, por proximidade e sem reuso. Ignora tentativas sem identidade confirmada.';


CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca_manual(
    p_escala_mensal_id uuid,
    p_dia integer,
    p_categoria text,
    p_tipo text,
    p_validador_id uuid,
    p_justificativa text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    v_servidor_id UUID;
    v_unidade_id UUID;
    v_mes INTEGER;
    v_ano INTEGER;
    v_timezone TEXT;
    
    v_start_hour INTEGER;
    v_jornada_nome TEXT;
    v_horas_totais INTEGER;
    v_horas_computadas INTEGER;
    v_slots TEXT[];
    v_turno_codigo TEXT;
    v_intervalo_minutos INTEGER;
    
    v_jornada_parsed BOOLEAN := false;
    v_jornada_end INTEGER;
    v_duration INTEGER;
    
    v_start_timestamp_local TIMESTAMP;
    v_end_timestamp_local TIMESTAMP;
    v_target_timestamp TIMESTAMP WITH TIME ZONE;
    v_existing_entrada TIMESTAMP WITH TIME ZONE;
    v_existing_saida_int TIMESTAMP WITH TIME ZONE;
    v_motivo_log TEXT;

    -- Horarios previstos de cada passo e as batidas reais recusadas correspondentes.
    v_tem_intervalo BOOLEAN;
    v_permite_marca_intervalo BOOLEAN;
    v_prev_entrada TIMESTAMP WITH TIME ZONE;
    v_prev_int_saida TIMESTAMP WITH TIME ZONE;
    v_prev_int_retorno TIMESTAMP WITH TIME ZONE;
    v_prev_saida TIMESTAMP WITH TIME ZONE;
    v_real_entrada TIMESTAMP WITH TIME ZONE;
    v_real_int_saida TIMESTAMP WITH TIME ZONE;
    v_real_int_retorno TIMESTAMP WITH TIME ZONE;
    v_real_saida TIMESTAMP WITH TIME ZONE;
BEGIN
    -- 1. Fetch metadata from escala_mensal
    SELECT servidor_id, unidade_id, mes, ano INTO v_servidor_id, v_unidade_id, v_mes, v_ano
    FROM public.escala_mensal
    WHERE id = p_escala_mensal_id;
    
    IF v_servidor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Escala mensal não encontrada.');
    END IF;

    -- Block future presence validation
    IF MAKE_DATE(v_ano, v_mes, p_dia) > CURRENT_DATE THEN
        RETURN jsonb_build_object('success', false, 'message', 'Não é possível validar presenças para datas futuras.');
    END IF;

    -- 2. Fetch timezone
    SELECT (valor#>>'{}')::text INTO v_timezone 
    FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    -- 3. Fetch start hour and shift parameters
    SELECT 
        dt.horas_computadas,
        dt.slots,
        j.horas_totais,
        dt.codigo as turno_codigo,
        j.nome as jornada_nome,
        COALESCE(j.intervalo_minutos, 60) as intervalo_minutos,
        COALESCE(
            CASE WHEN ed.categoria = 'Regular' THEN
                COALESCE(
                    CASE 
                      WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                          substring(j.nome from '^([0-9]+)')::integer
                      ELSE NULL
                    END,
                    CASE 
                      WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                      WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                      WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                      WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                      WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                      
                      ELSE NULL
                    END,
                    CASE 
                      WHEN dt.codigo = 'T4' THEN 14
                      WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                      WHEN dt.slots[1] = 'M' THEN 7
                      WHEN dt.slots[1] = 'T' THEN 13
                      WHEN dt.slots[1] = 'N' THEN 19
                      ELSE 7
                    END
                )
            ELSE NULL END,
            CASE WHEN ed.categoria = 'Plantão' THEN
                COALESCE(
                    CASE 
                      WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                      WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                      WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                      WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                      WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                      WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                          substring(j.nome from '^([0-9]+)')::integer
                      
                      ELSE NULL
                    END,
                    CASE 
                      WHEN dt.codigo = 'T4' THEN 14
                      WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                      WHEN dt.slots[1] = 'M' THEN 7
                      WHEN dt.slots[1] = 'T' THEN 13
                      WHEN dt.slots[1] = 'N' THEN 19
                      ELSE 7
                    END
                )
            ELSE NULL END,
            -- Se for Extra, busca o término do turno Regular ou Plantão do mesmo dia com tratamento de meia-noite
            (
                SELECT 
                    COALESCE(
                        (
                            SELECT 
                                CASE 
                                    WHEN substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer < substring(j2.nome from '^([0-9]+)')::integer THEN
                                        substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer + 24
                                    ELSE
                                        substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer
                                END
                            FROM public.escala_diaria ed2
                            JOIN public.escala_mensal em2 ON ed2.escala_mensal_id = em2.id
                            JOIN public.jornadas j2 ON j2.id = public.obter_jornada_servidor_data(em2.servidor_id, MAKE_DATE(em2.ano, em2.mes, ed2.dia), em2.jornada_id)
                            WHERE em2.id = em.id
                               AND ed2.dia = ed.dia
                               AND ed2.categoria = 'Regular'
                            LIMIT 1
                        ),
                        (
                            SELECT 
                                CASE 
                                    WHEN dt2.slots[1] = 'M' THEN 13
                                    WHEN dt2.slots[1] = 'T' THEN 19
                                    WHEN dt2.slots[1] = 'N' THEN 7 + 24 -- N cruza a meia-noite
                                    WHEN dt2.slots[1] ~ '^[0-9]+$' THEN 
                                        CASE 
                                            WHEN (dt2.slots[1]::integer + dt2.horas_computadas::integer) >= 24 THEN
                                                dt2.slots[1]::integer + dt2.horas_computadas::integer
                                            WHEN (dt2.slots[1]::integer + dt2.horas_computadas::integer) < dt2.slots[1]::integer THEN
                                                dt2.slots[1]::integer + dt2.horas_computadas::integer + 24
                                            ELSE
                                                dt2.slots[1]::integer + dt2.horas_computadas::integer
                                        END
                                    ELSE 19
                                END
                            FROM public.escala_diaria ed2
                            JOIN public.dicionario_turnos dt2 ON ed2.dicionario_turnos_id = dt2.id
                            WHERE ed2.escala_mensal_id = em.id
                               AND ed2.dia = ed.dia
                               AND ed2.categoria = 'Plantão'
                            LIMIT 1
                        )
                    )
                FROM public.escala_diaria ed
                JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
                WHERE em.id = p_escala_mensal_id AND ed.dia = p_dia AND ed.categoria = p_categoria::public.escala_categoria
                LIMIT 1
            ),
            7
        ) as start_hour
    INTO v_horas_computadas, v_slots, v_horas_totais, v_turno_codigo, v_jornada_nome, v_intervalo_minutos, v_start_hour
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
    WHERE em.id = p_escala_mensal_id AND ed.dia = p_dia AND ed.categoria = p_categoria::public.escala_categoria
    LIMIT 1;

    IF v_start_hour IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Registro de escala diária não encontrado.');
    END IF;

    -- Calculate scheduled start and end timestamps
    v_start_timestamp_local := MAKE_DATE(v_ano, v_mes, p_dia) + (v_start_hour || ' hours')::interval;
    
    IF v_jornada_nome IS NOT NULL AND p_categoria = 'Regular' THEN
        v_jornada_end := substring(v_jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer;
        IF v_jornada_end IS NOT NULL THEN
            v_jornada_parsed := true;
            IF v_jornada_end < v_start_hour THEN
                v_end_timestamp_local := MAKE_DATE(v_ano, v_mes, p_dia) + ( (v_jornada_end + 24) || ' hours')::interval;
            ELSE
                v_end_timestamp_local := MAKE_DATE(v_ano, v_mes, p_dia) + (v_jornada_end || ' hours')::interval;
            END IF;
        END IF;
    END IF;

    IF NOT v_jornada_parsed THEN
        v_duration := CASE 
            WHEN p_categoria = 'Regular' AND v_horas_totais IS NOT NULL AND v_horas_totais > 0 THEN v_horas_totais 
            ELSE COALESCE(v_horas_computadas, 0) 
        END;
        v_end_timestamp_local := v_start_timestamp_local + (v_duration || ' hours')::interval;
    END IF;

    -- Horarios previstos de cada passo. Servem para gravar o horario sintetico E para
    -- localizar, em logs_tentativas_presenca, a batida real que foi recusada por bug.
    v_prev_entrada     := v_start_timestamp_local AT TIME ZONE v_timezone;
    v_prev_saida       := v_end_timestamp_local AT TIME ZONE v_timezone;
    v_prev_int_saida   := (v_start_timestamp_local + (4 || ' hours')::interval) AT TIME ZONE v_timezone;
    v_prev_int_retorno := v_prev_int_saida + (COALESCE(v_intervalo_minutos, 60) || ' minutes')::interval;

    -- Espelha exatamente a condicao que ScaleGrid.tsx usa para desenhar 4 segmentos em vez
    -- de 2 (isUnitInterval). Gravar intervalo fora dela produziria dado invisivel na grade.
    --   1. so Regular e Plantao tem os passos de intervalo;
    --   2. a unidade precisa permitir a marcacao;
    --   3. CLT Art. 71: jornada de ate 6h nao tem intervalo.
    -- A duracao sai do horario efetivo calculado acima, e nao de v_horas_totais: para
    -- Plantao e Extra, v_horas_totais e da jornada Regular do servidor e nao descreve a
    -- duracao do turno (ver CLAUDE.md, regra de intervalo intrajornada).
    SELECT COALESCE(u.permite_marca_intervalo, false)
      INTO v_permite_marca_intervalo
      FROM public.unidades u
     WHERE u.id = v_unidade_id;

    v_tem_intervalo := p_categoria IN ('Regular', 'Plantão')
        AND COALESCE(v_permite_marca_intervalo, false)
        AND COALESCE(public.fn_jornada_tem_intervalo(
                (EXTRACT(EPOCH FROM (v_end_timestamp_local - v_start_timestamp_local)) / 60)::integer,
                v_intervalo_minutos), false);

    -- Batida real recusada tem precedencia sobre o horario sintetico (CLAUDE.md armadilha 7).
    -- Sobreaviso nao entra: nao marca presenca e nunca usou o terminal.
    IF p_categoria <> 'Sobreaviso' THEN
        SELECT r.entrada, r.int_saida, r.int_retorno, r.saida
          INTO v_real_entrada, v_real_int_saida, v_real_int_retorno, v_real_saida
          FROM public.fn_batidas_reais_recusadas(
                   v_servidor_id, v_prev_entrada, v_prev_int_saida,
                   v_prev_int_retorno, v_prev_saida, v_tem_intervalo) r;
    END IF;

    -- Update presence based on scope
    IF p_categoria = 'Sobreaviso' THEN
        -- Sobreaviso NAO marca presenca em escala_diaria.
        -- O registro de chegada e feito exclusivamente em logs_sobreaviso (secao 4 abaixo).
        v_motivo_log := 'Validação Manual (Sobreaviso)';

    ELSIF p_tipo = 'completo' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(presenca_entrada_em, v_real_entrada, v_prev_entrada),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            presenca_intervalo_saida_em = CASE WHEN v_tem_intervalo
                THEN COALESCE(presenca_intervalo_saida_em, v_real_int_saida, v_prev_int_saida)
                ELSE presenca_intervalo_saida_em END,
            presenca_intervalo_saida_manual = CASE WHEN v_tem_intervalo AND presenca_intervalo_saida_em IS NULL
                THEN true ELSE presenca_intervalo_saida_manual END,
            presenca_intervalo_retorno_em = CASE WHEN v_tem_intervalo
                THEN COALESCE(presenca_intervalo_retorno_em, v_real_int_retorno, v_prev_int_retorno)
                ELSE presenca_intervalo_retorno_em END,
            presenca_intervalo_retorno_manual = CASE WHEN v_tem_intervalo AND presenca_intervalo_retorno_em IS NULL
                THEN true ELSE presenca_intervalo_retorno_manual END,
            presenca_saida_em = COALESCE(presenca_saida_em, v_real_saida, v_prev_saida),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Dia Completo)';

    ELSIF p_tipo = 'entrada' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(presenca_entrada_em, v_real_entrada, v_prev_entrada),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Entrada / 1º Turno)';

    ELSIF p_tipo = 'saida' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_saida_em = COALESCE(presenca_saida_em, v_real_saida, v_prev_saida),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Saída / 2º Turno)';

    ELSIF p_tipo = 'periodo_1' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(presenca_entrada_em, v_real_entrada, v_prev_entrada),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (1º Período / Entrada Tarde/Noite)';

    ELSIF p_tipo = 'periodo_2' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_saida_em = COALESCE(presenca_saida_em, v_real_saida, v_prev_saida),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (2º Período / Saída Tarde/Noite)';

    ELSIF p_tipo = 'intervalo_saida' THEN
        -- GUARD: jornadas de ate 6h nao possuem intervalo intrajornada (CLT Art. 71).
        -- Cobre tambem fn_confirmar_presenca_manual_bulk, que delega para esta funcao.
        IF NOT v_tem_intervalo THEN
            RETURN jsonb_build_object('success', false, 'message',
                'Jornada de ' || COALESCE(v_horas_totais::text, '?') || 'h nao possui intervalo intrajornada.');
        END IF;

        UPDATE public.escala_diaria
        SET presenca_intervalo_saida_em = COALESCE(presenca_intervalo_saida_em, v_real_int_saida, v_prev_int_saida),
            presenca_intervalo_saida_manual = CASE WHEN presenca_intervalo_saida_em IS NULL THEN true ELSE presenca_intervalo_saida_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Saída Intervalo)';

    ELSIF p_tipo = 'intervalo_retorno' THEN
        -- GUARD: jornadas de ate 6h nao possuem intervalo intrajornada (CLT Art. 71).
        IF NOT v_tem_intervalo THEN
            RETURN jsonb_build_object('success', false, 'message',
                'Jornada de ' || COALESCE(v_horas_totais::text, '?') || 'h nao possui intervalo intrajornada.');
        END IF;

        SELECT presenca_entrada_em, presenca_intervalo_saida_em INTO v_existing_entrada, v_existing_saida_int
        FROM public.escala_diaria
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;

        v_target_timestamp := (v_start_timestamp_local + (5 || ' hours')::interval) AT TIME ZONE v_timezone;

        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(v_existing_entrada, (v_start_timestamp_local + (5 || ' hours')::interval) AT TIME ZONE v_timezone),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            presenca_intervalo_retorno_em = COALESCE(presenca_intervalo_retorno_em, v_real_int_retorno, v_target_timestamp),
            presenca_intervalo_retorno_manual = CASE WHEN presenca_intervalo_retorno_em IS NULL THEN true ELSE presenca_intervalo_retorno_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Retorno Intervalo / Entrada 2º Período)';

    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Tipo de presença inválido.');
    END IF;

    -- 4. Audit logging for Sobreaviso if applicable
    IF p_categoria = 'Sobreaviso' THEN
        UPDATE public.logs_sobreaviso
        SET status = 'Chegou',
            data_hora_chegada = now(),
            data_hora_validacao = now(),
            validacao_manual = true,
            validado_por = p_validador_id,
            justificativa = p_justificativa,
            tipo_validacao_chegada = 'Manual'
        WHERE servidor_id = v_servidor_id 
          AND escala_mensal_id = p_escala_mensal_id 
          AND dia = p_dia 
          AND status IN ('Aguardando', 'Aceito');

        IF NOT FOUND THEN
            INSERT INTO public.logs_sobreaviso (
                servidor_id, unidade_id, escala_mensal_id, dia, 
                data_hora_acionamento, data_hora_chegada, data_hora_validacao, 
                validacao_manual, validado_por, status, justificativa, motivo_acionamento, tipo_validacao_chegada, categoria
            ) VALUES (
                v_servidor_id, v_unidade_id, p_escala_mensal_id, p_dia, 
                now(), now(), now(), 
                true, p_validador_id, 'Chegou', p_justificativa, v_motivo_log, 'Manual', 'Sobreaviso'
            );
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'message', 'Presença confirmada manualmente com sucesso.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
