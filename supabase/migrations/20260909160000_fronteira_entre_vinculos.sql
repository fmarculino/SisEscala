-- ============================================================================
-- A FRONTEIRA ENTRE DOIS VINCULOS DA MESMA PESSOA
-- ============================================================================
-- Gerado por scratchpad/gen_fronteira_entre_vinculos.js a partir de
-- 20260909130000_alocacao_considera_vinculos_irmaos.sql (a VIGENTE de fn_alocar_marcacoes_dia).
-- Nao editar a mao: regerar pelo script.
--
-- Fecha o unico efeito colateral que o ensaio de 20260909130000 revelou em producao.
--
-- O QUE MUDA: quando a saida de um turno e a entrada do outro estao previstas para o MESMO
-- instante em DUAS matriculas da mesma pessoa, a regra do dono deixa de desqualificar a
-- candidata. Fora dessa combinacao exata (mesmo instante + um lado 'saida' + outro lado
-- 'entrada' + sombra de IRMAO), nada muda.
--
-- POR QUE
--
-- A regra do dono existe para impedir que a MESMA batida sirva ao MESMO passo em dois lugares.
-- Ela nao deve impedir que o fim de um turno encoste no inicio do outro — isso o sistema ja
-- trata como DESEJADO entre blocos encostados do mesmo servidor (armadilha 6 do CLAUDE.md, e os
-- slots de fronteira de 20260819200000, que ate ESPELHAM a mesma marcacao nos dois lados).
--
-- MEDIDO em 09/09/2026, no ensaio antes de aplicar (ELAYNE DE SOUSA PEIXOTO, mat 54464 e 68140,
-- HMI/ACOLHIMENTO, 02/09/2026):
--
--   previsto:  mat 68140  MT 07:00 -> 19:00      mat 54464  N 19:00 -> 07:00
--   batidas:   07:01  13:00  14:00  19:00  19:05
--
--   a 54464 ficava com a 19:00 como ENTRADA (dist 0)
--   a 68140 ficava com PENDENCIA na saida das 19:00
--   e a batida das 19:05 NAO era usada por ninguem — a regra do dono a desqualificava dos DOIS
--   lados, porque o instante previsto empata (19:00 = 19:00) e o desempate por servidor_id
--   entrega a candidata a um so.
--
-- Quatro dias so' nessa pessoa (02, 04, 06 e 08/09), mais um da MARIZANI. Sem esta correcao, a
-- folha do turno da manha fica sem a saida — pendencia visivel, nao erro silencioso, mas
-- pendencia que nao precisa existir: a batida esta la.
--
-- O QUE **NAO** MUDA, e e deliberado:
--
--   * O desempate por servidor_id CONTINUA, e continua sendo o que impede a dupla contagem
--     quando os dois lados disputam o MESMO passo (entrada x entrada, saida x saida). E' so a
--     combinacao complementar que passa a ser tratada como fronteira.
--
--   * Sombra de DIA VIZINHO (v_som_serv IS NULL) nao e afetada: a regra do dono entre dias
--     continua exatamente como em 20260819180000. Um bloco que termina as 07:00 e outro que
--     comeca as 07:00 no dia seguinte continuam disputando pela regra antiga.
--
--   * O intervalo nao entra: so 'entrada' e 'saida'. Intervalo de um vinculo coincidindo com
--     entrada/saida do outro nao e fronteira de turno, e tratar como tal fabricaria um par.
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
    -- De QUEM e cada sombra. NULL = dia vizinho do proprio servidor; preenchido = vinculo
    -- IRMAO (mesma pessoa, outra matricula). So serve para desempatar instante identico:
    -- sem isso, dois vinculos com o mesmo passo previsto ficariam AMBOS com a batida.
    v_sombra_serv   uuid[]        := '{}';
    v_som_serv      uuid;
    -- Qual PASSO cada sombra representa. So e usado para reconhecer a FRONTEIRA entre dois
    -- vinculos: saida de um turno e entrada do outro previstas para o mesmo instante.
    v_sombra_passo  text[]        := '{}';
    v_som_passo     text;
    v_real_passo    text;
    -- A PESSOA, nao a matricula: os outros cadastros Ativos com o mesmo CPF. Duplo vinculo
    -- (servidores.vinculo_multiplo_confirmado) faz a mesma pessoa ter duas matriculas, e o
    -- AFD identifica a PESSOA — a Portaria 671 nao tem campo de contrato. Vazio para a
    -- esmagadora maioria: 21 CPFs em 2.498 servidores Ativos (medido em 09/09/2026).
    v_pessoa_ids    uuid[]        := '{}';
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
    -- OS OUTROS CADASTROS DA MESMA PESSOA
    --
    -- Por que isto existe: o relogio nao consegue — e por norma nao pode — distinguir dois
    -- vinculos da mesma pessoa. O registro tipo 3 do AFD carrega
    -- "NSR + data/hora + identificador(12) + CRC", e a Portaria 671 define esse identificador
    -- como o CPF/PIS do TRABALHADOR. Nao existe campo de contrato, em nenhum REP-C certificado.
    -- O equipamento, por cima disso, RECUSA o segundo cadastro ("PIS ja cadastrado" /
    -- "CPF ja cadastrado" — 1.531 falhas medidas em rep_cadastros_fila em 09/09/2026).
    --
    -- Entao a desambiguacao e do PTRP, que e o papel dele na propria Portaria: complementar e
    -- tratar, nunca alterar o dado original. Quem decide de qual matricula e a batida e o
    -- HORARIO PREVISTO — e ele resolve, porque os dois vinculos sao turnos complementares
    -- (medido: 40 dos 41 dias com as duas matriculas escaladas tem janelas DISJUNTAS,
    -- sempre MT 07-19 x N 19-07).
    --
    -- So cadastro Ativo e nao-mesclado entra: mesclado_em_servidor_id marca a duplicata ja
    -- absorvida (armadilha 50), e ressuscita-la aqui traria de volta o que a mesclagem desfez.
    SELECT COALESCE(array_agg(o.id), '{}')
      INTO v_pessoa_ids
      FROM public.servidores eu
      JOIN public.servidores o
        ON o.id <> eu.id
       AND o.status = 'Ativo'
       AND o.mesclado_em_servidor_id IS NULL
       AND length(regexp_replace(COALESCE(o.cpf, ''), '\D', '', 'g')) >= 11
       AND right(regexp_replace(COALESCE(o.cpf, ''), '\D', '', 'g'), 11)
         = right(regexp_replace(COALESCE(eu.cpf, ''), '\D', '', 'g'), 11)
     WHERE eu.id = p_servidor_id
       AND length(regexp_replace(COALESCE(eu.cpf, ''), '\D', '', 'g')) >= 11;

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

    -- 1.c SLOTS-SOMBRA DOS VINCULOS IRMAOS, no MESMO dia
    -- A regra do dono de 20260819180000 resolve "de qual DIA e esta batida". A mesma mecanica,
    -- sem uma linha nova de algoritmo, resolve "de qual VINCULO e esta batida": os passos do
    -- irmao entram como sombra e so desqualificam candidata.
    --
    -- Bloco EXCEPTION PROPRIO, e nao o de cima: o guard de escopo de fn_blocos_previstos_dia
    -- levanta insufficient_privilege quando quem chama nao alcanca o irmao, e reaproveitar o
    -- EXCEPTION anterior zeraria tambem as sombras dos dias vizinhos, que ja estao montadas.
    IF array_length(v_pessoa_ids, 1) > 0 THEN
        BEGIN
            FOR r IN
                SELECT irmao.id AS servidor_id, b.*
                  FROM unnest(v_pessoa_ids) AS irmao(id)
                  CROSS JOIN LATERAL public.fn_blocos_previstos_dia(irmao.id, p_data) b
                 ORDER BY b.inicio_previsto
            LOOP
                v_sombra_prev  := v_sombra_prev  || r.inicio_previsto;
                v_sombra_serv  := v_sombra_serv  || r.servidor_id;
                v_sombra_passo := v_sombra_passo || 'entrada'::text;
                IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN
                    v_sombra_prev  := v_sombra_prev  || r.intervalo_inicio_previsto;
                    v_sombra_serv  := v_sombra_serv  || r.servidor_id;
                    v_sombra_passo := v_sombra_passo || 'intervalo_saida'::text;
                    v_sombra_prev  := v_sombra_prev  || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
                    v_sombra_serv  := v_sombra_serv  || r.servidor_id;
                    v_sombra_passo := v_sombra_passo || 'intervalo_retorno'::text;
                END IF;
                v_sombra_prev  := v_sombra_prev  || r.fim_previsto;
                v_sombra_serv  := v_sombra_serv  || r.servidor_id;
                v_sombra_passo := v_sombra_passo || 'saida'::text;
            END LOOP;
        EXCEPTION
            WHEN insufficient_privilege THEN
                NULL;
        END;
    END IF;

    -- v_sombra_serv acompanha v_sombra_prev posicao a posicao. As sombras de dias vizinhos
    -- foram empilhadas antes, sem dono: completa com NULL ate igualar, senao o unnest de dois
    -- arrays de tamanhos diferentes desalinha o dono da sombra.
    WHILE COALESCE(array_length(v_sombra_serv, 1), 0) < COALESCE(array_length(v_sombra_prev, 1), 0) LOOP
        v_sombra_serv  := array_prepend(NULL::uuid, v_sombra_serv);
        v_sombra_passo := array_prepend(NULL::text, v_sombra_passo);
    END LOOP;

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
                 WHERE (
                           m.servidor_id = p_servidor_id
                        OR (
                           -- Batida de um vinculo IRMAO. So a de RELOGIO entra, e o motivo e o
                           -- mesmo que ja restringe o lugar logo abaixo: em origem terminal,
                           -- marcacoes_ponto.unidade_id e a LOTACAO do servidor, nao onde ele
                           -- bateu. Sem lugar confiavel nao da para dizer que as duas matriculas
                           -- disputam a mesma batida fisica — e o problema medido e inteiramente
                           -- do REP. ajuste_coordenador/ajuste_servidor sao declaracao de alguem
                           -- sobre UMA matricula: nunca disputam.
                              m.servidor_id = ANY(v_pessoa_ids)
                          AND m.origem = 'rep'
                          AND m.dispositivo_id IS NOT NULL
                           )
                       )
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
                    SELECT u.t, u.p INTO v_ts_real, v_real_passo
                      FROM unnest(v_slot_prev, v_slot_passo) AS u(t, p)
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - u.t))), u.t LIMIT 1;
                    SELECT u.t, u.s, u.p INTO v_ts_som, v_som_serv, v_som_passo
                      FROM unnest(v_sombra_prev, v_sombra_serv, v_sombra_passo) AS u(t, s, p)
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - u.t))), u.t LIMIT 1;
                    -- FRONTEIRA ENTRE VINCULOS: a saida de um turno e a entrada do outro
                    -- previstas para o MESMO instante. Uma batida fisica ali fecha um turno e
                    -- abre o seguinte — e' o comportamento que o sistema JA trata como desejado
                    -- entre blocos encostados do mesmo servidor (armadilha 6, e os slots de
                    -- fronteira de 20260819200000). A regra do dono nao pode desqualificar aqui:
                    -- ela existe para impedir que a mesma batida sirva ao MESMO passo em dois
                    -- lugares, nao para impedir que o fim de um turno encoste no inicio do outro.
                    --
                    -- MEDIDO em 09/09/2026 (ELAYNE, mat 54464 e 68140, 02/09): MT 07:00-19:00 numa
                    -- matricula e N 19:00-07:00 na outra, com DUAS batidas na fronteira (19:00 e
                    -- 19:05). A 54464 ficava com a 19:00 como entrada e a 68140 ficava SEM SAIDA —
                    -- e a batida das 19:05 nao era usada por ninguem, porque a regra do dono a
                    -- desqualificava dos dois lados. Quatro dias assim so' nessa pessoa.
                    IF v_ts_real IS NOT NULL AND v_ts_som IS NOT NULL
                       AND v_som_serv IS NOT NULL
                       AND v_ts_som = v_ts_real
                       AND v_real_passo IS DISTINCT FROM v_som_passo
                       AND v_real_passo IN ('entrada', 'saida')
                       AND v_som_passo  IN ('entrada', 'saida') THEN
                        NULL;   -- fronteira: a candidata continua disputando deste lado
                    ELSIF v_ts_real IS NOT NULL AND v_ts_som IS NOT NULL THEN
                        v_d_real := abs(extract(epoch FROM (r.ocorrido_em - v_ts_real)));
                        v_d_som  := abs(extract(epoch FROM (r.ocorrido_em - v_ts_som)));
                        IF v_d_som < v_d_real
                           OR (v_d_som = v_d_real AND v_ts_som < v_ts_real)
                           -- Instante previsto IDENTICO nos dois vinculos (so acontece com
                           -- escala sobreposta, que a trava de pessoa unica passa a impedir):
                           -- sem este ramo nenhum dos dois "perde" e a MESMA batida seria
                           -- gravada nas duas matriculas — a dupla contagem da armadilha 23,
                           -- agora dentro da mesma pessoa. Desempate por servidor_id: e
                           -- arbitrario, mas e DETERMINISTICO e simetrico, entao os dois lados
                           -- chegam a decisoes opostas e exatamente um fica com ela.
                           OR (v_d_som = v_d_real AND v_ts_som = v_ts_real
                               AND v_som_serv IS NOT NULL AND v_som_serv < p_servidor_id) THEN
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

COMMENT ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer) IS
'Casa as batidas do dia com os passos previstos (DP monotonico). A batida e da PESSOA: os outros
cadastros Ativos com o mesmo CPF tambem disputam, e os passos deles entram como sombra. Na
FRONTEIRA entre dois vinculos (saida de um e entrada do outro no mesmo instante) a sombra nao
desqualifica — uma batida ali fecha um turno e abre o seguinte. Ver 20260909130000 e
20260909160000.';

-- ============================================================================
-- CONFERENCIA — roda junto e ABORTA se falhar (armadilha 42: EXECUTA a funcao)
-- ============================================================================
-- Confere os DOIS sentidos: a fronteira parou de perder a batida, E a exclusividade continua
-- valendo fora dela (nenhuma batida no mesmo passo de duas matriculas).

DO $conf$
DECLARE
    r          record;
    v_a        jsonb;
    v_dupla    integer := 0;
    v_pend     integer := 0;
    v_aloc     integer := 0;
BEGIN
    FOR r IN
        WITH pess AS (
            SELECT s.id, right(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 11) AS cpf11
              FROM public.servidores s
             WHERE s.status = 'Ativo' AND s.mesclado_em_servidor_id IS NULL
               AND length(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g')) >= 11),
        dup AS (SELECT cpf11 FROM pess GROUP BY cpf11 HAVING count(*) > 1),
        dias AS (
            SELECT DISTINCT p.cpf11,
                   (m.ocorrido_em AT TIME ZONE COALESCE(
                       (SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
                       'America/Sao_Paulo'))::date AS d
              FROM public.marcacoes_ponto m
              JOIN pess p ON p.id = m.servidor_id
              JOIN dup ON dup.cpf11 = p.cpf11
             WHERE m.origem = 'rep' AND m.dispositivo_id IS NOT NULL
               AND m.ocorrido_em >= (now() - interval '60 days'))
        SELECT * FROM dias
    LOOP
        DECLARE
            v_irmaos uuid[];
            v_um     uuid;
            v_par    text[] := '{}';
            v_chave  text;
        BEGIN
            SELECT array_agg(s.id) INTO v_irmaos
              FROM public.servidores s
             WHERE s.status = 'Ativo' AND s.mesclado_em_servidor_id IS NULL
               AND right(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 11) = r.cpf11;

            FOREACH v_um IN ARRAY v_irmaos LOOP
                BEGIN
                    v_a := public.fn_alocar_marcacoes_dia(v_um, r.d);
                EXCEPTION WHEN OTHERS THEN CONTINUE; END;
                v_aloc := v_aloc + jsonb_array_length(v_a->'alocacoes');
                v_pend := v_pend + jsonb_array_length(v_a->'pendencias');
                -- chave (marcacao, passo): a MESMA batida no MESMO passo em duas matriculas e
                -- que seria dupla contagem. Em passos diferentes (fronteira) e legitimo.
                SELECT COALESCE(array_agg((x->>'marcacao_id') || '|' || (x->>'passo')), '{}')
                  INTO v_par FROM jsonb_array_elements(v_a->'alocacoes') x;
                FOREACH v_chave IN ARRAY v_par LOOP
                    IF v_chave = ANY(v_par[1:array_position(v_par, v_chave) - 1]) THEN
                        v_dupla := v_dupla + 1;
                    END IF;
                END LOOP;
            END LOOP;
        END;
    END LOOP;

    RAISE NOTICE 'alocacoes: % | pendencias: % | (marcacao,passo) repetidos: %', v_aloc, v_pend, v_dupla;

    IF v_dupla > 0 THEN
        RAISE EXCEPTION 'ABORTADO: a mesma batida foi alocada ao MESMO passo mais de uma vez '
                        '(% ocorrencia(s)). A fronteira afrouxou demais.', v_dupla;
    END IF;
END;
$conf$;
