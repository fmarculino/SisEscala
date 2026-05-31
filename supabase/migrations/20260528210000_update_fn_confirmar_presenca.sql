-- Migration: Update fn_confirmar_presenca
-- Description: Updates the presence confirmation RPC to calculate checkout windows dynamically based on regular shift journey and overtime duration.

CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca(p_matricula text, p_pin_servidor text, p_coordenador_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_servidor_id UUID;
    v_servidor_unidade_id UUID;
    v_servidor_setor_id UUID;
    v_regular_id UUID;
    v_extra_id UUID;
    v_escala_mensal_id UUID;
    v_unidade_id UUID;
    v_regular_entrada TIMESTAMP WITH TIME ZONE;
    v_regular_saida TIMESTAMP WITH TIME ZONE;
    v_extra_entrada TIMESTAMP WITH TIME ZONE;
    v_extra_saida TIMESTAMP WITH TIME ZONE;
    v_entrada_confirmada TIMESTAMP WITH TIME ZONE;
    v_saida_confirmada TIMESTAMP WITH TIME ZONE;
    v_regular_duration NUMERIC;
    v_extra_duration NUMERIC;
    v_jornada_totais NUMERIC;
    v_slots TEXT[];
    
    v_start_hour INTEGER;
    v_now TIMESTAMP WITH TIME ZONE;
    v_now_local TIMESTAMP;
    v_janela_minutos INTEGER;
    v_timezone TEXT;
    
    v_hora_atual INTEGER;
    v_minuto_atual INTEGER;
    v_momento_atual_minutos INTEGER;
    
    v_inicio_turno_minutos INTEGER;
    v_regular_duracao_minutos INTEGER;
    v_extra_duracao_minutos INTEGER;
    v_fim_turno_minutos INTEGER;
    
    v_mes INTEGER;
    v_ano INTEGER;
    v_dia_hoje INTEGER;
    v_dia_ontem INTEGER;
    v_mes_ontem INTEGER;
    v_ano_ontem INTEGER;
    v_date_ontem DATE;
BEGIN
    v_now := now();
    
    SELECT (valor#>>'{}')::text INTO v_timezone 
    FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    SELECT (valor#>>'{}')::integer INTO v_janela_minutos 
    FROM public.configuracoes_globais WHERE chave = 'janela_presenca_minutos';
    IF v_janela_minutos IS NULL THEN v_janela_minutos := 30; END IF;

    v_now_local := v_now AT TIME ZONE v_timezone;
    
    v_dia_hoje := extract(day from v_now_local)::integer;
    v_mes := extract(month from v_now_local)::integer;
    v_ano := extract(year from v_now_local)::integer;
    
    v_date_ontem := v_now_local::date - interval '1 day';
    v_dia_ontem := extract(day from v_date_ontem)::integer;
    v_mes_ontem := extract(month from v_date_ontem)::integer;
    v_ano_ontem := extract(year from v_date_ontem)::integer;

    -- Validate servant credentials and fetch their unit/sector
    SELECT s.id, s.unidade_id, s.setor_id 
    INTO v_servidor_id, v_servidor_unidade_id, v_servidor_setor_id
    FROM public.servidores s
    WHERE s.matricula = p_matricula
      AND s.pin_acesso = p_pin_servidor;

    IF v_servidor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Matrícula ou PIN inválidos.');
    END IF;

    -- Validate coordinator permissions for this servant
    DECLARE
        v_coord_role TEXT;
        v_coord_todas_unidades BOOLEAN;
        v_coord_todos_setores BOOLEAN;
        v_has_unit_access BOOLEAN := false;
        v_has_sector_access BOOLEAN := false;
    BEGIN
        SELECT role::text, acesso_todas_unidades, acesso_todos_setores
        INTO v_coord_role, v_coord_todas_unidades, v_coord_todos_setores
        FROM public.profiles
        WHERE id = p_coordenador_id;

        IF v_coord_role = 'super_admin' THEN
            v_has_unit_access := true;
            v_has_sector_access := true;
        ELSE
            -- Check unit access
            IF v_coord_todas_unidades THEN
                v_has_unit_access := true;
            ELSE
                SELECT EXISTS (
                    SELECT 1 FROM public.profile_unidades 
                    WHERE profile_id = p_coordenador_id AND unidade_id = v_servidor_unidade_id
                ) INTO v_has_unit_access;
            END IF;

            -- Check sector access
            IF v_coord_todos_setores AND v_has_unit_access THEN
                v_has_sector_access := true;
            ELSIF v_coord_role = 'admin' AND v_has_unit_access THEN
                v_has_sector_access := true;
            ELSE
                SELECT EXISTS (
                    SELECT 1 FROM public.profile_setores 
                    WHERE profile_id = p_coordenador_id AND setor_id = v_servidor_setor_id
                ) INTO v_has_sector_access;
            END IF;
        END IF;

        IF NOT v_has_sector_access THEN
            RETURN jsonb_build_object(
                'success', false, 
                'message', 'Registro não permitido: Este servidor não pertence a uma unidade ou setor sob sua responsabilidade.'
            );
        END IF;
    END;

    -- 1. Fetch Regular (or Plantão) record for today
    SELECT ed.id, em.id, em.unidade_id, ed.presenca_entrada_em, ed.presenca_saida_em, dt.horas_computadas, dt.slots, j.horas_totais
    INTO v_regular_id, v_escala_mensal_id, v_unidade_id, v_regular_entrada, v_regular_saida, v_regular_duration, v_slots, v_jornada_totais
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    LEFT JOIN public.jornadas j ON em.jornada_id = j.id
    WHERE em.servidor_id = v_servidor_id
      AND em.mes = v_mes
      AND em.ano = v_ano
      AND ed.dia = v_dia_hoje
      AND ed.categoria IN ('Regular', 'Plantão')
    LIMIT 1;

    -- 2. Fetch Extra record for today
    SELECT ed.id, em.id, em.unidade_id, ed.presenca_entrada_em, ed.presenca_saida_em, dt.horas_computadas
    INTO v_extra_id, v_escala_mensal_id, v_unidade_id, v_extra_entrada, v_extra_saida, v_extra_duration
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    WHERE em.servidor_id = v_servidor_id
      AND em.mes = v_mes
      AND em.ano = v_ano
      AND ed.dia = v_dia_hoje
      AND ed.categoria = 'Extra'
    LIMIT 1;

    -- Determine check-in/check-out confirmation status
    v_entrada_confirmada := COALESCE(v_regular_entrada, v_extra_entrada);
    v_saida_confirmada := COALESCE(v_regular_saida, v_extra_saida);

    -- Calculate start hour (derived from Regular shift slots)
    IF v_slots IS NOT NULL AND array_length(v_slots, 1) > 0 THEN
        v_start_hour := CASE 
            WHEN v_slots[1] ~ '^[0-9]+$' THEN v_slots[1]::integer
            WHEN v_slots[1] = 'M' THEN 7
            WHEN v_slots[1] = 'T' THEN 13
            WHEN v_slots[1] = 'N' THEN 19
            ELSE 7
        END;
    ELSE
        v_start_hour := 7;
    END IF;

    -- Time values in minutes since midnight
    v_inicio_turno_minutos := v_start_hour * 60;
    
    v_regular_duracao_minutos := (CASE 
        WHEN v_regular_id IS NOT NULL THEN
            CASE WHEN v_jornada_totais IS NOT NULL AND v_jornada_totais > 0 THEN v_jornada_totais ELSE COALESCE(v_regular_duration, 0) END
        ELSE 0 
    END * 60)::integer;
    
    v_extra_duracao_minutos := (COALESCE(v_extra_duration, 0) * 60)::integer;
    v_fim_turno_minutos := v_inicio_turno_minutos + v_regular_duracao_minutos + v_extra_duracao_minutos;

    v_hora_atual := extract(hour from v_now_local)::integer;
    v_minuto_atual := extract(minute from v_now_local)::integer;
    v_momento_atual_minutos := (v_hora_atual * 60) + v_minuto_atual;

    -- 3. Check yesterday's unfinished shifts ending after midnight (only if currently in early morning)
    IF (v_regular_id IS NULL AND v_extra_id IS NULL OR v_entrada_confirmada IS NOT NULL OR v_hora_atual < 12) AND v_hora_atual < 12 THEN
        DECLARE
            v_mensal_ontem UUID;
            v_unid_ontem UUID;
            v_ent_ontem TIMESTAMP WITH TIME ZONE;
            v_sai_ontem TIMESTAMP WITH TIME ZONE;
            dt_slots_ontem TEXT[];
            dt_horas_ontem NUMERIC;
            v_jornada_ontem NUMERIC;
            v_start_ontem INTEGER;
            v_duration_ontem INTEGER;
            v_end_ontem INTEGER;
            v_fim_ontem_minutos INTEGER;
            v_has_unfinished_ontem BOOLEAN;
        BEGIN
            -- Check if there are any unfinished scale records from yesterday
            SELECT em.id, em.unidade_id, ed.presenca_entrada_em, ed.presenca_saida_em, dt.slots, dt.horas_computadas, j.horas_totais
            INTO v_mensal_ontem, v_unid_ontem, v_ent_ontem, v_sai_ontem, dt_slots_ontem, dt_horas_ontem, v_jornada_ontem
            FROM public.escala_diaria ed
            JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
            JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
            LEFT JOIN public.jornadas j ON em.jornada_id = j.id
            WHERE em.servidor_id = v_servidor_id
              AND em.mes = v_mes_ontem
              AND em.ano = v_ano_ontem
              AND ed.dia = v_dia_ontem
              AND ed.categoria IN ('Regular', 'Extra', 'Plantão')
              AND ed.presenca_entrada_em IS NOT NULL
              AND ed.presenca_saida_em IS NULL
            LIMIT 1;

            IF v_mensal_ontem IS NOT NULL THEN
                v_start_ontem := CASE 
                    WHEN dt_slots_ontem[1] ~ '^[0-9]+$' THEN dt_slots_ontem[1]::integer
                    WHEN dt_slots_ontem[1] = 'M' THEN 7
                    WHEN dt_slots_ontem[1] = 'T' THEN 13
                    WHEN dt_slots_ontem[1] = 'N' THEN 19
                    ELSE 7
                END;
                
                v_duration_ontem := CASE WHEN v_jornada_ontem IS NOT NULL AND v_jornada_ontem > 0 THEN v_jornada_ontem ELSE COALESCE(dt_horas_ontem, 0) END;
                v_end_ontem := v_start_ontem + v_duration_ontem;
                
                -- Check if the yesterday's shift ended after midnight
                IF v_end_ontem > 24 THEN
                    v_fim_ontem_minutos := (v_end_ontem - 24) * 60;
                    IF v_momento_atual_minutos >= (v_fim_ontem_minutos - v_janela_minutos) AND 
                       v_momento_atual_minutos <= (v_fim_ontem_minutos + v_janela_minutos) THEN
                        
                        -- Update both Regular and Extra yesterday shifts
                        UPDATE public.escala_diaria 
                        SET presenca_saida_em = v_now, confirmado_por_id = p_coordenador_id 
                        WHERE escala_mensal_id = v_mensal_ontem 
                          AND dia = v_dia_ontem 
                          AND categoria IN ('Regular', 'Extra', 'Plantão');
                        
                        INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada)
                        VALUES (v_servidor_id, v_unid_ontem, v_mensal_ontem, v_dia_ontem, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA ONTEM) via terminal.', 'Manual');
                        
                        RETURN jsonb_build_object('success', true, 'message', 'Saída confirmada (Plantão de Ontem) às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!');
                    END IF;
                END IF;
            END IF;
        END;
    END IF;

    -- Validate that today has at least one shift scheduled
    IF v_regular_id IS NULL AND v_extra_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nenhum plantão agendado para você hoje.');
    END IF;

    -- 4. Check-in and Check-out flow for today
    IF v_entrada_confirmada IS NULL THEN
        -- Check-in validation
        IF v_momento_atual_minutos >= (v_inicio_turno_minutos - v_janela_minutos) AND 
           v_momento_atual_minutos <= (v_inicio_turno_minutos + v_janela_minutos) THEN
            
            -- Check-in both Regular and Extra today
            UPDATE public.escala_diaria 
            SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id 
            WHERE id IN (v_regular_id, v_extra_id);
            
            INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada)
            VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (ENTRADA) via terminal.', 'Manual');
            
            RETURN jsonb_build_object('success', true, 'message', 'Entrada confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom plantão!');
        
        -- Checkout without check-in safety fallback (if within checkout window)
        ELSIF v_fim_turno_minutos <= 1440 AND v_momento_atual_minutos >= (v_fim_turno_minutos - v_janela_minutos) AND 
              v_momento_atual_minutos <= (v_fim_turno_minutos + v_janela_minutos) THEN
            
            -- Check-out both Regular and Extra today
            UPDATE public.escala_diaria 
            SET presenca_saida_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id 
            WHERE id IN (v_regular_id, v_extra_id);
            
            INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada)
            VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA SEM ENTRADA) via terminal.', 'Manual');
            
            RETURN jsonb_build_object('success', true, 'message', 'Saída confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Atenção: Sua ENTRADA não foi registrada e precisará de validação manual do administrador.');
        
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Fora da janela de ENTRADA. Seu plantão inicia às ' || lpad(v_start_hour::text, 2, '0') || ':00.');
        END IF;
    
    ELSIF v_saida_confirmada IS NULL THEN
        -- Check-out validation
        IF v_fim_turno_minutos > 1440 THEN
             RETURN jsonb_build_object('success', false, 'message', 'Sua saída está prevista para amanhã às ' || lpad((v_fim_turno_minutos/60 - 24)::text, 2, '0') || ':' || lpad((v_fim_turno_minutos%60)::text, 2, '0') || '.');
        END IF;

        IF v_momento_atual_minutos >= (v_fim_turno_minutos - v_janela_minutos) AND 
           v_momento_atual_minutos <= (v_fim_turno_minutos + v_janela_minutos) THEN
            
            -- Check-out both Regular and Extra today
            UPDATE public.escala_diaria 
            SET presenca_saida_em = v_now, confirmado_por_id = p_coordenador_id 
            WHERE id IN (v_regular_id, v_extra_id);
            
            INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada)
            VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA) via terminal.', 'Manual');
            
            RETURN jsonb_build_object('success', true, 'message', 'Saída confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!');
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Fora da janela de SAÍDA. Seu plantão encerra às ' || lpad((v_fim_turno_minutos/60)::text, 2, '0') || ':' || lpad((v_fim_turno_minutos%60)::text, 2, '0') || '.');
        END IF;
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Você já registrou sua entrada e saída hoje.');
    END IF;

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', 'Erro interno: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
