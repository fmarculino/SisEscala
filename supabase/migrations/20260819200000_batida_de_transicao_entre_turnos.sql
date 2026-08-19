-- ============================================================================
-- Migration: batida de transicao entre turnos fundidos no mesmo bloco
-- Data: 2026-08-19
--
-- PROBLEMA (medido em producao em 19/08/2026)
--   Regular M 07:00-13:00 + Plantao T 13:00-19:00 fundem em UM bloco continuo (armadilha 6),
--   e o bloco tem 4 passos no maximo: entrada, intervalo (quando ha) e saida. Nao existia
--   passo na FRONTEIRA dos dois turnos.
--
--   Consequencias, as duas visiveis no anexo de plantoes:
--     - quem bate na transicao perde a batida: MAISA (mat. 32269), 18/08/2026, bateu 07:04,
--       13:07, 13:10 e 19:09; as duas do meio viraram pendencia "fora_da_janela".
--     - a projecao grava o MESMO par entrada/saida em todas as linhas do bloco, entao a linha
--       do plantao recebia o horario do expediente (07:04 -> 19:09) — e no anexo o plantao
--       aparecia com o horario do regular.
--
-- CORRECAO — tres funcoes, uma ideia so
--   Cada fronteira interna do bloco ganha DOIS slots opcionais: a saida do turno que fecha e a
--   entrada do turno que abre, ambos previstos no mesmo instante. Eles sao gravados na LINHA de
--   cada turno, nao no bloco inteiro.
--
--   1. fn_blocos_previstos_dia expoe turnos_inicio[] / turnos_fim[] — o previsto de cada turno
--      fundido, na ordem de escala_diaria_ids. A regra de fusao NAO muda.
--   2. fn_alocar_marcacoes_dia cria os slots de fronteira e ordena os slots por instante
--      previsto (o DP e um alinhamento monotonico; sem ordenar, a batida de transicao seria
--      recusada do mesmo jeito). Slot opcional sem batida NAO vira pendencia.
--   3. fn_projecao_marcacoes_dia desempata a favor da alocacao de fronteira, que e especifica
--      de uma linha, contra a do bloco, que vale para todas.
--
-- O QUE NAO MUDA
--   - Quem trabalha em bloco continuo e bate so duas vezes continua igual: os slots de
--     fronteira ficam vazios e nao geram pendencia nem horario nenhum.
--   - Nada e fabricado. Sem batida na fronteira, a linha do plantao segue com o horario do
--     bloco, como hoje — a Portaria 671/2021 veda marcacao automatica, nao preenchimento
--     derivado de uma batida real.
--   - A fusao de blocos, os guards de Sobreaviso e o guard de escopo de fn_blocos_previstos_dia
--     seguem intactos (conferidos por contagem no gerador).
--
-- fn_blocos_previstos_dia muda a lista de colunas do RETURNS TABLE, entao precisa de DROP antes
-- do CREATE (42P13 — ver a nota de 13/08/2026 no CLAUDE.md). Sem CASCADE: se algum dependente
-- real existir, e melhor o erro do que a remocao silenciosa. fn_blocos_previstos_mes lista as
-- colunas que consome uma a uma, entao nao quebra com colunas novas.
--
-- Corpos copiados mecanicamente de 20260812130000 (blocos) e 20260819180000 (alocacao)
-- por scratchpad/gen_batida_transicao.js, que aborta se a contagem de ocorrencias divergir.
-- ============================================================================


DROP FUNCTION IF EXISTS public.fn_blocos_previstos_dia(uuid, date);

CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_dia(
    p_servidor_id uuid,
    p_data        date
)
RETURNS TABLE (
    bloco_ordem               integer,
    escala_diaria_ids         uuid[],
    categoria                 text,
    inicio_previsto           timestamptz,
    fim_previsto              timestamptz,
    intervalo_inicio_previsto timestamptz,
    intervalo_fim_previsto    timestamptz,
    permite_intervalo         boolean,
    -- O previsto de CADA turno fundido neste bloco, na mesma ordem de escala_diaria_ids.
    -- Um bloco com 2 turnos tem 1 fronteira interna: turnos_fim[1] = turnos_inicio[2]. E ali
    -- que a batida de transicao acontece. Ver 20260819200000.
    turnos_inicio             timestamptz[],
    turnos_fim                timestamptz[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fnbloco$
DECLARE
    v_timezone TEXT;
    v_servidor_id UUID;
    v_dia_hoje INTEGER;
    v_mes INTEGER;
    v_ano INTEGER;
    r RECORD;
    v_shifts_count INTEGER := 0;
    v_blocks_count INTEGER := 0;

    -- Turnos individuais do dia (ate 3), na ordem de start_hour.
    v_s1_id UUID; v_s1_inicio INTEGER; v_s1_fim INTEGER; v_s1_entrada TIMESTAMP WITH TIME ZONE; v_s1_int_saida TIMESTAMP WITH TIME ZONE; v_s1_int_retorno TIMESTAMP WITH TIME ZONE; v_s1_saida TIMESTAMP WITH TIME ZONE; v_s1_cat TEXT; v_s1_int_ini_min INTEGER; v_s1_int_fim_min INTEGER; v_s1_permite_int BOOLEAN; v_s1_dobra_diurna BOOLEAN;
    v_s2_id UUID; v_s2_inicio INTEGER; v_s2_fim INTEGER; v_s2_entrada TIMESTAMP WITH TIME ZONE; v_s2_int_saida TIMESTAMP WITH TIME ZONE; v_s2_int_retorno TIMESTAMP WITH TIME ZONE; v_s2_saida TIMESTAMP WITH TIME ZONE; v_s2_cat TEXT; v_s2_int_ini_min INTEGER; v_s2_int_fim_min INTEGER; v_s2_permite_int BOOLEAN; v_s2_dobra_diurna BOOLEAN;
    v_s3_id UUID; v_s3_inicio INTEGER; v_s3_fim INTEGER; v_s3_entrada TIMESTAMP WITH TIME ZONE; v_s3_int_saida TIMESTAMP WITH TIME ZONE; v_s3_int_retorno TIMESTAMP WITH TIME ZONE; v_s3_saida TIMESTAMP WITH TIME ZONE; v_s3_cat TEXT; v_s3_int_ini_min INTEGER; v_s3_int_fim_min INTEGER; v_s3_permite_int BOOLEAN; v_s3_dobra_diurna BOOLEAN;

    -- Blocos contiguos resultantes da fusao (ate 3).
    v_b1_inicio INTEGER; v_b1_fim INTEGER; v_b1_ids UUID[]; v_b1_entradas TIMESTAMP WITH TIME ZONE[]; v_b1_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b1_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b1_saidas TIMESTAMP WITH TIME ZONE[]; v_b1_cat TEXT; v_b1_int_ini INTEGER; v_b1_int_fim INTEGER; v_b1_permite_int BOOLEAN;
    v_b2_inicio INTEGER; v_b2_fim INTEGER; v_b2_ids UUID[]; v_b2_entradas TIMESTAMP WITH TIME ZONE[]; v_b2_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b2_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b2_saidas TIMESTAMP WITH TIME ZONE[]; v_b2_cat TEXT; v_b2_int_ini INTEGER; v_b2_int_fim INTEGER; v_b2_permite_int BOOLEAN;
    v_b3_inicio INTEGER; v_b3_fim INTEGER; v_b3_ids UUID[]; v_b3_entradas TIMESTAMP WITH TIME ZONE[]; v_b3_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b3_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b3_saidas TIMESTAMP WITH TIME ZONE[]; v_b3_cat TEXT; v_b3_int_ini INTEGER; v_b3_int_fim INTEGER; v_b3_permite_int BOOLEAN;
    -- Previsto de cada turno fundido, para a batida de transicao (20260819200000).
    v_b1_turnos_ini INTEGER[]; v_b1_turnos_fim INTEGER[];
    v_b2_turnos_ini INTEGER[]; v_b2_turnos_fim INTEGER[];
    v_b3_turnos_ini INTEGER[]; v_b3_turnos_fim INTEGER[];
BEGIN
    -- Timezone: mesma fonte e mesmo fallback de fn_confirmar_presenca.
    SELECT (valor#>>'{}')::text INTO v_timezone
    FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    -- Alimenta as variaveis que a regiao copiada espera. E isso que permite copiar o cursor
    -- verbatim, sem renomear nada dentro dele.
    v_servidor_id := p_servidor_id;
    v_dia_hoje    := extract(day   from p_data)::integer;
    v_mes         := extract(month from p_data)::integer;
    v_ano         := extract(year  from p_data)::integer;

    -- ESCOPO (12/08/2026, CLAUDE.md "Pendencias que bloqueiam a Fase 5", item 3). Antes desta
    -- checagem, qualquer authenticated podia consultar a projecao de presenca de QUALQUER
    -- servidor, sabendo so o UUID - GRANT liberado, nenhum guard.
    --
    -- service_role bypassa (auth.uid() IS NULL): e o caminho de toda chamada administrativa/
    -- manual da cadeia de reconciliacao (fn_alocar_marcacoes_dia, fn_projecao_marcacoes_dia,
    -- fn_conferir_reconciliacao, fn_reconciliar_marcacoes_dia - a unica que escreve). Nenhuma
    -- delas ganha guard proprio: por serem envelopes LATERAL desta funcao, herdam a checagem
    -- daqui.
    --
    -- Checa por ESCALA (escala_mensal do servidor no mes/ano consultado), NAO pela lotacao
    -- atual (servidores.unidade_id/setor_id): um servidor externo adicionado a escala de outra
    -- unidade (v1.2.4) tem que continuar visivel para quem gerencia AQUELA escala, mesmo fora
    -- da propria lotacao. fn_unidade_no_escopo sozinha nao basta - so verifica
    -- profile_unidades; fn_unidade_alcancavel_por_setor cobre quem so tem profile_setores sem a
    -- unidade-pai vinculada (piloto da TI, ver CLAUDE.md).
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM public.escala_mensal em_escopo
         WHERE em_escopo.servidor_id = p_servidor_id
           AND em_escopo.ano = v_ano
           AND em_escopo.mes = v_mes
           AND (
               public.fn_unidade_no_escopo(em_escopo.unidade_id)
               OR public.fn_unidade_alcancavel_por_setor(em_escopo.unidade_id)
           )
    ) THEN
        RAISE EXCEPTION 'Sem permissão para acessar a escala deste servidor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

-- ============================================================================
-- INICIO DA REGIAO COPIADA DE 20260807050000 (cursor de hoje + fusao de blocos)
-- Nao editar a mao. Alterar aqui exige regerar pelo script.
-- ============================================================================
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
            COALESCE(j.intervalo_minutos, 60) as intervalo_minutos,
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
            -- Jornadas de ate 6h nao possuem intervalo intrajornada (CLT Art. 71).
            v_permite_int := COALESCE(r.permite_marca_intervalo, false)
                AND public.fn_jornada_tem_intervalo(v_end_min - v_start_min, r.intervalo_minutos);
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
                        v_int_ini_min + COALESCE(r.intervalo_minutos, 60)
                END;
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
        -- Sem escala no dia: nenhum bloco previsto. A funcao original logava tentativa
        -- negada aqui; esta e de consulta e apenas nao devolve linhas.
        RETURN;
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

-- ============================================================================
-- FIM DA REGIAO COPIADA
-- ============================================================================

    -- Emite os blocos como linhas. Minutos desde a meia-noite viram timestamptz na data
    -- pedida; valores acima de 1440 atravessam a meia-noite naturalmente via make_interval.
    IF v_blocks_count >= 1 THEN
        bloco_ordem               := 1;
        escala_diaria_ids         := v_b1_ids;
        categoria                 := v_b1_cat;
        inicio_previsto           := (p_data::timestamp + make_interval(mins => v_b1_inicio)) AT TIME ZONE v_timezone;
        fim_previsto              := (p_data::timestamp + make_interval(mins => v_b1_fim))    AT TIME ZONE v_timezone;
        permite_intervalo         := COALESCE(v_b1_permite_int, false);
        intervalo_inicio_previsto := CASE WHEN COALESCE(v_b1_permite_int, false) AND v_b1_int_ini IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b1_int_ini)) AT TIME ZONE v_timezone END;
        intervalo_fim_previsto    := CASE WHEN COALESCE(v_b1_permite_int, false) AND v_b1_int_fim IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b1_int_fim)) AT TIME ZONE v_timezone END;
        turnos_inicio             := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b1_turnos_ini) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        turnos_fim                := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b1_turnos_fim) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        RETURN NEXT;
    END IF;

    IF v_blocks_count >= 2 THEN
        bloco_ordem               := 2;
        escala_diaria_ids         := v_b2_ids;
        categoria                 := v_b2_cat;
        inicio_previsto           := (p_data::timestamp + make_interval(mins => v_b2_inicio)) AT TIME ZONE v_timezone;
        fim_previsto              := (p_data::timestamp + make_interval(mins => v_b2_fim))    AT TIME ZONE v_timezone;
        permite_intervalo         := COALESCE(v_b2_permite_int, false);
        intervalo_inicio_previsto := CASE WHEN COALESCE(v_b2_permite_int, false) AND v_b2_int_ini IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b2_int_ini)) AT TIME ZONE v_timezone END;
        intervalo_fim_previsto    := CASE WHEN COALESCE(v_b2_permite_int, false) AND v_b2_int_fim IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b2_int_fim)) AT TIME ZONE v_timezone END;
        turnos_inicio             := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b2_turnos_ini) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        turnos_fim                := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b2_turnos_fim) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        RETURN NEXT;
    END IF;

    IF v_blocks_count >= 3 THEN
        bloco_ordem               := 3;
        escala_diaria_ids         := v_b3_ids;
        categoria                 := v_b3_cat;
        inicio_previsto           := (p_data::timestamp + make_interval(mins => v_b3_inicio)) AT TIME ZONE v_timezone;
        fim_previsto              := (p_data::timestamp + make_interval(mins => v_b3_fim))    AT TIME ZONE v_timezone;
        permite_intervalo         := COALESCE(v_b3_permite_int, false);
        intervalo_inicio_previsto := CASE WHEN COALESCE(v_b3_permite_int, false) AND v_b3_int_ini IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b3_int_ini)) AT TIME ZONE v_timezone END;
        intervalo_fim_previsto    := CASE WHEN COALESCE(v_b3_permite_int, false) AND v_b3_int_fim IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b3_int_fim)) AT TIME ZONE v_timezone END;
        turnos_inicio             := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b3_turnos_ini) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        turnos_fim                := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b3_turnos_fim) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        RETURN NEXT;
    END IF;

    RETURN;
END;
$fnbloco$;

COMMENT ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) IS
    'Blocos de trabalho previstos de um servidor num dia, com janela de intervalo e o previsto '
    'de cada turno fundido (turnos_inicio/turnos_fim), que e onde mora a batida de transicao. '
    'Corpo copiado mecanicamente de fn_confirmar_presenca - regerar pelo script, nunca editar a '
    'mao. Sobreaviso fica de fora por construcao.';

GRANT EXECUTE ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) TO authenticated, service_role;

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
        'substituidas',  v_substituidas
    );
END;
$fnaloc$;

COMMENT ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer) IS
    'Aloca marcacoes do dia nos passos previstos. Um passo nunca casa com batida anterior a '
    'meia-noite do dia civil em que o bloco comeca (piso), uma batida cujo passo previsto mais '
    'proximo pertence a um bloco de dia vizinho nao e candidata aqui (regra do dono), e cada '
    'fronteira entre turnos fundidos tem slots opcionais para a batida de transicao. '
    'Teto de casamento de 720 min. Ver 20260819200000, 20260819180000 e 20260819120000.';

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
    WITH alocacoes AS (
        SELECT x
          FROM jsonb_array_elements(
                   public.fn_alocar_marcacoes_dia(p_servidor_id, p_data) -> 'alocacoes'
               ) AS x
    ),
    expandido AS (
        -- Uma alocacao vale para todas as linhas de escala_diaria que ela nomeia. As do bloco
        -- nomeiam todas as linhas; as de FRONTEIRA nomeiam uma linha so (ver 20260819200000).
        SELECT NULLIF(btrim(e.valor), '')::uuid            AS ed_id,
               a.x->>'passo'                               AS passo,
               (a.x->>'marcacao_id')::uuid                 AS marcacao_id,
               COALESCE((a.x->>'fronteira')::boolean, false) AS fronteira
          FROM alocacoes a
          CROSS JOIN LATERAL jsonb_array_elements_text(a.x->'escala_diaria_ids') AS e(valor)
         WHERE NULLIF(btrim(e.valor), '') IS NOT NULL
    ),
    com_dados AS (
        SELECT ex.ed_id, ex.passo, ex.marcacao_id, ex.fronteira, m.ocorrido_em, m.origem
          FROM expandido ex
          JOIN public.marcacoes_ponto m ON m.id = ex.marcacao_id
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
        cd.ed_id,
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
        -- Confirmada quando ha qualquer marcacao no dia.
        count(*) > 0
      FROM com_dados cd
     GROUP BY cd.ed_id
$fnproj$;

COMMENT ON FUNCTION public.fn_projecao_marcacoes_dia(uuid, date) IS
    'O que escala_diaria deveria conter para um servidor num dia, derivado das marcacoes. '
    'Fonte unica compartilhada por fn_reconciliar_marcacoes_dia e fn_conferir_reconciliacao. '
    'Alocacao de fronteira (batida de transicao) vence a do bloco na mesma linha e passo.';

GRANT EXECUTE ON FUNCTION public.fn_projecao_marcacoes_dia(uuid, date) TO authenticated, service_role;
