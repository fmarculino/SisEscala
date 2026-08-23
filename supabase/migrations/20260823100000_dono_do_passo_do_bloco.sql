-- ============================================================================
-- Migration: o passo do bloco pertence a UM turno, e a batida de transicao solitaria espelha
-- Data: 2026-08-23
--
-- PROBLEMA (medido em producao em 23/08/2026, competencia 08/2026)
--   Regular 08:00-14:00 + Plantao T 14:00-20:00 fundem em UM bloco (armadilha 6). A projecao
--   grava o par entrada/saida do BLOCO em TODAS as linhas dele, entao com duas batidas so
--   (08:03 e 18:02) as duas linhas ficam 08:03 -> 18:02. Dois sintomas, um defeito:
--
--     - a folha cobra a saida das 18:02 contra a jornada que acaba as 14:00 e credita 4h de
--       hora extra que o anexo de plantoes JA esta pagando como plantao;
--     - o anexo mostra o plantao comecando as 08:03, a entrada do expediente.
--
--   AGNA CRISTINA RIBEIRO DO ROSARIO (mat. 205, LACEM), dias 10, 11 e 12 de 08/2026.
--   Em 08/2026: 27 dias com hora extra em dia de plantao escalado, 75h12 no total. Deste
--   plano saem 18h03 em 4 dias; 47h48 saem so regerando a folha (snapshot anterior ao
--   turnosDaFolha de 19/08); o resto sao casos individuais do coordenador.
--
-- CORRECAO — duas ideias, tres funcoes intocadas
--   C1 (fn_projecao_marcacoes_dia) o passo do bloco alcanca so a linha do turno DONO dele.
--      entrada -> primeiro turno; saida -> ultimo; intervalo -> o turno que o contem.
--      Sem batida na fronteira o passo fica VAZIO e vira pendencia. Nada e fabricado.
--   C2 (fn_alocar_marcacoes_dia) batida solitaria na fronteira espelha para o slot irmao.
--      Acaba com a regra folclorica de "esperar 5 minutos": UMA batida na transicao passa a
--      fechar o expediente e abrir o plantao.
--
--   fn_alocar_marcacoes_dia passa a devolver a chave "turnos" (aditiva) para C1 saber a ordem
--   e a janela de cada turno do bloco.
--
-- O QUE NAO MUDA
--   - Bloco de UM turno so: nada muda (ed_total <= 1 passa direto).
--   - Dia com 4 batidas (2 na fronteira): nada muda — o espelho so age em slot VAZIO.
--   - Bloco Regular + Extra: a folha e NEUTRA. turnosDaFolha mantem as duas linhas e o
--     min(entrada)/max(saida) da o mesmo resultado de hoje.
--   - Fusao de blocos, guards de Sobreaviso, regra do dono, piso de meia-noite, teto de 720
--     min e o guard de escopo de fn_blocos_previstos_dia: todos intactos (conferidos por
--     contagem no gerador).
--   - fn_confirmar_presenca NAO e tocada (armadilha 1). O terminal continua sem os slots de
--     fronteira — a batida de transicao segue virando marcacao pendente, que a reconciliacao
--     aproveita. Aceitar a transicao no proprio terminal fica para migration propria.
--
-- MEDIDO POR SIMULACAO ANTES DE APLICAR (scratchpad/sim_fronteira.js, sim_folha_efeito.js),
-- sobre os 223 dias de 08/2026 com bloco de 2+ turnos fundidos:
--   154 linhas de escala_diaria mudam, em 17 servidores; 213 dias ficam identicos;
--   na folha 10 dias mudam, 8 deles perdendo hora extra indevida; 72 fronteiras espelhadas.
--
-- Corpos copiados mecanicamente de 20260819200000 (alocacao) e 20260819210000 (projecao)
-- por scratchpad/gen_dono_do_passo.js, que aborta se a contagem de ocorrencias divergir.
--
-- Plano: docs/planos/2026-08-23-turno-regular-emendado-com-plantao.md
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
            v_slot_piso  := v_slot_piso  || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);
            v_slot_opcional := v_slot_opcional || false;

            v_slot_passo := v_slot_passo || 'intervalo_retorno'::text;
            v_slot_prev  := v_slot_prev  || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
            v_slot_bloco := v_slot_bloco || r.bloco_ordem;
            v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
            v_slot_data  := v_slot_data  || r.dia_ref;
            v_slot_piso  := v_slot_piso  || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);
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

COMMENT ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer) IS
    'Aloca marcacoes do dia nos passos previstos. Um passo nunca casa com batida anterior a '
    'meia-noite do dia civil em que o bloco comeca (piso), uma batida cujo passo previsto mais '
    'proximo pertence a um bloco de dia vizinho nao e candidata aqui (regra do dono), e cada '
    'fronteira entre turnos fundidos tem slots opcionais para a batida de transicao. '
    'Uma batida solitaria na fronteira espelha para o slot irmao, e o retorno declara os '
    'turnos de cada bloco para a projecao saber o dono de cada passo. '
    'Teto de casamento de 720 min. Ver 20260823100000, 20260819200000, 20260819180000 e '
    '20260819120000.';

GRANT EXECUTE ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer)
    TO authenticated, service_role;


DROP FUNCTION IF EXISTS public.fn_projecao_marcacoes_dia(uuid, date);

CREATE OR REPLACE FUNCTION public.fn_projecao_marcacoes_dia(
    p_servidor_id uuid,
    p_data        date
)
RETURNS TABLE (
    escala_diaria_id      uuid,
    entrada_em            timestamptz,
    entrada_origem        public.marcacao_origem,
    entrada_marcacao_id   uuid,
    int_saida_em          timestamptz,
    int_saida_origem      public.marcacao_origem,
    int_saida_marcacao_id uuid,
    int_ret_em            timestamptz,
    int_ret_origem        public.marcacao_origem,
    int_ret_marcacao_id   uuid,
    saida_em              timestamptz,
    saida_origem          public.marcacao_origem,
    saida_marcacao_id     uuid,
    confirmada            boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fnproj$
    -- MATERIALIZED: fn_alocar_marcacoes_dia roda o DP inteiro. Sem isto o planejador pode
    -- inline-a-la uma vez por CTE que a referencia.
    WITH aloc AS MATERIALIZED (
        SELECT public.fn_alocar_marcacoes_dia(p_servidor_id, p_data) AS j
    ),
    alocacoes AS (
        SELECT x FROM aloc, jsonb_array_elements(aloc.j -> 'alocacoes') AS x
    ),
    -- Cada linha de escala_diaria com a posicao dela dentro do bloco e a janela do seu turno.
    turnos AS (
        SELECT (t.x->>'escala_diaria_id')::uuid AS ed_id,
               (t.x->>'ordem')::integer         AS ordem,
               (t.x->>'total')::integer         AS total,
               (t.x->>'inicio')::timestamptz    AS turno_inicio,
               (t.x->>'fim')::timestamptz       AS turno_fim
          FROM aloc, jsonb_array_elements(aloc.j -> 'turnos') AS t(x)
    ),
    expandido AS (
        -- Uma alocacao vale para todas as linhas de escala_diaria que ela nomeia. As do bloco
        -- nomeiam todas as linhas; as de FRONTEIRA nomeiam uma linha so (ver 20260819200000).
        SELECT NULLIF(btrim(e.valor), '')::uuid              AS ed_id,
               e.ord::integer                                AS ed_ordem,
               jsonb_array_length(a.x->'escala_diaria_ids')  AS ed_total,
               a.x->>'passo'                                 AS passo,
               (a.x->>'marcacao_id')::uuid                   AS marcacao_id,
               (a.x->>'previsto')::timestamptz               AS previsto,
               COALESCE((a.x->>'fronteira')::boolean, false)  AS fronteira
          FROM alocacoes a
          CROSS JOIN LATERAL jsonb_array_elements_text(a.x->'escala_diaria_ids')
               WITH ORDINALITY AS e(valor, ord)
         WHERE NULLIF(btrim(e.valor), '') IS NOT NULL
    ),
    -- DONO DO PASSO (20260823100000)
    -- Uma alocacao de BLOCO nomeia todas as linhas dele, mas cada passo tem um dono so:
    --   entrada  -> a linha do PRIMEIRO turno
    --   saida    -> a linha do ULTIMO turno
    --   intervalo-> a linha do turno cuja janela contem o intervalo previsto
    -- Criterio POSICIONAL, nao por tolerancia de horario: deterministico e sem numero magico.
    --
    -- Sem isto a linha do expediente recebia a saida do plantao e a folha cobrava aquelas
    -- horas como EXTRA, alem de o plantao ja as pagar pelo anexo — a mesma jornada contada
    -- duas vezes. Bloco de um turno so (ed_total = 1) e alocacao de FRONTEIRA nao mudam nada.
    --
    -- Nada e fabricado: sem batida na fronteira, o passo simplesmente fica VAZIO e vira
    -- pendencia visivel. Decisao do usuario em 23/08/2026 — o sistema nao preenche onde o
    -- servidor TEM como registrar (vedacao 2 da Portaria 671/2021).
    dono AS (
        SELECT ex.*
          FROM expandido ex
          LEFT JOIN turnos t ON t.ed_id = ex.ed_id
         WHERE ex.fronteira
            OR COALESCE(ex.ed_total, 1) <= 1
            OR (ex.passo = 'entrada' AND ex.ed_ordem = 1)
            OR (ex.passo = 'saida'   AND ex.ed_ordem = ex.ed_total)
            OR (ex.passo LIKE 'intervalo%'
                AND (t.ed_id IS NULL
                     OR ex.previsto IS NULL
                     OR (ex.previsto >= t.turno_inicio AND ex.previsto <= t.turno_fim)))
    ),
    com_dados AS (
        SELECT ex.ed_id, ex.passo, ex.marcacao_id, ex.fronteira, m.ocorrido_em, m.origem
          FROM dono ex
          JOIN public.marcacoes_ponto m ON m.id = ex.marcacao_id
    ),
    -- Janela real do turno naquela linha, quando existe batida de transicao.
    janela AS (
        SELECT ed_id,
               max(ocorrido_em) FILTER (WHERE fronteira AND passo = 'entrada') AS abre_em,
               min(ocorrido_em) FILTER (WHERE fronteira AND passo = 'saida')   AS fecha_em
          FROM com_dados
         GROUP BY ed_id
    ),
    -- Sem batida de transicao (abre_em e fecha_em nulos) nada e descartado: o comportamento de
    -- sempre. Com ela, o passo herdado do bloco que cai fora da janela pertence ao turno vizinho.
    filtrado AS (
        SELECT cd.*
          FROM com_dados cd
          JOIN janela j ON j.ed_id = cd.ed_id
         WHERE cd.fronteira
            OR (    (j.abre_em  IS NULL OR cd.ocorrido_em >= j.abre_em)
                AND (j.fecha_em IS NULL OR cd.ocorrido_em <= j.fecha_em))
    ),
    -- Toda linha nomeada por alguma alocacao continua na projecao, mesmo que o filtro do dono
    -- tenha tirado todos os passos dela. E o que faz fn_reconciliar_marcacoes_dia LIMPAR o
    -- valor velho: ela grava a projecao inteira, inclusive os nulos, mas so alcanca as linhas
    -- que a projecao devolve. Sem isto, a linha do plantao de um dia em que so houve entrada
    -- ficaria para sempre com a entrada do expediente (AGNA, mat. 205, dias 5, 6 e 7).
    linhas AS (
        SELECT DISTINCT ed_id FROM expandido
    )
    -- Pode haver DUAS alocacoes para o mesmo (linha, passo): a do bloco, que vale para todas as
    -- linhas, e a da fronteira, que e daquela linha so. A especifica vence — e o que faz a linha
    -- do plantao mostrar a batida das 13:10 em vez da entrada do expediente das 07:04. Fora esse
    -- desempate os agregados apenas pivotam de linhas para colunas.
    --
    -- array_agg(...)[1] em vez de max() nao e preciosismo: NAO EXISTE max(uuid) no Postgres -
    -- usar max em marcacao_id falha com 42883 no CREATE FUNCTION. E, para a coluna de origem,
    -- max() de enum funciona mas escolheria pelo ordinal do tipo, o que sugeriria uma regra de
    -- desempate que nao existe aqui. Nao trocar de volta.
    SELECT
        l.ed_id,
        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'entrada'))[1],
        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'entrada'))[1],
        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'entrada'))[1],
        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_saida'))[1],
        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_saida'))[1],
        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_saida'))[1],
        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_retorno'))[1],
        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_retorno'))[1],
        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_retorno'))[1],
        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'saida'))[1],
        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'saida'))[1],
        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'saida'))[1],
        -- Confirmada quando ha qualquer marcacao no dia. count(cd.ed_id), NAO count(*): no
        -- LEFT JOIN sem par o count(*) devolveria 1 e a linha vazia sairia como confirmada.
        count(cd.ed_id) > 0
      FROM linhas l
      LEFT JOIN filtrado cd ON cd.ed_id = l.ed_id
     GROUP BY l.ed_id
$fnproj$;

COMMENT ON FUNCTION public.fn_projecao_marcacoes_dia(uuid, date) IS
    'O que escala_diaria deveria conter para um servidor num dia, derivado das marcacoes. '
    'Fonte unica compartilhada por fn_reconciliar_marcacoes_dia e fn_conferir_reconciliacao. '
    'Alocacao de fronteira (batida de transicao) vence a do bloco na mesma linha e passo, e a '
    'linha que tem batida de transicao nao herda passo do bloco fora da janela do seu turno. '
    'Passo do bloco alcanca so a linha do turno DONO dele: entrada no primeiro, saida no '
    'ultimo, intervalo no turno que o contem. Ver 20260823100000.';

GRANT EXECUTE ON FUNCTION public.fn_projecao_marcacoes_dia(uuid, date) TO authenticated, service_role;

-- ============================================================================
-- CONFERENCIA (rodar DEPOIS de aplicar; nenhuma delas escreve)
-- ============================================================================
--
-- 1) A chave "turnos" existe e descreve o bloco (AGNA, 10/08/2026):
--
--    SELECT jsonb_pretty(public.fn_alocar_marcacoes_dia(s.id, DATE '2026-08-10') -> 'turnos')
--      FROM public.servidores s WHERE s.matricula = '205';
--
-- 2) A linha do expediente deixou de carregar a saida do plantao:
--
--    SELECT ed.categoria, dt.codigo, p.entrada_em, p.saida_em
--      FROM public.servidores s
--      JOIN public.escala_mensal em ON em.servidor_id = s.id AND em.mes = 8 AND em.ano = 2026
--      JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id AND ed.dia = 10
--      JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
--      LEFT JOIN LATERAL public.fn_projecao_marcacoes_dia(s.id, DATE '2026-08-10') p
--             ON p.escala_diaria_id = ed.id
--     WHERE s.matricula = '205';
--
--    Esperado: Regular M com entrada 08:03 e saida NULA; Plantao T com entrada NULA e
--    saida 18:02. A saida vazia do Regular e o resultado desejado, nao falha.
--
-- 3) O espelho da fronteira solitaria (AGNA, 03/08/2026 — uma batida so as 14:00):
--
--    Esperado: Regular M 08:06 -> 14:00 e Plantao T 14:00 -> 20:00.
--    Antes desta migration o Plantao comecava as 08:06.
--
-- 4) Nenhum passo invertido em 08/2026 (mesmo portao de 20260819210000):
--    rodar scratchpad/checa_inversao_projecao.js.
--
-- 5) Divergencia projecao x gravado, para escolher os dias a reconciliar:
--    rodar scratchpad/sim_fronteira.js. A reconciliacao NAO deve ser em massa
--    (memoria "nao-reconciliar-agosto-em-massa") — so os dias de bloco fundido.
-- ============================================================================
