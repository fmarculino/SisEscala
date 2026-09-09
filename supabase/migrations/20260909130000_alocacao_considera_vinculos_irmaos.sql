-- ============================================================================
-- DUPLO VINCULO: A BATIDA E DA PESSOA; A ESCALA DIZ DE QUAL MATRICULA
-- ============================================================================
-- Gerado por scratchpad/gen_alocacao_duplo_vinculo.js a partir de
-- 20260908150000_alocacao_nao_atravessa_unidade.sql (a migration VIGENTE de
-- fn_alocar_marcacoes_dia). Nao editar a mao: regerar pelo script.
--
-- Par de 20260909140000 (pessoa unica na trava de sobreposicao de escala). Aplicar as duas.
-- Esta e segura sozinha; a outra e o que impede o caso ambiguo de nascer.
--
-- O QUE MUDA: ao alocar o dia de uma matricula, as batidas de RELOGIO dos OUTROS cadastros da
-- mesma pessoa (mesmo CPF, Ativos) tambem disputam os passos daquele dia — e os passos deles
-- entram como sombra, entao exatamente um dos vinculos fica com cada batida. Para os 2.477
-- servidores sem cadastro irmao, v_pessoa_ids e vazio e NADA muda.
--
-- POR QUE
--
-- O relogio nao consegue, e por norma nao pode, distinguir dois vinculos da mesma pessoa:
--
--   1. O AFD nao tem campo de contrato. O registro tipo 3 carrega
--      "NSR + data/hora + identificador(12) + CRC", e a Portaria 671/2021 define esse campo
--      (posicoes 035-046) como o PIS, CPF ou sua composicao — do TRABALHADOR. Isso vale para
--      qualquer REP-C certificado: trocar de marca de relogio nao resolve.
--
--   2. O equipamento RECUSA o segundo cadastro. Medido em producao (09/09/2026): os 42
--      cadastros das 21 pessoas com CPF duplicado acumulam 1.531 falhas em rep_cadastros_fila,
--      com a resposta do proprio device — "PIS ja cadastrado: 25896334249",
--      "CPF ja cadastrado: 88556093191", "Matricula ja cadastrada". Lido direto do REP da SMS:
--      300 usuarios, 300 `pis` DISTINTOS.
--
--   3. A digital e 1:N e nao pergunta nada. O modo 1:1 existe (get_system_configuration
--      devolve one_to_one_enabled: false) mas e configuracao do equipamento INTEIRO: ligar
--      obrigaria os 323 usuarios daquele relogio a digitar antes do dedo, para resolver 10
--      pessoas. Descartado por desproporcao.
--
-- Entao a desambiguacao e do PTRP — que e exatamente o papel dele na Portaria 671:
-- complementar e tratar, NUNCA alterar o dado original. E o dado para isso ja existe: a
-- escala.
--
-- O QUE TORNA ISSO POSSIVEL (medido em 08 e 09/2026, os 10 casos de mesma unidade):
--   41 dias em que AS DUAS matriculas tem turno
--   40 com janelas de horario DISJUNTAS  <- a escala desambigua sozinha
--    1 sobreposta, e e ERRO DE LANCAMENTO (EDILEUZA 01/09, dois plantoes N simultaneos)
-- O padrao e sempre o mesmo: MT 07:00-19:00 numa matricula, N 19:00-07:00 na outra. Uma
-- batida as 07:03 e do MT; as 19:04 e do N.
--
-- O DANO QUE ISTO CORRIGE (09/2026, os mesmos 10 casos):
--   13 matriculas com escala; 6 delas com ZERO batida propria
--   174 dias de escala, 149 (86%) sem presenca registrada
--   163 batidas no mes, 29 gravadas numa matricula que NAO tinha turno naquele dia
-- E qual matricula ganhava o ponto era acidente: o vinculo nasce por ordem de chegada da fila
-- de cadastro, e no HMM os quatro relogios irmaos apontavam para matriculas DIFERENTES
-- (PAULINO: HMM-01/02 -> mat 67469, HMM-03/04 -> mat 65562). Em qual matricula o ponto caia
-- dependia de em qual dos quatro a pessoa encostou o dedo.
--
-- O QUE **NAO** MUDA, e e deliberado:
--
--   * marcacoes_ponto NAO e tocada. A marcacao continua com o dono que tem, o AFD original
--     continua intocado e o trigger de imutabilidade NAO ganha excecao nova (hoje sao tres:
--     reparse de AFD, fusao de setor, mesclagem de cadastro). A batida e da PESSOA; o que
--     passa a ser resolvido pela escala e em qual matricula ela e APLICADA.
--
--   * Os 11 casos de vinculo em unidades DIFERENTES continuam como estao — ja funcionavam,
--     porque rep_vinculos_servidor e unico por (dispositivo, identificador) e cada relogio
--     resolve para a matricula da sua unidade. Conferido: ANA LUCIA bate 25x na SMS e 16x no
--     HMI, cada batida na matricula certa. A restricao de unidade (20260908150000) segue
--     valendo por cima disto.
--
--   * "Nunca fabricar horario" e "nunca descartar batida" seguem intactos: vinculo sem batida
--     que case continua virando pendencia, e batida que nao casa com nenhum dos dois continua
--     gravada e visivel.
--
-- TRES DECISOES QUE PRECISAM SOBREVIVER A QUALQUER RECRIACAO:
--
--   1. SO A BATIDA DE RELOGIO DO IRMAO DISPUTA. Em origem `terminal`,
--      marcacoes_ponto.unidade_id e a LOTACAO do servidor (fn_registrar_ponto le
--      servidores.unidade_id), nao onde a pessoa bateu — sem lugar confiavel nao da para
--      afirmar que as duas matriculas disputam a mesma batida fisica. E ajuste_coordenador /
--      ajuste_servidor sao declaracao de alguem sobre UMA matricula: nunca disputam.
--
--   2. EXATAMENTE UM DONO. Os passos do irmao viram SOMBRA e so desqualificam candidata —
--      a mesma mecanica da regra do dono entre dias vizinhos (20260819180000), sem uma linha
--      nova de algoritmo. E quando o instante previsto EMPATA entre os dois vinculos, o
--      desempate por servidor_id fecha o caso: sem ele nenhum dos dois perderia e a MESMA
--      batida seria gravada nas duas matriculas — a dupla contagem da armadilha 23, agora
--      dentro da mesma pessoa.
--
--   3. CADASTRO MESCLADO NAO VOLTA. o.mesclado_em_servidor_id IS NULL: a duplicata ja
--      absorvida (armadilha 50) nao pode ressuscitar aqui como se fosse um vinculo vivo.
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
                v_sombra_prev := v_sombra_prev || r.inicio_previsto;
                v_sombra_serv := v_sombra_serv || r.servidor_id;
                IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN
                    v_sombra_prev := v_sombra_prev || r.intervalo_inicio_previsto;
                    v_sombra_serv := v_sombra_serv || r.servidor_id;
                    v_sombra_prev := v_sombra_prev || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
                    v_sombra_serv := v_sombra_serv || r.servidor_id;
                END IF;
                v_sombra_prev := v_sombra_prev || r.fim_previsto;
                v_sombra_serv := v_sombra_serv || r.servidor_id;
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
        v_sombra_serv := array_prepend(NULL::uuid, v_sombra_serv);
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
                    SELECT t INTO v_ts_real FROM unnest(v_slot_prev) AS t
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - t))), t LIMIT 1;
                    SELECT u.t, u.s INTO v_ts_som, v_som_serv
                      FROM unnest(v_sombra_prev, v_sombra_serv) AS u(t, s)
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - u.t))), u.t LIMIT 1;
                    IF v_ts_real IS NOT NULL AND v_ts_som IS NOT NULL THEN
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
'Casa as batidas do dia com os passos previstos (DP monotonico). A batida e da PESSOA: os
outros cadastros Ativos com o mesmo CPF (duplo vinculo) tambem disputam, e os passos deles
entram como sombra, entao exatamente um vinculo fica com cada batida. So a batida de RELOGIO
do irmao disputa — em origem terminal, unidade_id e a lotacao, nao o lugar. Ver
20260909130000 e docs/planos/2026-09-09-duplo-vinculo-e-registro-de-ponto-no-rep.md.';

-- ============================================================================
-- CONFERENCIA — roda junto e ABORTA a migration se qualquer assercao falhar
-- ============================================================================
-- EXECUTA fn_alocar_marcacoes_dia (armadilha 42: conferir que a funcao existe nao prova nada).
-- Confere os DOIS sentidos: a batida do vinculo irmao passou a ser alcancavel, E ninguem ficou
-- com a mesma batida duas vezes. Afrouxar aqui recria a dupla contagem; apertar demais
-- esvaziaria a folha de quem nao tem irmao nenhum.

DO $conf$
DECLARE
    v_pessoas    integer;
    v_dupla      integer := 0;
    v_ganhos     integer := 0;
    v_amostra    integer := 0;
    v_com_aloc   integer := 0;
    r            record;
    v_a          jsonb;
BEGIN
    -- 1. Quantas pessoas tem cadastro irmao Ativo (so para registrar o alcance no log)
    SELECT count(*) INTO v_pessoas
      FROM (
        SELECT right(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 11) AS cpf11
          FROM public.servidores s
         WHERE s.status = 'Ativo'
           AND s.mesclado_em_servidor_id IS NULL
           AND length(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g')) >= 11
         GROUP BY 1
        HAVING count(*) > 1) x;

    RAISE NOTICE 'pessoas com 2+ cadastros Ativos (mesmo CPF): %', v_pessoas;

    -- 2. EXCLUSIVIDADE: rodando os dois lados do mesmo dia, nenhuma marcacao pode aparecer
    --    alocada nas DUAS matriculas. E a assercao central desta migration.
    FOR r IN
        WITH pess AS (
            SELECT s.id,
                   right(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 11) AS cpf11
              FROM public.servidores s
             WHERE s.status = 'Ativo'
               AND s.mesclado_em_servidor_id IS NULL
               AND length(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g')) >= 11
        ),
        dup AS (SELECT cpf11 FROM pess GROUP BY cpf11 HAVING count(*) > 1),
        dias AS (
            SELECT DISTINCT p.cpf11, p.id AS servidor_id,
                   (m.ocorrido_em AT TIME ZONE COALESCE(
                       (SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
                       'America/Sao_Paulo'))::date AS d
              FROM public.marcacoes_ponto m
              JOIN pess p ON p.id = m.servidor_id
              JOIN dup  ON dup.cpf11 = p.cpf11
             WHERE m.origem = 'rep'
               AND m.dispositivo_id IS NOT NULL
               AND m.ocorrido_em >= (now() - interval '90 days')
        )
        SELECT cpf11, d, array_agg(servidor_id) AS servidores FROM dias GROUP BY cpf11, d
    LOOP
        DECLARE
            v_ids   uuid[] := '{}';
            v_todos uuid[] := '{}';
            v_um    uuid;
            v_irmaos uuid[];
        BEGIN
            -- todos os cadastros daquela pessoa, nao so os que tem batida propria hoje
            SELECT array_agg(s.id) INTO v_irmaos
              FROM public.servidores s
             WHERE s.status = 'Ativo'
               AND s.mesclado_em_servidor_id IS NULL
               AND right(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 11) = r.cpf11;

            FOREACH v_um IN ARRAY v_irmaos LOOP
                BEGIN
                    v_a := public.fn_alocar_marcacoes_dia(v_um, r.d);
                EXCEPTION WHEN OTHERS THEN
                    CONTINUE;
                END;
                SELECT COALESCE(array_agg((x->>'marcacao_id')::uuid), '{}')
                  INTO v_ids
                  FROM jsonb_array_elements(v_a->'alocacoes') x;
                v_todos := v_todos || v_ids;
            END LOOP;

            IF array_length(v_todos, 1) IS NOT NULL
               AND array_length(v_todos, 1) <> (SELECT count(DISTINCT u) FROM unnest(v_todos) u) THEN
                v_dupla := v_dupla + 1;
                RAISE WARNING 'DUPLA CONTAGEM: cpf %, dia % -> %', r.cpf11, r.d, v_todos;
            END IF;
            IF array_length(v_todos, 1) IS NOT NULL THEN
                v_ganhos := v_ganhos + array_length(v_todos, 1);
            END IF;
        END;
    END LOOP;

    IF v_dupla > 0 THEN
        RAISE EXCEPTION 'ABORTADO: a mesma batida ficou alocada em DUAS matriculas em % dia(s). '
                        'O desempate da regra do dono entre vinculos nao esta fechando — '
                        'confira v_sombra_serv / v_som_serv < p_servidor_id.', v_dupla;
    END IF;
    RAISE NOTICE 'exclusividade ok: nenhuma batida alocada em duas matriculas (% alocacoes conferidas)', v_ganhos;

    -- 3. NAO REGREDIU para quem NAO tem irmao: uma amostra de dias que hoje tem presenca
    --    gravada precisa continuar produzindo alocacao. Pega erro grosseiro (funcao que passou
    --    a nao casar nada), que e o modo de falha que esvaziaria a folha do parque.
    FOR r IN
        SELECT em.servidor_id,
               make_date(em.ano, em.mes, ed.dia) AS d
          FROM public.escala_diaria ed
          JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
         WHERE ed.presenca_entrada_em IS NOT NULL
           AND ed.presenca_entrada_origem = 'rep'
           AND make_date(em.ano, em.mes, ed.dia) >= (now() - interval '45 days')::date
           AND NOT EXISTS (
               SELECT 1 FROM public.servidores a
                JOIN public.servidores b
                  ON b.id <> a.id
                 AND b.status = 'Ativo'
                 AND b.mesclado_em_servidor_id IS NULL
                 AND right(regexp_replace(COALESCE(b.cpf, ''), '\D', '', 'g'), 11)
                   = right(regexp_replace(COALESCE(a.cpf, ''), '\D', '', 'g'), 11)
                WHERE a.id = em.servidor_id
                  AND length(regexp_replace(COALESCE(a.cpf, ''), '\D', '', 'g')) >= 11)
         LIMIT 40
    LOOP
        v_amostra := v_amostra + 1;
        BEGIN
            v_a := public.fn_alocar_marcacoes_dia(r.servidor_id, r.d);
            IF jsonb_array_length(v_a->'alocacoes') > 0 THEN
                v_com_aloc := v_com_aloc + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'ABORTADO: fn_alocar_marcacoes_dia falhou para servidor % em % : %',
                            r.servidor_id, r.d, SQLERRM;
        END;
    END LOOP;

    IF v_amostra > 0 AND v_com_aloc = 0 THEN
        RAISE EXCEPTION 'ABORTADO: nenhum dos % dias da amostra (servidores SEM cadastro irmao, '
                        'com presenca de origem rep ja gravada) produziu alocacao. A funcao '
                        'parou de casar batida — isto esvaziaria a folha do parque.', v_amostra;
    END IF;
    RAISE NOTICE 'sem regressao: % de % dias da amostra (sem irmao) continuam alocando', v_com_aloc, v_amostra;
END;
$conf$;
