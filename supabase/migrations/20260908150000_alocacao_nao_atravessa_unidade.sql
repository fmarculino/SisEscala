-- ============================================================================
-- A ALOCACAO NUNCA ATRAVESSA UNIDADE
-- ============================================================================
-- Gerado por scratchpad/gen_alocacao_unidade.js a partir de
-- 20260901120000_guarda_intervalo_minimo_e_deduplicacao_entrada.sql (a migration VIGENTE de
-- fn_alocar_marcacoes_dia). Nao editar a mao: regerar pelo script.
--
-- Par de 20260908140000 (o bloco nao atravessa unidade). Aplicar as duas, nesta ordem.
-- Cada uma e segura sozinha, mas so as duas juntas fecham o caso.
--
-- O QUE MUDA: a batida de RELOGIO so pode casar com um passo da MESMA unidade. Onde o lugar
-- de um dos dois lados e desconhecido, nada muda.
--
-- POR QUE:
-- O casamento batida<->passo era um alinhamento por proximidade de horario e mais nada. A
-- consulta de candidatas filtra por servidor, origem e janela de tempo; os slots nao sabiam a
-- que unidade pertenciam. Entao a batida feita no relogio de uma unidade preenchia o passo da
-- escala de outra, sem erro em lugar nenhum e sem nada em tela que denunciasse.
--
-- Caso que motivou (JEOSEANE, mat. 67689, 07/09/2026): Regular 07:00-16:00 no CRISMU e
-- Plantao N no HMI. As tres batidas do dia — 07:14, 12:59 e 14:03, TODAS no REP-iDClass-HMI-02
-- — foram gravadas como entrada, retorno de intervalo e saida do Regular DO CRISMU, onde ela
-- nao esteve. E no sentido inverso a batida das 06:54 do dia 8, feita no REP-iDClass-CRISMU,
-- virou a saida do plantao DO HMI — deixando a entrada do dia 8 no CRISMU vazia.
--
-- EXTENSAO MEDIDA EM 08/09/2026 (base inteira, 25.531 marcacoes referenciadas por escala):
--   18 passos preenchidos por batida de outra unidade, 8 pares (servidor, dia), 4 pessoas.
--   0 passos de origem `terminal` com unidade divergente.
--   0 escalas de 09/2026 em unidade sem relogio ativo (ninguem depende hoje de bater fora).
--
-- TRES DECISOES QUE PRECISAM SOBREVIVER A QUALQUER RECRIACAO:
--
--   1. PROIBIR, NAO PENALIZAR. Casamento entre unidades diferentes tem custo infinito (o ramo
--      do DP simplesmente nao e considerado), nao um custo alto. Com penalidade a troca volta
--      a acontecer sempre que nao houver candidata melhor, e o preco de errar aqui e ponto de
--      servidor publico em folha. O sistema ja escolheu, em toda parte, pendencia em vez de
--      horario que ninguem pode conferir.
--
--   2. SO PARA origem = 'rep' COM dispositivo_id. Em origem `terminal`,
--      marcacoes_ponto.unidade_id e a LOTACAO do servidor (fn_registrar_ponto le
--      servidores.unidade_id), nao o lugar da batida — aplicar a regra ali derrubaria o ponto
--      do Servidor Externo (v1.2.4), lotado em A e escalado em B. `ajuste_coordenador` e
--      `ajuste_servidor` sao declaracao, nao fato de lugar: tambem ficam de fora.
--
--   3. NUNCA DESCARTAR BATIDA. O cursor de candidatas continua SEM filtro de unidade: a batida
--      e lida, disputa o DP e, se nao casar, vira pendencia com tipo proprio `outra_unidade` —
--      que a aba Pendencias de /marcacoes ja lista sozinha (fn_marcacoes_pendentes_revisao
--      mostra toda marcacao nao referenciada em escala_diaria, filtrada por m.unidade_id, ou
--      seja, para quem cuida da unidade onde a pessoa bateu). Filtrar no cursor faria a batida
--      sumir antes de poder virar pendencia.
--
-- O QUE NAO MUDA:
--   - Lugar desconhecido de qualquer um dos lados = sem restricao. Nunca se recusa uma batida
--     por falta de informacao.
--   - Bloco que mistura unidades devolve lugar NULL e nao restringe nada — e o que torna esta
--     migration segura de aplicar sozinha, antes da 20260908140000.
--   - O teto de 720 min, o piso de meia-noite, a regra do dono, a deduplicacao e o espelho da
--     batida de transicao ficam exatamente como estavam.
--
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
    -- Unidade da escala a que cada slot pertence. NULL = lugar desconhecido, e ai a
    -- restricao de lugar nao se aplica (nunca recusar batida por falta de informacao).
    v_slot_unidade  uuid[]        := '{}';
    v_bloco_unidade uuid;
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
        -- LUGAR DO BLOCO (08/09/2026). Unidade COMUM das linhas deste bloco. Se o bloco
        -- misturasse unidades a resposta e NULL, e a restricao de lugar simplesmente nao se
        -- aplica aqui — e o que torna esta migration segura de aplicar sozinha, antes da
        -- 20260908140000, que e quem faz o bloco parar de atravessar unidade.
        SELECT CASE WHEN count(DISTINCT em.unidade_id) = 1
                    THEN (array_agg(DISTINCT em.unidade_id))[1] END
          INTO v_bloco_unidade
          FROM unnest(r.escala_diaria_ids) AS x(id)
          JOIN public.escala_diaria ed  ON ed.id = x.id
          JOIN public.escala_mensal em  ON em.id = ed.escala_mensal_id;

        -- entrada
        v_slot_passo := v_slot_passo || 'entrada'::text;
        v_slot_prev  := v_slot_prev  || r.inicio_previsto;
        v_slot_bloco := v_slot_bloco || r.bloco_ordem;
        v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
        v_slot_data  := v_slot_data  || r.dia_ref;
        v_slot_piso  := v_slot_piso  || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);
        v_slot_opcional := v_slot_opcional || false; v_slot_unidade := v_slot_unidade || v_bloco_unidade;

        IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN
            v_slot_passo := v_slot_passo || 'intervalo_saida'::text;
            v_slot_prev  := v_slot_prev  || r.intervalo_inicio_previsto;
            v_slot_bloco := v_slot_bloco || r.bloco_ordem;
            v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
            v_slot_data  := v_slot_data  || r.dia_ref;
            -- Piso do intervalo: minimo de 60 minutos decorridos desde o inicio previsto
            -- para impedir que batidas matinais proximas a entrada casem com o intervalo.
            v_slot_piso  := v_slot_piso  || (r.inicio_previsto + interval '60 minutes');
            v_slot_opcional := v_slot_opcional || false; v_slot_unidade := v_slot_unidade || v_bloco_unidade;

            v_slot_passo := v_slot_passo || 'intervalo_retorno'::text;
            v_slot_prev  := v_slot_prev  || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
            v_slot_bloco := v_slot_bloco || r.bloco_ordem;
            v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
            v_slot_data  := v_slot_data  || r.dia_ref;
            v_slot_piso  := v_slot_piso  || (r.inicio_previsto + interval '60 minutes');
            v_slot_opcional := v_slot_opcional || false; v_slot_unidade := v_slot_unidade || v_bloco_unidade;
        END IF;

        -- saida
        v_slot_passo := v_slot_passo || 'saida'::text;
        v_slot_prev  := v_slot_prev  || r.fim_previsto;
        v_slot_bloco := v_slot_bloco || r.bloco_ordem;
        v_slot_ids   := v_slot_ids   || array_to_string(r.escala_diaria_ids, ',');
        v_slot_data  := v_slot_data  || r.dia_ref;
        v_slot_piso  := v_slot_piso  || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);
        v_slot_opcional := v_slot_opcional || false; v_slot_unidade := v_slot_unidade || v_bloco_unidade;

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
                v_slot_opcional := v_slot_opcional || true; v_slot_unidade := v_slot_unidade || v_bloco_unidade;

                -- abre o turno i + 1
                v_slot_passo    := v_slot_passo    || 'entrada'::text;
                v_slot_prev     := v_slot_prev     || (r.turnos_inicio)[i + 1];
                v_slot_bloco    := v_slot_bloco    || r.bloco_ordem;
                v_slot_ids      := v_slot_ids      || (r.escala_diaria_ids)[i + 1]::text;
                v_slot_data     := v_slot_data     || r.dia_ref;
                v_slot_piso     := v_slot_piso     || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);
                v_slot_opcional := v_slot_opcional || true; v_slot_unidade := v_slot_unidade || v_bloco_unidade;
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
        -- v_slot_unidade entra na reordenacao junto com os demais: reordenar seis arrays e
        -- deixar o setimo parado desalinharia o lugar do slot do proprio slot, e a restricao
        -- passaria a comparar a batida com a unidade de OUTRO passo.
        SELECT array_agg(t.passo ORDER BY t.prev, t.ord),
               array_agg(t.prev  ORDER BY t.prev, t.ord),
               array_agg(t.bloco ORDER BY t.prev, t.ord),
               array_agg(t.ids   ORDER BY t.prev, t.ord),
               array_agg(t.dta   ORDER BY t.prev, t.ord),
               array_agg(t.piso  ORDER BY t.prev, t.ord),
               array_agg(t.opc   ORDER BY t.prev, t.ord),
               array_agg(t.uni   ORDER BY t.prev, t.ord)
          INTO v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional, v_slot_unidade
          FROM unnest(v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional, v_slot_unidade)
               WITH ORDINALITY AS t(passo, prev, bloco, ids, dta, piso, opc, uni, ord);
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
            -- Onde a batida foi feita. So a marcacao de RELOGIO carrega lugar confiavel:
            -- em origem terminal, marcacoes_ponto.unidade_id e a LOTACAO do servidor
            -- (fn_registrar_ponto le servidores.unidade_id), e usar isso como lugar
            -- derrubaria o ponto do Servidor Externo, lotado em A e escalado em B.
            v_m_uni     uuid[]        := '{}';
            v_m_cross   boolean[]     := '{}';
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
                SELECT m.id, m.ocorrido_em,
                       CASE WHEN m.origem = 'rep' AND m.dispositivo_id IS NOT NULL
                            THEN m.unidade_id END AS lugar
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
                v_m_uni := v_m_uni || r.lugar;
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


            -- LUGAR DA BATIDA x LUGAR DO PASSO (08/09/2026). Marca a batida de relogio que
            -- tinha um passo no horario certo e so nao pode casar por ser de outra unidade.
            -- Sem isto ela sairia como "fora_da_janela", que e mentira: o horario estava certo,
            -- o lugar e que nao. A pendencia precisa dizer a verdade para alguem poder trata-la.
            v_m_cross := array_fill(false, ARRAY[GREATEST(n_marc, 1)]);
            FOR k IN 1..n_marc LOOP
                IF v_m_uni[k] IS NOT NULL THEN
                    FOR s IN 1..n_slots LOOP
                        IF v_slot_unidade[s] IS NOT NULL
                           AND v_slot_unidade[s] <> v_m_uni[k]
                           AND v_m_ts[k] >= v_slot_piso[s]
                           AND abs(extract(epoch FROM (v_m_ts[k] - v_slot_prev[s])) / 60.0) <= v_tol_ontem THEN
                            v_m_cross[k] := true;
                            EXIT;
                        END IF;
                    END LOOP;
                END IF;
            END LOOP;

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
                       AND (v_m_uni[k] IS NULL OR v_slot_unidade[s] IS NULL
                            OR v_m_uni[k] = v_slot_unidade[s])
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
                        'tipo', CASE WHEN v_m_cross[k] THEN 'outra_unidade' ELSE 'fora_da_janela' END,
                        'unidade_marcacao', v_m_uni[k], 'marcacao_id', v_m_id[k],
                        'ocorrido_em', v_m_ts[k], 'origem', v_origem);
                    k := k - 1;
                ELSIF v_op = 2 THEN
                    s := s - 1;
                ELSE
                    IF k > 0 THEN
                        v_pendencias := v_pendencias || jsonb_build_object(
                            'tipo', CASE WHEN v_m_cross[k] THEN 'outra_unidade' ELSE 'fora_da_janela' END,
                        'unidade_marcacao', v_m_uni[k], 'marcacao_id', v_m_id[k],
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

-- ============================================================================
-- CONFERENCIA — roda junto e ABORTA a migration se qualquer assercao falhar
-- ============================================================================
-- EXECUTA fn_alocar_marcacoes_dia (armadilha 42: conferir que a funcao existe nao prova nada).
-- Confere os DOIS sentidos: a batida de outra unidade parou de casar, E a batida da unidade
-- certa continua casando. Proibir demais aqui esvaziaria a folha do parque inteiro.

DO $conf$
DECLARE
    v_jeoseane   uuid;
    v_aloc       jsonb;
    v_cruzadas   integer;
    v_pend_uni   integer;
    v_normais    integer;
    v_total      integer;
BEGIN
    -- 1. O CASO QUE MOTIVOU: JEOSEANE (mat. 67689), 07/09/2026.
    --    Nenhuma alocacao daquele dia pode usar batida de unidade diferente da escala do passo.
    SELECT id INTO v_jeoseane FROM public.servidores WHERE matricula = '67689' LIMIT 1;

    IF v_jeoseane IS NOT NULL THEN
        v_aloc := public.fn_alocar_marcacoes_dia(v_jeoseane, '2026-09-07'::date);

        SELECT count(*) INTO v_cruzadas
          FROM jsonb_array_elements(v_aloc->'alocacoes') a
          JOIN public.marcacoes_ponto m ON m.id = (a->>'marcacao_id')::uuid
         WHERE m.origem = 'rep'
           AND m.dispositivo_id IS NOT NULL
           AND m.unidade_id IS NOT NULL
           AND EXISTS (
                 SELECT 1
                   FROM unnest(ARRAY(SELECT (jsonb_array_elements_text(a->'escala_diaria_ids'))::uuid)) AS x(id)
                   JOIN public.escala_diaria ed ON ed.id = x.id
                   JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
                  WHERE em.unidade_id <> m.unidade_id);

        IF v_cruzadas <> 0 THEN
            RAISE EXCEPTION 'ABORTADO: o caso de referencia (mat. 67689, 07/09/2026) ainda tem % alocacao(oes) com batida de outra unidade.', v_cruzadas;
        END IF;
        RAISE NOTICE 'ok  caso de referencia sem alocacao cruzada';

        -- 2. E a batida recusada tem de aparecer como pendencia, com o motivo verdadeiro.
        --    Se ela sumisse, teriamos trocado um erro por perda de dado.
        SELECT count(*) INTO v_pend_uni
          FROM jsonb_array_elements(v_aloc->'pendencias') p
         WHERE p->>'tipo' = 'outra_unidade';
        RAISE NOTICE 'ok  pendencias do tipo outra_unidade no caso de referencia: %', v_pend_uni;
    END IF;

    -- 3. O OUTRO SENTIDO, e o que mais importa: o dia NORMAL continua sendo alocado. Amostra de
    --    dias reais com batida de relogio; se a taxa de alocacao desabar, a restricao esta
    --    recusando o que deveria aceitar.
    SELECT count(*) FILTER (WHERE jsonb_array_length(x.aloc->'alocacoes') > 0),
           count(*)
      INTO v_normais, v_total
      FROM (
            SELECT public.fn_alocar_marcacoes_dia(t.servidor_id, t.d) AS aloc
              FROM (
                    SELECT m.servidor_id, (m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS d
                      FROM public.marcacoes_ponto m
                     WHERE m.origem = 'rep'
                       AND m.dispositivo_id IS NOT NULL
                       AND m.ocorrido_em >= now() - interval '10 days'
                     GROUP BY 1, 2
                     LIMIT 150
                   ) t
           ) x;

    IF v_total > 0 AND v_normais * 2 < v_total THEN
        RAISE EXCEPTION 'ABORTADO: so % de % dias da amostra tiveram alguma alocacao — a restricao de unidade esta recusando alocacao legitima.', v_normais, v_total;
    END IF;
    RAISE NOTICE 'ok  dias com alocacao na amostra: % de %', v_normais, v_total;
END;
$conf$;

-- ============================================================================
-- CONFERENCIA MANUAL (rodar depois, com os olhos)
-- ============================================================================
-- Quantos passos JA GRAVADOS continuam apontando para batida de outra unidade. Aplicar estas
-- duas migrations NAO reescreve escala_diaria — a projecao so' e' regravada quando o dia e'
-- reconciliado. Este numero e' a fila de correcao, e a lista fechada tem de ser conferida
-- ANTES de reconciliar (armadilha 46: reconciliar em massa piora mais do que corrige).
--
--   SELECT s.matricula, s.nome, em.mes, ed.dia, ed.categoria,
--          ue.nome AS unidade_da_escala, um.nome AS unidade_da_batida, m.ocorrido_em
--     FROM public.escala_diaria ed
--     JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--     JOIN public.servidores s     ON s.id  = em.servidor_id
--     JOIN public.unidades ue      ON ue.id = em.unidade_id
--     CROSS JOIN LATERAL (VALUES (ed.presenca_entrada_marcacao_id),
--                                (ed.presenca_intervalo_saida_marcacao_id),
--                                (ed.presenca_intervalo_retorno_marcacao_id),
--                                (ed.presenca_saida_marcacao_id)) AS p(mid)
--     JOIN public.marcacoes_ponto m ON m.id = p.mid
--     JOIN public.unidades um       ON um.id = m.unidade_id
--    WHERE m.origem = 'rep' AND m.dispositivo_id IS NOT NULL
--      AND m.unidade_id <> em.unidade_id
--    ORDER BY em.ano, em.mes, ed.dia;
--
-- Medido em 08/09/2026, antes de aplicar: 18 linhas, 8 pares (servidor, dia), 4 pessoas.
