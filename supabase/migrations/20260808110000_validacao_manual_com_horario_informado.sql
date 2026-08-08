-- Migration: Validacao manual passa a aceitar o horario informado pelo servidor
-- Data: 2026-08-08
--
-- MOTIVACAO
--   fn_confirmar_presenca_manual grava horarios SINTETICOS derivados da jornada: entrada no
--   inicio previsto, saida no fim previsto, intervalo em inicio+4h. Medido em producao nas
--   competencias fechadas, isso responde por 24% a 29% das entradas e saidas da folha - quatro
--   a cinco vezes mais que o horario gerado automaticamente, que ja foi restringido.
--
--   E a "marcacao automatica do ponto usando horarios predeterminados ou contratuais" vedada
--   pela Portaria 671/2021. Retirar a geracao automatica da folha sem tratar este caminho so
--   mudaria a fabricacao de porta: o coordenador que antes deixava a folha completar sozinha
--   passaria a validar manualmente, com resultado identico na folha.
--
-- O QUE MUDA
--   O coordenador informa o HORARIO QUE O SERVIDOR DECLARA ter cumprido, em vez de herdar o da
--   jornada. Isso e complementar omissao com informacao real - o que o Art. 82, paragrafo unico,
--   autoriza expressamente. Continua sendo tratamento, nao invencao.
--
-- POR QUE UMA FUNCAO NOVA
--   fn_confirmar_presenca_manual e irma de fn_confirmar_presenca em tamanho e em historico de
--   regressao: das seis regressoes registradas no CLAUDE.md, cinco sairam de uma unica migration
--   que a recriou. Acrescentar quatro parametros de horario e reescrever os sete escopos de
--   gravacao seria a maior cirurgia ja feita nela.
--
--   fn_registrar_presenca_informada escreve direto na linha, sem tocar na funcao existente.
--   fn_confirmar_presenca_manual continua valendo para o que ela faz bem: validacao em massa,
--   onde nao ha horario individual a informar.
--
-- O QUE ELA NAO FAZ
--   Nao sobrescreve horario ja gravado - COALESCE em todos os campos. Alterar dado ja
--   registrado pelo servidor e a quarta vedacao da Portaria. Para corrigir um horario errado,
--   o caminho e reverter primeiro.


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

    FOREACH v_passo IN ARRAY ARRAY['entrada', 'intervalo_saida', 'intervalo_retorno', 'saida']
    LOOP
        v_hhmm := NULLIF(btrim(COALESCE(p_horarios->>v_passo, '')), '');
        CONTINUE WHEN v_hhmm IS NULL;

        IF v_hhmm !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
            RETURN jsonb_build_object('success', false,
                'message', 'Horário inválido para ' || v_passo || ': "' || v_hhmm || '". Use HH:MM.');
        END IF;

        v_ts := (v_data::text || ' ' || v_hhmm || ':00')::timestamp AT TIME ZONE v_timezone;

        -- Saida anterior a entrada significa turno que atravessa a meia-noite.
        IF v_passo = 'saida'
           AND (p_horarios->>'entrada') IS NOT NULL
           AND v_hhmm < (p_horarios->>'entrada') THEN
            v_ts := v_ts + interval '1 day';
        END IF;

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
    'porque o horario nao foi derivado - foi declarado.';

GRANT EXECUTE ON FUNCTION public.fn_registrar_presenca_informada(uuid, jsonb, uuid, text)
    TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) Registrar horarios informados numa linha vazia:
--
--   SELECT public.fn_registrar_presenca_informada(
--       '<escala_diaria_id>',
--       '{"entrada":"08:07","saida":"18:12"}'::jsonb,
--       '<validador_id>',
--       'Servidor informou os horarios; terminal estava fora do ar.');
--
--   SELECT presenca_entrada_em, presenca_entrada_origem, presenca_saida_em
--     FROM public.escala_diaria WHERE id = '<escala_diaria_id>';
--   -- os horarios tem de ser 08:07 e 18:12 - NAO o inicio e fim da jornada.
--
--   2) A marcacao nasceu como informada, nao como sintetica:
--
--   SELECT ocorrido_em, origem, sintetica, justificativa, observacao
--     FROM public.marcacoes_ponto
--    WHERE observacao LIKE 'Horario informado%'
--    ORDER BY registrado_em DESC LIMIT 4;
--   -- sintetica DEVE ser false.
--
--   3) NAO sobrescreve horario existente (rode a mesma chamada com outro horario):
--
--   SELECT public.fn_registrar_presenca_informada(
--       '<escala_diaria_id>', '{"entrada":"09:00"}'::jsonb, '<validador_id>', 'teste');
--   -- presenca_entrada_em tem de continuar 08:07.
--
--   4) Horario invalido e recusado antes de gravar qualquer coisa:
--
--   SELECT public.fn_registrar_presenca_informada(
--       '<escala_diaria_id>', '{"entrada":"25:99"}'::jsonb, '<validador_id>', 'teste');
--
--   5) Turno que cruza a meia-noite: saida menor que entrada vai para o dia seguinte.
--
--   SELECT public.fn_registrar_presenca_informada(
--       '<escala_diaria_noturna_id>', '{"entrada":"19:00","saida":"07:00"}'::jsonb,
--       '<validador_id>', 'Plantao noturno.');
--   -- presenca_saida_em tem de cair no dia seguinte.
--
--   6) Sobreaviso continua fora:
--
--   SELECT public.fn_registrar_presenca_informada(
--       '<escala_diaria_sobreaviso_id>', '{"entrada":"08:00"}'::jsonb, '<validador_id>', 'teste');
--   -- esperado: success = false.
