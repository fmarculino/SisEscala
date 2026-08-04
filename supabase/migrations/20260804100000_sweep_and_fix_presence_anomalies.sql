-- Migration: Sweep and Reconcile All Presence Anomalies
-- Description: Creates fn_varredura_anomalias_presenca to audit all servants with distorted presence entries (short durations < 30m, late entries for morning shifts, or missing entries) and fn_corrigir_todas_anomalias_presenca to fix them automatically.

-- 1. FUNCTION TO AUDIT AND LIST ALL ANOMALIES FOR A MONTH
CREATE OR REPLACE FUNCTION public.fn_varredura_anomalias_presenca(
    p_mes integer DEFAULT 8,
    p_ano integer DEFAULT 2026
)
RETURNS TABLE (
    unidade_nome text,
    setor_nome text,
    servidor_nome text,
    matricula text,
    jornada text,
    dia integer,
    entrada_registrada timestamp with time zone,
    saida_registrada timestamp with time zone,
    tipo_anomalia text,
    tentativa_auditoria timestamp with time zone
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(u.nome, 'N/A')::text AS unidade_nome,
        COALESCE(ds.nome, 'N/A')::text AS setor_nome,
        s.nome::text AS servidor_nome,
        s.matricula::text,
        COALESCE(j.nome, 'N/A')::text AS jornada,
        ed.dia::integer,
        ed.presenca_entrada_em AS entrada_registrada,
        ed.presenca_saida_em AS saida_registrada,
        CASE
            WHEN ed.presenca_entrada_em IS NOT NULL 
                 AND ed.presenca_saida_em IS NOT NULL 
                 AND (EXTRACT(EPOCH FROM (ed.presenca_saida_em - ed.presenca_entrada_em)) < 1800)
                THEN 'DURAÇÃO ANORMALMENTE CURTA (< 30 min)'
            WHEN ed.presenca_entrada_em IS NOT NULL 
                 AND (j.nome ILIKE '08H%' OR j.nome ILIKE '07H%' OR j.nome ILIKE '12H%')
                 AND EXTRACT(HOUR FROM ed.presenca_entrada_em AT TIME ZONE 'America/Belem') >= 14
                THEN 'ENTRADA TARDE EM JORNADA DIURNA'
            WHEN ed.presenca_entrada_em IS NULL AND ed.presenca_saida_em IS NOT NULL
                THEN 'SAÍDA REGISTRADA SEM ENTRADA'
            ELSE 'OUTRA DIVERGÊNCIA'
        END AS tipo_anomalia,
        (
            SELECT MIN(lt.data_hora_tentativa)
            FROM public.logs_tentativas_presenca lt
            WHERE (lt.servidor_id = s.id OR lt.matricula_digitada = s.matricula)
              AND EXTRACT(DAY FROM lt.data_hora_tentativa AT TIME ZONE 'America/Belem')::integer = ed.dia
              AND EXTRACT(MONTH FROM lt.data_hora_tentativa AT TIME ZONE 'America/Belem')::integer = p_mes
              AND EXTRACT(YEAR FROM lt.data_hora_tentativa AT TIME ZONE 'America/Belem')::integer = p_ano
        ) AS tentativa_auditoria
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.servidores s ON em.servidor_id = s.id
    LEFT JOIN public.unidades u ON em.unidade_id = u.id
    LEFT JOIN public.setores setr ON em.setor_id = setr.id
    LEFT JOIN public.dicionario_setores ds ON setr.dicionario_setor_id = ds.id
    LEFT JOIN public.jornadas j ON j.id = em.jornada_id
    WHERE em.mes = p_mes
      AND em.ano = p_ano
      AND ed.categoria = 'Regular'
      AND (
          -- Anomaly 1: Short duration < 30 mins (e.g. 18:18 to 18:23)
          (ed.presenca_entrada_em IS NOT NULL AND ed.presenca_saida_em IS NOT NULL AND EXTRACT(EPOCH FROM (ed.presenca_saida_em - ed.presenca_entrada_em)) < 1800)
          OR
          -- Anomaly 2: Entry after 14:00 for daytime shifts
          (ed.presenca_entrada_em IS NOT NULL AND (j.nome ILIKE '08H%' OR j.nome ILIKE '07H%') AND EXTRACT(HOUR FROM ed.presenca_entrada_em AT TIME ZONE 'America/Belem') >= 14)
          OR
          -- Anomaly 3: Missing entry but has exit
          (ed.presenca_entrada_em IS NULL AND ed.presenca_saida_em IS NOT NULL)
      )
    ORDER BY ed.dia, s.nome;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. FUNCTION TO AUTOMATICALLY RECONCILE ALL FOUND ANOMALIES
CREATE OR REPLACE FUNCTION public.fn_corrigir_todas_anomalias_presenca(
    p_mes integer DEFAULT 8,
    p_ano integer DEFAULT 2026
)
RETURNS TABLE (
    r_servidor_nome text,
    r_matricula text,
    r_dia integer,
    r_entrada_corrigida timestamp with time zone,
    r_saida_corrigida timestamp with time zone,
    r_status text
) AS $$
DECLARE
    v_rec RECORD;
    v_entrada_real TIMESTAMPTZ;
    v_saida_real TIMESTAMPTZ;
BEGIN
    FOR v_rec IN 
        SELECT * FROM public.fn_varredura_anomalias_presenca(p_mes, p_ano)
    LOOP
        -- If we have an audited clockin attempt from logs_tentativas_presenca
        IF v_rec.tentativa_auditoria IS NOT NULL THEN
            v_entrada_real := v_rec.tentativa_auditoria;
            v_saida_real := GREATEST(v_rec.entrada_registrada, v_rec.saida_registrada);
            IF v_saida_real <= v_entrada_real THEN
                v_saida_real := v_rec.saida_registrada;
            END IF;
        ELSE
            -- Fallback: Use standard shift start time if entry was late afternoon
            v_entrada_real := (make_date(p_ano, p_mes, v_rec.dia) + time '08:00:00') AT TIME ZONE 'America/Belem';
            v_saida_real := GREATEST(v_rec.entrada_registrada, v_rec.saida_registrada);
        END IF;

        -- Update escala_diaria
        UPDATE public.escala_diaria ed
        SET presenca_entrada_em = v_entrada_real,
            presenca_saida_em = v_saida_real,
            presenca_confirmada = true
        FROM public.escala_mensal em
        JOIN public.servidores s ON em.servidor_id = s.id
        WHERE ed.escala_mensal_id = em.id
          AND s.matricula = v_rec.matricula
          AND em.mes = p_mes
          AND em.ano = p_ano
          AND ed.dia = v_rec.dia
          AND ed.categoria = 'Regular';

        r_servidor_nome := v_rec.servidor_nome;
        r_matricula := v_rec.matricula;
        r_dia := v_rec.dia;
        r_entrada_corrigida := v_entrada_real;
        r_saida_corrigida := v_saida_real;
        r_status := 'Corrigido com sucesso';
        RETURN NEXT;
    END LOOP;
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. AUDIT RUN: VARREDURA GERAL (List all anomalies in August 2026)
SELECT * FROM public.fn_varredura_anomalias_presenca(8, 2026);
