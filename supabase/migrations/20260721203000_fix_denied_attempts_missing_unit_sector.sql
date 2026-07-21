-- Migration: Fix missing unit/sector names and scale details in presence attempts logging
-- Description: Updates public.fn_log_tentativa_negada to resolve unit and sector names from the servant's registration as fallback if passed as NULL.
-- Updates public.fn_confirmar_presenca to track completed shifts as fallback, preventing scale details from being NULL in logs.
-- Backfills unit_nome, setor_nome, and scale details for existing log entries.

CREATE OR REPLACE FUNCTION public.fn_log_tentativa_negada(
    p_servidor_id UUID,
    p_matricula_digitada TEXT,
    p_coordenador_id UUID,
    p_mensagem_erro TEXT,
    p_escala_prevista_inicio TEXT,
    p_escala_prevista_fim TEXT,
    p_escala_categoria TEXT,
    p_unidade_nome TEXT,
    p_setor_nome TEXT,
    p_turno_codigo TEXT,
    p_detalhes_escala JSONB
) RETURNS VOID AS $$
DECLARE
    v_servidor_nome TEXT := NULL;
    v_coordenador_nome TEXT := NULL;
    v_unidade_nome TEXT := p_unidade_nome;
    v_setor_nome TEXT := p_setor_nome;
BEGIN
    IF p_servidor_id IS NOT NULL THEN
        -- Query the servant's name
        SELECT nome INTO v_servidor_nome FROM public.servidores WHERE id = p_servidor_id;
        
        -- Fallback: if unit_nome or sector_nome is NULL, fetch from servant's main registration
        IF v_unidade_nome IS NULL THEN
            SELECT u.nome INTO v_unidade_nome
            FROM public.servidores s
            LEFT JOIN public.unidades u ON s.unidade_id = u.id
            WHERE s.id = p_servidor_id;
        END IF;
        
        IF v_setor_nome IS NULL THEN
            SELECT ds.nome INTO v_setor_nome
            FROM public.servidores s
            LEFT JOIN public.setores setr ON s.setor_id = setr.id
            LEFT JOIN public.dicionario_setores ds ON setr.dicionario_setor_id = ds.id
            WHERE s.id = p_servidor_id;
        END IF;
    END IF;
    
    IF p_coordenador_id IS NOT NULL THEN
        SELECT full_name INTO v_coordenador_nome FROM public.profiles WHERE id = p_coordenador_id;
    END IF;

    INSERT INTO public.logs_tentativas_presenca (
        servidor_id,
        matricula_digitada,
        nome_servidor_detectado,
        coordenador_id,
        coordenador_nome,
        mensagem_erro,
        escala_prevista_inicio,
        escala_prevista_fim,
        escala_categoria,
        unidade_nome,
        setor_nome,
        turno_codigo,
        detalhes_escala
    ) VALUES (
        p_servidor_id,
        p_matricula_digitada,
        v_servidor_nome,
        p_coordenador_id,
        v_coordenador_nome,
        p_mensagem_erro,
        p_escala_prevista_inicio,
        p_escala_prevista_fim,
        p_escala_categoria,
        v_unidade_nome,
        v_setor_nome,
        p_turno_codigo,
        p_detalhes_escala
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca(
    p_matricula text, 
    p_pin_servidor text, 
    p_coordenador_id uuid,
    p_momento_simulado timestamp with time zone default null
)
RETURNS jsonb AS $$
DECLARE
    v_servidor_id UUID;
    v_servidor_unidade_id UUID;
    v_servidor_setor_id UUID;
    v_escala_mensal_id UUID;
    v_unidade_id UUID;
    v_ignora_janela BOOLEAN;
    
    v_now TIMESTAMP WITH TIME ZONE;
    v_now_local TIMESTAMP;
    v_janela_minutos INTEGER;
    v_timezone TEXT;
    
    v_hora_atual INTEGER;
    v_minuto_atual INTEGER;
    v_momento_atual_minutos INTEGER;
    
    v_dia_hoje INTEGER;
    v_mes INTEGER;
    v_ano INTEGER;
    
    v_dia_ontem INTEGER;
    v_mes_ontem INTEGER;
    v_ano_ontem INTEGER;
    v_date_ontem DATE;

    -- Shift variables
    r RECORD;
    v_shifts_count INTEGER;
    v_blocks_count INTEGER;
    v_start_hour INTEGER;
    v_inicio_turno_minutos INTEGER;
    v_regular_duracao_minutos INTEGER;
    v_fim_turno_minutos INTEGER;

    -- Today/Yesterday shifts (up to 3 supported)
    v_s1_id UUID; v_s1_inicio INTEGER; v_s1_fim INTEGER; v_s1_entrada TIMESTAMP WITH TIME ZONE; v_s1_saida TIMESTAMP WITH TIME ZONE; v_s1_cat TEXT;
    v_s2_id UUID; v_s2_inicio INTEGER; v_s2_fim INTEGER; v_s2_entrada TIMESTAMP WITH TIME ZONE; v_s2_saida TIMESTAMP WITH TIME ZONE; v_s2_cat TEXT;
    v_s3_id UUID; v_s3_inicio INTEGER; v_s3_fim INTEGER; v_s3_entrada TIMESTAMP WITH TIME ZONE; v_s3_saida TIMESTAMP WITH TIME ZONE; v_s3_cat TEXT;

    -- Today/Yesterday blocks (up to 3 blocks)
    v_b1_inicio INTEGER; v_b1_fim INTEGER; v_b1_ids UUID[]; v_b1_entradas TIMESTAMP WITH TIME ZONE[]; v_b1_saidas TIMESTAMP WITH TIME ZONE[]; v_b1_cat TEXT;
    v_b2_inicio INTEGER; v_b2_fim INTEGER; v_b2_ids UUID[]; v_b2_entradas TIMESTAMP WITH TIME ZONE[]; v_b2_saidas TIMESTAMP WITH TIME ZONE[]; v_b2_cat TEXT;
    v_b3_inicio INTEGER; v_b3_fim INTEGER; v_b3_ids UUID[]; v_b3_entradas TIMESTAMP WITH TIME ZONE[]; v_b3_saidas TIMESTAMP WITH TIME ZONE[]; v_b3_cat TEXT;

    -- Ponto Facultativo variables
    v_block_date DATE;
    v_pf_inicio_liberacao TIME;
    v_pf_fim_liberacao TIME;
    v_pf_desc TEXT;
    v_pf_inicio_minutos INTEGER;
    v_pf_fim_minutos INTEGER;
    v_pf_existe BOOLEAN;
BEGIN
    v_now := COALESCE(p_momento_simulado, now());
    
    SELECT (valor#>>'{}')::text INTO v_timezone 
    FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    SELECT (valor#>>'{}')::integer INTO v_janela_minutos 
    FROM public.configuracoes_globais WHERE chave = 'janela_presenca_minutos';
    IF v_janela_minutos IS NULL THEN v_janela_minutos := 30; END IF;

    v_now_local := v_now AT TIME ZONE v_timezone;
    
    v_hora_atual := extract(hour from v_now_local)::integer;
    v_minuto_atual := extract(minute from v_now_local)::integer;
    v_momento_atual_minutos := (v_hora_atual * 60) + v_minuto_atual;
    
    v_dia_hoje := extract(day from v_now_local)::integer;
    v_mes := extract(month from v_now_local)::integer;
    v_ano := extract(year from v_now_local)::integer;
    
    v_date_ontem := v_now_local::date - interval '1 day';
    v_dia_ontem := extract(day from v_date_ontem)::integer;
    v_mes_ontem := extract(month from v_date_ontem)::integer;
    v_ano_ontem := extract(year from v_date_ontem)::integer;

    -- Validate servant credentials and fetch their unit/sector
    SELECT s.id, s.unidade_id, s.setor_id, s.ignora_janela_presenca 
    INTO v_servidor_id, v_servidor_unidade_id, v_servidor_setor_id, v_ignora_janela
    FROM public.servidores s
    WHERE s.matricula = p_matricula;

    IF v_servidor_id IS NULL OR NOT public.verify_pin(v_servidor_id, p_pin_servidor) THEN
        PERFORM public.fn_log_tentativa_negada(
            v_servidor_id, 
            p_matricula, 
            p_coordenador_id, 
            'Matrícula ou PIN inválidos.', 
            NULL, NULL, NULL, NULL, NULL, NULL, NULL
        );
        RETURN jsonb_build_object('success', false, 'message', 'Matrícula ou PIN inválidos.');
    END IF;

    -- Validate coordinator permissions for this servant
    DECLARE
        v_coord_role TEXT;
        v_coord_todas_unidades BOOLEAN;
        v_coord_todos_setores BOOLEAN;
        v_has_unit_access BOOLEAN := false;
        v_has_sector_access BOOLEAN := false;
        v_has_scale_access_ontem BOOLEAN := false;
        v_has_scale_access_hoje BOOLEAN := false;
    BEGIN
        SELECT role::text, acesso_todas_unidades, acesso_todos_setores
        INTO v_coord_role, v_coord_todas_unidades, v_coord_todos_setores
        FROM public.profiles
        WHERE id = p_coordenador_id;

        IF v_coord_role = 'super_admin' THEN
            v_has_unit_access := true;
            v_has_sector_access := true;
        ELSE
            -- Check unit access (based on main lotation)
            IF v_coord_todas_unidades THEN
                v_has_unit_access := true;
            ELSE
                SELECT EXISTS (
                    SELECT 1 FROM public.profile_unidades 
                    WHERE profile_id = p_coordenador_id AND unidade_id = v_servidor_unidade_id
                ) INTO v_has_unit_access;
            END IF;

            -- Check sector access (based on main lotation)
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

        -- FALLBACK: If coordinator has no access based on servant's main lotation,
        -- check if they have access to the unit/sector of any active shift scheduled for today or yesterday.
        IF NOT v_has_sector_access THEN
            -- Check yesterday's shifts
            SELECT EXISTS (
                SELECT 1 
                FROM public.escala_diaria ed
                JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
                WHERE em.servidor_id = v_servidor_id
                  AND em.mes = v_mes_ontem
                  AND em.ano = v_ano_ontem
                  AND ed.dia = v_dia_ontem
                  AND ed.categoria IN ('Regular', 'Plantão', 'Extra')
                  AND (
                      v_coord_todas_unidades OR EXISTS (
                          SELECT 1 FROM public.profile_unidades pu 
                          WHERE pu.profile_id = p_coordenador_id AND pu.unidade_id = em.unidade_id
                      )
                  )
                  AND (
                      v_coord_todos_setores OR v_coord_role = 'admin' OR EXISTS (
                          SELECT 1 FROM public.profile_setores ps 
                          WHERE ps.profile_id = p_coordenador_id AND ps.setor_id = em.setor_id
                      )
                  )
            ) INTO v_has_scale_access_ontem;

            -- Check today's shifts
            SELECT EXISTS (
                SELECT 1 
                FROM public.escala_diaria ed
                JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
                WHERE em.servidor_id = v_servidor_id
                  AND em.mes = v_mes
                  AND em.ano = v_ano
                  AND ed.dia = v_dia_hoje
                  AND ed.categoria IN ('Regular', 'Plantão', 'Extra')
                  AND (
                      v_coord_todas_unidades OR EXISTS (
                          SELECT 1 FROM public.profile_unidades pu 
                          WHERE pu.profile_id = p_coordenador_id AND pu.unidade_id = em.unidade_id
                      )
                  )
                  AND (
                      v_coord_todos_setores OR v_coord_role = 'admin' OR EXISTS (
                          SELECT 1 FROM public.profile_setores ps 
                          WHERE ps.profile_id = p_coordenador_id AND ps.setor_id = em.setor_id
                      )
                  )
            ) INTO v_has_scale_access_hoje;

            IF v_has_scale_access_ontem OR v_has_scale_access_hoje THEN
                v_has_sector_access := true;
            END IF;
        END IF;

        IF NOT v_has_sector_access THEN
            DECLARE
                v_main_unit_nome TEXT := NULL;
                v_main_sector_nome TEXT := NULL;
            BEGIN
                SELECT nome INTO v_main_unit_nome FROM public.unidades WHERE id = v_servidor_unidade_id;
                SELECT ds.nome INTO v_main_sector_nome 
                FROM public.setores s 
                JOIN public.dicionario_setores ds ON s.dicionario_setor_id = ds.id 
                WHERE s.id = v_servidor_setor_id;

                PERFORM public.fn_log_tentativa_negada(
                    v_servidor_id, 
                    p_matricula, 
                    p_coordenador_id, 
                    'Registro não permitido: Este servidor não pertence a uma unidade ou setor sob sua responsabilidade.', 
                    NULL, NULL, NULL, v_main_unit_nome, v_main_sector_nome, NULL, 
                    jsonb_build_object('servidor_unidade_id', v_servidor_unidade_id, 'servidor_setor_id', v_servidor_setor_id)
                );
            END;
            RETURN jsonb_build_object(
                'success', false, 
                'message', 'Registro não permitido: Este servidor não pertence a uma unidade ou setor sob sua responsabilidade.'
            );
        END IF;
    END;

    -- Check if there is an active ponto facultativo for yesterday
    v_pf_inicio_liberacao := NULL;
    v_pf_fim_liberacao := NULL;
    v_pf_desc := NULL;
    v_pf_inicio_minutos := NULL;
    v_pf_fim_minutos := NULL;
    v_pf_existe := FALSE;

    SELECT pf.inicio_liberacao_em, pf.fim_liberacao_em, pf.descricao
    INTO v_pf_inicio_liberacao, v_pf_fim_liberacao, v_pf_desc
    FROM public.pontos_facultativos pf
    WHERE pf.data = v_date_ontem
      AND (
        EXISTS (
            SELECT 1 FROM public.ponto_facultativo_setores pfs 
            WHERE pfs.ponto_facultativo_id = pf.id 
              AND pfs.setor_id = v_servidor_setor_id 
              AND pfs.tipo_regra = 'incluido'
        )
        OR (
            COALESCE((SELECT s.essencial FROM public.setores s WHERE s.id = v_servidor_setor_id), FALSE) = FALSE
            AND NOT EXISTS (
                SELECT 1 FROM public.ponto_facultativo_setores pfs 
                WHERE pfs.ponto_facultativo_id = pf.id 
                  AND pfs.setor_id = v_servidor_setor_id 
                  AND pfs.tipo_regra = 'excluido'
            )
        )
      )
    LIMIT 1;

    IF FOUND THEN
        v_pf_existe := TRUE;
        IF v_pf_inicio_liberacao IS NOT NULL THEN
            v_pf_inicio_minutos := extract(hour from v_pf_inicio_liberacao)::integer * 60 + extract(minute from v_pf_inicio_liberacao)::integer;
        END IF;
        IF v_pf_fim_liberacao IS NOT NULL THEN
            v_pf_fim_minutos := extract(hour from v_pf_fim_liberacao)::integer * 60 + extract(minute from v_pf_fim_liberacao)::integer;
        END IF;
    END IF;

    -- 1. Check yesterday's unfinished shifts ending after midnight (only if currently in early morning)
    IF v_hora_atual < 12 THEN
        v_shifts_count := 0;
        v_blocks_count := 0;
        
        -- Clear sX variables
        v_s1_id := NULL; v_s2_id := NULL; v_s3_id := NULL;
        
        FOR r IN 
            SELECT 
                ed.id as escala_diaria_id, 
                ed.presenca_entrada_em, 
                ed.presenca_saida_em, 
                dt.horas_computadas, 
                dt.slots, 
                j.horas_totais, 
                dt.codigo as turno_codigo, 
                j.nome as jornada_nome, 
                ed.categoria::text,
                COALESCE(
                    CASE WHEN ed.categoria = 'Regular' THEN substring(j.nome from '^([0-9]+)')::integer ELSE NULL END,
                    CASE WHEN ed.categoria = 'Plantão' THEN
                        COALESCE(
                            CASE 
                              WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                                   (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                              THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                              WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                                   (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                              THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                              WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                                   (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                              THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer
                              
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
                    ),
                    7
                ) as start_hour
            FROM public.escala_diaria ed
            JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
            JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
            LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
            WHERE em.servidor_id = v_servidor_id
              AND em.mes = v_mes_ontem
              AND em.ano = v_ano_ontem
              AND ed.dia = v_dia_ontem
              AND ed.categoria IN ('Regular', 'Plantão', 'Extra')
            ORDER BY start_hour ASC
        LOOP
            v_shifts_count := v_shifts_count + 1;
            
            DECLARE
                v_jornada_parsed BOOLEAN := false;
                v_jornada_end INTEGER;
                v_duration INTEGER;
                v_start_min INTEGER;
                v_end_min INTEGER;
            BEGIN
                v_start_min := r.start_hour * 60;
                
                IF r.jornada_nome IS NOT NULL AND r.categoria = 'Regular' THEN
                    v_jornada_end := substring(r.jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer;
                    IF v_jornada_end IS NOT NULL THEN
                        v_jornada_parsed := true;
                        IF v_jornada_end < r.start_hour THEN
                            v_end_min := (v_jornada_end + 24) * 60;
                        ELSE
                            v_end_min := v_jornada_end * 60;
                        END IF;
                    END IF;
                END IF;
                
                IF NOT v_jornada_parsed THEN
                    v_duration := CASE 
                        WHEN r.categoria = 'Regular' AND r.horas_totais IS NOT NULL AND r.horas_totais > 0 THEN r.horas_totais 
                        ELSE COALESCE(r.horas_computadas, 0) 
                    END;
                    v_end_min := v_start_min + (v_duration * 60);
                END IF;

                IF v_shifts_count = 1 THEN
                    v_s1_id := r.escala_diaria_id; v_s1_inicio := v_start_min; v_s1_fim := v_end_min; v_s1_entrada := r.presenca_entrada_em; v_s1_saida := r.presenca_saida_em; v_s1_cat := r.categoria;
                ELSIF v_shifts_count = 2 THEN
                    v_s2_id := r.escala_diaria_id; v_s2_inicio := v_start_min; v_s2_fim := v_end_min; v_s2_entrada := r.presenca_entrada_em; v_s2_saida := r.presenca_saida_em; v_s2_cat := r.categoria;
                ELSIF v_shifts_count = 3 THEN
                    v_s3_id := r.escala_diaria_id; v_s3_inicio := v_start_min; v_s3_fim := v_end_min; v_s3_entrada := r.presenca_entrada_em; v_s3_saida := r.presenca_saida_em; v_s3_cat := r.categoria;
                END IF;
            END;
        END LOOP;

        IF v_shifts_count > 0 THEN
            -- Merge yesterday shifts into blocks
            IF v_shifts_count = 1 THEN
                v_blocks_count := 1;
                v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat;
            ELSIF v_shifts_count = 2 THEN
                IF v_s2_inicio <= v_s1_fim THEN
                    v_blocks_count := 1;
                    v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
                    v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
                ELSE
                    v_blocks_count := 2;
                    v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat;
                    v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat;
                END IF;
            ELSIF v_shifts_count >= 3 THEN
                IF v_s2_inicio <= v_s1_fim THEN
                    v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
                    v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
                    
                    IF v_s3_inicio <= v_b1_fim THEN
                        v_blocks_count := 1;
                        v_b1_fim := GREATEST(v_b1_fim, v_s3_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id, v_s3_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada, v_s3_entrada]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida, v_s3_saida];
                        v_b1_cat := CASE WHEN v_s3_cat IN ('Regular', 'Plantão') THEN v_s3_cat ELSE v_b1_cat END;
                    ELSE
                        v_blocks_count := 2;
                        v_b2_inicio := v_s3_inicio; v_b2_fim := v_s3_fim; v_b2_ids := ARRAY[v_s3_id]; v_b2_entradas := ARRAY[v_s3_entrada]; v_b2_saidas := ARRAY[v_s3_saida]; v_b2_cat := v_s3_cat;
                    END IF;
                ELSE
                    v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat;
                    
                    IF v_s3_inicio <= v_s2_fim THEN
                        v_blocks_count := 2;
                        v_b2_inicio := v_s2_inicio; v_b2_fim := GREATEST(v_s2_fim, v_s3_fim); v_b2_ids := ARRAY[v_s2_id, v_s3_id]; v_b2_entradas := ARRAY[v_s2_entrada, v_s3_entrada]; v_b2_saidas := ARRAY[v_s2_saida, v_s3_saida];
                        v_b2_cat := CASE WHEN v_s2_cat IN ('Regular', 'Plantão') THEN v_s2_cat ELSE v_s3_cat END;
                    ELSE
                        v_blocks_count := 3;
                        v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat;
                        v_b3_inicio := v_s3_inicio; v_b3_fim := v_s3_fim; v_b3_ids := ARRAY[v_s3_id]; v_b3_entradas := ARRAY[v_s3_entrada]; v_b3_saidas := ARRAY[v_s3_saida]; v_b3_cat := v_s3_cat;
                    END IF;
                END IF;
            END IF;

            -- Check yesterday's blocks for early morning checkout
            DECLARE
                v_b_inicio INTEGER; v_b_fim INTEGER; v_b_ids UUID[]; v_b_entradas TIMESTAMP WITH TIME ZONE[]; v_b_saidas TIMESTAMP WITH TIME ZONE[]; v_b_cat TEXT;
                v_b_has_null_entrada BOOLEAN; v_b_has_null_saida BOOLEAN; v_b_total_count INTEGER;
            BEGIN
                FOR idx IN 1..v_blocks_count LOOP
                    IF idx = 1 THEN
                        v_b_inicio := v_b1_inicio; v_b_fim := v_b1_fim; v_b_ids := v_b1_ids; v_b_entradas := v_b1_entradas; v_b_saidas := v_b1_saidas; v_b_cat := v_b1_cat;
                    ELSIF idx = 2 THEN
                        v_b_inicio := v_b2_inicio; v_b_fim := v_b2_fim; v_b_ids := v_b2_ids; v_b_entradas := v_b2_entradas; v_b_saidas := v_b2_saidas; v_b_cat := v_b2_cat;
                    ELSE
                        v_b_inicio := v_b3_inicio; v_b_fim := v_b3_fim; v_b_ids := v_b3_ids; v_b_entradas := v_b3_entradas; v_b_saidas := v_b3_saidas; v_b_cat := v_b3_cat;
                    END IF;
                    
                    v_b_total_count := array_length(v_b_ids, 1);
                    
                    -- If the yesterday's block crosses midnight, the first shift has an entry, and the last shift has no exit
                    IF v_b_fim > 1440 AND v_b_entradas[1] IS NOT NULL AND v_b_saidas[v_b_total_count] IS NULL THEN
                        -- Yesterday block end relative to today's midnight
                        DECLARE
                            v_fim_ontem_hoje_minutos INTEGER := v_b_fim - 1440;
                            v_checkout_permitido BOOLEAN := false;
                        BEGIN
                            -- Normal checkout check
                            IF v_momento_atual_minutos >= (v_fim_ontem_hoje_minutos - v_janela_minutos) AND 
                               v_momento_atual_minutos <= (v_fim_ontem_hoje_minutos + v_janela_minutos) THEN
                                v_checkout_permitido := true;
                            END IF;

                            -- Early exit point facultativo check
                            IF v_pf_existe AND v_pf_inicio_minutos IS NOT NULL THEN
                                -- If early release was yesterday before midnight, this shift would have checkout yesterday.
                            END IF;
                            
                            IF v_checkout_permitido OR v_ignora_janela OR (v_pf_existe AND v_pf_inicio_liberacao IS NULL AND v_pf_fim_liberacao IS NULL) THEN
                                SELECT escala_mensal_id INTO v_escala_mensal_id FROM public.escala_diaria WHERE id = v_b_ids[1];
                                SELECT unidade_id INTO v_unidade_id FROM public.escala_mensal WHERE id = v_escala_mensal_id;

                                PERFORM public.fn_salvar_saida_bloco(v_b_ids, v_now, p_coordenador_id, v_timezone, false);
                                
                                INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria)
                                VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_ontem, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA ONTEM) via terminal.', 'Manual', v_b_cat);
                                
                                RETURN jsonb_build_object('success', true, 'message', 'Saída confirmada (Plantão de Ontem) às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!');
                            END IF;
                        END;
                    END IF;
                END LOOP;
            END;
        END IF;
    END IF;

    -- Check if there is an active ponto facultativo for today
    v_pf_inicio_liberacao := NULL;
    v_pf_fim_liberacao := NULL;
    v_pf_desc := NULL;
    v_pf_inicio_minutos := NULL;
    v_pf_fim_minutos := NULL;
    v_pf_existe := FALSE;

    SELECT pf.inicio_liberacao_em, pf.fim_liberacao_em, pf.descricao
    INTO v_pf_inicio_liberacao, v_pf_fim_liberacao, v_pf_desc
    FROM public.pontos_facultativos pf
    WHERE pf.data = v_now_local::date
      AND (
        EXISTS (
            SELECT 1 FROM public.ponto_facultativo_setores pfs 
            WHERE pfs.ponto_facultativo_id = pf.id 
              AND pfs.setor_id = v_servidor_setor_id 
              AND pfs.tipo_regra = 'incluido'
        )
        OR (
            COALESCE((SELECT s.essencial FROM public.setores s WHERE s.id = v_servidor_setor_id), FALSE) = FALSE
            AND NOT EXISTS (
                SELECT 1 FROM public.ponto_facultativo_setores pfs 
                WHERE pfs.ponto_facultativo_id = pf.id 
                  AND pfs.setor_id = v_servidor_setor_id 
                  AND pfs.tipo_regra = 'excluido'
            )
        )
      )
    LIMIT 1;

    IF FOUND THEN
        v_pf_existe := TRUE;
        IF v_pf_inicio_liberacao IS NOT NULL THEN
            v_pf_inicio_minutos := extract(hour from v_pf_inicio_liberacao)::integer * 60 + extract(minute from v_pf_inicio_liberacao)::integer;
        END IF;
        IF v_pf_fim_liberacao IS NOT NULL THEN
            v_pf_fim_minutos := extract(hour from v_pf_fim_liberacao)::integer * 60 + extract(minute from v_pf_fim_liberacao)::integer;
        END IF;
        
        -- If it's a full-day Ponto Facultativo, we allow checkin/checkout anytime
        IF v_pf_inicio_liberacao IS NULL AND v_pf_fim_liberacao IS NULL THEN
            v_ignora_janela := TRUE;
        END IF;
    END IF;

    -- 2. Check-in and Check-out flow for today
    v_shifts_count := 0;
    v_blocks_count := 0;
    
    -- Clear sX variables
    v_s1_id := NULL; v_s2_id := NULL; v_s3_id := NULL;
    
    FOR r IN 
        SELECT 
            ed.id as escala_diaria_id, 
            ed.presenca_entrada_em, 
            ed.presenca_saida_em, 
            dt.horas_computadas, 
            dt.slots, 
            j.horas_totais, 
            dt.codigo as turno_codigo, 
            j.nome as jornada_nome, 
            ed.categoria::text,
            COALESCE(
                CASE WHEN ed.categoria = 'Regular' THEN substring(j.nome from '^([0-9]+)')::integer ELSE NULL END,
                CASE WHEN ed.categoria = 'Plantão' THEN
                    COALESCE(
                        CASE 
                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer
                          
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
                ),
                7
            ) as start_hour
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
        LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
        WHERE em.servidor_id = v_servidor_id
          AND em.mes = v_mes
          AND em.ano = v_ano
          AND ed.dia = v_dia_hoje
          AND ed.categoria IN ('Regular', 'Plantão', 'Extra')
        ORDER BY start_hour ASC
    LOOP
        v_shifts_count := v_shifts_count + 1;
        
        DECLARE
            v_jornada_parsed BOOLEAN := false;
            v_jornada_end INTEGER;
            v_duration INTEGER;
            v_start_min INTEGER;
            v_end_min INTEGER;
        BEGIN
            v_start_min := r.start_hour * 60;
            
            IF r.jornada_nome IS NOT NULL AND r.categoria = 'Regular' THEN
                v_jornada_end := substring(r.jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer;
                IF v_jornada_end IS NOT NULL THEN
                    v_jornada_parsed := true;
                    IF v_jornada_end < r.start_hour THEN
                        v_end_min := (v_jornada_end + 24) * 60;
                    ELSE
                        v_end_min := v_jornada_end * 60;
                    END IF;
                END IF;
            END IF;
            
            IF NOT v_jornada_parsed THEN
                v_duration := CASE 
                    WHEN r.categoria = 'Regular' AND r.horas_totais IS NOT NULL AND r.horas_totais > 0 THEN r.horas_totais 
                    ELSE COALESCE(r.horas_computadas, 0) 
                END;
                v_end_min := v_start_min + (v_duration * 60);
            END IF;

            IF v_shifts_count = 1 THEN
                v_s1_id := r.escala_diaria_id; v_s1_inicio := v_start_min; v_s1_fim := v_end_min; v_s1_entrada := r.presenca_entrada_em; v_s1_saida := r.presenca_saida_em; v_s1_cat := r.categoria;
            ELSIF v_shifts_count = 2 THEN
                v_s2_id := r.escala_diaria_id; v_s2_inicio := v_start_min; v_s2_fim := v_end_min; v_s2_entrada := r.presenca_entrada_em; v_s2_saida := r.presenca_saida_em; v_s2_cat := r.categoria;
            ELSIF v_shifts_count = 3 THEN
                v_s3_id := r.escala_diaria_id; v_s3_inicio := v_start_min; v_s3_fim := v_end_min; v_s3_entrada := r.presenca_entrada_em; v_s3_saida := r.presenca_saida_em; v_s3_cat := r.categoria;
            END IF;
        END;
    END LOOP;

    -- Merge shifts into logical blocks of today
    IF v_shifts_count = 1 THEN
        v_blocks_count := 1;
        v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat;
    ELSIF v_shifts_count = 2 THEN
        IF v_s2_inicio <= v_s1_fim THEN
            v_blocks_count := 1;
            v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
            v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
        ELSE
            v_blocks_count := 2;
            v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat;
            v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat;
        END IF;
    ELSIF v_shifts_count >= 3 THEN
        IF v_s2_inicio <= v_s1_fim THEN
            v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
            v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
            
            IF v_s3_inicio <= v_b1_fim THEN
                v_blocks_count := 1;
                v_b1_fim := GREATEST(v_b1_fim, v_s3_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id, v_s3_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada, v_s3_entrada]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida, v_s3_saida];
                v_b1_cat := CASE WHEN v_s3_cat IN ('Regular', 'Plantão') THEN v_s3_cat ELSE v_b1_cat END;
            ELSE
                v_blocks_count := 2;
                v_b2_inicio := v_s3_inicio; v_b2_fim := v_s3_fim; v_b2_ids := ARRAY[v_s3_id]; v_b2_entradas := ARRAY[v_s3_entrada]; v_b2_saidas := ARRAY[v_s3_saida]; v_b2_cat := v_s3_cat;
            END IF;
        ELSE
            v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat;
            
            IF v_s3_inicio <= v_s2_fim THEN
                v_blocks_count := 2;
                v_b2_inicio := v_s2_inicio; v_b2_fim := GREATEST(v_s2_fim, v_s3_fim); v_b2_ids := ARRAY[v_s2_id, v_s3_id]; v_b2_entradas := ARRAY[v_s2_entrada, v_s3_entrada]; v_b2_saidas := ARRAY[v_s2_saida, v_s3_saida];
                v_b2_cat := CASE WHEN v_s2_cat IN ('Regular', 'Plantão') THEN v_s2_cat ELSE v_s3_cat END;
            ELSE
                v_blocks_count := 3;
                v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat;
                v_b3_inicio := v_s3_inicio; v_b3_fim := v_s3_fim; v_b3_ids := ARRAY[v_s3_id]; v_b3_entradas := ARRAY[v_s3_entrada]; v_b3_saidas := ARRAY[v_s3_saida]; v_b3_cat := v_s3_cat;
            END IF;
        END IF;
    END IF;

    -- Match action on today's blocks
    DECLARE
        v_matched_block_idx INTEGER := NULL;
        v_matched_action TEXT := NULL; -- 'checkin', 'checkout', 'checkout_no_checkin'
        v_matched_ids UUID[];
        v_matched_start INTEGER;
        v_matched_fim INTEGER;
        v_matched_cat TEXT;
        
        v_closest_start INTEGER := NULL;
        v_closest_fim INTEGER := NULL;
        v_closest_diff INTEGER := 99999;
        v_closest_action TEXT := NULL;
        
        v_total_shifts INTEGER := 0;
        v_completed_shifts INTEGER := 0;
        
        -- helper variables for checking block b
        v_b_inicio INTEGER;
        v_b_fim INTEGER;
        v_b_ids UUID[];
        v_b_entradas TIMESTAMP WITH TIME ZONE[];
        v_b_saidas TIMESTAMP WITH TIME ZONE[];
        v_b_cat TEXT;
        
        v_b_has_null_entrada BOOLEAN;
        v_b_has_null_saida BOOLEAN;
        v_b_total_count INTEGER;
        v_b_completed_count INTEGER;
    BEGIN
        FOR idx IN 1..v_blocks_count LOOP
            IF idx = 1 THEN
                v_b_inicio := v_b1_inicio; v_b_fim := v_b1_fim; v_b_ids := v_b1_ids; v_b_entradas := v_b1_entradas; v_b_saidas := v_b1_saidas; v_b_cat := v_b1_cat;
            ELSIF idx = 2 THEN
                v_b_inicio := v_b2_inicio; v_b_fim := v_b2_fim; v_b_ids := v_b2_ids; v_b_entradas := v_b2_entradas; v_b_saidas := v_b2_saidas; v_b_cat := v_b2_cat;
            ELSE
                v_b_inicio := v_b3_inicio; v_b_fim := v_b3_fim; v_b_ids := v_b3_ids; v_b_entradas := v_b3_entradas; v_b_saidas := v_b3_saidas; v_b_cat := v_b3_cat;
            END IF;
            
            v_b_total_count := array_length(v_b_ids, 1);
            v_b_completed_count := 0;
            
            FOR i IN 1..v_b_total_count LOOP
                IF v_b_entradas[i] IS NOT NULL AND v_b_saidas[i] IS NOT NULL THEN
                    v_b_completed_count := v_b_completed_count + 1;
                END IF;
            END LOOP;
            
            v_total_shifts := v_total_shifts + v_b_total_count;
            v_completed_shifts := v_completed_shifts + v_b_completed_count;
            
            IF v_b_completed_count = v_b_total_count THEN
                -- Track as closest completed block for logging fallback
                IF v_closest_start IS NULL OR abs(v_momento_atual_minutos - v_b_inicio) < v_closest_diff THEN
                    v_closest_diff := abs(v_momento_atual_minutos - v_b_inicio);
                    v_closest_start := v_b_inicio;
                    v_closest_fim := v_b_fim;
                    v_closest_action := 'checkout'; -- default to checkout for completed shifts query matching
                END IF;
                CONTINUE;
            END IF;
            
            -- Determine if shift is fully excused because it is outside the ponto facultativo active times
            IF v_pf_existe THEN
                -- If early release, and shift starts after release time, it's fully excused
                IF v_pf_inicio_minutos IS NOT NULL AND v_b_inicio >= v_pf_inicio_minutos THEN
                    CONTINUE;
                END IF;
                -- If late entry, and shift ends before entry time, it's fully excused
                IF v_pf_fim_minutos IS NOT NULL AND v_b_fim <= v_pf_fim_minutos THEN
                    CONTINUE;
                END IF;
            END IF;

            -- Check entry window (if first shift has no entry)
            IF v_b_entradas[1] IS NULL THEN
                DECLARE
                    v_dentro_entrada BOOLEAN := false;
                BEGIN
                    -- Check normal entry window
                    IF v_momento_atual_minutos >= (v_b_inicio - v_janela_minutos) AND 
                       v_momento_atual_minutos <= (v_b_inicio + v_janela_minutos) THEN
                        v_dentro_entrada := true;
                    END IF;

                    -- Check late entry ponto facultativo window
                    IF v_pf_existe AND v_pf_fim_minutos IS NOT NULL AND v_b_inicio < v_pf_fim_minutos THEN
                        IF (v_momento_atual_minutos >= (v_pf_fim_minutos - v_janela_minutos) AND 
                            v_momento_atual_minutos <= (v_pf_fim_minutos + v_janela_minutos)) OR
                           (v_momento_atual_minutos >= v_b_inicio AND v_momento_atual_minutos <= v_pf_fim_minutos) THEN
                            v_dentro_entrada := true;
                        END IF;
                    END IF;

                    IF v_ignora_janela OR v_dentro_entrada THEN
                        v_matched_block_idx := idx;
                        v_matched_action := 'checkin';
                        v_matched_ids := v_b_ids;
                        v_matched_start := CASE WHEN v_pf_existe AND v_pf_fim_minutos IS NOT NULL AND v_b_inicio < v_pf_fim_minutos THEN v_pf_fim_minutos ELSE v_b_inicio END;
                        v_matched_fim := v_b_fim;
                        v_matched_cat := v_b_cat;
                        EXIT;
                    END IF;
                END;
                
                -- Check exit window without check-in
                DECLARE
                    v_dentro_saida BOOLEAN := false;
                    v_target_exit INTEGER := v_b_fim;
                BEGIN
                    IF v_pf_existe AND v_pf_inicio_minutos IS NOT NULL AND v_b_inicio < v_pf_inicio_minutos THEN
                        v_target_exit := v_pf_inicio_minutos;
                    END IF;

                    IF v_momento_atual_minutos >= (v_target_exit - v_janela_minutos) AND 
                       v_momento_atual_minutos <= (v_target_exit + v_janela_minutos) THEN
                        v_dentro_saida := true;
                    END IF;

                    IF v_ignora_janela OR (v_target_exit <= 1440 AND v_dentro_saida) THEN
                        v_matched_block_idx := idx;
                        v_matched_action := 'checkout_no_checkin';
                        v_matched_ids := v_b_ids;
                        v_matched_start := v_b_inicio;
                        v_matched_fim := v_target_exit;
                        v_matched_cat := v_b_cat;
                    END IF;
                END;
                
                -- Track closest check-in
                DECLARE
                    v_target_start INTEGER := v_b_inicio;
                BEGIN
                    IF v_pf_existe AND v_pf_fim_minutos IS NOT NULL AND v_b_inicio < v_pf_fim_minutos THEN
                        v_target_start := v_pf_fim_minutos;
                    END IF;
                    IF abs(v_momento_atual_minutos - v_target_start) < v_closest_diff THEN
                        v_closest_diff := abs(v_momento_atual_minutos - v_target_start);
                        v_closest_start := v_target_start;
                        v_closest_fim := v_b_fim;
                        v_closest_action := 'checkin';
                    END IF;
                END;
            END IF;
            
            -- Check exit window (if first shift has entry, but the last shift has no exit)
            IF v_b_entradas[1] IS NOT NULL AND v_b_saidas[v_b_total_count] IS NULL THEN
                DECLARE
                    v_dentro_saida BOOLEAN := false;
                    v_target_exit INTEGER := v_b_fim;
                BEGIN
                    IF v_pf_existe AND v_pf_inicio_minutos IS NOT NULL AND v_b_inicio < v_pf_inicio_minutos THEN
                        v_target_exit := v_pf_inicio_minutos;
                    END IF;

                    IF (v_momento_atual_minutos >= (v_target_exit - v_janela_minutos) AND 
                        v_momento_atual_minutos <= (v_target_exit + v_janela_minutos)) OR
                       (v_pf_existe AND v_pf_inicio_minutos IS NOT NULL AND v_momento_atual_minutos >= v_target_exit) THEN
                        v_dentro_saida := true;
                    END IF;

                    IF v_ignora_janela OR v_dentro_saida THEN
                        v_matched_block_idx := idx;
                        v_matched_action := 'checkout';
                        v_matched_ids := v_b_ids;
                        v_matched_start := v_b_inicio;
                        v_matched_fim := v_target_exit;
                        v_matched_cat := v_b_cat;
                        EXIT;
                    END IF;
                END;
                
                -- Track closest check-out
                DECLARE
                    v_target_exit INTEGER := v_b_fim;
                BEGIN
                    IF v_pf_existe AND v_pf_inicio_minutos IS NOT NULL AND v_b_inicio < v_pf_inicio_minutos THEN
                        v_target_exit := v_pf_inicio_minutos;
                    END IF;
                    IF abs(v_momento_atual_minutos - v_target_exit) < v_closest_diff THEN
                        v_closest_diff := abs(v_momento_atual_minutos - v_target_exit);
                        v_closest_start := v_b_inicio;
                        v_closest_fim := v_target_exit;
                        v_closest_action := 'checkout';
                    END IF;
                END;
            END IF;
        END LOOP;

        IF v_matched_action IS NULL THEN
            IF v_total_shifts = 0 THEN
                PERFORM public.fn_log_tentativa_negada(
                    v_servidor_id, 
                    p_matricula, 
                    p_coordenador_id, 
                    'Nenhum plantão agendado para você hoje.', 
                    NULL, NULL, NULL, NULL, NULL, NULL, NULL
                );
                RETURN jsonb_build_object('success', false, 'message', 'Nenhum plantão agendado para você hoje.');
            ELSIF v_completed_shifts = v_total_shifts THEN
                DECLARE
                    v_closest_inicio_formatted TEXT := NULL;
                    v_closest_fim_formatted TEXT := NULL;
                    v_escala_detalhes JSONB := NULL;
                    v_escala_categoria TEXT := NULL;
                    v_unidade_nome TEXT := NULL;
                    v_setor_nome TEXT := NULL;
                    v_turno_codigo TEXT := NULL;
                BEGIN
                    v_closest_inicio_formatted := lpad((v_closest_start/60)::text, 2, '0') || ':' || lpad((v_closest_start%60)::text, 2, '0');
                    IF v_closest_fim > 1440 THEN
                        v_closest_fim_formatted := lpad((v_closest_fim/60 - 24)::text, 2, '0') || ':' || lpad((v_closest_fim%60)::text, 2, '0') || ' (Amanhã)';
                    ELSE
                        v_closest_fim_formatted := lpad((v_closest_fim/60)::text, 2, '0') || ':' || lpad((v_closest_fim%60)::text, 2, '0');
                    END IF;

                    -- Find scale details matching the closest shift
                    SELECT 
                        ed.categoria::text,
                        u.nome,
                        ds.nome,
                        dt.codigo,
                        jsonb_build_object(
                            'escala_diaria_id', ed.id,
                            'unidade', u.nome,
                            'setor', ds.nome,
                            'turno_codigo', dt.codigo,
                            'jornada_nome', j.nome,
                            'categoria', ed.categoria,
                            'entrada_registrada', ed.presenca_entrada_em,
                            'saida_registrada', ed.presenca_saida_em,
                            'dia', ed.dia
                        )
                    INTO v_escala_categoria, v_unidade_nome, v_setor_nome, v_turno_codigo, v_escala_detalhes
                    FROM public.escala_diaria ed
                    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
                    JOIN public.unidades u ON em.unidade_id = u.id
                    JOIN public.setores s ON em.setor_id = s.id
                    JOIN public.dicionario_setores ds ON s.dicionario_setor_id = ds.id
                    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
                    LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
                    WHERE em.servidor_id = v_servidor_id
                      AND em.mes = v_mes
                      AND em.ano = v_ano
                      AND ed.dia = v_dia_hoje
                      AND ed.categoria IN ('Regular', 'Plantão', 'Extra')
                      AND (
                          (v_closest_action = 'checkin' AND (COALESCE(
                              CASE WHEN ed.categoria = 'Regular' THEN substring(j.nome from '^([0-9]+)')::integer ELSE NULL END,
                              CASE WHEN ed.categoria = 'Plantão' THEN
                                  COALESCE(
                                      CASE 
                                        WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                                             (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                                        THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
                                        WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                                             (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                                        THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
                                        WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                                             (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                                        THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer
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
                              (
                                  SELECT COALESCE(
                                      (SELECT substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer FROM public.escala_diaria ed2 JOIN public.escala_mensal em2 ON ed2.escala_mensal_id = em2.id JOIN public.jornadas j2 ON j2.id = public.obter_jornada_servidor_data(em2.servidor_id, MAKE_DATE(em2.ano, em2.mes, ed2.dia), em2.jornada_id) WHERE em2.id = em.id AND ed2.dia = ed.dia AND ed2.categoria = 'Regular' LIMIT 1),
                                      (SELECT CASE WHEN dt2.slots[1] = 'M' THEN 13 WHEN dt2.slots[1] = 'T' THEN 19 WHEN dt2.slots[1] = 'N' THEN 31 WHEN dt2.slots[1] ~ '^[0-9]+$' THEN dt2.slots[1]::integer + dt2.horas_computadas::integer ELSE 19 END FROM public.escala_diaria ed2 JOIN public.dicionario_turnos dt2 ON ed2.dicionario_turnos_id = dt2.id WHERE ed2.escala_mensal_id = em.id AND ed2.dia = ed.dia AND ed2.categoria = 'Plantão' LIMIT 1)
                                  )
                              ),
                              7
                          ) * 60 = CASE WHEN v_pf_existe AND v_pf_fim_minutos IS NOT NULL THEN v_pf_fim_minutos ELSE v_closest_start END))
                          OR 
                          (v_closest_action = 'checkout')
                      )
                    LIMIT 1;

                    PERFORM public.fn_log_tentativa_negada(
                        v_servidor_id, 
                        p_matricula, 
                        p_coordenador_id, 
                        'Você já registrou sua entrada e saída hoje.', 
                        v_closest_inicio_formatted, v_closest_fim_formatted, v_escala_categoria, v_unidade_nome, v_setor_nome, v_turno_codigo, v_escala_detalhes
                    );
                END;
                RETURN jsonb_build_object('success', false, 'message', 'Você já registrou sua entrada e saída hoje.');
            ELSE
                DECLARE
                    v_closest_inicio_formatted TEXT := NULL;
                    v_closest_fim_formatted TEXT := NULL;
                    v_escala_detalhes JSONB := NULL;
                    v_escala_categoria TEXT := NULL;
                    v_unidade_nome TEXT := NULL;
                    v_setor_nome TEXT := NULL;
                    v_turno_codigo TEXT := NULL;
                BEGIN
                    v_closest_inicio_formatted := lpad((v_closest_start/60)::text, 2, '0') || ':' || lpad((v_closest_start%60)::text, 2, '0');
                    IF v_closest_fim > 1440 THEN
                        v_closest_fim_formatted := lpad((v_closest_fim/60 - 24)::text, 2, '0') || ':' || lpad((v_closest_fim%60)::text, 2, '0') || ' (Amanhã)';
                    ELSE
                        v_closest_fim_formatted := lpad((v_closest_fim/60)::text, 2, '0') || ':' || lpad((v_closest_fim%60)::text, 2, '0');
                    END IF;

                    -- Find scale details matching the closest shift
                    SELECT 
                        ed.categoria::text,
                        u.nome,
                        ds.nome,
                        dt.codigo,
                        jsonb_build_object(
                            'escala_diaria_id', ed.id,
                            'unidade', u.nome,
                            'setor', ds.nome,
                            'turno_codigo', dt.codigo,
                            'jornada_nome', j.nome,
                            'categoria', ed.categoria,
                            'entrada_registrada', ed.presenca_entrada_em,
                            'saida_registrada', ed.presenca_saida_em,
                            'dia', ed.dia
                        )
                    INTO v_escala_categoria, v_unidade_nome, v_setor_nome, v_turno_codigo, v_escala_detalhes
                    FROM public.escala_diaria ed
                    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
                    JOIN public.unidades u ON em.unidade_id = u.id
                    JOIN public.setores s ON em.setor_id = s.id
                    JOIN public.dicionario_setores ds ON s.dicionario_setor_id = ds.id
                    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
                    LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
                    WHERE em.servidor_id = v_servidor_id
                      AND em.mes = v_mes
                      AND em.ano = v_ano
                      AND ed.dia = v_dia_hoje
                      AND ed.categoria IN ('Regular', 'Plantão', 'Extra')
                      AND (
                          (v_closest_action = 'checkin' AND (COALESCE(
                              CASE WHEN ed.categoria = 'Regular' THEN substring(j.nome from '^([0-9]+)')::integer ELSE NULL END,
                              CASE WHEN ed.categoria = 'Plantão' THEN
                                  COALESCE(
                                      CASE 
                                        WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                                             (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                                        THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                                        WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                                             (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                                        THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                                        WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                                             (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                                        THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer
                                        
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
                              (
                                  SELECT COALESCE(
                                      (SELECT substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer FROM public.escala_diaria ed2 JOIN public.escala_mensal em2 ON ed2.escala_mensal_id = em2.id JOIN public.jornadas j2 ON j2.id = public.obter_jornada_servidor_data(em2.servidor_id, MAKE_DATE(em2.ano, em2.mes, ed2.dia), em2.jornada_id) WHERE em2.id = em.id AND ed2.dia = ed.dia AND ed2.categoria = 'Regular' LIMIT 1),
                                      (SELECT CASE WHEN dt2.slots[1] = 'M' THEN 13 WHEN dt2.slots[1] = 'T' THEN 19 WHEN dt2.slots[1] = 'N' THEN 31 WHEN dt2.slots[1] ~ '^[0-9]+$' THEN dt2.slots[1]::integer + dt2.horas_computadas::integer ELSE 19 END FROM public.escala_diaria ed2 JOIN public.dicionario_turnos dt2 ON ed2.dicionario_turnos_id = dt2.id WHERE ed2.escala_mensal_id = em.id AND ed2.dia = ed.dia AND ed2.categoria = 'Plantão' LIMIT 1)
                                  )
                              ),
                              7
                          ) * 60 = CASE WHEN v_pf_existe AND v_pf_fim_minutos IS NOT NULL THEN v_pf_fim_minutos ELSE v_closest_start END))
                          OR 
                          (v_closest_action = 'checkout')
                      )
                    LIMIT 1;

                    IF v_closest_action = 'checkin' THEN
                        PERFORM public.fn_log_tentativa_negada(
                            v_servidor_id, 
                            p_matricula, 
                            p_coordenador_id, 
                            'Fora da janela de ENTRADA. Seu plantão inicia às ' || v_closest_inicio_formatted || '.', 
                            v_closest_inicio_formatted, v_closest_fim_formatted, v_escala_categoria, v_unidade_nome, v_setor_nome, v_turno_codigo, v_escala_detalhes
                        );
                        RETURN jsonb_build_object('success', false, 'message', 'Fora da janela de ENTRADA. Seu plantão inicia às ' || v_closest_inicio_formatted || '.');
                    ELSE
                        IF v_closest_fim > 1440 THEN
                            PERFORM public.fn_log_tentativa_negada(
                                v_servidor_id, 
                                p_matricula, 
                                p_coordenador_id, 
                                'Sua saída está prevista para amanhã às ' || v_closest_fim_formatted || '.', 
                                v_closest_inicio_formatted, v_closest_fim_formatted, v_escala_categoria, v_unidade_nome, v_setor_nome, v_turno_codigo, v_escala_detalhes
                            );
                            RETURN jsonb_build_object('success', false, 'message', 'Sua saída está prevista para amanhã às ' || v_closest_fim_formatted || '.');
                        ELSE
                            PERFORM public.fn_log_tentativa_negada(
                                v_servidor_id, 
                                p_matricula, 
                                p_coordenador_id, 
                                'Fora da janela de SAÍDA. Seu plantão encerra às ' || v_closest_fim_formatted || '.', 
                                v_closest_inicio_formatted, v_closest_fim_formatted, v_escala_categoria, v_unidade_nome, v_setor_nome, v_turno_codigo, v_escala_detalhes
                            );
                            RETURN jsonb_build_object('success', false, 'message', 'Fora da janela de SAÍDA. Seu plantão encerra às ' || v_closest_fim_formatted || '.');
                        END IF;
                    END IF;
                END;
            END IF;
        END IF;

        -- Process the matched action
        IF v_matched_action = 'checkin' THEN
            SELECT escala_mensal_id INTO v_escala_mensal_id FROM public.escala_diaria WHERE id = v_matched_ids[1];
            SELECT unidade_id INTO v_unidade_id FROM public.escala_mensal WHERE id = v_escala_mensal_id;

            UPDATE public.escala_diaria 
            SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id 
            WHERE id = ANY(v_matched_ids);
            
            INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria)
            VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (ENTRADA) via terminal.', 'Manual', v_matched_cat);
            
            RETURN jsonb_build_object('success', true, 'message', 'Entrada confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom plantão!');
            
        ELSIF v_matched_action = 'checkout_no_checkin' THEN
            SELECT escala_mensal_id INTO v_escala_mensal_id FROM public.escala_diaria WHERE id = v_matched_ids[1];
            SELECT unidade_id INTO v_unidade_id FROM public.escala_mensal WHERE id = v_escala_mensal_id;

            PERFORM public.fn_salvar_saida_bloco(v_matched_ids, v_now, p_coordenador_id, v_timezone, true);
            
            INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria)
            VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA SEM ENTRADA) via terminal.', 'Manual', v_matched_cat);
            
            RETURN jsonb_build_object('success', true, 'message', 'Saída confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Atenção: Sua ENTRADA não foi registrada e precisará de validação manual do administrador.');
            
        ELSIF v_matched_action = 'checkout' THEN
            SELECT escala_mensal_id INTO v_escala_mensal_id FROM public.escala_diaria WHERE id = v_matched_ids[1];
            SELECT unidade_id INTO v_unidade_id FROM public.escala_mensal WHERE id = v_escala_mensal_id;

            PERFORM public.fn_salvar_saida_bloco(v_matched_ids, v_now, p_coordenador_id, v_timezone, false);
            
            INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria)
            VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA) via terminal.', 'Manual', v_matched_cat);
            
            RETURN jsonb_build_object('success', true, 'message', 'Saída confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!');
        END IF;
    END;

EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_log_tentativa_negada(
        v_servidor_id, 
        p_matricula, 
        p_coordenador_id, 
        'Erro interno: ' || SQLERRM, 
        NULL, NULL, NULL, NULL, NULL, NULL, NULL
    );
    RETURN jsonb_build_object('success', false, 'message', 'Erro interno: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 1. Backfill existing NULL unit_nome and/or sector_nome in logs_tentativas_presenca for known servers
UPDATE public.logs_tentativas_presenca l
SET 
    unidade_nome = COALESCE(l.unidade_nome, u.nome),
    setor_nome = COALESCE(l.setor_nome, ds.nome)
FROM public.servidores s
LEFT JOIN public.unidades u ON s.unidade_id = u.id
LEFT JOIN public.setores setr ON s.setor_id = setr.id
LEFT JOIN public.dicionario_setores ds ON setr.dicionario_setor_id = ds.id
WHERE l.servidor_id = s.id
  AND (l.unidade_nome IS NULL OR l.setor_nome IS NULL);

-- 2. Backfill completed scale details for historical logs that had "Você já registrou sua entrada e saída hoje." but NULL scale details
WITH scale_details AS (
    SELECT 
        ed.id as escala_diaria_id,
        em.servidor_id,
        (ed.dia) as dia,
        em.mes,
        em.ano,
        (ed.dia::text || '-' || em.mes::text || '-' || em.ano::text) as scale_date_key,
        ed.categoria::text as escala_categoria,
        dt.codigo as turno_codigo,
        u.nome as unidade_nome,
        ds.nome as setor_nome,
        -- Get start and end hours formatted
        CASE 
            WHEN ed.categoria = 'Regular' THEN substring(j.nome from '^([0-9]+)')::integer
            WHEN ed.categoria = 'Plantão' THEN
                CASE 
                    WHEN dt.codigo = 'T4' THEN 14
                    WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                    WHEN dt.slots[1] = 'M' THEN 7
                    WHEN dt.slots[1] = 'T' THEN 13
                    WHEN dt.slots[1] = 'N' THEN 19
                    ELSE 7
                END
            ELSE 7
        END as start_hour,
        CASE 
            WHEN ed.categoria = 'Regular' THEN 
                COALESCE(
                    substring(j.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer,
                    (substring(j.nome from '^([0-9]+)')::integer + COALESCE(j.horas_totais, 8))
                )
            WHEN ed.categoria = 'Plantão' THEN
                CASE 
                    WHEN dt.codigo = 'T4' THEN 14 + dt.horas_computadas::integer
                    WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer + dt.horas_computadas::integer
                    WHEN dt.slots[1] = 'M' THEN 7 + dt.horas_computadas::integer
                    WHEN dt.slots[1] = 'T' THEN 13 + dt.horas_computadas::integer
                    WHEN dt.slots[1] = 'N' THEN 19 + dt.horas_computadas::integer
                    ELSE 7 + dt.horas_computadas::integer
                END
            ELSE 7 + dt.horas_computadas::integer
        END as end_hour,
        j.nome as jornada_nome,
        ed.presenca_entrada_em,
        ed.presenca_saida_em
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.unidades u ON em.unidade_id = u.id
    JOIN public.setores s ON em.setor_id = s.id
    JOIN public.dicionario_setores ds ON s.dicionario_setor_id = ds.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
    WHERE ed.categoria IN ('Regular', 'Plantão', 'Extra')
),
formatted_details AS (
    SELECT 
        escala_diaria_id,
        servidor_id,
        dia,
        mes,
        ano,
        escala_categoria,
        turno_codigo,
        unidade_nome,
        setor_nome,
        lpad(start_hour::text, 2, '0') || ':00' as start_time_str,
        CASE 
            WHEN end_hour > 24 THEN lpad((end_hour - 24)::text, 2, '0') || ':00 (Amanhã)'
            ELSE lpad(end_hour::text, 2, '0') || ':00'
        END as end_time_str,
        jsonb_build_object(
            'escala_diaria_id', escala_diaria_id,
            'unidade', unidade_nome,
            'setor', setor_nome,
            'turno_codigo', turno_codigo,
            'jornada_nome', jornada_nome,
            'categoria', escala_categoria,
            'entrada_registrada', presenca_entrada_em,
            'saida_registrada', presenca_saida_em,
            'dia', dia
        ) as escala_detalhes
    FROM scale_details
)
UPDATE public.logs_tentativas_presenca l
SET 
    escala_prevista_inicio = fd.start_time_str,
    escala_prevista_fim = fd.end_time_str,
    escala_categoria = fd.escala_categoria,
    turno_codigo = fd.turno_codigo,
    detalhes_escala = fd.escala_detalhes,
    unidade_nome = COALESCE(l.unidade_nome, fd.unidade_nome),
    setor_nome = COALESCE(l.setor_nome, fd.setor_nome)
FROM formatted_details fd
WHERE l.servidor_id = fd.servidor_id
  AND extract(day from l.data_hora_tentativa AT TIME ZONE 'America/Sao_Paulo')::integer = fd.dia
  AND extract(month from l.data_hora_tentativa AT TIME ZONE 'America/Sao_Paulo')::integer = fd.mes
  AND extract(year from l.data_hora_tentativa AT TIME ZONE 'America/Sao_Paulo')::integer = fd.ano
  AND l.mensagem_erro = 'Você já registrou sua entrada e saída hoje.'
  AND l.escala_prevista_inicio IS NULL;

