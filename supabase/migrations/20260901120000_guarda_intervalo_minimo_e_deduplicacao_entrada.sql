-- ============================================================================
-- Migration: Guarda de Intervalo Mínimo e Proteção contra Batidas Repetidas na Entrada
-- Data: 2026-09-01
--
-- PROBLEMA
--   Quando o servidor chega pela manhã e bate o ponto 2x ou 3x em sequência rápida:
--   1. No terminal web (fn_confirmar_presenca), o modo de intervalo flexível aceitava
--      v_momento_atual_minutos > v_b_inicio, registrando as batidas seguintes como
--      saída para almoço e retorno de almoço logo nos primeiros minutos da manhã.
--   2. Na reconciliação automática (fn_alocar_marcacoes_dia), o piso do slot de intervalo
--      era 00:00 do dia, permitindo que marcações matinais fossem alocadas para o intervalo.
--
-- SOLUÇÃO
--   1. Em fn_alocar_marcacoes_dia: o piso dos slots de intervalo (intervalo_saida e retorno)
--      passa a exigir r.inicio_previsto + interval '60 minutes', impedindo matematicamente
--      que batidas da manhã casem com o intervalo.
--   2. Em fn_confirmar_presenca: o intervalo flexível passa a exigir no mínimo 60 minutos
--      decorridos desde a entrada. Se o servidor bater novamente nos primeiros 60 minutos,
--      o sistema responde amigavelmente "Entrada já confirmada às HH:MM" sem consumir passos.
--   3. As batidas de transição entre turnos (fronteira das 13h/15h) permanecem 100% intactas.
-- ============================================================================

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
    -- Teto do casamento batida<->slot. A escala repete a cada 1440 min; um teto >= metade
    -- disso faz a batida do dia vizinho empatar com a do dia certo e o casamento por menor
    -- distancia escolhe errado. Ver 20260819120000 e scratchpad/gen_teto_alocacao.js.
    c_teto_alocacao_min constant integer := 720;
    v_dup_seg       integer;
    v_timezone      text;
    v_meia_noite    timestamptz;
    v_busca_ini     timestamptz;
    v_busca_fim     timestamptz;

    v_slot_passo    text[]        := '{}';
    v_slot_prev     timestamptz[] := '{}';
    v_slot_bloco    integer[]     := '{}';
    v_slot_ids      text[]        := '{}';
    v_slot_data     date[]        := '{}';
    -- Piso do slot: meia-noite do dia civil em que o BLOCO daquele passo comeca. Chegar
    -- 'cedo' nunca significa chegar no dia civil anterior; se aconteceu, e anomalia para o
    -- coordenador ver, nao alocacao silenciosa. Ver 20260819180000.
    v_slot_piso     timestamptz[] := '{}';
    -- Slot OPCIONAL: existe para receber a batida de transicao entre dois turnos fundidos.
    -- Sem batida ele nao vira pendencia — a esmagadora maioria dos dias em bloco continuo
    -- nao tem batida na fronteira, e isso e normal, nao falta. Ver 20260819200000.
    v_slot_opcional boolean[]     := '{}';
    -- Passos previstos dos blocos dos dias VIZINHOS que nao entram nos slots deste dia.
    -- Nunca recebem alocacao: existem so para decidir de quem e a batida.
    v_sombra_prev   timestamptz[] := '{}';
    n_sombras       integer;
    n_slots         integer;

    v_win_marcacao  uuid[]        := '{}';
    v_win_peso      integer[]     := '{}';
    v_win_dist      numeric[]     := '{}';

    v_origem        public.marcacao_origem;
    v_alocacoes     jsonb := '[]'::jsonb;
    v_pendencias    jsonb := '[]'::jsonb;
    v_substituidas  jsonb := '[]'::jsonb;
    -- Turnos de cada bloco, na ordem de escala_diaria_ids. E o que permite a projecao saber
    -- QUAL linha e dona de cada passo do bloco, e nao so quais linhas o bloco nomeia.
    v_turnos        jsonb := '[]'::jsonb;

    r               record;
    i               integer;
    j               integer;
BEGIN
    -- Se o servidor possui ignora_janela_presenca = true (ex: diretores, chefias sem horário fixo),
    -- a tolerância é ampla (1440 min = 24h) para casar qualquer batida do dia com a escala.
    IF EXISTS (SELECT 1 FROM public.servidores WHERE id = p_servidor_id AND COALESCE(ignora_janela_presenca, false) = true) THEN
        v_tol_ontem := LEAST(1440, c_teto_alocacao_min);
    ELSE
        SELECT COALESCE(p_tolerancia_ontem_min,
                        (SELECT (valor#>>'{}')::integer FROM public.configuracoes_globais
                          WHERE chave = 'rep_tolerancia_alocacao_minutos'),
                        360)
          INTO v_tol_ontem;
    END IF;

    SELECT COALESCE(p_janela_duplicidade_s,
                    (SELECT (valor#>>'{}')::integer FROM public.configuracoes_globais
                      WHERE chave = 'rep_janela_duplicidade_segundos'),
                    60)
      INTO v_dup_seg;

    SELECT COALESCE((SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
                    'America/Sao_Paulo')
      INTO v_timezone;

    v_meia_noite := p_data::timestamp AT TIME ZONE v_timezone;

    -- 1. SLOTS CANDIDATOS
    FOR r IN
        SELECT d.dia_ref, b.*
          FROM (VALUES (p_data - 1), (p_data)) AS d(dia_ref)
          CROSS JOIN LATERAL public.fn_blocos_previstos_dia(p_servidor_id, d.dia_ref) b
         WHERE d.dia_ref = p_data
            OR b.fim_previsto > v_meia_noite
         ORDER BY b.inicio_previsto
    LOOP
        -- entrada
        v_slot_passo := v_slot_passo || 'entrada'::text;
        v_slot_prev  := v_slot_prev  || r.inicio_previsto;
        v_slot_bloco := v_slot_bloco || r.bloco_ordem;
        v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
        v_slot_data  := v_slot_data  || r.dia_ref;
        v_slot_piso  := v_slot_piso  || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);
        v_slot_opcional := v_slot_opcional || false;

        IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN
            v_slot_passo := v_slot_passo || 'intervalo_saida'::text;
            v_slot_prev  := v_slot_prev  || r.intervalo_inicio_previsto;
            v_slot_bloco := v_slot_bloco || r.bloco_ordem;
            v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
            v_slot_data  := v_slot_data  || r.dia_ref;
            -- Piso do intervalo: minimo de 60 minutos decorridos desde o inicio previsto
            -- para impedir que batidas matinais proximas a entrada casem com o intervalo.
            v_slot_piso  := v_slot_piso  || (r.inicio_previsto + interval '60 minutes');
            v_slot_opcional := v_slot_opcional || false;

            v_slot_passo := v_slot_passo || 'intervalo_retorno'::text;
            v_slot_prev  := v_slot_prev  || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
            v_slot_bloco := v_slot_bloco || r.bloco_ordem;
            v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
            v_slot_data  := v_slot_data  || r.dia_ref;
            v_slot_piso  := v_slot_piso  || (r.inicio_previsto + interval '60 minutes');
            v_slot_opcional := v_slot_opcional || false;
        END IF;

        -- saida
        v_slot_passo := v_slot_passo || 'saida'::text;
        v_slot_prev  := v_slot_prev  || r.fim_previsto;
        v_slot_bloco := v_slot_bloco || r.bloco_ordem;
        v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
        v_slot_data  := v_slot_data  || r.dia_ref;
        v_slot_piso  := v_slot_piso  || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);
        v_slot_opcional := v_slot_opcional || false;

        -- 1.a-0 DONO DE CADA PASSO DO BLOCO (20260823100000)
        -- A entrada do bloco pertence ao PRIMEIRO turno, a saida ao ULTIMO, e o intervalo ao
        -- turno cuja janela o contem. Sem isto a projecao copia o par do bloco para TODAS as
        -- linhas dele, e a linha do expediente recebe a saida do plantao — 18h03 de hora extra
        -- indevida em 08/2026, medido em 23/08/2026.
        IF COALESCE(array_length(r.escala_diaria_ids, 1), 0) > 0 THEN
            FOR i IN 1..array_length(r.escala_diaria_ids, 1) LOOP
                v_turnos := v_turnos || jsonb_build_object(
                    'escala_diaria_id', (r.escala_diaria_ids)[i],
                    'bloco',            r.bloco_ordem,
                    'ordem',            i,
                    'total',            array_length(r.escala_diaria_ids, 1),
                    'inicio',           COALESCE((r.turnos_inicio)[i], r.inicio_previsto),
                    'fim',              COALESCE((r.turnos_fim)[i],    r.fim_previsto));
            END LOOP;
        END IF;

        -- 1.a BATIDA DE TRANSICAO
        -- Um bloco pode ser a fusao de ate 3 turnos (armadilha 6). Na fronteira entre dois
        -- deles a pessoa pode bater duas vezes — fechando um turno e abrindo o outro — e ate
        -- aqui essas batidas viravam "fora_da_janela", porque o bloco so tinha os 4 passos do
        -- conjunto. Medido em producao em 19/08/2026 (MAISA, 18/08): bateu 07:04, 13:07, 13:10
        -- e 19:09 num Regular 07:00-13:00 + Plantao 13:00-19:00, e as duas do meio se perderam.
        --
        -- Os slots abaixo sao gravados na LINHA de cada turno (um unico escala_diaria_id), nao
        -- no bloco inteiro — e por isso que a folha e o anexo passam a saber onde o plantao
        -- comecou de fato. Nada e fabricado: sem batida, nao ha alocacao nem pendencia.
        IF COALESCE(array_length(r.turnos_fim, 1), 0) > 1 THEN
            FOR i IN 1..(array_length(r.turnos_fim, 1) - 1) LOOP
                -- fecha o turno i
                v_slot_passo    := v_slot_passo    || 'saida'::text;
                v_slot_prev     := v_slot_prev     || (r.turnos_fim)[i];
                v_slot_bloco    := v_slot_bloco    || r.bloco_ordem;
                v_slot_ids      := v_slot_ids      || (r.escala_diaria_ids)[i]::text;
                v_slot_data     := v_slot_data     || r.dia_ref;
                v_slot_piso     := v_slot_piso     || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);
                v_slot_opcional := v_slot_opcional || true;

                -- abre o turno i + 1
                v_slot_passo    := v_slot_passo    || 'entrada'::text;
                v_slot_prev     := v_slot_prev     || (r.turnos_inicio)[i + 1];
                v_slot_bloco    := v_slot_bloco    || r.bloco_ordem;
                v_slot_ids      := v_slot_ids      || (r.escala_diaria_ids)[i + 1]::text;
                v_slot_data     := v_slot_data     || r.dia_ref;
                v_slot_piso     := v_slot_piso     || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);
                v_slot_opcional := v_slot_opcional || true;
            END LOOP;
        END IF;
    END LOOP;

    -- 1.b SLOTS-SOMBRA
    -- Mesmos dias vizinhos, mas os blocos que NAO entraram acima: os de ontem que terminam
    -- antes da meia-noite e todos os de amanha. Servem so de referencia de proximidade.
    -- O guard de escopo de fn_blocos_previstos_dia levanta insufficient_privilege quando o
    -- servidor nao tem escala no mes do dia vizinho (dia 1 e dia 31, chamada por usuario
    -- autenticado). Ai a regra do dono simplesmente nao se aplica — o piso continua valendo.
    BEGIN
        FOR r IN
            SELECT d.dia_ref, b.*
              FROM (VALUES (p_data - 1), (p_data + 1)) AS d(dia_ref)
              CROSS JOIN LATERAL public.fn_blocos_previstos_dia(p_servidor_id, d.dia_ref) b
             WHERE NOT (d.dia_ref = p_data - 1 AND b.fim_previsto > v_meia_noite)
             ORDER BY b.inicio_previsto
        LOOP
            v_sombra_prev := v_sombra_prev || r.inicio_previsto;
            IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN
                v_sombra_prev := v_sombra_prev || r.intervalo_inicio_previsto;
                v_sombra_prev := v_sombra_prev || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
            END IF;
            v_sombra_prev := v_sombra_prev || r.fim_previsto;
        END LOOP;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_sombra_prev := '{}';
    END;

    n_sombras := COALESCE(array_length(v_sombra_prev, 1), 0);

    -- O DP e um alinhamento monotonico: ele casa a k-esima batida com o s-esimo slot sem
    -- cruzar. Os slots de fronteira nascem no fim do array (13:00 depois da saida das 19:00),
    -- entao sem esta ordenacao o alinhamento fica impossivel e a batida de transicao seria
    -- recusada exatamente como antes. Ordena por instante previsto, mantendo a ordem de
    -- insercao no empate — o que fecha um turno vem antes do que abre o seguinte.
    IF COALESCE(array_length(v_slot_passo, 1), 0) > 1 THEN
        SELECT array_agg(t.passo ORDER BY t.prev, t.ord),
               array_agg(t.prev  ORDER BY t.prev, t.ord),
               array_agg(t.bloco ORDER BY t.prev, t.ord),
               array_agg(t.ids   ORDER BY t.prev, t.ord),
               array_agg(t.dta   ORDER BY t.prev, t.ord),
               array_agg(t.piso  ORDER BY t.prev, t.ord),
               array_agg(t.opc   ORDER BY t.prev, t.ord)
          INTO v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional
          FROM unnest(v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional)
               WITH ORDINALITY AS t(passo, prev, bloco, ids, dta, piso, opc, ord);
    END IF;

    n_slots := COALESCE(array_length(v_slot_passo, 1), 0);

    IF n_slots > 0 THEN
        SELECT min(t), max(t) INTO v_busca_ini, v_busca_fim FROM unnest(v_slot_prev) AS t;
        v_busca_ini := v_busca_ini - make_interval(mins => v_tol_ontem);
        v_busca_fim := v_busca_fim + make_interval(mins => v_tol_ontem);
    ELSE
        v_busca_ini := v_meia_noite;
        v_busca_fim := v_meia_noite + interval '1 day';
    END IF;

    v_win_marcacao := array_fill(NULL::uuid,    ARRAY[GREATEST(n_slots, 1)]);
    v_win_peso     := array_fill(999,           ARRAY[GREATEST(n_slots, 1)]);
    v_win_dist     := array_fill(NULL::numeric, ARRAY[GREATEST(n_slots, 1)]);

    -- 2. UM DP POR ORIGEM
    FOREACH v_origem IN ARRAY enum_range(NULL::public.marcacao_origem)
    LOOP
        DECLARE
            v_m_id      uuid[]        := '{}';
            v_m_ts      timestamptz[] := '{}';
            n_marc      integer;
            v_custo     numeric[];
            v_escolha   integer[];
            v_dist      numeric;
            v_melhor    numeric;
            v_op        integer;
            v_ant_ts    timestamptz;
            v_ant_id    uuid;
            v_ts_real   timestamptz;
            v_ts_som    timestamptz;
            v_d_real    numeric;
            v_d_som     numeric;
            k           integer;
            s           integer;
        BEGIN
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
                -- REGRA DO DONO: a batida e do dia cujo passo previsto esta mais perto dela.
                -- Sem isto, a mesma batida podia ser a saida de ontem E a entrada de hoje —
                -- cada dia reconcilia sozinho e nenhum sabe do outro. O desempate por
                -- timestamp do slot garante que os dois dias cheguem a decisoes opostas:
                -- exatamente um fica com ela.
                IF n_sombras > 0 THEN
                    SELECT t INTO v_ts_real FROM unnest(v_slot_prev) AS t
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - t))), t LIMIT 1;
                    SELECT t INTO v_ts_som  FROM unnest(v_sombra_prev) AS t
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - t))), t LIMIT 1;
                    IF v_ts_real IS NOT NULL AND v_ts_som IS NOT NULL THEN
                        v_d_real := abs(extract(epoch FROM (r.ocorrido_em - v_ts_real)));
                        v_d_som  := abs(extract(epoch FROM (r.ocorrido_em - v_ts_som)));
                        IF v_d_som < v_d_real
                           OR (v_d_som = v_d_real AND v_ts_som < v_ts_real) THEN
                            CONTINUE;
                        END IF;
                    END IF;
                END IF;

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
                FOR k IN 1..n_marc LOOP
                    v_pendencias := v_pendencias || jsonb_build_object(
                        'tipo', 'sem_escala', 'marcacao_id', v_m_id[k],
                        'ocorrido_em', v_m_ts[k], 'origem', v_origem);
                END LOOP;
                CONTINUE;
            END IF;

            v_custo   := array_fill(0::numeric, ARRAY[(n_marc + 1) * (n_slots + 1)]);
            v_escolha := array_fill(0,          ARRAY[(n_marc + 1) * (n_slots + 1)]);

            FOR k IN 0..n_marc LOOP
                v_custo[k * (n_slots + 1) + 0 + 1] := k * (v_tol_ontem * 2);
            END LOOP;
            FOR s IN 0..n_slots LOOP
                v_custo[0 * (n_slots + 1) + s + 1] := s * (v_tol_ontem * 2);
            END LOOP;

            FOR k IN 1..n_marc LOOP
                FOR s IN 1..n_slots LOOP
                    v_dist := abs(extract(epoch FROM (v_m_ts[k] - v_slot_prev[s])) / 60.0);

                    v_melhor := v_custo[(k - 1) * (n_slots + 1) + s + 1] + (v_tol_ontem * 2);
                    v_op     := 1;

                    IF v_custo[k * (n_slots + 1) + (s - 1) + 1] + (v_tol_ontem * 2) < v_melhor THEN
                        v_melhor := v_custo[k * (n_slots + 1) + (s - 1) + 1] + (v_tol_ontem * 2);
                        v_op     := 2;
                    END IF;

                    IF v_dist <= v_tol_ontem
                       AND v_m_ts[k] >= v_slot_piso[s]
                       AND v_custo[(k - 1) * (n_slots + 1) + (s - 1) + 1] + v_dist < v_melhor THEN
                        v_melhor := v_custo[(k - 1) * (n_slots + 1) + (s - 1) + 1] + v_dist;
                        v_op     := 3;
                    END IF;

                    v_custo[k * (n_slots + 1) + s + 1]   := v_melhor;
                    v_escolha[k * (n_slots + 1) + s + 1] := v_op;
                END LOOP;
            END LOOP;

            k := n_marc;
            s := n_slots;
            WHILE k > 0 OR s > 0 LOOP
                v_op := v_escolha[k * (n_slots + 1) + s + 1];
                IF v_op = 3 THEN
                    v_dist := abs(extract(epoch FROM (v_m_ts[k] - v_slot_prev[s])) / 60.0);
                    IF public.fn_precedencia_origem(v_origem) < v_win_peso[s] THEN
                        IF v_win_marcacao[s] IS NOT NULL THEN
                            v_substituidas := v_substituidas || jsonb_build_object(
                                'slot', s, 'passo', v_slot_passo[s],
                                'marcacao_substituida_id', v_win_marcacao[s],
                                'vencedor_marcacao_id',    v_m_id[k],
                                'vencedor_origem',         v_origem);
                        END IF;
                        v_win_marcacao[s] := v_m_id[k];
                        v_win_peso[s]     := public.fn_precedencia_origem(v_origem);
                        v_win_dist[s]     := v_dist;
                    END IF;
                    k := k - 1;
                    s := s - 1;
                ELSIF v_op = 1 THEN
                    v_pendencias := v_pendencias || jsonb_build_object(
                        'tipo', 'fora_da_janela', 'marcacao_id', v_m_id[k],
                        'ocorrido_em', v_m_ts[k], 'origem', v_origem);
                    k := k - 1;
                ELSIF v_op = 2 THEN
                    s := s - 1;
                ELSE
                    IF k > 0 THEN
                        v_pendencias := v_pendencias || jsonb_build_object(
                            'tipo', 'fora_da_janela', 'marcacao_id', v_m_id[k],
                            'ocorrido_em', v_m_ts[k], 'origem', v_origem);
                        k := k - 1;
                    END IF;
                    IF s > 0 THEN s := s - 1; END IF;
                END IF;
            END LOOP;
        END;
    END LOOP;

    -- 2.b ESPELHO DA BATIDA DE TRANSICAO SOLITARIA (20260823100000)
    -- Os dois slots de uma fronteira sao previstos no MESMO instante, mas o DP e 1-para-1:
    -- uma batida ocupa um slot so. Quem batia UMA vez na transicao fechava o turno e nao abria
    -- o seguinte, e a linha do turno seguinte voltava a herdar a entrada do bloco (AGNA, mat.
    -- 205, dias 3 e 4 de 08/2026: entrada do plantao ficou com as 07:46 do expediente).
    --
    -- Espelhar NAO fabrica nada: e a MESMA marcacao real servindo aos dois lados da fronteira,
    -- que e o comportamento ja desejado entre blocos encostados (armadilha 6 do CLAUDE.md).
    -- Duas batidas distintas continuam vencendo — o espelho so age quando o irmao esta VAZIO,
    -- entao os dias com 4 batidas nao mudam em nada.
    --
    -- E isto que derruba a regra folclorica de "sair e esperar 5 minutos para bater de novo":
    -- a segunda batida em menos de rep_janela_duplicidade_segundos (60) e descartada como
    -- duplicada, entao a regra real nunca foi 5 minutos, era 1 minuto. Agora e nenhuma.
    IF n_slots > 1 THEN
        FOR s IN 1..(n_slots - 1) LOOP
            IF COALESCE(v_slot_opcional[s], false)
               AND COALESCE(v_slot_opcional[s + 1], false)
               AND v_slot_passo[s]     = 'saida'
               AND v_slot_passo[s + 1] = 'entrada'
               AND v_slot_prev[s]      = v_slot_prev[s + 1] THEN
                IF v_win_marcacao[s] IS NOT NULL AND v_win_marcacao[s + 1] IS NULL THEN
                    v_win_marcacao[s + 1] := v_win_marcacao[s];
                    v_win_peso[s + 1]     := v_win_peso[s];
                    v_win_dist[s + 1]     := v_win_dist[s];
                ELSIF v_win_marcacao[s + 1] IS NOT NULL AND v_win_marcacao[s] IS NULL THEN
                    v_win_marcacao[s] := v_win_marcacao[s + 1];
                    v_win_peso[s]     := v_win_peso[s + 1];
                    v_win_dist[s]     := v_win_dist[s + 1];
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- 3. CONSOLIDA ALOCACOES E PASSOS SEM MARCACAO
    IF n_slots > 0 THEN
        FOR s IN 1..n_slots LOOP
            IF v_win_marcacao[s] IS NOT NULL THEN
                v_alocacoes := v_alocacoes || jsonb_build_object(
                    'bloco',             v_slot_bloco[s],
                    'passo',             v_slot_passo[s],
                    'previsto',          v_slot_prev[s],
                    'data_bloco',        v_slot_data[s],
                    'fronteira',         COALESCE(v_slot_opcional[s], false),
                    'marcacao_id',       v_win_marcacao[s],
                    'distancia_min',     round(v_win_dist[s]),
                    'escala_diaria_ids', string_to_array(v_slot_ids[s], ',')::uuid[]);
            ELSIF NOT COALESCE(v_slot_opcional[s], false) THEN
                v_pendencias := v_pendencias || jsonb_build_object(
                    'tipo',              'passo_sem_marcacao',
                    'bloco',             v_slot_bloco[s],
                    'passo',             v_slot_passo[s],
                    'previsto',          v_slot_prev[s],
                    'data_bloco',        v_slot_data[s],
                    'escala_diaria_ids', string_to_array(v_slot_ids[s], ',')::uuid[]);
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'servidor_id',   p_servidor_id,
        'data',          p_data,
        'slots',         n_slots,
        'alocacoes',     v_alocacoes,
        'pendencias',    v_pendencias,
        'substituidas',  v_substituidas,
        'turnos',        v_turnos
    );
END;
$fnaloc$;

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
    v_intervalo_flexivel BOOLEAN;
    
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

    -- Today/Yesterday shifts (up to 3 supported)
    v_s1_id UUID; v_s1_inicio INTEGER; v_s1_fim INTEGER; v_s1_entrada TIMESTAMP WITH TIME ZONE; v_s1_int_saida TIMESTAMP WITH TIME ZONE; v_s1_int_retorno TIMESTAMP WITH TIME ZONE; v_s1_saida TIMESTAMP WITH TIME ZONE; v_s1_cat TEXT; v_s1_int_ini_min INTEGER; v_s1_int_fim_min INTEGER; v_s1_permite_int BOOLEAN; v_s1_dobra_diurna BOOLEAN;
    v_s2_id UUID; v_s2_inicio INTEGER; v_s2_fim INTEGER; v_s2_entrada TIMESTAMP WITH TIME ZONE; v_s2_int_saida TIMESTAMP WITH TIME ZONE; v_s2_int_retorno TIMESTAMP WITH TIME ZONE; v_s2_saida TIMESTAMP WITH TIME ZONE; v_s2_cat TEXT; v_s2_int_ini_min INTEGER; v_s2_int_fim_min INTEGER; v_s2_permite_int BOOLEAN; v_s2_dobra_diurna BOOLEAN;
    v_s3_id UUID; v_s3_inicio INTEGER; v_s3_fim INTEGER; v_s3_entrada TIMESTAMP WITH TIME ZONE; v_s3_int_saida TIMESTAMP WITH TIME ZONE; v_s3_int_retorno TIMESTAMP WITH TIME ZONE; v_s3_saida TIMESTAMP WITH TIME ZONE; v_s3_cat TEXT; v_s3_int_ini_min INTEGER; v_s3_int_fim_min INTEGER; v_s3_permite_int BOOLEAN; v_s3_dobra_diurna BOOLEAN;

    -- Today/Yesterday blocks (up to 3 blocks)
    v_b1_inicio INTEGER; v_b1_fim INTEGER; v_b1_ids UUID[]; v_b1_turnos_ini INTEGER[]; v_b1_turnos_fim INTEGER[]; v_b1_entradas TIMESTAMP WITH TIME ZONE[]; v_b1_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b1_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b1_saidas TIMESTAMP WITH TIME ZONE[]; v_b1_cat TEXT; v_b1_int_ini INTEGER; v_b1_int_fim INTEGER; v_b1_permite_int BOOLEAN;
    v_b2_inicio INTEGER; v_b2_fim INTEGER; v_b2_ids UUID[]; v_b2_turnos_ini INTEGER[]; v_b2_turnos_fim INTEGER[]; v_b2_entradas TIMESTAMP WITH TIME ZONE[]; v_b2_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b2_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b2_saidas TIMESTAMP WITH TIME ZONE[]; v_b2_cat TEXT; v_b2_int_ini INTEGER; v_b2_int_fim INTEGER; v_b2_permite_int BOOLEAN;
    v_b3_inicio INTEGER; v_b3_fim INTEGER; v_b3_ids UUID[]; v_b3_turnos_ini INTEGER[]; v_b3_turnos_fim INTEGER[]; v_b3_entradas TIMESTAMP WITH TIME ZONE[]; v_b3_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b3_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b3_saidas TIMESTAMP WITH TIME ZONE[]; v_b3_cat TEXT; v_b3_int_ini INTEGER; v_b3_int_fim INTEGER; v_b3_permite_int BOOLEAN;

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
    SELECT s.id, s.unidade_id, s.setor_id, s.ignora_janela_presenca, COALESCE(s.intervalo_flexivel, false)
    INTO v_servidor_id, v_servidor_unidade_id, v_servidor_setor_id, v_ignora_janela, v_intervalo_flexivel
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
            IF v_coord_todas_unidades THEN
                v_has_unit_access := true;
            ELSE
                SELECT EXISTS (
                    SELECT 1 FROM public.profile_unidades 
                    WHERE profile_id = p_coordenador_id AND unidade_id = v_servidor_unidade_id
                ) INTO v_has_unit_access;
            END IF;

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
            SELECT EXISTS (
                SELECT 1 
                FROM public.escala_diaria ed
                JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
                WHERE em.servidor_id = v_servidor_id
                  AND em.mes = v_mes_ontem
                  AND em.ano = v_ano_ontem
                  AND ed.dia = v_dia_ontem
                  AND ed.categoria IN ('Regular', 'Plantão', 'Extra', 'Sobreaviso')
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

            SELECT EXISTS (
                SELECT 1 
                FROM public.escala_diaria ed
                JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
                WHERE em.servidor_id = v_servidor_id
                  AND em.mes = v_mes
                  AND em.ano = v_ano
                  AND ed.dia = v_dia_hoje
                  AND ed.categoria IN ('Regular', 'Plantão', 'Extra', 'Sobreaviso')
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
            PERFORM public.fn_log_tentativa_negada(
                v_servidor_id, 
                p_matricula, 
                p_coordenador_id, 
                'Sem permissão para validar este servidor nesta unidade/setor.', 
                NULL, NULL, NULL, NULL, NULL, NULL, NULL
            );
            RETURN jsonb_build_object('success', false, 'message', 'Sem permissão para validar este servidor nesta unidade/setor.');
        END IF;
    END;

    -- Check yesterday's shifts first (for overnight shift exit)
    v_s1_id := NULL; v_s2_id := NULL; v_s3_id := NULL;
    v_b1_ids := '{}'; v_b2_ids := '{}'; v_b3_ids := '{}';
    v_shifts_count := 0;

    FOR r IN 
        SELECT 
            ed.id as escala_diaria_id, 
            ed.presenca_entrada_em, 
            ed.presenca_intervalo_saida_em,
            ed.presenca_intervalo_retorno_em,
            ed.presenca_saida_em, 
            ed.categoria::text as categoria,
            dt.horas_computadas, 
            j.nome as jornada_nome, 
            j.horas_totais,
            -- Os DOIS cadastros, CRUS. A resolucao (qual deles vale, e o piso legal do Art. 71)
            -- acontece em public.fn_intervalo_previsto_minutos, que precisa da duracao EFETIVA
            -- do turno - e essa so existe depois do calculo de v_start_min/v_end_min, abaixo.
            -- Ver 20260822120000.
            --
            -- NAO voltar a resolver aqui. Era exatamente o COALESCE(j.intervalo_minutos, 60)
            -- aplicado a QUALQUER categoria que fazia o zero de uma jornada de 6h suprimir o
            -- intervalo de um plantao de 12h (106 lancamentos medidos em 22/08/2026).
            j.intervalo_minutos as jornada_intervalo_minutos,
            dt.intervalo_minutos as turno_intervalo_minutos,
            j.intervalo_inicio_padrao,
            j.intervalo_fim_padrao,
            s.intervalo_inicio_personalizado,
            s.intervalo_fim_personalizado,
            COALESCE(u.permite_marca_intervalo, false) as permite_marca_intervalo,
            -- Marca o plantao diurno que cai em dia de jornada noturna. Um turno marcado assim
            -- NAO FUNDE com nenhum outro bloco: sao duas jornadas de 12h, cada uma com seu
            -- proprio intervalo, e um bloco so carrega UM intervalo
            -- (v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min)). Fundir apagaria
            -- o intervalo da segunda jornada. NAO REMOVER.
            (ed.categoria = 'Plantão'
             AND COALESCE(dt.slots[1], '') IN ('M', 'T')
             AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
               < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
            ) as dobra_diurna,
            COALESCE(
                -- NIVEL 1 da cadeia de precedencia de horario (o mais alto). Ver
                -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
                --
                -- Hora que o COORDENADOR informou ao escalar. E o unico nivel capaz de resolver os
                -- codigos em que o codigo do turno da a duracao e o periodo, mas nao a hora:
                -- T4, N4, N6, M7 ("M2 sao 2h em qualquer ponto da manha").
                --
                -- NULL por padrao em toda linha existente, entao nao muda NADA ate alguem preencher.
                --
                -- NAO vale para Regular: la o nome da jornada continua mandando, e mexer nisso
                -- afetaria folha de ponto e motor de compliance. NAO REMOVER ESTA CONDICAO.
                CASE WHEN ed.categoria <> 'Regular'
                     THEN extract(hour from ed.hora_inicio_prevista)::integer END,
                CASE WHEN ed.categoria = 'Regular' THEN
                    COALESCE(
                        CASE 
                          WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                              substring(j.nome from '^([0-9]+)')::integer
                          ELSE NULL
                        END,
                        CASE 
                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                          
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
                CASE WHEN ed.categoria = 'Plantão' THEN
                    COALESCE(
                        -- NIVEL 2 da cadeia de precedencia de horario. Ver
                        -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
                        --
                        -- Ancora fixa do codigo do turno (M, T, N, MT). Devolve NULL para os outros 60
                        -- codigos, entao a cascata abaixo continua valendo sem nenhuma mudanca.
                        --
                        -- SO VALE QUANDO NAO HA TURNO REGULAR NO DIA. Havendo Regular, o plantao e
                        -- sequencia do expediente e o alinhamento da cascata esta correto - forcar a
                        -- ancora ali sobreporia o plantao ao turno Regular (medido em 49 dias reais de
                        -- producao em 08/08/2026). NAO REMOVER ESTA CONDICAO.
                        -- NIVEL 2-A da cadeia de precedencia. Ver
                        -- docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md
                        --
                        -- ESPELHO DA JORNADA NOTURNA. Quando o Regular do dia CRUZA A MEIA-NOITE
                        -- (18H AS 06H), o plantao de periodo diurno NAO e sequencia do expediente:
                        -- ele vem ANTES dele. A cascata legada alinhava o plantao pelo INICIO da
                        -- jornada (18:00) e o sobrepunha inteiro ao Regular. A ancora correta e o
                        -- FIM da jornada - a "manha" de quem faz noite comeca quando a noite dela
                        -- terminaria (06:00).
                        --
                        -- Vale so para slots[1] em (M, T), o codigo que declara o periodo. Codigo de
                        -- duracao livre (slots[1] numerico) continua resolvendo pelo NIVEL 1, acima.
                        -- Fica ACIMA do nivel 2 porque a ancora fixa do dicionario (MT = 07:00) nao
                        -- conhece a jornada do servidor e erraria por uma hora.
                        CASE WHEN COALESCE(dt.slots[1], '') IN ('M', 'T')
                                  AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
                                    < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                             THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer END,
                        CASE WHEN public.fn_obter_horario_regular_dia(em.id, ed.dia) IS NULL
                             THEN extract(hour from dt.horario_inicio)::integer END,
                        CASE 
                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                              substring(j.nome from '^([0-9]+)')::integer
                          
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
                                        WHEN dt2.slots[1] = 'N' THEN 7 + 24
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
                CASE 
                  WHEN dt.codigo = 'T4' THEN 14
                  WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                  WHEN dt.slots[1] = 'M' THEN 7
                  WHEN dt.slots[1] = 'T' THEN 13
                  WHEN dt.slots[1] = 'N' THEN 19
                  ELSE 7
                END
            ) as start_hour
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        JOIN public.servidores s ON em.servidor_id = s.id
        JOIN public.unidades u ON em.unidade_id = u.id
        JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
        LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
        WHERE em.servidor_id = v_servidor_id
          AND em.mes = v_mes_ontem
          AND em.ano = v_ano_ontem
          AND ed.dia = v_dia_ontem
          -- Sobreaviso NAO marca presenca: fica fora da montagem de blocos.
          -- Seu ciclo vive em logs_sobreaviso. NAO REINCLUIR.
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
            v_int_ini_min INTEGER;
            v_int_fim_min INTEGER;
            v_int_dur INTEGER;
            v_permite_int BOOLEAN;
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

            -- GUARD RESTAURADO (regressao de 20260804080000). NAO REMOVER.
            -- Trabalho continuo de ate 6h nao possui intervalo intrajornada (CLT Art. 71,
            -- caput; decisao do usuario em 22/08/2026: ate 6h registra so entrada e saida).
            --
            -- ⚠️ AS DUAS PONTAS SAO DO TURNO, NAO DA JORNADA REGULAR DO SERVIDOR:
            --   duracao  = v_end_min - v_start_min, que para Plantao/Extra ja vinha do turno;
            --   intervalo= fn_intervalo_previsto_minutos, que passou a vir do turno tambem.
            -- Ate 20260822120000 so a primeira era. O intervalo_minutos = 0 de uma jornada de
            -- 6h anulava este guard inteiro num plantao de 12h.
            v_permite_int := COALESCE(r.permite_marca_intervalo, false)
                AND public.fn_jornada_tem_intervalo(
                        v_end_min - v_start_min,
                        public.fn_intervalo_previsto_minutos(
                            r.categoria, v_end_min - v_start_min,
                            r.jornada_intervalo_minutos, r.turno_intervalo_minutos));
            IF v_permite_int THEN
                v_int_ini_min := CASE
                    WHEN r.intervalo_inicio_personalizado IS NOT NULL THEN
                        extract(hour from r.intervalo_inicio_personalizado)::integer * 60 + extract(minute from r.intervalo_inicio_personalizado)::integer
                    WHEN r.intervalo_inicio_padrao IS NOT NULL THEN
                        extract(hour from r.intervalo_inicio_padrao)::integer * 60 + extract(minute from r.intervalo_inicio_padrao)::integer
                    ELSE
                        v_start_min + 240
                END;

                v_int_fim_min := CASE
                    WHEN r.intervalo_fim_personalizado IS NOT NULL THEN
                        extract(hour from r.intervalo_fim_personalizado)::integer * 60 + extract(minute from r.intervalo_fim_personalizado)::integer
                    WHEN r.intervalo_fim_padrao IS NOT NULL THEN
                        extract(hour from r.intervalo_fim_padrao)::integer * 60 + extract(minute from r.intervalo_fim_padrao)::integer
                    ELSE
                        v_int_ini_min + public.fn_intervalo_previsto_minutos(
                            r.categoria, v_end_min - v_start_min,
                            r.jornada_intervalo_minutos, r.turno_intervalo_minutos)
                END;

                -- O intervalo previsto tem que cair DENTRO do turno. jornadas.intervalo_*_padrao
                -- e HORA ABSOLUTA (12:00), entao num plantao 19:00 -> 07:00 ele nascia antes da
                -- propria entrada. Medido em 9 blocos de agosto/2026, todos plantao noturno; e o
                -- que deixava a linha do plantao com intervalo as 13:02 e entrada as 19:03.
                -- Ver 20260819220000.
                --
                -- 1. Turno que cruza a meia-noite: a hora absoluta do padrao pode pertencer ao
                --    dia seguinte. 22:00 num turno 19:00 -> 07:00 ja esta certo; 01:00 e 01:00
                --    do dia seguinte, e so somar um dia resolve.
                IF v_int_ini_min < v_start_min AND (v_int_ini_min + 1440) <= v_end_min THEN
                    v_int_ini_min := v_int_ini_min + 1440;
                    v_int_fim_min := v_int_fim_min + 1440;
                END IF;

                -- 2. Ainda fora do turno: o padrao da jornada nao serve para ESTE turno. Cai
                --    para o relativo (o mesmo fallback de quem nao tem padrao), preservando a
                --    DURACAO que o padrao definia — 12:00-14:00 continua valendo 2h.
                IF v_int_ini_min < v_start_min OR v_int_fim_min > v_end_min THEN
                    v_int_dur     := GREATEST(COALESCE(v_int_fim_min - v_int_ini_min, 0),
                                              public.fn_intervalo_previsto_minutos(
                                                  r.categoria, v_end_min - v_start_min,
                                                  r.jornada_intervalo_minutos, r.turno_intervalo_minutos));
                    v_int_ini_min := v_start_min + 240;
                    v_int_fim_min := v_int_ini_min + v_int_dur;

                    -- Nao cabe nem com o relativo (turno curto): centraliza no turno.
                    IF v_int_fim_min > v_end_min THEN
                        v_int_ini_min := v_start_min + GREATEST(((v_end_min - v_start_min) - v_int_dur) / 2, 0);
                        v_int_fim_min := v_int_ini_min + v_int_dur;
                    END IF;
                END IF;
            END IF;

            IF v_shifts_count = 1 THEN
                v_s1_id := r.escala_diaria_id; v_s1_inicio := v_start_min; v_s1_fim := v_end_min; v_s1_entrada := r.presenca_entrada_em; v_s1_int_saida := r.presenca_intervalo_saida_em; v_s1_int_retorno := r.presenca_intervalo_retorno_em; v_s1_saida := r.presenca_saida_em; v_s1_cat := r.categoria; v_s1_int_ini_min := v_int_ini_min; v_s1_int_fim_min := v_int_fim_min; v_s1_permite_int := v_permite_int; v_s1_dobra_diurna := COALESCE(r.dobra_diurna, false);
            ELSIF v_shifts_count = 2 THEN
                v_s2_id := r.escala_diaria_id; v_s2_inicio := v_start_min; v_s2_fim := v_end_min; v_s2_entrada := r.presenca_entrada_em; v_s2_int_saida := r.presenca_intervalo_saida_em; v_s2_int_retorno := r.presenca_intervalo_retorno_em; v_s2_saida := r.presenca_saida_em; v_s2_cat := r.categoria; v_s2_int_ini_min := v_int_ini_min; v_s2_int_fim_min := v_int_fim_min; v_s2_permite_int := v_permite_int; v_s2_dobra_diurna := COALESCE(r.dobra_diurna, false);
            ELSIF v_shifts_count = 3 THEN
                v_s3_id := r.escala_diaria_id; v_s3_inicio := v_start_min; v_s3_fim := v_end_min; v_s3_entrada := r.presenca_entrada_em; v_s3_int_saida := r.presenca_intervalo_saida_em; v_s3_int_retorno := r.presenca_intervalo_retorno_em; v_s3_saida := r.presenca_saida_em; v_s3_cat := r.categoria; v_s3_int_ini_min := v_int_ini_min; v_s3_int_fim_min := v_int_fim_min; v_s3_permite_int := v_permite_int; v_s3_dobra_diurna := COALESCE(r.dobra_diurna, false);
            END IF;
        END;
    END LOOP;

    IF v_shifts_count > 0 THEN
        IF v_shifts_count = 1 THEN
            v_blocks_count := 1;
            v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
        ELSIF v_shifts_count = 2 THEN
            IF v_s2_inicio <= v_s1_fim
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'
               AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN
                v_blocks_count := 1;
                v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio, v_s2_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim, v_s2_fim]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
                v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
                v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
            ELSE
                v_blocks_count := 2;
                v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
                v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_turnos_ini := ARRAY[v_s2_inicio]; v_b2_turnos_fim := ARRAY[v_s2_fim]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat; v_b2_int_ini := v_s2_int_ini_min; v_b2_int_fim := v_s2_int_fim_min; v_b2_permite_int := v_s2_permite_int;
            END IF;
        ELSIF v_shifts_count >= 3 THEN
            IF v_s2_inicio <= v_s1_fim
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'
               AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN
                v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio, v_s2_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim, v_s2_fim]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
                v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
                v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
                
                IF v_s3_inicio <= v_b1_fim AND v_s3_cat <> 'Sobreaviso' AND NOT v_s3_dobra_diurna THEN
                    v_blocks_count := 1;
                    v_b1_fim := GREATEST(v_b1_fim, v_s3_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id, v_s3_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio, v_s2_inicio, v_s3_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim, v_s2_fim, v_s3_fim]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada, v_s3_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida, v_s3_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno, v_s3_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida, v_s3_saida];
                    v_b1_cat := CASE WHEN v_s3_cat IN ('Regular', 'Plantão') THEN v_s3_cat ELSE v_b1_cat END;
                ELSE
                    v_blocks_count := 2;
                    v_b2_inicio := v_s3_inicio; v_b2_fim := v_s3_fim; v_b2_ids := ARRAY[v_s3_id]; v_b2_turnos_ini := ARRAY[v_s3_inicio]; v_b2_turnos_fim := ARRAY[v_s3_fim]; v_b2_entradas := ARRAY[v_s3_entrada]; v_b2_int_saidas := ARRAY[v_s3_int_saida]; v_b2_int_retornos := ARRAY[v_s3_int_retorno]; v_b2_saidas := ARRAY[v_s3_saida]; v_b2_cat := v_s3_cat; v_b2_int_ini := v_s3_int_ini_min; v_b2_int_fim := v_s3_int_fim_min; v_b2_permite_int := v_s3_permite_int;
                END IF;
            ELSE
                v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
                
                IF v_s3_inicio <= v_s2_fim
                   AND v_s2_cat <> 'Sobreaviso' AND v_s3_cat <> 'Sobreaviso'
                   AND NOT v_s2_dobra_diurna AND NOT v_s3_dobra_diurna THEN
                    v_blocks_count := 2;
                    v_b2_inicio := v_s2_inicio; v_b2_fim := GREATEST(v_s2_fim, v_s3_fim); v_b2_ids := ARRAY[v_s2_id, v_s3_id]; v_b2_turnos_ini := ARRAY[v_s2_inicio, v_s3_inicio]; v_b2_turnos_fim := ARRAY[v_s2_fim, v_s3_fim]; v_b2_entradas := ARRAY[v_s2_entrada, v_s3_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida, v_s3_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno, v_s3_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida, v_s3_saida];
                    v_b2_cat := CASE WHEN v_s2_cat IN ('Regular', 'Plantão') THEN v_s2_cat ELSE v_s3_cat END;
                    v_b2_int_ini := COALESCE(v_s2_int_ini_min, v_s3_int_ini_min); v_b2_int_fim := COALESCE(v_s2_int_fim_min, v_s3_int_fim_min); v_b2_permite_int := COALESCE(v_s2_permite_int, v_s3_permite_int, false);
                ELSE
                    v_blocks_count := 3;
                    v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_turnos_ini := ARRAY[v_s2_inicio]; v_b2_turnos_fim := ARRAY[v_s2_fim]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat; v_b2_int_ini := v_s2_int_ini_min; v_b2_int_fim := v_s2_int_fim_min; v_b2_permite_int := v_s2_permite_int;
                    v_b3_inicio := v_s3_inicio; v_b3_fim := v_s3_fim; v_b3_ids := ARRAY[v_s3_id]; v_b3_turnos_ini := ARRAY[v_s3_inicio]; v_b3_turnos_fim := ARRAY[v_s3_fim]; v_b3_entradas := ARRAY[v_s3_entrada]; v_b3_int_saidas := ARRAY[v_s3_int_saida]; v_b3_int_retornos := ARRAY[v_s3_int_retorno]; v_b3_saidas := ARRAY[v_s3_saida]; v_b3_cat := v_s3_cat; v_b3_int_ini := v_s3_int_ini_min; v_b3_int_fim := v_s3_int_fim_min; v_b3_permite_int := v_s3_permite_int;
                END IF;
            END IF;
        END IF;

        -- Check yesterday's blocks for early morning checkout
        DECLARE
            idx INTEGER;
            v_b_inicio INTEGER; v_b_fim INTEGER; v_b_ids UUID[]; v_b_entradas TIMESTAMP WITH TIME ZONE[]; v_b_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b_saidas TIMESTAMP WITH TIME ZONE[]; v_b_cat TEXT; v_b_int_ini INTEGER; v_b_int_fim INTEGER; v_b_permite_int BOOLEAN;
            v_b_total_count INTEGER;
            -- Preenchidas pela copia do bloco, nao usadas aqui: o cursor de ontem so trata a
            -- saida. Declaradas para que o escopo case com o cursor de hoje.
            v_b_turnos_ini INTEGER[]; v_b_turnos_fim INTEGER[];
        BEGIN
            FOR idx IN 1..v_blocks_count LOOP
                IF idx = 1 THEN
                    v_b_inicio := v_b1_inicio; v_b_fim := v_b1_fim; v_b_ids := v_b1_ids; v_b_turnos_ini := v_b1_turnos_ini; v_b_turnos_fim := v_b1_turnos_fim; v_b_entradas := v_b1_entradas; v_b_int_saidas := v_b1_int_saidas; v_b_int_retornos := v_b1_int_retornos; v_b_saidas := v_b1_saidas; v_b_cat := v_b1_cat; v_b_int_ini := v_b1_int_ini; v_b_int_fim := v_b1_int_fim; v_b_permite_int := v_b1_permite_int;
                ELSIF idx = 2 THEN
                    v_b_inicio := v_b2_inicio; v_b_fim := v_b2_fim; v_b_ids := v_b2_ids; v_b_turnos_ini := v_b2_turnos_ini; v_b_turnos_fim := v_b2_turnos_fim; v_b_entradas := v_b2_entradas; v_b_int_saidas := v_b2_int_saidas; v_b_int_retornos := v_b2_int_retornos; v_b_saidas := v_b2_saidas; v_b_cat := v_b2_cat; v_b_int_ini := v_b2_int_ini; v_b_int_fim := v_b2_int_fim; v_b_permite_int := v_b2_permite_int;
                ELSE
                    v_b_inicio := v_b3_inicio; v_b_fim := v_b3_fim; v_b_ids := v_b3_ids; v_b_turnos_ini := v_b3_turnos_ini; v_b_turnos_fim := v_b3_turnos_fim; v_b_entradas := v_b3_entradas; v_b_int_saidas := v_b3_int_saidas; v_b_int_retornos := v_b3_int_retornos; v_b_saidas := v_b3_saidas; v_b_cat := v_b3_cat; v_b_int_ini := v_b3_int_ini; v_b_int_fim := v_b3_int_fim; v_b_permite_int := v_b3_permite_int;
                END IF;

                v_b_total_count := array_length(v_b_ids, 1);

                IF v_b_fim > 1440 THEN
                    IF v_b_entradas[1] IS NOT NULL AND v_b_saidas[v_b_total_count] IS NULL THEN
                        IF v_ignora_janela OR (
                           (v_momento_atual_minutos + 1440) >= (v_b_fim + public.fn_ajuste_intervalo_flexivel(v_intervalo_flexivel, v_b_int_saidas[1], v_b_int_retornos[1], v_b_int_fim - v_b_int_ini) - v_janela_minutos) AND
                           (v_momento_atual_minutos + 1440) <= (v_b_fim + public.fn_ajuste_intervalo_flexivel(v_intervalo_flexivel, v_b_int_saidas[1], v_b_int_retornos[1], v_b_int_fim - v_b_int_ini) + v_janela_minutos)
                        ) THEN
                            PERFORM public.fn_salvar_saida_bloco(v_b_ids, v_now, p_coordenador_id, v_timezone, false);

                            SELECT escala_mensal_id INTO v_escala_mensal_id FROM public.escala_diaria WHERE id = v_b_ids[1];
                            SELECT unidade_id INTO v_unidade_id FROM public.escala_mensal WHERE id = v_escala_mensal_id;

                            IF v_b_cat = 'Sobreaviso' THEN
                                UPDATE public.logs_sobreaviso
                                SET status = 'Chegou',
                                    data_hora_chegada = v_now,
                                    tipo_validacao_chegada = 'Terminal'
                                WHERE servidor_id = v_servidor_id 
                                  AND escala_mensal_id = v_escala_mensal_id 
                                  AND dia = v_dia_ontem 
                                  AND status IN ('Aguardando', 'Aceito');

                                IF NOT FOUND THEN
                                    INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_chegada, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria)
                                    VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_ontem, v_now, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA) via terminal.', 'Terminal', 'Sobreaviso');
                                END IF;
                            END IF;

                            RETURN jsonb_build_object('success', true, 'message', 'Saída do plantão de ontem confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!');
                        END IF;
                    END IF;
                END IF;
            END LOOP;
        END;
    END IF;

    -- Process today's shifts
    v_s1_id := NULL; v_s2_id := NULL; v_s3_id := NULL;
    v_b1_ids := '{}'; v_b2_ids := '{}'; v_b3_ids := '{}';
    v_shifts_count := 0;

    FOR r IN 
        SELECT 
            ed.id as escala_diaria_id, 
            ed.presenca_entrada_em, 
            ed.presenca_intervalo_saida_em,
            ed.presenca_intervalo_retorno_em,
            ed.presenca_saida_em, 
            ed.categoria::text as categoria,
            dt.horas_computadas, 
            j.nome as jornada_nome, 
            j.horas_totais,
            -- Os DOIS cadastros, CRUS. A resolucao (qual deles vale, e o piso legal do Art. 71)
            -- acontece em public.fn_intervalo_previsto_minutos, que precisa da duracao EFETIVA
            -- do turno - e essa so existe depois do calculo de v_start_min/v_end_min, abaixo.
            -- Ver 20260822120000.
            --
            -- NAO voltar a resolver aqui. Era exatamente o COALESCE(j.intervalo_minutos, 60)
            -- aplicado a QUALQUER categoria que fazia o zero de uma jornada de 6h suprimir o
            -- intervalo de um plantao de 12h (106 lancamentos medidos em 22/08/2026).
            j.intervalo_minutos as jornada_intervalo_minutos,
            dt.intervalo_minutos as turno_intervalo_minutos,
            j.intervalo_inicio_padrao,
            j.intervalo_fim_padrao,
            s.intervalo_inicio_personalizado,
            s.intervalo_fim_personalizado,
            COALESCE(u.permite_marca_intervalo, false) as permite_marca_intervalo,
            -- Marca o plantao diurno que cai em dia de jornada noturna. Um turno marcado assim
            -- NAO FUNDE com nenhum outro bloco: sao duas jornadas de 12h, cada uma com seu
            -- proprio intervalo, e um bloco so carrega UM intervalo
            -- (v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min)). Fundir apagaria
            -- o intervalo da segunda jornada. NAO REMOVER.
            (ed.categoria = 'Plantão'
             AND COALESCE(dt.slots[1], '') IN ('M', 'T')
             AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
               < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
            ) as dobra_diurna,
            COALESCE(
                -- NIVEL 1 da cadeia de precedencia de horario (o mais alto). Ver
                -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
                --
                -- Hora que o COORDENADOR informou ao escalar. E o unico nivel capaz de resolver os
                -- codigos em que o codigo do turno da a duracao e o periodo, mas nao a hora:
                -- T4, N4, N6, M7 ("M2 sao 2h em qualquer ponto da manha").
                --
                -- NULL por padrao em toda linha existente, entao nao muda NADA ate alguem preencher.
                --
                -- NAO vale para Regular: la o nome da jornada continua mandando, e mexer nisso
                -- afetaria folha de ponto e motor de compliance. NAO REMOVER ESTA CONDICAO.
                CASE WHEN ed.categoria <> 'Regular'
                     THEN extract(hour from ed.hora_inicio_prevista)::integer END,
                CASE WHEN ed.categoria = 'Regular' THEN
                    COALESCE(
                        CASE 
                          WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                              substring(j.nome from '^([0-9]+)')::integer
                          ELSE NULL
                        END,
                        CASE 
                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                          
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
                CASE WHEN ed.categoria = 'Plantão' THEN
                    COALESCE(
                        -- NIVEL 2 da cadeia de precedencia de horario. Ver
                        -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
                        --
                        -- Ancora fixa do codigo do turno (M, T, N, MT). Devolve NULL para os outros 60
                        -- codigos, entao a cascata abaixo continua valendo sem nenhuma mudanca.
                        --
                        -- SO VALE QUANDO NAO HA TURNO REGULAR NO DIA. Havendo Regular, o plantao e
                        -- sequencia do expediente e o alinhamento da cascata esta correto - forcar a
                        -- ancora ali sobreporia o plantao ao turno Regular (medido em 49 dias reais de
                        -- producao em 08/08/2026). NAO REMOVER ESTA CONDICAO.
                        -- NIVEL 2-A da cadeia de precedencia. Ver
                        -- docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md
                        --
                        -- ESPELHO DA JORNADA NOTURNA. Quando o Regular do dia CRUZA A MEIA-NOITE
                        -- (18H AS 06H), o plantao de periodo diurno NAO e sequencia do expediente:
                        -- ele vem ANTES dele. A cascata legada alinhava o plantao pelo INICIO da
                        -- jornada (18:00) e o sobrepunha inteiro ao Regular. A ancora correta e o
                        -- FIM da jornada - a "manha" de quem faz noite comeca quando a noite dela
                        -- terminaria (06:00).
                        --
                        -- Vale so para slots[1] em (M, T), o codigo que declara o periodo. Codigo de
                        -- duracao livre (slots[1] numerico) continua resolvendo pelo NIVEL 1, acima.
                        -- Fica ACIMA do nivel 2 porque a ancora fixa do dicionario (MT = 07:00) nao
                        -- conhece a jornada do servidor e erraria por uma hora.
                        CASE WHEN COALESCE(dt.slots[1], '') IN ('M', 'T')
                                  AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
                                    < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                             THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer END,
                        CASE WHEN public.fn_obter_horario_regular_dia(em.id, ed.dia) IS NULL
                             THEN extract(hour from dt.horario_inicio)::integer END,
                        CASE 
                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                              substring(j.nome from '^([0-9]+)')::integer
                          
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
                                        WHEN dt2.slots[1] = 'N' THEN 7 + 24
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
                CASE 
                  WHEN dt.codigo = 'T4' THEN 14
                  WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                  WHEN dt.slots[1] = 'M' THEN 7
                  WHEN dt.slots[1] = 'T' THEN 13
                  WHEN dt.slots[1] = 'N' THEN 19
                  ELSE 7
                END
            ) as start_hour
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        JOIN public.servidores s ON em.servidor_id = s.id
        JOIN public.unidades u ON em.unidade_id = u.id
        JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
        LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
        WHERE em.servidor_id = v_servidor_id
          AND em.mes = v_mes
          AND em.ano = v_ano
          AND ed.dia = v_dia_hoje
          -- Sobreaviso NAO marca presenca: fica fora da montagem de blocos.
          -- Seu ciclo vive em logs_sobreaviso. NAO REINCLUIR.
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
            v_int_ini_min INTEGER;
            v_int_fim_min INTEGER;
            v_int_dur INTEGER;
            v_permite_int BOOLEAN;
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

            -- GUARD RESTAURADO (regressao de 20260804080000). NAO REMOVER.
            -- Trabalho continuo de ate 6h nao possui intervalo intrajornada (CLT Art. 71,
            -- caput; decisao do usuario em 22/08/2026: ate 6h registra so entrada e saida).
            --
            -- ⚠️ AS DUAS PONTAS SAO DO TURNO, NAO DA JORNADA REGULAR DO SERVIDOR:
            --   duracao  = v_end_min - v_start_min, que para Plantao/Extra ja vinha do turno;
            --   intervalo= fn_intervalo_previsto_minutos, que passou a vir do turno tambem.
            -- Ate 20260822120000 so a primeira era. O intervalo_minutos = 0 de uma jornada de
            -- 6h anulava este guard inteiro num plantao de 12h.
            v_permite_int := COALESCE(r.permite_marca_intervalo, false)
                AND public.fn_jornada_tem_intervalo(
                        v_end_min - v_start_min,
                        public.fn_intervalo_previsto_minutos(
                            r.categoria, v_end_min - v_start_min,
                            r.jornada_intervalo_minutos, r.turno_intervalo_minutos));
            IF v_permite_int THEN
                v_int_ini_min := CASE
                    WHEN r.intervalo_inicio_personalizado IS NOT NULL THEN
                        extract(hour from r.intervalo_inicio_personalizado)::integer * 60 + extract(minute from r.intervalo_inicio_personalizado)::integer
                    WHEN r.intervalo_inicio_padrao IS NOT NULL THEN
                        extract(hour from r.intervalo_inicio_padrao)::integer * 60 + extract(minute from r.intervalo_inicio_padrao)::integer
                    ELSE
                        v_start_min + 240
                END;

                v_int_fim_min := CASE
                    WHEN r.intervalo_fim_personalizado IS NOT NULL THEN
                        extract(hour from r.intervalo_fim_personalizado)::integer * 60 + extract(minute from r.intervalo_fim_personalizado)::integer
                    WHEN r.intervalo_fim_padrao IS NOT NULL THEN
                        extract(hour from r.intervalo_fim_padrao)::integer * 60 + extract(minute from r.intervalo_fim_padrao)::integer
                    ELSE
                        v_int_ini_min + public.fn_intervalo_previsto_minutos(
                            r.categoria, v_end_min - v_start_min,
                            r.jornada_intervalo_minutos, r.turno_intervalo_minutos)
                END;

                -- O intervalo previsto tem que cair DENTRO do turno. jornadas.intervalo_*_padrao
                -- e HORA ABSOLUTA (12:00), entao num plantao 19:00 -> 07:00 ele nascia antes da
                -- propria entrada. Medido em 9 blocos de agosto/2026, todos plantao noturno; e o
                -- que deixava a linha do plantao com intervalo as 13:02 e entrada as 19:03.
                -- Ver 20260819220000.
                --
                -- 1. Turno que cruza a meia-noite: a hora absoluta do padrao pode pertencer ao
                --    dia seguinte. 22:00 num turno 19:00 -> 07:00 ja esta certo; 01:00 e 01:00
                --    do dia seguinte, e so somar um dia resolve.
                IF v_int_ini_min < v_start_min AND (v_int_ini_min + 1440) <= v_end_min THEN
                    v_int_ini_min := v_int_ini_min + 1440;
                    v_int_fim_min := v_int_fim_min + 1440;
                END IF;

                -- 2. Ainda fora do turno: o padrao da jornada nao serve para ESTE turno. Cai
                --    para o relativo (o mesmo fallback de quem nao tem padrao), preservando a
                --    DURACAO que o padrao definia — 12:00-14:00 continua valendo 2h.
                IF v_int_ini_min < v_start_min OR v_int_fim_min > v_end_min THEN
                    v_int_dur     := GREATEST(COALESCE(v_int_fim_min - v_int_ini_min, 0),
                                              public.fn_intervalo_previsto_minutos(
                                                  r.categoria, v_end_min - v_start_min,
                                                  r.jornada_intervalo_minutos, r.turno_intervalo_minutos));
                    v_int_ini_min := v_start_min + 240;
                    v_int_fim_min := v_int_ini_min + v_int_dur;

                    -- Nao cabe nem com o relativo (turno curto): centraliza no turno.
                    IF v_int_fim_min > v_end_min THEN
                        v_int_ini_min := v_start_min + GREATEST(((v_end_min - v_start_min) - v_int_dur) / 2, 0);
                        v_int_fim_min := v_int_ini_min + v_int_dur;
                    END IF;
                END IF;
            END IF;

            IF v_shifts_count = 1 THEN
                v_s1_id := r.escala_diaria_id; v_s1_inicio := v_start_min; v_s1_fim := v_end_min; v_s1_entrada := r.presenca_entrada_em; v_s1_int_saida := r.presenca_intervalo_saida_em; v_s1_int_retorno := r.presenca_intervalo_retorno_em; v_s1_saida := r.presenca_saida_em; v_s1_cat := r.categoria; v_s1_int_ini_min := v_int_ini_min; v_s1_int_fim_min := v_int_fim_min; v_s1_permite_int := v_permite_int; v_s1_dobra_diurna := COALESCE(r.dobra_diurna, false);
            ELSIF v_shifts_count = 2 THEN
                v_s2_id := r.escala_diaria_id; v_s2_inicio := v_start_min; v_s2_fim := v_end_min; v_s2_entrada := r.presenca_entrada_em; v_s2_int_saida := r.presenca_intervalo_saida_em; v_s2_int_retorno := r.presenca_intervalo_retorno_em; v_s2_saida := r.presenca_saida_em; v_s2_cat := r.categoria; v_s2_int_ini_min := v_int_ini_min; v_s2_int_fim_min := v_int_fim_min; v_s2_permite_int := v_permite_int; v_s2_dobra_diurna := COALESCE(r.dobra_diurna, false);
            ELSIF v_shifts_count = 3 THEN
                v_s3_id := r.escala_diaria_id; v_s3_inicio := v_start_min; v_s3_fim := v_end_min; v_s3_entrada := r.presenca_entrada_em; v_s3_int_saida := r.presenca_intervalo_saida_em; v_s3_int_retorno := r.presenca_intervalo_retorno_em; v_s3_saida := r.presenca_saida_em; v_s3_cat := r.categoria; v_s3_int_ini_min := v_int_ini_min; v_s3_int_fim_min := v_int_fim_min; v_s3_permite_int := v_permite_int; v_s3_dobra_diurna := COALESCE(r.dobra_diurna, false);
            END IF;
        END;
    END LOOP;

    IF v_shifts_count = 0 THEN
        PERFORM public.fn_log_tentativa_negada(
            v_servidor_id, 
            p_matricula, 
            p_coordenador_id, 
            'Sem escala agendada para hoje.', 
            NULL, NULL, NULL, NULL, NULL, NULL, NULL
        );
        RETURN jsonb_build_object('success', false, 'message', 'Sem escala agendada para hoje.');
    END IF;

    -- Merge today's shifts into blocks
    IF v_shifts_count = 1 THEN
        v_blocks_count := 1;
        v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
    ELSIF v_shifts_count = 2 THEN
        IF v_s2_inicio <= v_s1_fim
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'
               AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN
            v_blocks_count := 1;
            v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio, v_s2_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim, v_s2_fim]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
            v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
            v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
        ELSE
            v_blocks_count := 2;
            v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
            v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_turnos_ini := ARRAY[v_s2_inicio]; v_b2_turnos_fim := ARRAY[v_s2_fim]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat; v_b2_int_ini := v_s2_int_ini_min; v_b2_int_fim := v_s2_int_fim_min; v_b2_permite_int := v_s2_permite_int;
        END IF;
    ELSIF v_shifts_count >= 3 THEN
        IF v_s2_inicio <= v_s1_fim
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'
               AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN
            v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio, v_s2_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim, v_s2_fim]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
            v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
            v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
            
            IF v_s3_inicio <= v_b1_fim AND v_s3_cat <> 'Sobreaviso' AND NOT v_s3_dobra_diurna THEN
                v_blocks_count := 1;
                v_b1_fim := GREATEST(v_b1_fim, v_s3_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id, v_s3_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio, v_s2_inicio, v_s3_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim, v_s2_fim, v_s3_fim]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada, v_s3_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida, v_s3_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno, v_s3_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida, v_s3_saida];
                v_b1_cat := CASE WHEN v_s3_cat IN ('Regular', 'Plantão') THEN v_s3_cat ELSE v_b1_cat END;
            ELSE
                v_blocks_count := 2;
                v_b2_inicio := v_s3_inicio; v_b2_fim := v_s3_fim; v_b2_ids := ARRAY[v_s3_id]; v_b2_turnos_ini := ARRAY[v_s3_inicio]; v_b2_turnos_fim := ARRAY[v_s3_fim]; v_b2_entradas := ARRAY[v_s3_entrada]; v_b2_int_saidas := ARRAY[v_s3_int_saida]; v_b2_int_retornos := ARRAY[v_s3_int_retorno]; v_b2_saidas := ARRAY[v_s3_saida]; v_b2_cat := v_s3_cat; v_b2_int_ini := v_s3_int_ini_min; v_b2_int_fim := v_s3_int_fim_min; v_b2_permite_int := v_s3_permite_int;
            END IF;
        ELSE
            v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
            
            IF v_s3_inicio <= v_s2_fim
                   AND v_s2_cat <> 'Sobreaviso' AND v_s3_cat <> 'Sobreaviso'
                   AND NOT v_s2_dobra_diurna AND NOT v_s3_dobra_diurna THEN
                v_blocks_count := 2;
                v_b2_inicio := v_s2_inicio; v_b2_fim := GREATEST(v_s2_fim, v_s3_fim); v_b2_ids := ARRAY[v_s2_id, v_s3_id]; v_b2_turnos_ini := ARRAY[v_s2_inicio, v_s3_inicio]; v_b2_turnos_fim := ARRAY[v_s2_fim, v_s3_fim]; v_b2_entradas := ARRAY[v_s2_entrada, v_s3_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida, v_s3_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno, v_s3_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida, v_s3_saida];
                v_b2_cat := CASE WHEN v_s2_cat IN ('Regular', 'Plantão') THEN v_s2_cat ELSE v_s3_cat END;
                v_b2_int_ini := COALESCE(v_s2_int_ini_min, v_s3_int_ini_min); v_b2_int_fim := COALESCE(v_s2_int_fim_min, v_s3_int_fim_min); v_b2_permite_int := COALESCE(v_s2_permite_int, v_s3_permite_int, false);
            ELSE
                v_blocks_count := 3;
                v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_turnos_ini := ARRAY[v_s2_inicio]; v_b2_turnos_fim := ARRAY[v_s2_fim]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat; v_b2_int_ini := v_s2_int_ini_min; v_b2_int_fim := v_s2_int_fim_min; v_b2_permite_int := v_s2_permite_int;
                v_b3_inicio := v_s3_inicio; v_b3_fim := v_s3_fim; v_b3_ids := ARRAY[v_s3_id]; v_b3_turnos_ini := ARRAY[v_s3_inicio]; v_b3_turnos_fim := ARRAY[v_s3_fim]; v_b3_entradas := ARRAY[v_s3_entrada]; v_b3_int_saidas := ARRAY[v_s3_int_saida]; v_b3_int_retornos := ARRAY[v_s3_int_retorno]; v_b3_saidas := ARRAY[v_s3_saida]; v_b3_cat := v_s3_cat; v_b3_int_ini := v_s3_int_ini_min; v_b3_int_fim := v_s3_int_fim_min; v_b3_permite_int := v_s3_permite_int;
            END IF;
        END IF;
    END IF;

    -- Evaluate blocks for checkin, interval exit, interval return, or checkout
    DECLARE
        idx INTEGER;
        v_b_inicio INTEGER; v_b_fim INTEGER; v_b_ids UUID[]; v_b_entradas TIMESTAMP WITH TIME ZONE[]; v_b_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b_saidas TIMESTAMP WITH TIME ZONE[]; v_b_cat TEXT; v_b_int_ini INTEGER; v_b_int_fim INTEGER; v_b_permite_int BOOLEAN;
        v_b_total_count INTEGER;
        
        v_fim_efetivo INTEGER;
        v_matched_action TEXT := NULL;
        v_matched_ids UUID[] := '{}';
        v_matched_cat TEXT := NULL;
        v_matched_idx INTEGER := NULL;
        v_transicao BOOLEAN := false;
        -- Previsto de cada turno fundido no bloco corrente, na ordem de v_b_ids. E o que
        -- permite achar a FRONTEIRA: turnos_fim[i] = turnos_ini[i+1].
        v_b_turnos_ini INTEGER[]; v_b_turnos_fim INTEGER[];
        f INTEGER;
        v_fronteira_min INTEGER;
        v_closest_inicio_formatted TEXT := NULL;
        v_closest_fim_formatted TEXT := NULL;
    BEGIN
        FOR idx IN 1..v_blocks_count LOOP
            IF idx = 1 THEN
                v_b_inicio := v_b1_inicio; v_b_fim := v_b1_fim; v_b_ids := v_b1_ids; v_b_turnos_ini := v_b1_turnos_ini; v_b_turnos_fim := v_b1_turnos_fim; v_b_entradas := v_b1_entradas; v_b_int_saidas := v_b1_int_saidas; v_b_int_retornos := v_b1_int_retornos; v_b_saidas := v_b1_saidas; v_b_cat := v_b1_cat; v_b_int_ini := v_b1_int_ini; v_b_int_fim := v_b1_int_fim; v_b_permite_int := v_b1_permite_int;
            ELSIF idx = 2 THEN
                v_b_inicio := v_b2_inicio; v_b_fim := v_b2_fim; v_b_ids := v_b2_ids; v_b_turnos_ini := v_b2_turnos_ini; v_b_turnos_fim := v_b2_turnos_fim; v_b_entradas := v_b2_entradas; v_b_int_saidas := v_b2_int_saidas; v_b_int_retornos := v_b2_int_retornos; v_b_saidas := v_b2_saidas; v_b_cat := v_b2_cat; v_b_int_ini := v_b2_int_ini; v_b_int_fim := v_b2_int_fim; v_b_permite_int := v_b2_permite_int;
            ELSE
                v_b_inicio := v_b3_inicio; v_b_fim := v_b3_fim; v_b_ids := v_b3_ids; v_b_turnos_ini := v_b3_turnos_ini; v_b_turnos_fim := v_b3_turnos_fim; v_b_entradas := v_b3_entradas; v_b_int_saidas := v_b3_int_saidas; v_b_int_retornos := v_b3_int_retornos; v_b_saidas := v_b3_saidas; v_b_cat := v_b3_cat; v_b_int_ini := v_b3_int_ini; v_b_int_fim := v_b3_int_fim; v_b_permite_int := v_b3_permite_int;
            END IF;

            v_b_total_count := array_length(v_b_ids, 1);

            -- Step 1: Checkin (first shift entry is NULL and tap matches 1st period start)
            IF v_b_entradas[1] IS NULL THEN
                v_closest_inicio_formatted := lpad((v_b_inicio / 60)::text, 2, '0') || ':' || lpad((v_b_inicio % 60)::text, 2, '0');
                
                IF v_ignora_janela OR (
                   v_momento_atual_minutos >= (v_b_inicio - v_janela_minutos) AND 
                   v_momento_atual_minutos <= (v_b_inicio + v_janela_minutos)
                ) THEN
                    v_matched_action := 'checkin';
                    v_matched_ids := v_b_ids;
                    v_matched_cat := v_b_cat;
                    EXIT;
                END IF;
            END IF;

            -- Step 1.b: BATIDA DE TRANSICAO ENTRE TURNOS FUNDIDOS (20260823130000)
            --
            -- Um bloco pode fundir ate 3 turnos (armadilha 6). Na fronteira entre dois deles a
            -- pessoa fecha um turno e abre o seguinte — e ate aqui o terminal so conhecia os 4
            -- passos do BLOCO, entao essa batida caia em "Fora da janela de presenca permitida".
            -- A reconciliacao ja sabia disso desde a 20260819200000; o terminal, nao. O servidor
            -- via recusa e parava de bater (AGNA, mat. 205, dias 5, 6 e 7 de 08/2026: nenhuma
            -- saida registrada).
            --
            -- ⚠️ POR QUE AQUI, ENTRE O CHECKIN E O INTERVALO
            --   Depois do checkin porque nao se fecha um turno que ainda nao foi aberto. ANTES do
            --   intervalo porque em unidade de intervalo FLEXIVEL o passo 2 aceita "qualquer
            --   momento apos a entrada" — ele engoliria a batida de transicao e a gravaria como
            --   saida para o almoco. Foi o que aconteceu com MAISA (mat. 32269) em 18/08/2026.
            --
            -- ⚠️ O DESEMPATE CONTRA O INTERVALO E POR PROXIMIDADE, nao por ordem.
            --   Sem ele, um bloco cujo intervalo previsto cai perto da fronteira teria a batida
            --   do almoco classificada como transicao. A alocacao (fn_alocar_marcacoes_dia) casa
            --   por menor distancia; aqui vale o mesmo criterio, senao terminal e reconciliacao
            --   discordam sobre a mesma batida.
            --
            -- Nada e fabricado: sem batida na fronteira nao ha passo nenhum, exatamente como
            -- antes. Este bloco so ACEITA uma batida que hoje e recusada.
            IF v_b_total_count > 1 AND array_length(v_b_turnos_fim, 1) = v_b_total_count THEN
                FOR f IN 1..(v_b_total_count - 1) LOOP
                    v_fronteira_min := v_b_turnos_fim[f];

                    IF (v_b_int_ini IS NULL OR
                        abs(v_momento_atual_minutos - v_fronteira_min) <= abs(v_momento_atual_minutos - v_b_int_ini))
                       AND (v_b_int_fim IS NULL OR
                        abs(v_momento_atual_minutos - v_fronteira_min) <= abs(v_momento_atual_minutos - v_b_int_fim))
                       AND v_momento_atual_minutos >= (v_fronteira_min - v_janela_minutos)
                       AND v_momento_atual_minutos <= (v_fronteira_min + v_janela_minutos)
                    THEN
                        -- Fecha o turno que termina na fronteira.
                        IF v_b_saidas[f] IS NULL THEN
                            v_matched_action := 'fronteira_saida';
                            v_matched_ids := ARRAY[v_b_ids[f]];
                            v_matched_cat := v_b_cat;
                            EXIT;
                        END IF;
                        -- Ja fechado: a mesma janela abre o turno seguinte. Duas batidas na
                        -- fronteira preenchem os dois lados; uma so preenche o primeiro e a
                        -- reconciliacao espelha para o outro (20260823100000).
                        IF v_b_entradas[f + 1] IS NULL THEN
                            v_matched_action := 'fronteira_entrada';
                            v_matched_ids := ARRAY[v_b_ids[f + 1]];
                            v_matched_cat := v_b_cat;
                            EXIT;
                        END IF;
                    END IF;
                END LOOP;
                EXIT WHEN v_matched_action IS NOT NULL;
            END IF;

            -- Step 2: Interval Exit (Saída Almoço)
            IF v_b_permite_int AND v_b_int_saidas[1] IS NULL AND v_b_int_ini IS NOT NULL THEN
                IF v_ignora_janela
                   -- Intervalo flexivel: exige ao menos 60 minutos decorridos de trabalho
                   -- desde a entrada, e antes de abrir a janela de saida final.
                   OR (v_intervalo_flexivel
                       AND v_b_entradas[1] IS NOT NULL
                       AND extract(epoch from (v_now - v_b_entradas[1])) >= 3600
                       AND v_momento_atual_minutos >= (v_b_inicio + 60)
                       AND v_momento_atual_minutos < (v_b_fim - v_janela_minutos))
                   OR (NOT v_intervalo_flexivel AND
                       v_momento_atual_minutos >= (v_b_int_ini - v_janela_minutos) AND
                       v_momento_atual_minutos <= (v_b_int_ini + v_janela_minutos)
                ) THEN
                    v_matched_action := 'intervalo_saida';
                    v_matched_ids := v_b_ids;
                    v_matched_cat := v_b_cat;
                    EXIT;
                END IF;
            END IF;

            -- Step 3: Interval Return / 2nd Period Checkin (Retorno Almoço / Entrada Tarde)
            IF v_b_permite_int AND v_b_int_retornos[1] IS NULL AND v_b_int_fim IS NOT NULL THEN
                IF v_ignora_janela
                   -- Intervalo flexivel: qualquer momento, desde que a saida ja tenha ocorrido.
                   OR (v_intervalo_flexivel AND v_b_int_saidas[1] IS NOT NULL)
                   OR (NOT v_intervalo_flexivel AND
                       v_momento_atual_minutos >= (v_b_int_fim - v_janela_minutos) AND
                       v_momento_atual_minutos <= (v_b_int_fim + v_janela_minutos)
                ) THEN
                    v_matched_action := 'intervalo_retorno';
                    v_matched_ids := v_b_ids;
                    v_matched_cat := v_b_cat;
                    EXIT;
                END IF;
            END IF;

            -- Step 4: Checkout (last shift exit is NULL and tap matches final exit time)
            IF v_b_saidas[v_b_total_count] IS NULL THEN
                v_fim_efetivo := v_b_fim + public.fn_ajuste_intervalo_flexivel(v_intervalo_flexivel, v_b_int_saidas[1], v_b_int_retornos[1], v_b_int_fim - v_b_int_ini);
                v_closest_fim_formatted := lpad(((v_fim_efetivo % 1440) / 60)::text, 2, '0') || ':' || lpad((v_fim_efetivo % 60)::text, 2, '0');

                IF v_ignora_janela OR (
                   v_momento_atual_minutos >= (v_fim_efetivo - v_janela_minutos) AND
                   v_momento_atual_minutos <= (v_fim_efetivo + v_janela_minutos)
                ) THEN
                    v_matched_action := 'checkout';
                    v_matched_idx := idx;
                    v_matched_ids := v_b_ids;
                    v_matched_cat := v_b_cat;
                    EXIT;
                END IF;
            END IF;
        END LOOP;

        -- Fallback: If no exact window matched and free checkin applies (ignora_janela)
        IF v_matched_action IS NULL THEN
            FOR idx IN 1..v_blocks_count LOOP
                IF idx = 1 THEN
                    v_b_inicio := v_b1_inicio; v_b_fim := v_b1_fim; v_b_ids := v_b1_ids; v_b_turnos_ini := v_b1_turnos_ini; v_b_turnos_fim := v_b1_turnos_fim; v_b_entradas := v_b1_entradas; v_b_saidas := v_b1_saidas; v_b_cat := v_b1_cat;
                ELSIF idx = 2 THEN
                    v_b_inicio := v_b2_inicio; v_b_fim := v_b2_fim; v_b_ids := v_b2_ids; v_b_turnos_ini := v_b2_turnos_ini; v_b_turnos_fim := v_b2_turnos_fim; v_b_entradas := v_b2_entradas; v_b_saidas := v_b2_saidas; v_b_cat := v_b2_cat;
                ELSE
                    v_b_inicio := v_b3_inicio; v_b_fim := v_b3_fim; v_b_ids := v_b3_ids; v_b_turnos_ini := v_b3_turnos_ini; v_b_turnos_fim := v_b3_turnos_fim; v_b_entradas := v_b3_entradas; v_b_saidas := v_b3_saidas; v_b_cat := v_b3_cat;
                END IF;

                v_b_total_count := array_length(v_b_ids, 1);

                IF v_b_entradas[1] IS NULL THEN
                    IF v_ignora_janela THEN
                        v_matched_action := 'checkin';
                        v_matched_ids := v_b_ids;
                        v_matched_cat := v_b_cat;
                        EXIT;
                    END IF;
                ELSIF v_b_saidas[v_b_total_count] IS NULL THEN
                    IF v_ignora_janela THEN
                        v_matched_action := 'checkout';
                    v_matched_idx := idx;
                        v_matched_ids := v_b_ids;
                        v_matched_cat := v_b_cat;
                        EXIT;
                    END IF;
                END IF;
            END LOOP;
        END IF;

        IF v_matched_action IS NULL THEN
            -- Se a entrada do primeiro bloco foi confirmada a menos de 60 minutos, responde amigavelmente
            -- que a presenca ja foi registrada, sem queimar intervalos nem gerar recusa indevida.
            IF v_b1_entradas[1] IS NOT NULL AND extract(epoch from (v_now - v_b1_entradas[1])) < 3600 THEN
                RETURN jsonb_build_object('success', true, 'message',
                    'Entrada já confirmada às ' || to_char(v_b1_entradas[1] AT TIME ZONE v_timezone, 'HH24:MI') || '. Bom trabalho!');
            END IF;

            PERFORM public.fn_log_tentativa_negada(
                v_servidor_id, 
                p_matricula, 
                p_coordenador_id, 
                'Fora da janela de presença permitida.', 
                v_closest_inicio_formatted, v_closest_fim_formatted, NULL, NULL, NULL, NULL, NULL
            );
            RETURN jsonb_build_object('success', false, 'message', 'Fora da janela de presença permitida.');
        END IF;

        -- Process the matched action

        -- BATIDA DE TRANSICAO (20260823130000). Grava na LINHA daquele turno, nunca no bloco
        -- inteiro: e essa especificidade que faz a folha e o anexo de plantoes saberem onde o
        -- expediente terminou e onde o plantao comecou.
        IF v_matched_action IN ('fronteira_saida', 'fronteira_entrada') THEN
            -- Só UPDATE em escala_diaria, como todos os outros passos: quem grava em
            -- marcacoes_ponto é fn_registrar_ponto, o wrapper que chama esta função.
            IF v_matched_action = 'fronteira_saida' THEN
                UPDATE public.escala_diaria
                SET presenca_saida_em = v_now, confirmado_por_id = p_coordenador_id
                WHERE id = v_matched_ids[1];
            ELSE
                UPDATE public.escala_diaria
                SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id
                WHERE id = v_matched_ids[1];
            END IF;

            RETURN jsonb_build_object('success', true, 'message',
                CASE WHEN v_matched_action = 'fronteira_saida'
                     THEN 'Saída do turno confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Registre a entrada do próximo turno.'
                     ELSE 'Entrada do próximo turno confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom trabalho!'
                END);
        END IF;

        IF v_matched_action = 'checkin' THEN
            SELECT escala_mensal_id INTO v_escala_mensal_id FROM public.escala_diaria WHERE id = v_matched_ids[1];
            SELECT unidade_id INTO v_unidade_id FROM public.escala_mensal WHERE id = v_escala_mensal_id;

            UPDATE public.escala_diaria 
            SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id 
            WHERE id = ANY(v_matched_ids);
            
            IF v_matched_cat = 'Sobreaviso' THEN
                UPDATE public.logs_sobreaviso
                SET status = 'Chegou',
                    data_hora_chegada = v_now,
                    tipo_validacao_chegada = 'Terminal'
                WHERE servidor_id = v_servidor_id 
                  AND escala_mensal_id = v_escala_mensal_id 
                  AND dia = v_dia_hoje 
                  AND status IN ('Aguardando', 'Aceito');

                IF NOT FOUND THEN
                    INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_chegada, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria)
                    VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (ENTRADA) via terminal.', 'Terminal', 'Sobreaviso');
                END IF;
            END IF;
            
            RETURN jsonb_build_object('success', true, 'message', 'Entrada confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom plantão!');

        ELSIF v_matched_action = 'intervalo_saida' THEN
            UPDATE public.escala_diaria
            SET presenca_intervalo_saida_em = v_now, confirmado_por_id = p_coordenador_id
            WHERE id = ANY(v_matched_ids);

            RETURN jsonb_build_object('success', true, 'message', 'Saída para o intervalo confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom almoço!');

        ELSIF v_matched_action = 'intervalo_retorno' THEN
            UPDATE public.escala_diaria
            SET presenca_intervalo_retorno_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id
            WHERE id = ANY(v_matched_ids);

            RETURN jsonb_build_object('success', true, 'message', 'Retorno do intervalo / Entrada do 2º Período confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom trabalho!');
            
        ELSIF v_matched_action = 'checkout' THEN
            SELECT escala_mensal_id INTO v_escala_mensal_id FROM public.escala_diaria WHERE id = v_matched_ids[1];
            SELECT unidade_id INTO v_unidade_id FROM public.escala_mensal WHERE id = v_escala_mensal_id;

            PERFORM public.fn_salvar_saida_bloco(v_matched_ids, v_now, p_coordenador_id, v_timezone, false);

            -- BATIDA DE TRANSICAO (09/08/2026). Ver
            -- docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md
            --
            -- Dois blocos encostados (fim do bloco i == inicio do bloco i+1) sao duas
            -- jornadas seguidas sem intervalo entre elas: o servidor sai de uma e entra na
            -- outra no mesmo instante. Uma batida so responde pelos dois passos.
            --
            -- O horario gravado na entrada do bloco seguinte e a BATIDA REAL, nunca o
            -- previsto - e o oposto de fabricar timestamp (Portaria 671/2021, vedacao 2).
            -- Sem esta regra o servidor teria de bater duas vezes no mesmo minuto, e quem
            -- esquecesse a segunda deixaria a jornada seguinte sem entrada.
            IF v_matched_idx = 1 AND v_blocks_count >= 2
                   AND v_b2_inicio = v_b1_fim AND v_b2_entradas[1] IS NULL THEN
                UPDATE public.escala_diaria
                SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id
                WHERE id = ANY(v_b2_ids);
                v_transicao := true;
            ELSIF v_matched_idx = 2 AND v_blocks_count >= 3
                   AND v_b3_inicio = v_b2_fim AND v_b3_entradas[1] IS NULL THEN
                UPDATE public.escala_diaria
                SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id
                WHERE id = ANY(v_b3_ids);
                v_transicao := true;
            END IF;
            
            IF v_matched_cat = 'Sobreaviso' THEN
                UPDATE public.logs_sobreaviso
                SET status = 'Chegou',
                    data_hora_chegada = v_now,
                    tipo_validacao_chegada = 'Terminal'
                WHERE servidor_id = v_servidor_id 
                  AND escala_mensal_id = v_escala_mensal_id 
                  AND dia = v_dia_hoje 
                  AND status IN ('Aguardando', 'Aceito');

                IF NOT FOUND THEN
                    INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_chegada, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria)
                    VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA) via terminal.', 'Terminal', 'Sobreaviso');
                END IF;
            END IF;
            
            RETURN jsonb_build_object('success', true, 'message',
                CASE WHEN v_transicao
                     THEN 'Saída do turno e entrada do turno seguinte confirmadas às ' || to_char(v_now_local, 'HH24:MI') || '. Bom trabalho!'
                     ELSE 'Saída confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!'
                END);
        END IF;
    END;

EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_log_tentativa_negada(
        v_servidor_id, 
        p_matricula, 
        p_coordenador_id, 
        SQLERRM, 
        NULL, NULL, NULL, NULL, NULL, NULL, NULL
    );
    RETURN jsonb_build_object('success', false, 'message', 'Erro interno ao processar confirmação de presença: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
