-- Migration: Reconcile Denied Presence Attempt Logs to Daily Scale Presence Records
-- Description: Creates fn_reconciliar_presencas_negadas function to automatically detect denied clock-in attempts from logs_tentativas_presenca caused by shift window mismatches, and updates escala_diaria with the exact real arrival and departure timestamps.

CREATE OR REPLACE FUNCTION public.fn_reconciliar_presencas_negadas(p_data date DEFAULT '2026-08-04')
RETURNS TABLE (
    servidor_id uuid,
    servidor_nome text,
    matricula text,
    dia integer,
    entrada_real timestamp with time zone,
    saida_real timestamp with time zone,
    observacao text
) AS $$
DECLARE
    v_rec RECORD;
    v_escala_mensal_id UUID;
    v_escala_diaria_id UUID;
    v_entrada_anterior TIMESTAMPTZ;
    v_saida_anterior TIMESTAMPTZ;
    v_primeira_tentativa TIMESTAMPTZ;
    v_ultima_tentativa_ou_saida TIMESTAMPTZ;
    v_dia INTEGER := EXTRACT(DAY FROM p_data)::INTEGER;
    v_mes INTEGER := EXTRACT(MONTH FROM p_data)::INTEGER;
    v_ano INTEGER := EXTRACT(YEAR FROM p_data)::INTEGER;
BEGIN
    FOR v_rec IN 
        SELECT DISTINCT 
            COALESCE(l.servidor_id, s.id) AS s_id,
            COALESCE(s.nome, l.nome_servidor_detectado) AS s_nome,
            COALESCE(s.matricula, l.matricula_digitada) AS s_matricula
        FROM public.logs_tentativas_presenca l
        LEFT JOIN public.servidores s ON (s.id = l.servidor_id OR s.matricula = l.matricula_digitada)
        WHERE l.data_hora_tentativa::date = p_data
          AND l.mensagem_erro ILIKE '%janela%'
    LOOP
        -- Find escala_mensal for this servant
        SELECT em.id INTO v_escala_mensal_id
        FROM public.escala_mensal em
        WHERE em.servidor_id = v_rec.s_id
          AND em.mes = v_mes
          AND em.ano = v_ano
        LIMIT 1;

        IF v_escala_mensal_id IS NOT NULL THEN
            -- Find escala_diaria record for day
            SELECT ed.id, ed.presenca_entrada_em, ed.presenca_saida_em
            INTO v_escala_diaria_id, v_entrada_anterior, v_saida_anterior
            FROM public.escala_diaria ed
            WHERE ed.escala_mensal_id = v_escala_mensal_id
              AND ed.dia = v_dia
              AND ed.categoria = 'Regular'
            LIMIT 1;

            IF v_escala_diaria_id IS NOT NULL THEN
                -- Find the earliest denied attempt timestamp (real arrival)
                SELECT MIN(lt.data_hora_tentativa) INTO v_primeira_tentativa
                FROM public.logs_tentativas_presenca lt
                WHERE (lt.servidor_id = v_rec.s_id OR lt.matricula_digitada = v_rec.s_matricula)
                  AND lt.data_hora_tentativa::date = p_data
                  AND lt.mensagem_erro ILIKE '%janela%';

                -- Determine departure timestamp (either recorded exit, recorded entry placed in afternoon, or NULL)
                IF v_saida_anterior IS NOT NULL AND v_saida_anterior > v_primeira_tentativa THEN
                    v_ultima_tentativa_ou_saida := v_saida_anterior;
                ELSIF v_entrada_anterior IS NOT NULL AND v_entrada_anterior > v_primeira_tentativa THEN
                    v_ultima_tentativa_ou_saida := v_entrada_anterior;
                ELSE
                    v_ultima_tentativa_ou_saida := NULL;
                END IF;

                -- Perform update on escala_diaria
                UPDATE public.escala_diaria
                SET presenca_entrada_em = v_primeira_tentativa,
                    presenca_saida_em = v_ultima_tentativa_ou_saida,
                    presenca_confirmada = true
                WHERE id = v_escala_diaria_id;

                servidor_id := v_rec.s_id;
                servidor_nome := v_rec.s_nome;
                matricula := v_rec.s_matricula;
                dia := v_dia;
                entrada_real := v_primeira_tentativa;
                saida_real := v_ultima_tentativa_ou_saida;
                observacao := 'Reconciliado a partir dos logs de auditoria de tentativas negadas.';
                RETURN NEXT;
            END IF;
        END IF;
    END LOOP;
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Execute reconciliation for 2026-08-04
SELECT * FROM public.fn_reconciliar_presencas_negadas('2026-08-04');
