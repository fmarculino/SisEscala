-- ============================================================================
-- Auditoria do ponto de UM servidor: a trilha completa, dia a dia (19/09/2026)
-- ============================================================================
--
-- Responde a pergunta que hoje obriga a acionar a TI: *"bati o ponto e estou com traco vermelho
-- na grade -- o que houve?"*. Junta, por dia, o turno escalado, a presenca gravada, as batidas
-- fisicas (com relogio e NSR), as do cadastro IRMAO e as que estao fora de circulacao -- e
-- devolve um DIAGNOSTICO, nao os dados crus.
--
-- 🚨 SOMENTE LEITURA, e isto e' desenho, nao omissao. A funcao diagnostica e diz PARA ONDE ir;
-- quem corrige sao os caminhos que ja existem (Preencher pelas Batidas, Restaurar Batidas,
-- correcao de batida real, lancamento de escala), cada um com a previa e o guard dele. Criar aqui
-- um segundo caminho de escrita sobre ponto e' o padrao que este projeto ja pagou caro tres vezes.
--
-- ⚠️ ESTREITA POR CONSTRUCAO. `rep_afd_registros` tem 3,17 milhoes de linhas e a Cobertura de
-- Ponto ja viveu a 1,4s do statement_timeout por falta de indice pelo caminho certo (armadilha
-- 54). Por isso o periodo e' limitado a 62 dias AQUI DENTRO: sem teto, a primeira pessoa que
-- pedisse "o ano todo" derrubaria a consulta, e o sintoma seria um erro sem explicacao na tela.

-- ----------------------------------------------------------------------------
-- O indice que faltava em marcacoes_ponto(afd_registro_id)
-- ----------------------------------------------------------------------------
-- 🚨 Medido por EXPLAIN (ANALYZE) em producao em 19/09/2026: um
-- `NOT EXISTS (SELECT 1 FROM marcacoes_ponto WHERE afd_registro_id = a.id)` sobre 74 registros
-- de AFD virava Hash Anti Join com SEQ SCAN das 3.491.055 linhas de marcacoes_ponto -- 3.718 ms
-- de leitura, 4.869 ms montando o hash, 14.742 blocos de arquivo temporario. 5.369 ms para
-- responder "estas 74 linhas ja viraram marcacao?".
--
-- `marcacoes_ponto` nasceu em 20260808000000 com indices por servidor, por orfa e por origem --
-- nenhum por `afd_registro_id`. Ninguem tinha sentido porque a unica consulta que percorria esse
-- caminho era a do helper de reconciliacao da rota, com poucos ids por vez (`IN (...)`).
--
-- ⚠️ PARCIAL: so linhas com AFD. Marcacao de terminal e ajuste tem `afd_registro_id` nulo e nao
-- interessam a nenhuma busca por registro de AFD -- o indice fica menor e mais rapido de manter.
--
-- ⚠️ A criacao bloqueia ESCRITA em marcacoes_ponto por dezenas de segundos (3,5 milhoes de
-- linhas). Nada se perde: o coletor tem fila offline e o terminal re-tenta.
CREATE INDEX IF NOT EXISTS idx_marcacao_afd_registro
    ON public.marcacoes_ponto (afd_registro_id)
    WHERE afd_registro_id IS NOT NULL;

COMMENT ON INDEX public.idx_marcacao_afd_registro IS
    'Responde "este registro de AFD ja virou marcacao?" sem varrer a tabela. Sem ele o NOT EXISTS '
    'da auditoria de orfas fazia Hash Anti Join sobre 3,49 milhoes de linhas (5,4 s). '
    'Ver 20260919120000.';

DROP FUNCTION IF EXISTS public.fn_auditoria_ponto_servidor(uuid, date, date);

CREATE OR REPLACE FUNCTION public.fn_auditoria_ponto_servidor(
    p_servidor_id uuid,
    p_inicio      date,
    p_fim         date
)
RETURNS TABLE (
    data                 date,
    turno_codigo         text,
    categoria            text,
    unidade_nome         text,
    setor_nome           text,
    -- Presenca como esta gravada na grade agora.
    entrada_em           timestamptz,
    int_saida_em         timestamptz,
    int_retorno_em       timestamptz,
    saida_em             timestamptz,
    passos_preenchidos   integer,
    passos_esperados     integer,
    -- O que existe de batida, e onde.
    batidas              jsonb,
    batidas_retidas      integer,
    batidas_irmao        jsonb,
    afd_sem_marcacao     integer,
    -- O veredito.
    diagnostico          text,
    explicacao           text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_unidades uuid[];
    -- 🚨 Resolvidos ANTES da consulta, de proposito. Como subquery dentro do WHERE eles escondem
    -- os valores do planner, que perde a estimativa e troca o indice por uma varredura de
    -- `rep_afd_registros` (3,17 milhoes de linhas): medido, 10 ms com 1 dia contra 6.414 ms com 8.
    -- Com o array ja resolvido, `= ANY(...)` volta a usar idx_afd_identificador.
    v_ids_afd  text[];
    v_irmaos   uuid[];
BEGIN
    IF p_servidor_id IS NULL OR p_inicio IS NULL OR p_fim IS NULL THEN
        RAISE EXCEPTION 'Servidor e periodo sao obrigatorios.';
    END IF;
    IF p_fim < p_inicio THEN
        RAISE EXCEPTION 'O fim do periodo e anterior ao inicio.';
    END IF;
    IF (p_fim - p_inicio) > 62 THEN
        RAISE EXCEPTION 'Periodo de % dias e maior que o maximo de 62.', (p_fim - p_inicio);
    END IF;

    -- Escopo: as unidades onde este servidor tem escala no periodo, mais a lotacao dele. A mesma
    -- uniao de lotacao ∪ escala da Cobertura de Ponto -- so lotacao esconderia o Servidor Externo,
    -- que e escalado numa unidade e lotado em outra.
    SELECT array_agg(DISTINCT u) INTO v_unidades
      FROM (
          SELECT em.unidade_id AS u
            FROM public.escala_mensal em
            JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
           WHERE em.servidor_id = p_servidor_id
             AND make_date(em.ano, em.mes, ed.dia) BETWEEN p_inicio AND p_fim
          UNION
          SELECT s.unidade_id FROM public.servidores s WHERE s.id = p_servidor_id
      ) t WHERE u IS NOT NULL;

    IF v_unidades IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(v_unidades) x WHERE public.fn_escopo_gestao_alcanca(x)
    ) THEN
        RAISE EXCEPTION 'Sem permissao para auditar o ponto deste servidor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Identificadores deste servidor no AFD. A conversao e `lpad(digitos, 12, '0')`, a mesma que
    -- fn_enfileirar_cadastros_rep usa para GRAVAR -- e a direcao que casa por igualdade e preserva
    -- o indice (right(identificador, 11) descartaria).
    SELECT array_remove(ARRAY[
               CASE WHEN COALESCE(s.cpf, '') <> ''
                    THEN lpad(regexp_replace(s.cpf, '\D', '', 'g'), 12, '0') END,
               CASE WHEN COALESCE(s.pis_pasep, '') <> ''
                    THEN lpad(regexp_replace(s.pis_pasep, '\D', '', 'g'), 12, '0') END
           ], NULL)
      INTO v_ids_afd
      FROM public.servidores s WHERE s.id = p_servidor_id;

    -- Cadastros irmaos (mesmo CPF, outra matricula). Mesmo motivo de estar aqui: como funcao de
    -- conjunto dentro do JOIN, o planner nao sabe quantas linhas esperar.
    SELECT array_agg(i.irmao_id) INTO v_irmaos
      FROM public.fn_cadastros_irmaos(ARRAY[p_servidor_id]) i;

    RETURN QUERY
    WITH dias AS MATERIALIZED (
        SELECT d::date AS data FROM generate_series(p_inicio, p_fim, interval '1 day') d
    ),
    -- Uma linha por (dia, categoria). Sobreaviso fica de fora: nao marca presenca por construcao,
    -- e listar sempre como "sem batida" seria alarme fabricado em toda linha.
    -- MATERIALIZED como as demais: sem isso o planner pode empurrar este par de tabelas para
    -- dentro do LEFT JOIN com `dias` e reavalia-lo por dia. `make_date(...)` nao e indexavel,
    -- entao a escolha de plano depende da seletividade do BETWEEN -- que muda com o periodo.
    escala AS MATERIALIZED (
        SELECT make_date(em.ano, em.mes, ed.dia) AS data,
               dt.codigo AS turno_codigo, ed.categoria::text AS categoria,
               u.nome AS unidade_nome, ds.nome AS setor_nome,
               ed.presenca_entrada_em, ed.presenca_intervalo_saida_em,
               ed.presenca_intervalo_retorno_em, ed.presenca_saida_em
          FROM public.escala_mensal em
          JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
          LEFT JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
          LEFT JOIN public.unidades u ON u.id = em.unidade_id
          LEFT JOIN public.setores st ON st.id = em.setor_id
          LEFT JOIN public.dicionario_setores ds ON ds.id = st.dicionario_setor_id
         WHERE em.servidor_id = p_servidor_id
           AND ed.categoria <> 'Sobreaviso'
           AND make_date(em.ano, em.mes, ed.dia) BETWEEN p_inicio AND p_fim
    ),
    -- Batidas do proprio servidor no dia civil, com o relogio e o NSR. `desconsiderada` diz se
    -- ela esta fora de circulacao AGORA -- a batida existe, esta correta, e a alocacao a filtra.
    --
    -- ⚠️ A contagem de retidas aqui e por DIA CIVIL, nao pela janela D-1..D+2 de
    -- fn_batidas_retidas_dia. E deliberado: naquela funcao a janela larga existe porque a
    -- ALOCACAO precisa enxergar o turno que cruza a meia-noite; aqui cada batida aparece na
    -- linha do dia em que foi feita, que e' o que quem le a tela espera. Contar a mesma batida
    -- em dois dias faria a tela somar duas vezes o mesmo problema.
    -- As marcacoes CRUAS do periodo. Materializada e sem JOIN nenhum de proposito: e a lista
    -- pequena (dezenas de linhas) que as demais consultas vao usar.
    --
    -- ⚠️ Cada predicado e avaliado UMA vez por marcacao, nao duas. Na versao anterior
    -- fn_marcacao_desconsiderada aparecia no FILTER e dentro do jsonb_build_object, dobrando as
    -- chamadas -- e ela varre marcacoes_tratamentos duas vezes por chamada.
    marc_base AS MATERIALIZED (
        SELECT m.id, m.ocorrido_em, m.origem, m.dispositivo_id, m.afd_registro_id,
               public.fn_batida_fisica(m.origem, m.sintetica)   AS fisica,
               public.fn_marcacao_desconsiderada(m.id)          AS desconsiderada
          FROM public.marcacoes_ponto m
         WHERE m.servidor_id = p_servidor_id
           AND m.ocorrido_em >= p_inicio
           AND m.ocorrido_em <  (p_fim + 1)
    ),
    marc AS MATERIALIZED (
        SELECT (b.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data,
               -- Retidas: a mesma composicao de predicados que fn_batidas_retidas_dia faz (batida
               -- FISICA + desconsiderada), sobre o que marc_base ja resolveu. Nao e regra
               -- duplicada -- sao as duas mesmas funcoes.
               count(*) FILTER (WHERE b.fisica AND b.desconsiderada)::integer AS retidas,
               jsonb_agg(jsonb_build_object(
                   'hora', to_char(b.ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS'),
                   'origem', b.origem,
                   -- 🚨 Subquery escalar por CHAVE PRIMARIA, nunca LEFT JOIN. rep_afd_registros
                   -- tem 3,17 milhoes de linhas: com JOIN o planner passa a construir um hash da
                   -- tabela inteira assim que estima mais que um punhado de marcacoes, e foi isso
                   -- que fez a funcao saltar de 9 ms para 5.211 ms. Correlacionada por PK, o
                   -- acesso e sempre index scan.
                   'relogio', (SELECT d.nome FROM public.dispositivos_rep d WHERE d.id = b.dispositivo_id),
                   'nsr', (SELECT a.nsr FROM public.rep_afd_registros a WHERE a.id = b.afd_registro_id),
                   'desconsiderada', b.desconsiderada,
                   'fisica', b.fisica
               ) ORDER BY b.ocorrido_em) AS batidas
          FROM marc_base b
         GROUP BY 1
    ),
    -- Batidas do cadastro IRMAO (mesmo CPF, outra matricula). A alocacao ja decide sozinha de
    -- quem e cada batida desde 09/09/2026; isto aqui e' so' para o diagnostico saber DIZER que a
    -- batida existe e esta do outro lado, em vez de responder "nao ha batida".
    irmao AS MATERIALIZED (
        SELECT (m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data,
               jsonb_agg(jsonb_build_object(
                   'hora', to_char(m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS'),
                   'matricula', (SELECT i.matricula FROM public.servidores i WHERE i.id = m.servidor_id),
                   'relogio', (SELECT d.nome FROM public.dispositivos_rep d WHERE d.id = m.dispositivo_id)
               ) ORDER BY m.ocorrido_em) AS batidas
          FROM public.marcacoes_ponto m
         -- 🚨 `v_irmaos IS NOT NULL` PRIMEIRO, e nao e redundante com o ANY abaixo. Sem irmao o
         -- array fica vazio, o planner perde toda a seletividade de servidor_id e cai no indice
         -- de ocorrido_em -- varrendo as marcacoes do PARQUE INTEIRO no periodo (medido em
         -- producao: 264 linhas em 1 dia, 17.204 em 8, 58.370 em 30) para descobrir que nao ha
         -- irmao nenhum. Era isso, e nao o hash join, que fazia a funcao saltar de 50 ms para
         -- 5.018 ms. Como condicao CONSTANTE, o planner a resolve uma vez e nem executa o no.
         --
         -- ⚠️ A maioria esmagadora dos servidores NAO tem cadastro irmao (21 CPFs na base
         -- inteira), entao este e o caminho COMUM, nao o raro.
         WHERE v_irmaos IS NOT NULL
           AND m.servidor_id = ANY (v_irmaos)
           AND m.ocorrido_em >= p_inicio
           AND m.ocorrido_em <  (p_fim + 1)
         GROUP BY 1
    ),
    -- Registro no AFD cru com o identificador desta pessoa e SEM marcacao gerada. E o caso da
    -- orfa: o relogio aceitou, a linha esta gravada, e ninguem conseguiu dizer de quem era.
    -- 🚨 A busca e por IGUALDADE em `identificador_afd`, nunca por `right(identificador, 11)`.
    -- `rep_afd_registros` tem 3,17 MILHOES de linhas e o unico indice util aqui e
    -- `idx_afd_identificador (identificador_afd) WHERE tipo_registro = '3'`. Qualquer funcao em
    -- cima da coluna (right, regexp, trim) descarta o indice e vira scan da tabela inteira -- a
    -- mesma classe de defeito que fez a vigilancia estourar o timeout em 19/09/2026.
    --
    -- ⚠️ O identificador do AFD tem 12 posicoes com zero de preenchimento, e a conversao
    -- CPF/PIS -> identificador e `lpad(digitos, 12, '0')` -- a mesma que
    -- `fn_enfileirar_cadastros_rep` usa para gravar. Aqui e' a direcao que preserva o indice.
    orfas AS MATERIALIZED (
        SELECT (a.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data, count(*)::integer AS n
          FROM public.rep_afd_registros a
         WHERE a.tipo_registro = '3'
           AND a.identificador_afd = ANY (v_ids_afd)
           AND a.ocorrido_em >= p_inicio
           AND a.ocorrido_em <  (p_fim + 1)
           AND NOT EXISTS (SELECT 1 FROM public.marcacoes_ponto m WHERE m.afd_registro_id = a.id)
         GROUP BY 1
    ),
    base AS (
        SELECT dd.data, e.turno_codigo, e.categoria, e.unidade_nome, e.setor_nome,
               e.presenca_entrada_em, e.presenca_intervalo_saida_em,
               e.presenca_intervalo_retorno_em, e.presenca_saida_em,
               COALESCE(m.batidas, '[]'::jsonb) AS batidas,
               COALESCE(m.retidas, 0) AS batidas_retidas,
               COALESCE(i.batidas, '[]'::jsonb) AS batidas_irmao,
               COALESCE(o.n, 0) AS afd_sem_marcacao,
               (CASE WHEN e.presenca_entrada_em IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN e.presenca_intervalo_saida_em IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN e.presenca_intervalo_retorno_em IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN e.presenca_saida_em IS NOT NULL THEN 1 ELSE 0 END) AS preenchidos
          FROM dias dd
          LEFT JOIN escala e ON e.data = dd.data
          LEFT JOIN marc   m ON m.data = dd.data
          LEFT JOIN irmao  i ON i.data = dd.data
          LEFT JOIN orfas  o ON o.data = dd.data
    )
    SELECT b.data, b.turno_codigo, b.categoria, b.unidade_nome, b.setor_nome,
           b.presenca_entrada_em, b.presenca_intervalo_saida_em,
           b.presenca_intervalo_retorno_em, b.presenca_saida_em,
           b.preenchidos,
           CASE WHEN b.turno_codigo IS NULL THEN 0 ELSE 4 END,
           b.batidas, b.batidas_retidas, b.batidas_irmao, b.afd_sem_marcacao,
           -- A ORDEM importa: o primeiro caso que casa e o que a tela mostra, e ela precisa ser
           -- da causa mais especifica para a mais generica. `retida` antes de `nao_reconciliado`
           -- porque batida fora de circulacao EXPLICA o passo vazio -- invertido, a tela mandaria
           -- a pessoa para o Preencher pelas Batidas, que responderia "nada a preencher".
           CASE
               WHEN b.turno_codigo IS NULL AND jsonb_array_length(b.batidas) = 0 THEN 'sem_escala'
               WHEN b.turno_codigo IS NULL                                        THEN 'sem_turno'
               WHEN b.preenchidos >= 2 AND b.batidas_retidas = 0                  THEN 'regular'
               WHEN b.batidas_retidas > 0                                         THEN 'retida'
               WHEN b.afd_sem_marcacao > 0                                        THEN 'orfa'
               WHEN jsonb_array_length(b.batidas) > 0                             THEN 'nao_reconciliado'
               WHEN jsonb_array_length(b.batidas_irmao) > 0                       THEN 'outra_matricula'
               ELSE 'sem_batida'
           END,
           CASE
               WHEN b.turno_codigo IS NULL AND jsonb_array_length(b.batidas) = 0
                   THEN 'Sem turno lancado e sem batida. Nada a explicar neste dia.'
               WHEN b.turno_codigo IS NULL
                   THEN format('Ha %s batida(s) neste dia e a escala nao tem turno lancado. '
                               'A batida existe e nao tem onde ser aplicada.', jsonb_array_length(b.batidas))
               WHEN b.preenchidos >= 2 AND b.batidas_retidas = 0
                   THEN 'Presenca registrada na grade.'
               WHEN b.batidas_retidas > 0
                   THEN format('Existe(m) %s batida(s) real(is) fora de circulacao: alguem reverteu a '
                               'presenca deste dia e as batidas sairam junto. Use "Restaurar Batidas" '
                               'na grade antes de qualquer outra coisa.', b.batidas_retidas)
               WHEN b.afd_sem_marcacao > 0
                   THEN format('O relogio gravou %s registro(s) com o CPF/PIS desta pessoa, mas nenhum '
                               'virou marcacao: a identidade nao foi resolvida. Confira CPF/PIS no '
                               'cadastro e o vinculo no equipamento.', b.afd_sem_marcacao)
               WHEN jsonb_array_length(b.batidas) > 0
                   THEN format('Ha %s batida(s) gravada(s) e a grade esta com %s de 4 passos. '
                               'O dia provavelmente nunca foi projetado: use "Preencher pelas Batidas".',
                               jsonb_array_length(b.batidas), b.preenchidos)
               WHEN jsonb_array_length(b.batidas_irmao) > 0
                   THEN 'Nao ha batida nesta matricula, mas ha na OUTRA matricula da mesma pessoa. '
                        'O acerto e na escala, nunca na batida.'
               ELSE 'Nenhuma batida chegou ao SisEscala neste dia. Confira, em Dispositivos REP, se o '
                    'relogio da unidade tem ponto ainda nao coletado antes de tratar como falta.'
           END
      FROM base b
     ORDER BY b.data;
END;
$fn$;

COMMENT ON FUNCTION public.fn_auditoria_ponto_servidor(uuid, date, date) IS
    'Trilha diaria do ponto de um servidor: turno, presenca na grade, batidas (proprias, do irmao, '
    'retidas e orfas no AFD) e um diagnostico por dia. SOMENTE LEITURA -- diz para onde ir, nunca '
    'corrige. Periodo limitado a 62 dias. Ver 20260919120000.';

REVOKE ALL ON FUNCTION public.fn_auditoria_ponto_servidor(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auditoria_ponto_servidor(uuid, date, date) TO authenticated, service_role;

-- ============================================================================
-- CONFERENCIA -- EXECUTA a funcao (armadilha 42), nos dois sentidos.
-- ============================================================================
DO $conf$
DECLARE
    v_srv    uuid;
    v_n      integer;
    v_erro   text;
    v_ini    timestamptz;
    v_ms     numeric;
    v_ms1    numeric;
    v_msOrfa numeric;
    v_ids    text[];
    v_irm      uuid[];
    v_msGuard  numeric;
    v_msEscala numeric;
    v_msMarc   numeric;
    v_msIrmao  numeric;
    v_ini30    date;
    v_hoje     date;
    v_ms30   numeric;
BEGIN
    v_hoje  := now()::date;
    v_ini30 := (now() - interval '29 days')::date;
    SELECT id INTO v_srv FROM public.servidores WHERE status = 'Ativo' ORDER BY created_at LIMIT 1;
    IF v_srv IS NULL THEN
        RAISE NOTICE 'Sem servidor ativo para conferir; conferencia estrutural apenas.';
    ELSE
        v_ini := clock_timestamp();
        BEGIN
            SELECT count(*) INTO v_n
              FROM public.fn_auditoria_ponto_servidor(v_srv, (now() - interval '7 days')::date, now()::date);
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
            RAISE EXCEPTION 'fn_auditoria_ponto_servidor nao executou: %', v_erro;
        END;

        -- 🚨 MEDIR O TEMPO faz parte da conferencia, e esta linha existe por experiencia propria:
        -- em 19/09/2026 a `20260919110000` foi aplicada com a conferencia passando e a funcao
        -- estourando o statement_timeout na primeira chamada real. O Studio roda como `postgres`,
        -- cujo timeout e outro -- conferir so a CORRETUDE deixa passar o defeito de DESEMPENHO,
        -- que aqui e a diferenca entre a tela funcionar e dar erro.
        v_ms := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;
        RAISE NOTICE 'fn_auditoria_ponto_servidor: % dia(s) em % ms', v_n, round(v_ms);

        IF v_ms > 3000 THEN
            -- 🚨 A mensagem MEDE COMO ESCALA, em vez de só reprovar. Na primeira reprovação
            -- (6799 ms para 8 dias, 19/09/2026) o número sozinho não dizia se o custo era por dia
            -- ou fixo por chamada — e sem isso a correção seria chute. Crescimento proporcional
            -- aponta para trabalho por dia; custo parecido em 1 e em 30 dias aponta para uma
            -- varredura que ignora o período. Uma tentativa passa a bastar.
            v_ini := clock_timestamp();
            PERFORM * FROM public.fn_auditoria_ponto_servidor(v_srv, now()::date, now()::date);
            v_ms1 := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            v_ini := clock_timestamp();
            PERFORM * FROM public.fn_auditoria_ponto_servidor(v_srv, (now() - interval '29 days')::date, now()::date);
            v_ms30 := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            -- 🚨 Mede TODAS as etapas, nao um suspeito. Quatro rodadas foram gastas eliminando
            -- um candidato por vez (orfa 1 ms, batidas 3 ms, irmao 5 ms) enquanto a funcao inteira
            -- levava 5 s -- ou seja, a soma das partes nunca explicou o todo. Com todos os tempos
            -- na mesma mensagem, a etapa cara aparece de primeira, seja ela qual for.
            v_ini := clock_timestamp();
            PERFORM em.unidade_id
               FROM public.escala_mensal em
               JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
              WHERE em.servidor_id = v_srv
                AND make_date(em.ano, em.mes, ed.dia) BETWEEN v_ini30 AND v_hoje;
            v_msGuard := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            v_ini := clock_timestamp();
            PERFORM make_date(em.ano, em.mes, ed.dia), dt.codigo, u.nome, ds.nome
               FROM public.escala_mensal em
               JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
               LEFT JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
               LEFT JOIN public.unidades u ON u.id = em.unidade_id
               LEFT JOIN public.setores st ON st.id = em.setor_id
               LEFT JOIN public.dicionario_setores ds ON ds.id = st.dicionario_setor_id
              WHERE em.servidor_id = v_srv
                AND ed.categoria <> 'Sobreaviso'
                AND make_date(em.ano, em.mes, ed.dia) BETWEEN v_ini30 AND v_hoje;
            v_msEscala := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            v_ini := clock_timestamp();
            PERFORM m.id,
                    public.fn_batida_fisica(m.origem, m.sintetica),
                    public.fn_marcacao_desconsiderada(m.id),
                    (SELECT a.nsr FROM public.rep_afd_registros a WHERE a.id = m.afd_registro_id)
               FROM public.marcacoes_ponto m
              WHERE m.servidor_id = v_srv
                AND m.ocorrido_em >= v_ini30
                AND m.ocorrido_em <  (v_hoje + 1);
            v_msMarc := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            v_ini := clock_timestamp();
            SELECT array_agg(i.irmao_id) INTO v_irm FROM public.fn_cadastros_irmaos(ARRAY[v_srv]) i;
            PERFORM m.id FROM public.marcacoes_ponto m
              WHERE v_irm IS NOT NULL
                AND m.servidor_id = ANY (v_irm)
                AND m.ocorrido_em >= v_ini30
                AND m.ocorrido_em <  (v_hoje + 1);
            v_msIrmao := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            SELECT array_remove(ARRAY[
                       CASE WHEN COALESCE(sx.cpf, '') <> '' THEN lpad(regexp_replace(sx.cpf, '[^0-9]', '', 'g'), 12, '0') END,
                       CASE WHEN COALESCE(sx.pis_pasep, '') <> '' THEN lpad(regexp_replace(sx.pis_pasep, '[^0-9]', '', 'g'), 12, '0') END
                   ], NULL) INTO v_ids FROM public.servidores sx WHERE sx.id = v_srv;
            v_ini := clock_timestamp();
            -- ⚠️ O NOT EXISTS faz PARTE da sonda. A versao anterior dela o omitia e devolvia
            -- 1 ms, "inocentando" esta CTE enquanto ela sozinha custava 5.369 ms -- duas rodadas
            -- de producao foram gastas por causa disso. Sonda que nao reproduz a consulta
            -- inteira nao mede nada.
            PERFORM count(*) FROM public.rep_afd_registros a
             WHERE a.tipo_registro = '3'
               AND a.identificador_afd = ANY (v_ids)
               AND a.ocorrido_em >= v_ini30
               AND a.ocorrido_em <  (v_hoje + 1)
               AND NOT EXISTS (SELECT 1 FROM public.marcacoes_ponto m WHERE m.afd_registro_id = a.id);
            v_msOrfa := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            RAISE EXCEPTION 'fn_auditoria_ponto_servidor lenta demais: 1 dia = % ms, 8 dias = % ms, '
                            '30 dias = % ms (teto: 8s de authenticated). ETAPAS em 30 dias -- '
                            'guard=% ms, escala=% ms, batidas=% ms, irmao=% ms, orfas=% ms.',
                            round(v_ms1), round(v_ms), round(v_ms30),
                            round(v_msGuard), round(v_msEscala), round(v_msMarc),
                            round(v_msIrmao), round(v_msOrfa);
        END IF;
        -- >= e nao =: um dia com Regular E Plantao devolve DUAS linhas, e e assim que deve ser --
        -- cada turno tem presenca e diagnostico proprios. O que nao pode e' faltar dia.
        IF v_n < 8 THEN
            RAISE EXCEPTION 'esperava ao menos 8 dias (intervalo inclusivo), vieram %', v_n;
        END IF;
        RAISE NOTICE 'fn_auditoria_ponto_servidor executou: % dia(s)', v_n;

        -- Todo dia PRECISA ter diagnostico e explicacao. Linha muda e' o defeito que esta funcao
        -- existe para nao cometer: quem abre a tela quer um veredito, nao dados crus.
        IF EXISTS (
            SELECT 1 FROM public.fn_auditoria_ponto_servidor(v_srv, (now() - interval '7 days')::date, now()::date)
             WHERE diagnostico IS NULL OR explicacao IS NULL OR explicacao = ''
        ) THEN
            RAISE EXCEPTION 'fn_auditoria_ponto_servidor devolveu dia sem diagnostico';
        END IF;
    END IF;

    -- O teto de periodo precisa recusar de verdade.
    BEGIN
        PERFORM * FROM public.fn_auditoria_ponto_servidor(
            COALESCE(v_srv, gen_random_uuid()), '2026-01-01'::date, '2026-12-31'::date);
        RAISE EXCEPTION 'ABORTADO: periodo de 1 ano passou pelo teto de 62 dias';
    EXCEPTION
        WHEN sqlstate 'P0001' THEN
            IF SQLERRM LIKE 'ABORTADO%' THEN RAISE; END IF;  -- foi o nosso proprio RAISE
    END;

    IF has_function_privilege('anon', 'public.fn_auditoria_ponto_servidor(uuid, date, date)', 'EXECUTE') THEN
        RAISE EXCEPTION 'fn_auditoria_ponto_servidor executavel por anon';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_auditoria_ponto_servidor(uuid, date, date)', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated perdeu EXECUTE em fn_auditoria_ponto_servidor';
    END IF;

    RAISE NOTICE 'Conferencia de 20260919120000 OK.';
END
$conf$;
