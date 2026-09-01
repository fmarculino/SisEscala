-- Migration: Horario informado na validacao manual entende turno que atravessa a meia-noite
-- Data: 2026-09-01
-- Gerada por scratchpad/gen_meia_noite_informada.js a partir de
--   20260808110000_validacao_manual_com_horario_informado.sql (assinatura, guards e os quatro
--   UPDATE sao copia byte a byte; so a resolucao do timestamp de cada passo e nova).
--
-- O QUE ESTAVA ERRADO
--   A versao de 08/08/2026 deslocava um dia SO a saida, e so quando a entrada vinha no MESMO
--   payload:
--
--       IF v_passo = 'saida' AND (p_horarios->>'entrada') IS NOT NULL
--          AND v_hhmm < (p_horarios->>'entrada') THEN v_ts := v_ts + interval '1 day';
--
--   Dois furos, os dois silenciosos:
--
--   1) VALIDAR SO O 2o PERIODO de um plantao noturno nao manda a entrada. Retorno 23:00 e saida
--      07:00 eram gravados no MESMO dia civil - a saida 16 horas ANTES do retorno, e a folha
--      passa a ler negativo. A entrada correta ja estava gravada na propria escala_diaria; era
--      so ninguem estar olhando para ela.
--   2) OS PASSOS DE INTERVALO nunca eram deslocados. Plantao 19:00-07:00 com intervalo
--      00:30/01:30 gravava os dois no dia D, ou seja ANTES da entrada das 19:00.
--
-- A REGRA NOVA (a mesma de src/utils/sequenciaPresenca.ts, que valida na tela)
--   Os quatro passos formam UMA sequencia estritamente crescente. O passo cujo HH:MM cai antes
--   da referencia anterior pertence ao dia seguinte. A referencia inicial e o horario JA GRAVADO
--   na linha - por isso validar so o 2o periodo passa a acertar o dia.
--
--   ⚠️ O TETO DE 24H NAO E DECORACAO. Sem ele, "entrada 19:00 / saida 18:00" (um 7 que virou 8)
--   viraria jornada de 23h em vez de ser recusada. Bloco de trabalho nao passa de 24h; MTN bate
--   exatamente nas 24h e e o maior do dicionario.
--
--   ⚠️ A RESOLUCAO INTEIRA ACONTECE ANTES DA PRIMEIRA ESCRITA. A versao anterior validava o
--   formato HH:MM dentro do mesmo laco que gravava e dava RETURN no meio: com "entrada":"08:00"
--   e "saida":"8h", a entrada ja tinha sido gravada quando a saida era recusada. Meia validacao
--   e pior que nenhuma - e a mesma razao pela qual fn_validar_presenca_manual aborta por RAISE.
--
--   ⚠️ ESTA FUNCAO E CHAMAVEL DIRETO (fn_validar_presenca_manual delega a ela, e a RPC e
--   GRANTeada a authenticated). A checagem da tela nao a protege - CLAUDE.md armadilha 12.

CREATE OR REPLACE FUNCTION public.fn_registrar_presenca_informada(
    p_escala_diaria_id uuid,
    p_horarios         jsonb,     -- {"entrada":"08:03","intervalo_saida":"12:00",...} hora local
    p_validador_id     uuid,
    p_justificativa    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_timezone    text;
    v_mes         integer;
    v_ano         integer;
    v_dia         integer;
    v_data        date;
    v_servidor_id uuid;
    v_unidade_id  uuid;
    v_setor_id    uuid;
    v_categoria   text;
    v_passo       text;
    v_hhmm        text;
    v_ts          timestamptz;
    v_gravados    text[] := '{}';
    -- Novas: a resolucao dos quatro passos antes de qualquer escrita.
    v_passos      text[] := ARRAY['entrada', 'intervalo_saida', 'intervalo_retorno', 'saida'];
    v_i           integer;
    v_ja          timestamptz[];   -- o que ja esta gravado na linha, na ordem de v_passos
    v_resolvido   timestamptz[] := ARRAY[NULL, NULL, NULL, NULL]::timestamptz[];
    v_ref         timestamptz;     -- ultimo instante conhecido da sequencia
    v_ancora      timestamptz;     -- primeiro instante conhecido, para o teto de 24h
    v_ent_ja      timestamptz;
    v_isai_ja     timestamptz;
    v_iret_ja     timestamptz;
    v_sai_ja      timestamptz;
BEGIN
    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Justificativa é obrigatória.');
    END IF;

    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    SELECT ed.dia, ed.categoria::text, em.mes, em.ano, em.servidor_id, em.unidade_id, em.setor_id
      INTO v_dia, v_categoria, v_mes, v_ano, v_servidor_id, v_unidade_id, v_setor_id
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.id = p_escala_diaria_id;

    IF v_dia IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Linha de escala não encontrada.');
    END IF;

    -- Sobreaviso nao marca presenca: ciclo proprio em logs_sobreaviso, e a constraint
    -- chk_sobreaviso_sem_presenca rejeitaria a escrita de qualquer forma.
    IF v_categoria = 'Sobreaviso' THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Sobreaviso não registra presença. Use o fluxo de sobreaviso.');
    END IF;

    v_data := make_date(v_ano, v_mes, v_dia);

    IF public.fn_competencia_encerrada(v_mes, v_ano) THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Competência ' || lpad(v_mes::text, 2, '0') || '/' || v_ano ||
                       ' está encerrada. Reabra antes de alterar.');
    END IF;

    -- O trigger de sincronizacao criaria uma marcacao a partir de cada escrita abaixo, com
    -- sintetica derivada dos segundos zerados - o que rotularia errado um horario informado.
    -- As marcacoes sao criadas explicitamente mais adiante, com o rotulo correto.
    PERFORM set_config('sisescala.reconciliacao', 'on', true);

    -- ------------------------------------------------------------------
    -- FASE 1: resolver os quatro timestamps. NADA e gravado aqui.
    -- ------------------------------------------------------------------
    SELECT presenca_entrada_em, presenca_intervalo_saida_em,
           presenca_intervalo_retorno_em, presenca_saida_em
      INTO v_ent_ja, v_isai_ja, v_iret_ja, v_sai_ja
      FROM public.escala_diaria
     WHERE id = p_escala_diaria_id;

    v_ja := ARRAY[v_ent_ja, v_isai_ja, v_iret_ja, v_sai_ja];

    FOR v_i IN 1..4 LOOP
        v_passo := v_passos[v_i];

        -- Horario ja gravado neste passo manda na referencia: os UPDATE abaixo usam COALESCE e
        -- nao o sobrescrevem, entao e ele que o passo seguinte tem de suceder.
        IF v_ja[v_i] IS NOT NULL THEN
            IF v_ancora IS NULL THEN v_ancora := v_ja[v_i]; END IF;
            v_ref := v_ja[v_i];
        END IF;

        v_hhmm := NULLIF(btrim(COALESCE(p_horarios->>v_passo, '')), '');
        CONTINUE WHEN v_hhmm IS NULL;

        IF v_hhmm !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
            RETURN jsonb_build_object('success', false,
                'message', 'Horário inválido para ' || v_passo || ': "' || v_hhmm || '". Use HH:MM.');
        END IF;

        v_ts := (v_data::text || ' ' || v_hhmm || ':00')::timestamp AT TIME ZONE v_timezone;

        -- Passo anterior ao ultimo conhecido = turno que atravessou a meia-noite. Vale para os
        -- QUATRO passos: plantao 19:00-07:00 com intervalo 00:30/01:30 tem TRES passos no dia
        -- seguinte, nao so a saida.
        IF v_ref IS NOT NULL AND v_ts <= v_ref THEN
            v_ts := v_ts + interval '1 day';
        END IF;

        -- Um dia entra UMA vez. Se ainda nao passou do anterior, a sequencia e impossivel.
        IF v_ref IS NOT NULL AND v_ts <= v_ref THEN
            RETURN jsonb_build_object('success', false,
                'message', 'Horários fora de ordem: ' || v_passo || ' (' || v_hhmm ||
                           ') não pode ser anterior ou igual ao passo anterior.');
        END IF;

        IF v_ancora IS NULL THEN v_ancora := v_ts; END IF;

        IF v_ts > v_ancora + interval '24 hours' THEN
            RETURN jsonb_build_object('success', false,
                'message', 'Com ' || v_passo || ' em ' || v_hhmm ||
                           ', o período passaria de 24 horas. Confira os horários informados.');
        END IF;

        v_resolvido[v_i] := v_ts;
        v_ref := COALESCE(v_ja[v_i], v_ts);
    END LOOP;

    IF v_resolvido[1] IS NULL AND v_resolvido[2] IS NULL
       AND v_resolvido[3] IS NULL AND v_resolvido[4] IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Informe ao menos um horário.');
    END IF;

    -- ------------------------------------------------------------------
    -- FASE 2: gravar. Daqui para baixo e copia da versao de 20260808110000.
    -- ------------------------------------------------------------------
    FOR v_i IN 1..4 LOOP
        CONTINUE WHEN v_resolvido[v_i] IS NULL;
        v_passo := v_passos[v_i];
        v_ts    := v_resolvido[v_i];

        -- COALESCE em todos: horario ja registrado NUNCA e sobrescrito.
        IF v_passo = 'entrada' THEN
            UPDATE public.escala_diaria
               SET presenca_entrada_em = COALESCE(presenca_entrada_em, v_ts),
                   presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
                   presenca_entrada_origem = COALESCE(presenca_entrada_origem, 'ajuste_coordenador'::public.marcacao_origem),
                   presenca_confirmada = true, confirmado_por_id = p_validador_id,
                   justificativa_manual = p_justificativa, confirmacao_manual = true
             WHERE id = p_escala_diaria_id;
        ELSIF v_passo = 'intervalo_saida' THEN
            UPDATE public.escala_diaria
               SET presenca_intervalo_saida_em = COALESCE(presenca_intervalo_saida_em, v_ts),
                   presenca_intervalo_saida_manual = CASE WHEN presenca_intervalo_saida_em IS NULL THEN true ELSE presenca_intervalo_saida_manual END,
                   presenca_intervalo_saida_origem = COALESCE(presenca_intervalo_saida_origem, 'ajuste_coordenador'::public.marcacao_origem),
                   confirmado_por_id = p_validador_id,
                   justificativa_manual = p_justificativa, confirmacao_manual = true
             WHERE id = p_escala_diaria_id;
        ELSIF v_passo = 'intervalo_retorno' THEN
            UPDATE public.escala_diaria
               SET presenca_intervalo_retorno_em = COALESCE(presenca_intervalo_retorno_em, v_ts),
                   presenca_intervalo_retorno_manual = CASE WHEN presenca_intervalo_retorno_em IS NULL THEN true ELSE presenca_intervalo_retorno_manual END,
                   presenca_intervalo_retorno_origem = COALESCE(presenca_intervalo_retorno_origem, 'ajuste_coordenador'::public.marcacao_origem),
                   presenca_confirmada = true, confirmado_por_id = p_validador_id,
                   justificativa_manual = p_justificativa, confirmacao_manual = true
             WHERE id = p_escala_diaria_id;
        ELSE
            UPDATE public.escala_diaria
               SET presenca_saida_em = COALESCE(presenca_saida_em, v_ts),
                   presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
                   presenca_saida_origem = COALESCE(presenca_saida_origem, 'ajuste_coordenador'::public.marcacao_origem),
                   presenca_confirmada = true, confirmado_por_id = p_validador_id,
                   justificativa_manual = p_justificativa, confirmacao_manual = true
             WHERE id = p_escala_diaria_id;
        END IF;

        -- sintetica = FALSE de proposito: este horario nao foi derivado da jornada, foi
        -- INFORMADO pelo servidor. E a diferenca entre tratar a omissao e fabrica-la.
        -- A origem 'ajuste_coordenador' ja registra que nao houve batida.
        PERFORM public.fn_registrar_marcacao(
            v_servidor_id, 'ajuste_coordenador'::public.marcacao_origem, v_ts,
            v_unidade_id, v_setor_id,
            NULL, p_validador_id, p_justificativa,
            false, false, NULL, NULL, NULL, NULL, false,
            'Horario informado pelo servidor, passo ' || v_passo ||
            ', escala_diaria ' || p_escala_diaria_id::text);

        v_gravados := v_gravados || v_passo;
    END LOOP;

    IF array_length(v_gravados, 1) IS NULL THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Informe ao menos um horário.');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'passos', v_gravados,
        'message', 'Presença registrada com os horários informados (' ||
                   array_to_string(v_gravados, ', ') || ').');
END;
$fn$;

COMMENT ON FUNCTION public.fn_registrar_presenca_informada(uuid, jsonb, uuid, text) IS
    'Validacao manual com o horario INFORMADO pelo servidor, em vez do derivado da jornada. '
    'Nunca sobrescreve horario ja gravado. A marcacao correspondente nasce com sintetica = false, '
    'porque o horario nao foi derivado - foi declarado. Os quatro passos sao resolvidos como UMA '
    'sequencia crescente antes de qualquer escrita, entao turno que atravessa a meia-noite grava '
    'no dia certo (ver src/utils/sequenciaPresenca.ts, a mesma regra na tela).';


-- ============================================================================
-- PRIVILEGIOS
-- ============================================================================
-- Mesma assinatura => o CREATE OR REPLACE preserva os GRANT existentes. Reafirmar e conferir
-- assim mesmo: e barato, e a armadilha 24 (o REVOKE precisa ser de PUBLIC, e REVOKE de quem nao
-- e dono so emite WARNING) ja custou uma migration que "aplicou com sucesso" sem mudar nada.

DO $priv$
DECLARE
    r record;
    v_pendentes text := '';
BEGIN
    FOR r IN
        SELECT p.oid, p.oid::regprocedure AS assinatura
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'fn_registrar_presenca_informada'
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.assinatura);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.assinatura);
    END LOOP;

    FOR r IN
        SELECT p.oid::regprocedure::text AS assinatura,
               pg_get_userbyid(p.proowner) AS dono,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'fn_registrar_presenca_informada'
    LOOP
        -- Os DOIS sentidos: anon nao pode entrar, e authenticated nao pode ter sido revogado
        -- junto (seria a grade do coordenador parando de validar presenca).
        IF r.anon_executa OR NOT r.auth_executa THEN
            v_pendentes := v_pendentes || format(
                E'\n  - %s (dono: %s) — anon=%s, authenticated=%s',
                r.assinatura, r.dono, r.anon_executa, r.auth_executa);
        END IF;
    END LOOP;

    IF v_pendentes <> '' THEN
        RAISE EXCEPTION E'Privilegios divergentes em banco=% como usuario=%:%',
            current_database(), current_user, v_pendentes;
    END IF;
END;
$priv$;


-- ============================================================================
-- CONFERENCIA APOS APLICAR (nao roda sozinha; execute contra uma linha de teste)
-- ============================================================================
--
--   1) Plantao noturno, dia completo. A saida tem de sair em D+1:
--
--   SELECT public.fn_registrar_presenca_informada(
--       '<escala_diaria_id de um turno N>',
--       '{"entrada":"19:00","intervalo_saida":"22:00","intervalo_retorno":"23:00","saida":"07:00"}'::jsonb,
--       '<validador_id>', 'teste');
--
--   SELECT dia, presenca_entrada_em, presenca_intervalo_saida_em,
--          presenca_intervalo_retorno_em, presenca_saida_em
--     FROM public.escala_diaria WHERE id = '<escala_diaria_id>';
--   -- esperado: saida no dia seguinte, e a sequencia crescente nos quatro campos.
--
--   2) So o 2o periodo, com a entrada JA gravada (era o furo silencioso):
--
--   SELECT public.fn_registrar_presenca_informada(
--       '<escala_diaria_id>', '{"intervalo_retorno":"23:00","saida":"07:00"}'::jsonb,
--       '<validador_id>', 'teste');
--   -- esperado: saida em D+1, depois do retorno.
--
--   3) Fora de ordem num turno diurno continua sendo recusado, e NADA e gravado:
--
--   SELECT public.fn_registrar_presenca_informada(
--       '<escala_diaria_id de um turno M>', '{"entrada":"08:00","saida":"8h"}'::jsonb,
--       '<validador_id>', 'teste');
--   -- esperado: success=false por formato, e presenca_entrada_em CONTINUA nula.
--
--   4) Quantos dias tem saida gravada ANTES da entrada (o estrago anterior):
--
--   SELECT ed.id, em.servidor_id, ed.dia, ed.presenca_entrada_em, ed.presenca_saida_em
--     FROM public.escala_diaria ed
--     JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--    WHERE ed.presenca_saida_em IS NOT NULL
--      AND ed.presenca_entrada_em IS NOT NULL
--      AND ed.presenca_saida_em <= ed.presenca_entrada_em
--    ORDER BY em.ano DESC, em.mes DESC, ed.dia;
