-- Migration: Alocacao de marcacoes aos passos previstos do dia (Fase 2)
-- Data: 2026-08-08
--
-- OBJETIVO
--   Dada uma lista de batidas soltas (que e tudo que um REP produz: identificador, instante,
--   NSR) e os blocos previstos do dia, decidir QUAL batida corresponde a QUAL passo.
--   Funcao PURA: nao escreve nada, so devolve a decisao em jsonb.
--
-- POR QUE NAO SERVE O CASAMENTO GULOSO
--   fn_batidas_reais_recusadas (20260807090000) casa por proximidade de forma gulosa e sem
--   reuso, e o cabecalho dela ja registra o problema: considerar so entrada e saida errava
--   feio porque muitas tentativas caem por volta das 12h em jornadas 08:00-18:00 (almoco),
--   ficando a 250-295 min do passo escolhido.
--
--   Guloso tambem viola a ordem: uma batida da manha pode "roubar" o slot da tarde por estar
--   marginalmente mais perto, empurrando as seguintes para slots errados em cascata.
--
--   Aqui se usa PROGRAMACAO DINAMICA com restricao de monotonicidade: a i-esima batida nunca
--   ocupa um slot anterior ao da (i-1)-esima. O resultado e o de custo total minimo, e e
--   deterministico - rodar duas vezes sobre os mesmos dados da o mesmo resultado, o que e
--   requisito para uma folha de ponto auditavel. Com no maximo 12 slots e poucas batidas,
--   o custo computacional e irrelevante.
--
-- COMO A PRECEDENCIA ENTRA (relogio > terminal > ajuste manual)
--   A decisao de projeto: o DP roda SEPARADAMENTE POR ORIGEM, e so depois os resultados sao
--   fundidos slot a slot por fn_precedencia_origem.
--
--   Rodar um DP unico misturando origens seria errado. Se o relogio registrou a entrada e o
--   coordenador tambem lancou um ajuste manual para o mesmo dia, um DP unico teria duas
--   marcacoes competindo e empurraria a segunda para o slot seguinte - transformando um ajuste
--   de ENTRADA em marcacao de SAIDA DO INTERVALO. Separando por origem, cada sequencia e
--   internamente coerente e a disputa acontece onde deve: no slot.
--
--   A marcacao perdedora NAO some. Ela sai com status 'substituida_por_precedencia' e continua
--   visivel na linha do tempo - e assim que se cumpre "mesmo que um administrador altere uma
--   marcacao manual, a real tem que ficar registrada para auditorias futuras".
--
-- O QUE ESTA FUNCAO NUNCA FAZ
--   - Nao fabrica horario. Numero impar de batidas deixa o slot vazio como pendencia. E o
--     oposto de fn_salvar_saida_bloco (20260706115000), que inventa ate 5 timestamps sinteticos.
--   - Nao descarta batida. Orfa, excedente, duplicada e fora de escala continuam registradas.
--   - Nao rejeita por janela de tolerancia. Batida de REP-C e fato consumado; a janela e
--     criterio do terminal, nao do registro.
--
-- ESTA MIGRATION NAO MUDA NENHUM COMPORTAMENTO
--   Cria uma funcao nova que ninguem chama ainda.

DROP FUNCTION IF EXISTS public.fn_alocar_marcacoes_dia(uuid, date, integer, integer);

CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia(
    p_servidor_id           uuid,
    p_data                  date,
    p_tolerancia_ontem_min  integer DEFAULT NULL,
    p_janela_duplicidade_s  integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fnaloc$
DECLARE
    v_tol_ontem     integer;
    v_dup_seg       integer;
    v_timezone      text;
    v_meia_noite    timestamptz;   -- 00:00 de p_data no fuso configurado
    v_busca_ini     timestamptz;   -- janela de busca de marcacoes, derivada dos slots
    v_busca_fim     timestamptz;

    -- Slots candidatos do dia, na ordem cronologica.
    v_slot_passo    text[]        := '{}';
    v_slot_prev     timestamptz[] := '{}';
    v_slot_bloco    integer[]     := '{}';
    v_slot_ids      text[]        := '{}';   -- uuids do bloco, serializados
    v_slot_data     date[]        := '{}';   -- p_data ou p_data - 1
    n_slots         integer;

    -- Vencedor por slot, apos a fusao por precedencia.
    v_win_marcacao  uuid[]        := '{}';
    v_win_peso      integer[]     := '{}';
    v_win_dist      numeric[]     := '{}';

    v_origem        public.marcacao_origem;
    v_alocacoes     jsonb := '[]'::jsonb;
    v_pendencias    jsonb := '[]'::jsonb;
    v_substituidas  jsonb := '[]'::jsonb;

    r               record;
    i               integer;
    j               integer;
BEGIN
    SELECT COALESCE(p_tolerancia_ontem_min,
                    (SELECT (valor#>>'{}')::integer FROM public.configuracoes_globais
                      WHERE chave = 'rep_tolerancia_alocacao_minutos'),
                    240)
      INTO v_tol_ontem;

    SELECT COALESCE(p_janela_duplicidade_s,
                    (SELECT (valor#>>'{}')::integer FROM public.configuracoes_globais
                      WHERE chave = 'rep_janela_duplicidade_segundos'),
                    60)
      INTO v_dup_seg;

    SELECT COALESCE((SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
                    'America/Sao_Paulo')
      INTO v_timezone;

    v_meia_noite := p_data::timestamp AT TIME ZONE v_timezone;

    -- ========================================================================
    -- 1. SLOTS CANDIDATOS
    -- ========================================================================
    -- Considera os blocos de HOJE e os de ONTEM que CRUZAM A MEIA-NOITE. Um plantao noturno
    -- aberto ontem termina hoje de manha: a batida das 06:05 pertence ao bloco de ontem.
    --
    -- O criterio e fim_previsto > meia-noite de hoje, e nao "fim + tolerancia" - isto e, so
    -- entra o bloco que de fato atravessa o dia. Com a tolerancia na condicao, um turno que
    -- terminou as 20h de ontem tambem entraria, e seus 4 slots vazios virariam pendencias
    -- falsas de hoje. Batida atrasada de bloco que fechou ontem pertence a reconciliacao de
    -- ontem. A tolerancia continua valendo depois, ampliando a janela de busca de marcacoes.
    FOR r IN
        SELECT d.dia_ref, b.*
          FROM (VALUES (p_data - 1), (p_data)) AS d(dia_ref)
          CROSS JOIN LATERAL public.fn_blocos_previstos_dia(p_servidor_id, d.dia_ref) b
         WHERE d.dia_ref = p_data
            OR b.fim_previsto > v_meia_noite
         ORDER BY b.inicio_previsto
    LOOP
        -- O cast ::text nos literais de passo e OBRIGATORIO, nao estilo. Em
        -- "text[] || 'entrada'" o literal chega sem tipo e o Postgres resolve para a
        -- sobrecarga anyarray || anyarray, tentando ler a string como literal de array:
        --   22P02 malformed array literal: "entrada"
        -- Os demais appends deste bloco nao precisam porque as expressoes ja sao tipadas
        -- (timestamptz, integer, date, array_to_string -> text).

        -- entrada
        v_slot_passo := v_slot_passo || 'entrada'::text;
        v_slot_prev  := v_slot_prev  || r.inicio_previsto;
        v_slot_bloco := v_slot_bloco || r.bloco_ordem;
        v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
        v_slot_data  := v_slot_data  || r.dia_ref;

        -- Passos de intervalo so existem quando a jornada os preve (CLT Art. 71, via
        -- fn_jornada_tem_intervalo dentro de fn_blocos_previstos_dia). Criar slots de
        -- intervalo onde nao ha intervalo faria o DP deslocar a saida para o slot errado.
        IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN
            v_slot_passo := v_slot_passo || 'intervalo_saida'::text;
            v_slot_prev  := v_slot_prev  || r.intervalo_inicio_previsto;
            v_slot_bloco := v_slot_bloco || r.bloco_ordem;
            v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
            v_slot_data  := v_slot_data  || r.dia_ref;

            v_slot_passo := v_slot_passo || 'intervalo_retorno'::text;
            v_slot_prev  := v_slot_prev  || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
            v_slot_bloco := v_slot_bloco || r.bloco_ordem;
            v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
            v_slot_data  := v_slot_data  || r.dia_ref;
        END IF;

        -- saida
        v_slot_passo := v_slot_passo || 'saida'::text;
        v_slot_prev  := v_slot_prev  || r.fim_previsto;
        v_slot_bloco := v_slot_bloco || r.bloco_ordem;
        v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
        v_slot_data  := v_slot_data  || r.dia_ref;
    END LOOP;

    n_slots := COALESCE(array_length(v_slot_passo, 1), 0);

    -- Janela de busca de marcacoes: derivada dos SLOTS, nunca do calendario.
    -- A versao anterior usava meia-noite de ontem ate amanha + tolerancia - quase 48h - e com
    -- isso as batidas dos dias vizinhos entravam na disputa pelos slots de hoje. O DP as
    -- encaixava, produzindo entradas com 1440 e ate 2880 minutos de erro (1 e 2 dias exatos)
    -- e criando horario em linha que nao tinha nenhum. Amarrar a janela ao primeiro e ao
    -- ultimo slot mantem elegivel exatamente o que pode pertencer a este dia.
    IF n_slots > 0 THEN
        SELECT min(t), max(t) INTO v_busca_ini, v_busca_fim FROM unnest(v_slot_prev) AS t;
        v_busca_ini := v_busca_ini - make_interval(mins => v_tol_ontem);
        v_busca_fim := v_busca_fim + make_interval(mins => v_tol_ontem);
    ELSE
        -- Sem escala no dia: janela do proprio dia, so para reportar sem_escala.
        v_busca_ini := v_meia_noite;
        v_busca_fim := v_meia_noite + interval '1 day';
    END IF;

    v_win_marcacao := array_fill(NULL::uuid,    ARRAY[GREATEST(n_slots, 1)]);
    v_win_peso     := array_fill(999,           ARRAY[GREATEST(n_slots, 1)]);
    v_win_dist     := array_fill(NULL::numeric, ARRAY[GREATEST(n_slots, 1)]);

    -- ========================================================================
    -- 2. UM DP POR ORIGEM
    -- ========================================================================
    FOREACH v_origem IN ARRAY enum_range(NULL::public.marcacao_origem)
    LOOP
        DECLARE
            v_m_id      uuid[]        := '{}';
            v_m_ts      timestamptz[] := '{}';
            n_marc      integer;
            v_custo     numeric[];
            v_escolha   integer[];   -- 1 = pula marcacao, 2 = pula slot, 3 = casa
            v_dist      numeric;
            v_melhor    numeric;
            v_op        integer;
            v_ant_ts    timestamptz;
            v_ant_id    uuid;
            k           integer;
            s           integer;
        BEGIN
            -- Marcacoes efetivas desta origem: exclui as com 'desconsiderar' vigente.
            -- O efetivo e o ULTIMO tratamento por created_at, porque desconsiderar/restaurar
            -- se alternam.
            FOR r IN
                SELECT m.id, m.ocorrido_em
                  FROM public.marcacoes_ponto m
                 WHERE m.servidor_id = p_servidor_id
                   AND m.origem = v_origem
                   AND m.ocorrido_em >= v_busca_ini
                   AND m.ocorrido_em <= v_busca_fim
                   AND NOT EXISTS (
                       SELECT 1
                         FROM public.marcacoes_tratamentos t
                        WHERE t.marcacao_id = m.id
                          AND t.tipo IN ('desconsiderar', 'restaurar')
                          AND t.created_at = (
                              SELECT max(t2.created_at) FROM public.marcacoes_tratamentos t2
                               WHERE t2.marcacao_id = m.id
                                 AND t2.tipo IN ('desconsiderar', 'restaurar'))
                          AND t.tipo = 'desconsiderar'
                   )
                 ORDER BY m.ocorrido_em
            LOOP
                -- Deduplicacao dentro da origem: o classico "encostou o dedo duas vezes".
                -- A segunda e MARCADA duplicada, nunca apagada.
                IF v_ant_ts IS NOT NULL
                   AND extract(epoch FROM (r.ocorrido_em - v_ant_ts)) < v_dup_seg THEN
                    v_pendencias := v_pendencias || jsonb_build_object(
                        'tipo', 'duplicada', 'marcacao_id', r.id,
                        'ocorrido_em', r.ocorrido_em, 'origem', v_origem,
                        'duplicada_de', v_ant_id);
                    CONTINUE;
                END IF;

                v_m_id  := v_m_id  || r.id;
                v_m_ts  := v_m_ts  || r.ocorrido_em;
                v_ant_ts := r.ocorrido_em;
                v_ant_id := r.id;
            END LOOP;

            n_marc := COALESCE(array_length(v_m_id, 1), 0);
            CONTINUE WHEN n_marc = 0;

            IF n_slots = 0 THEN
                -- Batida num dia sem escala de trabalho (ex.: apenas Sobreaviso, que por
                -- construcao nao gera bloco). Guardada como pendencia, nunca escrita.
                FOR k IN 1 .. n_marc LOOP
                    v_pendencias := v_pendencias || jsonb_build_object(
                        'tipo', 'sem_escala', 'marcacao_id', v_m_id[k],
                        'ocorrido_em', v_m_ts[k], 'origem', v_origem);
                END LOOP;
                CONTINUE;
            END IF;

            -- ----------------------------------------------------------------
            -- DP monotonico de custo minimo.
            -- Indices deslocados em 1: linha i representa i-1 marcacoes ja decididas,
            -- coluna j representa j-1 slots ja considerados.
            -- ----------------------------------------------------------------
            v_custo   := array_fill(0::numeric, ARRAY[n_marc + 1, n_slots + 1]);
            v_escolha := array_fill(0,          ARRAY[n_marc + 1, n_slots + 1]);

            -- Pular uma marcacao custa caro: so acontece quando ha mais batidas que slots.
            FOR k IN 2 .. n_marc + 1 LOOP
                v_custo[k][1]   := (k - 1) * 100000::numeric;
                v_escolha[k][1] := 1;
            END LOOP;

            FOR k IN 2 .. n_marc + 1 LOOP
                FOR s IN 2 .. n_slots + 1 LOOP
                    -- opcao 1: pular a marcacao k-1
                    v_melhor := v_custo[k - 1][s] + 100000::numeric;
                    v_op := 1;

                    -- opcao 2: deixar o slot s-1 vazio
                    IF v_custo[k][s - 1] < v_melhor THEN
                        v_melhor := v_custo[k][s - 1];
                        v_op := 2;
                    END IF;

                    -- opcao 3: casar marcacao k-1 com slot s-1
                    v_dist := abs(extract(epoch FROM (v_m_ts[k - 1] - v_slot_prev[s - 1])) / 60.0);
                    IF v_custo[k - 1][s - 1] + v_dist < v_melhor THEN
                        v_melhor := v_custo[k - 1][s - 1] + v_dist;
                        v_op := 3;
                    END IF;

                    v_custo[k][s]   := v_melhor;
                    v_escolha[k][s] := v_op;
                END LOOP;
            END LOOP;

            -- Backtracking: recupera o casamento otimo.
            k := n_marc + 1;
            s := n_slots + 1;
            WHILE k > 1 AND s > 1 LOOP
                IF v_escolha[k][s] = 3 THEN
                    v_dist := abs(extract(epoch FROM (v_m_ts[k - 1] - v_slot_prev[s - 1])) / 60.0);
                    -- Fusao por precedencia: menor peso vence o slot.
                    IF public.fn_precedencia_origem(v_origem) < v_win_peso[s - 1] THEN
                        IF v_win_marcacao[s - 1] IS NOT NULL THEN
                            v_substituidas := v_substituidas || jsonb_build_object(
                                'marcacao_id', v_win_marcacao[s - 1],
                                'passo', v_slot_passo[s - 1],
                                'motivo', 'substituida_por_precedencia',
                                'vencedor_origem', v_origem);
                        END IF;
                        v_win_marcacao[s - 1] := v_m_id[k - 1];
                        v_win_peso[s - 1]     := public.fn_precedencia_origem(v_origem);
                        v_win_dist[s - 1]     := v_dist;
                    ELSE
                        v_substituidas := v_substituidas || jsonb_build_object(
                            'marcacao_id', v_m_id[k - 1],
                            'passo', v_slot_passo[s - 1],
                            'motivo', 'substituida_por_precedencia',
                            'vencedor_origem', NULL);
                    END IF;
                    k := k - 1;
                    s := s - 1;
                ELSIF v_escolha[k][s] = 1 THEN
                    -- Mais batidas que slots: a excedente fica registrada como pendencia.
                    v_pendencias := v_pendencias || jsonb_build_object(
                        'tipo', 'excedente', 'marcacao_id', v_m_id[k - 1],
                        'ocorrido_em', v_m_ts[k - 1], 'origem', v_origem);
                    k := k - 1;
                ELSE
                    s := s - 1;
                END IF;
            END LOOP;

            WHILE k > 1 LOOP
                v_pendencias := v_pendencias || jsonb_build_object(
                    'tipo', 'excedente', 'marcacao_id', v_m_id[k - 1],
                    'ocorrido_em', v_m_ts[k - 1], 'origem', v_origem);
                k := k - 1;
            END LOOP;
        END;
    END LOOP;

    -- ========================================================================
    -- 3. RESULTADO
    -- ========================================================================
    FOR i IN 1 .. n_slots LOOP
        IF v_win_marcacao[i] IS NOT NULL THEN
            v_alocacoes := v_alocacoes || jsonb_build_object(
                'marcacao_id',       v_win_marcacao[i],
                'passo',             v_slot_passo[i],
                'bloco',             v_slot_bloco[i],
                'data_bloco',        v_slot_data[i],
                'escala_diaria_ids', string_to_array(v_slot_ids[i], ','),
                'previsto',          v_slot_prev[i],
                'distancia_min',     round(v_win_dist[i]));
        ELSE
            -- Slot vazio NAO e preenchido com horario sintetico. Vira trabalho para o
            -- coordenador tratar - que e o comportamento honesto.
            v_pendencias := v_pendencias || jsonb_build_object(
                'tipo',              'passo_sem_marcacao',
                'passo',             v_slot_passo[i],
                'bloco',             v_slot_bloco[i],
                'data_bloco',        v_slot_data[i],
                'escala_diaria_ids', string_to_array(v_slot_ids[i], ','),
                'previsto',          v_slot_prev[i]);
        END IF;
    END LOOP;

    -- Marcacoes orfas do dia: identificador do AFD que nao resolveu para servidor nenhum.
    -- Nao pertencem a este servidor, mas precisam aparecer em algum lugar - sao contadas
    -- aqui apenas quando a consulta e feita sem servidor especifico (p_servidor_id nulo
    -- nao e suportado; a listagem de orfas vive no modulo de marcacoes).

    RETURN jsonb_build_object(
        'servidor_id',  p_servidor_id,
        'data',         p_data,
        'slots',        n_slots,
        'alocacoes',    v_alocacoes,
        'pendencias',   v_pendencias,
        'substituidas', v_substituidas);
END;
$fnaloc$;

COMMENT ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer) IS
    'Decide qual marcacao corresponde a qual passo previsto do dia, por programacao dinamica '
    'monotonica de custo minimo, com um DP por origem e fusao por fn_precedencia_origem. '
    'Funcao PURA: nao escreve nada. Nunca fabrica horario nem descarta batida.';

GRANT EXECUTE ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer)
    TO authenticated, service_role;


-- Parametros configuraveis (idempotente).
INSERT INTO public.configuracoes_globais (chave, valor)
SELECT 'rep_tolerancia_alocacao_minutos', to_jsonb('240'::text)
 WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes_globais WHERE chave = 'rep_tolerancia_alocacao_minutos');

INSERT INTO public.configuracoes_globais (chave, valor)
SELECT 'rep_janela_duplicidade_segundos', to_jsonb('60'::text)
 WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes_globais WHERE chave = 'rep_janela_duplicidade_segundos');


-- CONFERENCIA APOS APLICAR
--
--   1) Um dia com jornada diurna completa e as 4 batidas de backfill deve alocar 4 e nao
--      deixar pendencia de passo:
--
--   SELECT jsonb_pretty(public.fn_alocar_marcacoes_dia(em.servidor_id, make_date(em.ano, em.mes, ed.dia)))
--     FROM public.escala_diaria ed
--     JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--    WHERE em.mes = 8 AND em.ano = 2026
--      AND ed.categoria = 'Regular'
--      AND ed.presenca_entrada_em IS NOT NULL
--      AND ed.presenca_intervalo_saida_em IS NOT NULL
--      AND ed.presenca_saida_em IS NOT NULL
--    LIMIT 1;
--
--   2) PANORAMA - quanto o alocador erra, em minutos, sobre o mes inteiro.
--      Como as marcacoes do backfill vieram justamente de escala_diaria, a distancia deveria
--      ser pequena. Distancias grandes concentradas num passo indicam divergencia de regra
--      (por exemplo, o intervalo previsto em inicio+4h contra o ponto medio da jornada usado
--      pela folha - as tres regras divergentes de intervalo, que so convergem na Fase 8):
--
--   WITH dias AS (
--       SELECT DISTINCT em.servidor_id, make_date(em.ano, em.mes, ed.dia) AS data
--         FROM public.escala_diaria ed
--         JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--        WHERE em.mes = 8 AND em.ano = 2026
--   ), res AS (
--       SELECT (public.fn_alocar_marcacoes_dia(d.servidor_id, d.data) -> 'alocacoes') AS a
--         FROM dias d
--   )
--   SELECT x->>'passo' AS passo,
--          count(*) AS alocadas,
--          round(avg((x->>'distancia_min')::numeric)) AS erro_medio_min,
--          max((x->>'distancia_min')::numeric) AS erro_max_min
--     FROM res, jsonb_array_elements(res.a) x
--    GROUP BY 1 ORDER BY 1;
--
--   3) Determinismo - rodar duas vezes tem que dar exatamente o mesmo jsonb:
--
--   SELECT public.fn_alocar_marcacoes_dia('<servidor>', '2026-08-05')
--        = public.fn_alocar_marcacoes_dia('<servidor>', '2026-08-05') AS deterministico;
--
--   4) Dia so de Sobreaviso: nenhuma alocacao, e a batida (se houver) vira pendencia
--      'sem_escala'. Nunca 'passo_sem_marcacao', porque nao ha slot.
