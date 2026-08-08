-- Migration: Solicitacao de ajuste de ponto nao pode ser para dia futuro
-- Data: 2026-08-08
--
-- SINTOMA
--   fn_solicitar_ajuste_ponto (20260808130000) aceitava solicitacao para qualquer dia da
--   escala, inclusive dias que ainda nao ocorreram. No portal, o botao "informar horario"
--   aparecia em toda celula vazia do mes corrente, dias futuros inclusos - visto pelo usuario
--   em producao (captura de tela com os dias 10 a 19 de um mes cujo dia atual e 08).
--
-- POR QUE ISSO NAO FAZ SENTIDO
--   A solicitacao existe para justificar uma ocorrencia que fugiu do esperado - esquecimento
--   de bater o ponto, falha do terminal, etc. Nao existe "esqueci de bater o ponto" de um dia
--   que ainda nao aconteceu. Permitir isso abriria a porta para pre-registrar jornada futura,
--   que e o oposto do proposito da funcao e uma variante da vedacao 2 da Portaria 671/2021
--   (marcacao antecipada/automatica em vez de registro do que de fato ocorreu).
--
-- CORRECAO
--   Mesmo guard ja usado em fn_confirmar_presenca_manual (20260807050000): recusa quando
--   MAKE_DATE(ano, mes, dia) > CURRENT_DATE. Aplicado no banco porque a acao do portal e
--   chamavel diretamente - o bloqueio do botao na interface (FolhaPontoEditor.tsx) e so a
--   primeira camada, nao a unica.
--
-- IDEMPOTENTE
--   CREATE OR REPLACE de uma funcao que so foi criada nesta mesma sessao de correcoes
--   (20260808130000), sem outra migration dependente.

CREATE OR REPLACE FUNCTION public.fn_solicitar_ajuste_ponto(
    p_servidor_id      uuid,
    p_escala_diaria_id uuid,
    p_horarios         jsonb,
    p_justificativa    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_timezone   text;
    v_mes        integer;
    v_ano        integer;
    v_dia        integer;
    v_data       date;
    v_categoria  text;
    v_dono       uuid;
    v_unidade_id uuid;
    v_setor_id   uuid;
    v_ed         public.escala_diaria%ROWTYPE;
    v_passo      text;
    v_hhmm       text;
    v_ts         timestamptz;
    v_ja         timestamptz;
    v_criadas    text[] := '{}';
BEGIN
    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Explique o motivo da solicitação.');
    END IF;

    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    SELECT ed.* INTO v_ed
      FROM public.escala_diaria ed
     WHERE ed.id = p_escala_diaria_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Dia não encontrado na escala.');
    END IF;

    SELECT em.servidor_id, em.mes, em.ano, em.unidade_id, em.setor_id
      INTO v_dono, v_mes, v_ano, v_unidade_id, v_setor_id
      FROM public.escala_mensal em
     WHERE em.id = v_ed.escala_mensal_id;

    IF v_dono IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Escala mensal não encontrada.');
    END IF;

    IF v_dono <> p_servidor_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Este dia não pertence a você.');
    END IF;

    v_dia       := v_ed.dia;
    v_categoria := v_ed.categoria::text;
    v_data      := make_date(v_ano, v_mes, v_dia);

    -- NOVO: dia futuro nao tem o que justificar. Mesmo criterio de
    -- fn_confirmar_presenca_manual, aplicado do lado do servidor tambem.
    IF v_data > CURRENT_DATE THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Não é possível solicitar ajuste para um dia que ainda não ocorreu.');
    END IF;

    IF v_categoria = 'Sobreaviso' THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Sobreaviso tem fluxo próprio e não registra presença.');
    END IF;

    IF public.fn_competencia_encerrada(v_mes, v_ano) THEN
        RETURN jsonb_build_object('success', false,
            'message', 'A competência ' || lpad(v_mes::text, 2, '0') || '/' || v_ano ||
                       ' já foi encerrada. Procure seu coordenador.');
    END IF;

    FOREACH v_passo IN ARRAY ARRAY['entrada', 'intervalo_saida', 'intervalo_retorno', 'saida']
    LOOP
        v_hhmm := NULLIF(btrim(COALESCE(p_horarios->>v_passo, '')), '');
        CONTINUE WHEN v_hhmm IS NULL;

        IF v_hhmm !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
            RETURN jsonb_build_object('success', false,
                'message', 'Horário inválido: "' || v_hhmm || '". Use o formato HH:MM.');
        END IF;

        v_ja := CASE v_passo
                    WHEN 'entrada'           THEN v_ed.presenca_entrada_em
                    WHEN 'intervalo_saida'   THEN v_ed.presenca_intervalo_saida_em
                    WHEN 'intervalo_retorno' THEN v_ed.presenca_intervalo_retorno_em
                    ELSE v_ed.presenca_saida_em
                END;

        IF v_ja IS NOT NULL THEN
            RETURN jsonb_build_object('success', false,
                'message', 'Já existe registro de ' || v_passo || ' neste dia (' ||
                           to_char(v_ja AT TIME ZONE v_timezone, 'HH24:MI') ||
                           '). Para contestar, procure seu coordenador.');
        END IF;

        v_ts := (v_data::text || ' ' || v_hhmm || ':00')::timestamp AT TIME ZONE v_timezone;

        IF v_passo = 'saida'
           AND (p_horarios->>'entrada') IS NOT NULL
           AND v_hhmm < (p_horarios->>'entrada') THEN
            v_ts := v_ts + interval '1 day';
        END IF;

        -- Um turno noturno pode fazer a SAIDA cair amanha (ex.: entrada 22:00, saida 06:00).
        -- Mesmo com o dia base ja tendo ocorrido, o instante resultante pode estar no futuro
        -- se o servidor esta solicitando ainda no mesmo dia em que entrou, antes de a saida
        -- ter de fato acontecido. Sem este guard, "entrada hoje as 22h + saida amanha as 6h"
        -- solicitado hoje as 23h criaria um registro de saida que ainda vai ocorrer.
        IF v_ts > now() THEN
            RETURN jsonb_build_object('success', false,
                'message', 'O horário de ' || v_passo || ' informado ainda não ocorreu.');
        END IF;

        PERFORM public.fn_registrar_marcacao(
            p_servidor_id, 'ajuste_servidor'::public.marcacao_origem, v_ts,
            v_unidade_id, v_setor_id,
            NULL, NULL, p_justificativa,
            false, false, NULL, NULL, NULL, NULL, false,
            'Ajuste solicitado pelo servidor, passo ' || v_passo ||
            ', pendente de revisao, escala_diaria ' || p_escala_diaria_id::text);

        v_criadas := v_criadas || v_passo;
    END LOOP;

    IF array_length(v_criadas, 1) IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Informe ao menos um horário.');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'passos',  v_criadas,
        'message', 'Solicitação enviada ao seu coordenador (' ||
                   array_to_string(v_criadas, ', ') || '). Você será avisado da decisão.');
END;
$fn$;

COMMENT ON FUNCTION public.fn_solicitar_ajuste_ponto(uuid, uuid, jsonb, text) IS
    'Servidor solicita ajuste de ponto informando o horario de um dia JA OCORRIDO. Nao escreve '
    'em escala_diaria: cria marcacao de origem ajuste_servidor (precedencia 4) pendente de '
    'revisao do coordenador. Recusa dia futuro e horario que ainda nao ocorreu.';


-- CONFERENCIA APOS APLICAR
--
--   1) Dia futuro tem de ser recusado (ajuste o dia conforme o mes corrente):
--
--   SELECT public.fn_solicitar_ajuste_ponto('<servidor_id>', '<escala_diaria_futura_id>',
--          '{"entrada":"08:00"}'::jsonb, 'teste');
--   -- esperado: success = false, dia ainda nao ocorreu.
--
--   2) Dia de hoje ou anterior continua funcionando normalmente (ver conferencia de
--      20260808130000, item 1).
--
--   3) Turno noturno em andamento: solicitar a saida antes de ela ter ocorrido tem de ser
--      recusado mesmo que o DIA da entrada ja tenha passado:
--
--   SELECT public.fn_solicitar_ajuste_ponto('<servidor_id>', '<escala_diaria_noturna_id>',
--          '{"entrada":"22:00","saida":"06:00"}'::jsonb, 'teste');
--   -- se "hoje as 06:00 de amanha" ainda nao ocorreu, esperado: success = false na saida.
