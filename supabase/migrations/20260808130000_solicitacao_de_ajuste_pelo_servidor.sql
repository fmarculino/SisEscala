-- Migration: Servidor solicita ajuste em vez de editar a folha direto
-- Data: 2026-08-08
--
-- O PROBLEMA, QUE A v1.22.0 AGRAVOU
--   O portal do servidor permite editar qualquer celula cuja origem nao seja 'real'. A edicao
--   vai direto para folha_ponto.registros, com origem 'manual'. Nao passa por escala_diaria,
--   nao cria marcacao, e nao tem revisao de ninguem.
--
--   Ate ontem, entrada e saida SEMPRE traziam um horario ficticio. O servidor editava uma
--   invencao do sistema - algo ancorado no horario previsto. Depois que a geracao automatica
--   de entrada e saida foi removida, essas celulas ficam VAZIAS quando nao houve batida: o
--   servidor passou a digitar o horario que quiser numa celula vazia da folha oficial.
--
--   Trocamos "ajustar uma invencao" por "declarar do zero". Tres consequencias:
--     1. o servidor virou seu proprio registrador, sem conferencia;
--     2. a folha se desconecta de marcacoes_ponto - o espelho de ponto e as marcacoes passam
--        a discordar em silencio, e o espelho e o que vai para o fiscal;
--     3. some o rastro: quem digitou, quando e com base em que.
--
-- A SOLUCAO: CANALIZAR, NAO CALAR
--   Remover a edicao sem substituto empurraria tudo para o coordenador, que teria de perguntar
--   ao servidor de qualquer forma. O servidor E QUEM SABE o horario real - essa informacao e
--   valiosa e deve ser canalizada, nao descartada.
--
--   A solicitacao vira marcacao de origem 'ajuste_servidor', que ja existe no enum desde
--   20260808000000 com PRECEDENCIA 4 - a mais baixa. Perde para o relogio, para o terminal e
--   para o coordenador. E exatamente o peso de uma autodeclaracao.
--
--   O servidor mantem a voz, o coordenador mantem a decisao, e tudo fica rastreado.


-- ============================================================================
-- 1. SOLICITACAO DE AJUSTE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_solicitar_ajuste_ponto(
    p_servidor_id      uuid,
    p_escala_diaria_id uuid,
    p_horarios         jsonb,   -- {"entrada":"08:03","saida":"18:12"} hora local
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

    -- Em dois SELECT de proposito: plpgsql recusa variavel %ROWTYPE na mesma lista INTO que
    -- escalares (42601 - "record variable cannot be part of multiple-item INTO list").
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

    -- IDOR: o dia tem de ser do proprio servidor. O portal autentica so por PIN, entao esta
    -- checagem e a que impede alguem de solicitar ajuste no ponto de outra pessoa.
    IF v_dono <> p_servidor_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Este dia não pertence a você.');
    END IF;

    v_dia       := v_ed.dia;
    v_categoria := v_ed.categoria::text;
    v_data      := make_date(v_ano, v_mes, v_dia);

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

        -- Passo que ja tem horario registrado nao aceita solicitacao. Contestar um registro
        -- existente e processo mais pesado e nao pode ser autoatendimento - fica com o
        -- coordenador, que tem a ferramenta e a responsabilidade.
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

        -- Saida antes da entrada: turno que atravessa a meia-noite.
        IF v_passo = 'saida'
           AND (p_horarios->>'entrada') IS NOT NULL
           AND v_hhmm < (p_horarios->>'entrada') THEN
            v_ts := v_ts + interval '1 day';
        END IF;

        -- NAO escreve em escala_diaria. A solicitacao e um pedido, nao um registro: so vira
        -- presenca depois que o coordenador aceitar, via fn_aceitar_marcacao_pendente.
        --
        -- sintetica = false: o horario foi INFORMADO pelo servidor, nao derivado da jornada.
        -- A origem 'ajuste_servidor' ja diz que nao houve batida.
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
    'Servidor solicita ajuste de ponto informando o horario. NAO escreve em escala_diaria: cria '
    'marcacao de origem ajuste_servidor (precedencia 4, a mais baixa) pendente de revisao do '
    'coordenador. Substitui a edicao direta da folha pelo portal.';

REVOKE ALL ON FUNCTION public.fn_solicitar_ajuste_ponto(uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_solicitar_ajuste_ponto(uuid, uuid, jsonb, text) TO service_role;


-- ============================================================================
-- 2. A FILA DO COORDENADOR PASSA A INCLUIR AS SOLICITACOES
-- ============================================================================
-- Ganha a coluna 'origem' para o coordenador distinguir batida de terminal (o servidor esteve
-- la e bateu) de solicitacao do servidor (autodeclaracao). Sao coisas de peso diferente.

DROP FUNCTION IF EXISTS public.fn_marcacoes_pendentes_revisao(uuid, uuid, date);

CREATE OR REPLACE FUNCTION public.fn_marcacoes_pendentes_revisao(
    p_unidade_id uuid DEFAULT NULL,
    p_setor_id   uuid DEFAULT NULL,
    p_desde      date DEFAULT NULL
)
RETURNS TABLE (
    marcacao_id   uuid,
    servidor_id   uuid,
    servidor_nome text,
    matricula     text,
    ocorrido_em   timestamptz,
    origem        public.marcacao_origem,
    unidade_id    uuid,
    setor_id      uuid,
    observacao    text,
    justificativa text,
    dia           integer,
    ja_tratada    boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT m.id, m.servidor_id, s.nome, s.matricula, m.ocorrido_em, m.origem,
           m.unidade_id, m.setor_id, m.observacao, m.justificativa,
           extract(day from m.ocorrido_em AT TIME ZONE COALESCE(
               (SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
               'America/Sao_Paulo'))::integer,
           EXISTS (SELECT 1 FROM public.marcacoes_tratamentos t WHERE t.marcacao_id = m.id)
      FROM public.marcacoes_ponto m
      JOIN public.servidores s ON s.id = m.servidor_id
     WHERE m.origem IN ('terminal', 'ajuste_servidor')
       AND m.observacao LIKE '%pendente de revisao%'
       AND (p_unidade_id IS NULL OR m.unidade_id = p_unidade_id)
       AND (p_setor_id   IS NULL OR m.setor_id   = p_setor_id)
       AND (p_desde      IS NULL OR m.ocorrido_em >= p_desde)
       AND public.fn_unidade_no_escopo(m.unidade_id)
     ORDER BY m.ocorrido_em DESC
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_marcacoes_pendentes_revisao(uuid, uuid, date)
    TO authenticated, service_role;


-- ============================================================================
-- 3. O ATESTADO EM MASSA TAMBEM RESPEITA A SOLICITACAO
-- ============================================================================
-- Mesma razao de 20260808120000: onde ha informacao do servidor esperando decisao, atestar por
-- cima com o horario contratual enterra o que ele informou.

CREATE OR REPLACE FUNCTION public.fn_atestar_jornada_bulk(
    p_escala_mensal_ids uuid[],
    p_dias              integer[],
    p_categorias        text[],
    p_tipo              text,
    p_validador_id      uuid,
    p_justificativa     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_timezone  text;
    v_pendentes jsonb := '[]'::jsonb;
    v_em_id     uuid;
    v_dia       integer;
    v_res       jsonb;
    v_atestados integer := 0;
    v_pulados   integer := 0;
    r           record;
BEGIN
    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Justificativa é obrigatória para atestar jornada.');
    END IF;

    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    FOR r IN
        SELECT em.id AS escala_mensal_id,
               s.nome AS servidor_nome,
               extract(day from m.ocorrido_em AT TIME ZONE v_timezone)::integer AS dia,
               count(*) AS batidas,
               min(m.ocorrido_em) AS primeira,
               bool_or(m.origem = 'ajuste_servidor') AS tem_solicitacao
          FROM public.marcacoes_ponto m
          JOIN public.servidores s     ON s.id = m.servidor_id
          JOIN public.escala_mensal em ON em.servidor_id = m.servidor_id
                                      AND em.mes = extract(month from m.ocorrido_em AT TIME ZONE v_timezone)::integer
                                      AND em.ano = extract(year  from m.ocorrido_em AT TIME ZONE v_timezone)::integer
         WHERE em.id = ANY(p_escala_mensal_ids)
           AND m.origem IN ('terminal', 'ajuste_servidor')
           AND m.observacao LIKE '%pendente de revisao%'
           AND extract(day from m.ocorrido_em AT TIME ZONE v_timezone)::integer = ANY(p_dias)
           AND NOT EXISTS (SELECT 1 FROM public.marcacoes_tratamentos t WHERE t.marcacao_id = m.id)
         GROUP BY em.id, s.nome, 3
         ORDER BY s.nome, 3
    LOOP
        v_pendentes := v_pendentes || jsonb_build_object(
            'escala_mensal_id', r.escala_mensal_id,
            'servidor_nome',    r.servidor_nome,
            'dia',              r.dia,
            'batidas',          r.batidas,
            'tem_solicitacao',  r.tem_solicitacao,
            'primeira_batida',  to_char(r.primeira AT TIME ZONE v_timezone, 'HH24:MI'));
    END LOOP;

    FOREACH v_em_id IN ARRAY p_escala_mensal_ids LOOP
        FOREACH v_dia IN ARRAY p_dias LOOP
            IF EXISTS (
                SELECT 1 FROM jsonb_array_elements(v_pendentes) AS x
                 WHERE (x->>'escala_mensal_id')::uuid = v_em_id
                   AND (x->>'dia')::integer = v_dia
            ) THEN
                v_pulados := v_pulados + 1;
                CONTINUE;
            END IF;

            v_res := public.fn_confirmar_presenca_manual_bulk(
                ARRAY[v_em_id], ARRAY[v_dia], p_categorias,
                p_tipo, p_validador_id, p_justificativa);

            IF COALESCE((v_res->>'success')::boolean, false) THEN
                v_atestados := v_atestados + COALESCE((v_res->>'total_processed')::integer, 0);
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'success',   true,
        'atestados', v_atestados,
        'pulados',   v_pulados,
        'pendentes', v_pendentes,
        'message',   CASE
            WHEN jsonb_array_length(v_pendentes) = 0
                THEN 'Jornada atestada em ' || v_atestados || ' registro(s).'
            ELSE 'Jornada atestada em ' || v_atestados || ' registro(s). ' ||
                 jsonb_array_length(v_pendentes) || ' dia(s) ficaram de fora por terem ponto ' ||
                 'registrado ou ajuste solicitado aguardando revisão.'
        END);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_atestar_jornada_bulk(uuid[], integer[], text[], text, uuid, text)
    TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) Solicitacao valida cria marcacao pendente e NAO toca em escala_diaria:
--
--   SELECT public.fn_solicitar_ajuste_ponto('<servidor_id>', '<escala_diaria_id>',
--          '{"entrada":"08:03","saida":"18:12"}'::jsonb, 'Esqueci de bater na entrada.');
--
--   SELECT presenca_entrada_em FROM public.escala_diaria WHERE id = '<escala_diaria_id>';
--   -- tem de continuar NULL: solicitacao e pedido, nao registro.
--
--   SELECT ocorrido_em, origem, sintetica, justificativa
--     FROM public.marcacoes_ponto WHERE origem = 'ajuste_servidor'
--    ORDER BY registrado_em DESC LIMIT 4;
--   -- origem = ajuste_servidor, sintetica = false.
--
--   2) IDOR - dia de outro servidor tem de ser recusado:
--
--   SELECT public.fn_solicitar_ajuste_ponto('<outro_servidor_id>', '<escala_diaria_id>',
--          '{"entrada":"08:00"}'::jsonb, 'teste');
--   -- esperado: success = false, dia nao pertence ao servidor.
--
--   3) Passo que ja tem registro nao aceita solicitacao:
--
--   -- apos aceitar a solicitacao do item 1, repetir a chamada deve recusar apontando o
--   -- horario ja existente.
--
--   4) A solicitacao aparece na fila do coordenador, distinguivel da batida de terminal:
--
--   SELECT servidor_nome, ocorrido_em, origem, justificativa, dia
--     FROM public.fn_marcacoes_pendentes_revisao();
--
--   5) O atestado em massa pula o dia com solicitacao pendente:
--
--   SELECT public.fn_atestar_jornada_bulk(
--       ARRAY['<escala_mensal_id>']::uuid[], ARRAY[<dia>], ARRAY['Regular'],
--       'completo', '<validador_id>', 'Fechamento mensal.');
--   -- pendentes deve trazer o dia com tem_solicitacao = true.
