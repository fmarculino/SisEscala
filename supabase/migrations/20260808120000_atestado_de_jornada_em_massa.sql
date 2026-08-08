-- Migration: Validacao em massa passa a respeitar as batidas pendentes de revisao
-- Data: 2026-08-08
--
-- O DEFEITO, QUE E NOVO
--   A partir de 20260808100000 o terminal nao recusa mais batida fora da janela: ela e
--   registrada e fica PENDENTE DE REVISAO, para o coordenador decidir com o horario real na mao.
--
--   fn_confirmar_presenca_manual_bulk nao sabe disso. Se um servidor bateu as 07:40 e a batida
--   ficou pendente, o coordenador pode passar a validacao em massa por cima e o dia recebe o
--   horario CONTRATUAL - enquanto o horario verdadeiro esta ali do lado, sem ninguem olhar.
--
--   O horario real perde para o contratual por acidente de fluxo. E o pior tipo de defeito:
--   o dado certo existia, estava acessivel, e foi ignorado por conveniencia da ferramenta.
--
-- O QUE ESTA MIGRATION NAO E
--   Nao e correcao de rotulagem. Conferido em producao em 08/08/2026: apos as correcoes desta
--   data, a validacao em massa ja grava com origem 'ajuste_coordenador' e sintetica = true
--   (9 de 10 marcacoes), e a folha ja a pinta como 'manual'. O sistema NAO apresenta isso como
--   batida. Um coordenador declarando cumprimento de jornada, com justificativa e rotulo
--   proprio, e tratamento - o que o Art. 82, paragrafo unico, autoriza.
--
--   O que se corrige aqui e a PRECEDENCIA: onde existe horario real disponivel, ele tem de
--   ganhar do declarado. E a mesma regra que fn_precedencia_origem aplica na reconciliacao,
--   trazida para o fluxo do coordenador.
--
-- O DESENHO
--   fn_atestar_jornada_bulk envolve fn_confirmar_presenca_manual_bulk sem reescreve-la:
--   antes de atestar, separa os dias que tem batida pendente e os DEVOLVE ao chamador, para
--   que o coordenador os trate um a um - com o horario que a pessoa realmente bateu.
--
--   Atestar em massa continua existindo, e deve mesmo: quando ninguem bateu, alguem precisa
--   declarar o que houve. So deixa de ser o caminho que atropela o que foi batido.


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
    v_timezone     text;
    v_pendentes    jsonb := '[]'::jsonb;
    v_ids_limpos   uuid[] := '{}';
    v_dias_limpos  integer[] := '{}';
    v_em_id        uuid;
    v_dia          integer;
    v_res          jsonb;
    r              record;
BEGIN
    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Justificativa é obrigatória para atestar jornada.');
    END IF;

    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    -- ------------------------------------------------------------------
    -- 1. Quais (escala, dia) tem batida pendente de revisao?
    -- ------------------------------------------------------------------
    -- Estes NAO podem ser atestados em massa: existe horario real esperando decisao. Atestar
    -- por cima gravaria o contratual e enterraria o verdadeiro.
    FOR r IN
        SELECT em.id            AS escala_mensal_id,
               s.nome           AS servidor_nome,
               extract(day from m.ocorrido_em AT TIME ZONE v_timezone)::integer AS dia,
               count(*)         AS batidas,
               min(m.ocorrido_em) AS primeira
          FROM public.marcacoes_ponto m
          JOIN public.servidores s        ON s.id = m.servidor_id
          JOIN public.escala_mensal em    ON em.servidor_id = m.servidor_id
                                         AND em.mes = extract(month from m.ocorrido_em AT TIME ZONE v_timezone)::integer
                                         AND em.ano = extract(year  from m.ocorrido_em AT TIME ZONE v_timezone)::integer
         WHERE em.id = ANY(p_escala_mensal_ids)
           AND m.origem = 'terminal'
           AND m.observacao LIKE '%pendente de revisao%'
           AND extract(day from m.ocorrido_em AT TIME ZONE v_timezone)::integer = ANY(p_dias)
           -- Ja tratada pelo coordenador deixa de bloquear.
           AND NOT EXISTS (SELECT 1 FROM public.marcacoes_tratamentos t WHERE t.marcacao_id = m.id)
         GROUP BY em.id, s.nome, 3
         ORDER BY s.nome, 3
    LOOP
        v_pendentes := v_pendentes || jsonb_build_object(
            'escala_mensal_id', r.escala_mensal_id,
            'servidor_nome',    r.servidor_nome,
            'dia',              r.dia,
            'batidas',          r.batidas,
            'primeira_batida',  to_char(r.primeira AT TIME ZONE v_timezone, 'HH24:MI'));
    END LOOP;

    -- ------------------------------------------------------------------
    -- 2. Ateste o que sobrou, um par (escala, dia) por vez
    -- ------------------------------------------------------------------
    -- A exclusao e por PAR, nao por escala inteira nem por dia inteiro: um servidor com uma
    -- batida pendente no dia 5 continua podendo ser atestado nos dias 6 a 30.
    DECLARE
        v_atestados integer := 0;
        v_pulados   integer := 0;
    BEGIN
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
            'success',    true,
            'atestados',  v_atestados,
            'pulados',    v_pulados,
            'pendentes',  v_pendentes,
            'message',    CASE
                WHEN jsonb_array_length(v_pendentes) = 0
                    THEN 'Jornada atestada em ' || v_atestados || ' registro(s).'
                ELSE 'Jornada atestada em ' || v_atestados || ' registro(s). ' ||
                     jsonb_array_length(v_pendentes) || ' dia(s) ficaram de fora porque têm ' ||
                     'ponto registrado no terminal aguardando revisão — trate cada um com o ' ||
                     'horário real da batida.'
            END);
    END;
END;
$fn$;

COMMENT ON FUNCTION public.fn_atestar_jornada_bulk(uuid[], integer[], text[], text, uuid, text) IS
    'Atestado de jornada em massa que RESPEITA as batidas pendentes de revisao: dias com ponto '
    'registrado no terminal ficam de fora e sao devolvidos ao chamador, para tratamento '
    'individual com o horario real. Envolve fn_confirmar_presenca_manual_bulk sem reescreve-la.';

GRANT EXECUTE ON FUNCTION public.fn_atestar_jornada_bulk(uuid[], integer[], text[], text, uuid, text)
    TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) Sem nenhuma batida pendente no periodo, comporta-se como antes:
--
--   SELECT public.fn_atestar_jornada_bulk(
--       ARRAY['<escala_mensal_id>']::uuid[], ARRAY[3,4,5], ARRAY['Regular'],
--       'completo', '<validador_id>', 'Fechamento mensal.');
--   -- esperado: pulados = 0, pendentes = [], atestados > 0
--
--   2) TESTE PRINCIPAL - crie uma batida pendente e confirme que o dia fica de fora.
--      Registre um ponto fora da janela para um servidor do grupo:
--
--   SELECT public.fn_registrar_ponto('<matricula>', '<pin>', '<coordenador_id>',
--          (make_date(2026, 8, 5) + interval '3 hours')::timestamptz);
--
--   -- agora ateste o intervalo que inclui o dia 5:
--   SELECT public.fn_atestar_jornada_bulk(
--       ARRAY['<escala_mensal_id>']::uuid[], ARRAY[4,5,6], ARRAY['Regular'],
--       'completo', '<validador_id>', 'Fechamento mensal.');
--
--   -- esperado: pulados = 1, e pendentes traz o servidor, o dia 5 e o horario 03:00.
--   -- O dia 5 NAO pode ter recebido horario contratual:
--   SELECT presenca_entrada_em, presenca_entrada_origem
--     FROM public.escala_diaria ed
--     JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--    WHERE em.id = '<escala_mensal_id>' AND ed.dia = 5 AND ed.categoria = 'Regular';
--
--   3) A exclusao e por PAR (escala, dia), nao por escala inteira: os dias 4 e 6 do mesmo
--      servidor tem de ter sido atestados normalmente no teste acima.
--
--   4) Depois de o coordenador tratar a pendencia, o dia deixa de bloquear:
--
--   SELECT public.fn_aceitar_marcacao_pendente('<marcacao_id>', '<escala_diaria_id>',
--          'entrada', '<validador_id>', 'Servidor chegou cedo para cobertura.');
--   -- repetir o atestado do dia 5 agora deve funcionar (pulados = 0).
--
--   5) Justificativa continua obrigatoria:
--
--   SELECT public.fn_atestar_jornada_bulk(
--       ARRAY['<escala_mensal_id>']::uuid[], ARRAY[3], ARRAY['Regular'],
--       'completo', '<validador_id>', '');
--   -- esperado: success = false.
