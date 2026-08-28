-- Migration: teto de horas/sobreavisos consolidado entre TODAS as escalas do servidor no mes
-- Data: 2026-08-28
-- Plano: docs/planos/2026-08-28-limite-de-horas-consolidado-entre-escalas.md
--
-- O teto de `max_horas_escala_servidor` (300h) sempre foi DA PESSOA, mas a unica conta que o
-- defendia era a da GRADE: `calculateTotals` em ScaleGrid.tsx soma o `gridData` daquele setor.
-- Servidor escalado em dois setores tinha duas contas dentro do teto e uma soma fora dele.
-- Medido em producao em 28/08/2026: JEANE CONCEICAO SILVA, 09/2026, HMI -- 289h em
-- "SHL \ ACOLHIMENTO" mais 120h em "SHL \ LAVANDERIA" = 409h, com as duas telas mostrando um
-- numero dentro do teto. Mais dois casos iguais na mesma competencia (EDIVONETE 314h,
-- ERIKA SOUZA 302h) e 49 servidores em 2+ escalas em 09/2026, contra 2 ou 3 nos meses anteriores.
--
-- Esta migration cria a fonte unica da conta consolidada e do teto efetivo, e passa a
-- Autorizacao Extraordinaria a valer para (servidor, mes, ano) -- nao mais por unidade.
-- Nao ha trigger: o comportamento decidido e' aviso + autorizacao do administrador, o mesmo de
-- hoje, so que com a conta certa. Ver a secao "Sem trigger" do plano.

-- ---------------------------------------------------------------------------
-- 1. Autorizacao Extraordinaria passa a ser da PESSOA no mes
-- ---------------------------------------------------------------------------
--
-- A chave era (servidor_id, unidade_id, mes, ano). Com o teto consolidado isso nao tem onde
-- morar: duas unidades concederiam +100h cada e o teto efetivo viraria 500h sem que ninguem
-- tenha decidido isso. Somar as autorizacoes apaga o teto; pegar a maior faz o teto depender de
-- qual unidade agiu primeiro. A autorizacao e' uma decisao sobre o mes daquela pessoa.
--
-- `unidade_id` fica na tabela como registro de ONDE a autorizacao foi dada (auditoria).
--
-- Em producao a tabela tem 0 linhas (medido em 28/08/2026) -- ninguem nunca exerceu o teto,
-- porque a verificacao so rodava na digitacao celula a celula. Mesmo assim a migration confere
-- antes: homologacao pode ter dado, e o erro cru do indice unico nao diria o que fazer.
DO $$
DECLARE
    v_dup integer;
BEGIN
    SELECT COUNT(*) INTO v_dup
      FROM (
        SELECT servidor_id, mes, ano
          FROM public.excecoes_escala_servidor
         GROUP BY servidor_id, mes, ano
        HAVING COUNT(*) > 1
      ) d;

    IF v_dup > 0 THEN
        RAISE EXCEPTION
            'Ha % (servidor, mes, ano) com mais de uma Autorizacao Extraordinaria. Consolide-as em uma linha (somando ou escolhendo a vigente) antes de aplicar esta migration.',
            v_dup;
    END IF;
END;
$$;

ALTER TABLE public.excecoes_escala_servidor
    DROP CONSTRAINT IF EXISTS uq_excecao_servidor_unidade_mes_ano;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_excecao_servidor_mes_ano'
           AND conrelid = 'public.excecoes_escala_servidor'::regclass
    ) THEN
        ALTER TABLE public.excecoes_escala_servidor
            ADD CONSTRAINT uq_excecao_servidor_mes_ano UNIQUE (servidor_id, mes, ano);
    END IF;
END;
$$;

COMMENT ON COLUMN public.excecoes_escala_servidor.unidade_id IS
    'Unidade a partir de onde a autorizacao foi dada. AUDITORIA, nao parte da chave: o teto e da pessoa no mes, entao a autorizacao tambem e (uq_excecao_servidor_mes_ano).';

COMMENT ON TABLE public.excecoes_escala_servidor IS
    'Autorizacao Extraordinaria de administrador para o servidor ultrapassar o teto mensal de horas/sobreavisos. UMA por (servidor, mes, ano) -- vale para a soma de TODAS as escalas dele na competencia.';

-- ---------------------------------------------------------------------------
-- 2. Caminho completo do setor, em SQL
-- ---------------------------------------------------------------------------
--
-- Espelha `buildSectorPathMap` (src/utils/sectors.ts). Nome de setor sozinho nao identifica
-- setor: "BLOCO A" existe embaixo de mais de um pai, e a mensagem que diz ONDE estao as horas
-- do servidor precisa dizer qual.
--
-- Separador ' \ ' (barra INVERTIDA) de proposito, igual ao SECTOR_PATH_SEPARATOR do frontend:
-- a tela ja usa ' / ' entre unidade e setor, e repetir a barra normal apagaria essa fronteira.
--
-- Teto de 10 niveis: e' a defesa contra ciclo em `parent_id` (o equivalente do cache-antes-de-subir
-- da versao TS). Setor cujo pai nao existe comeca o caminho nele mesmo -- inventar ancestral
-- seria pior que o caminho curto.
CREATE OR REPLACE FUNCTION public.fn_setor_caminho(p_setor_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH RECURSIVE cadeia AS (
        SELECT s.id AS setor_id,
               s.parent_id,
               COALESCE(ds.nome, 'SETOR SEM NOME')::text AS caminho,
               1 AS nivel
          FROM public.setores s
          LEFT JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
         WHERE s.id = p_setor_id
        UNION ALL
        SELECT c.setor_id,
               s.parent_id,
               COALESCE(ds.nome, 'SETOR SEM NOME')::text || ' \ ' || c.caminho,
               c.nivel + 1
          FROM cadeia c
          JOIN public.setores s ON s.id = c.parent_id AND s.id <> c.setor_id
          LEFT JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
         WHERE c.nivel < 10
    )
    SELECT caminho FROM cadeia ORDER BY nivel DESC LIMIT 1;
$fn$;

COMMENT ON FUNCTION public.fn_setor_caminho(uuid) IS
    'Caminho completo do setor ("SHL \ LAVANDERIA"). Espelha buildSectorPathMap de src/utils/sectors.ts, inclusive o separador. Ao mexer em um, mexa no outro.';

-- ---------------------------------------------------------------------------
-- 3. A carga do servidor no mes, escala por escala
-- ---------------------------------------------------------------------------
--
-- Uma linha por escala do servidor na competencia -- no maximo ~4 por pessoa, longe do corte
-- silencioso de 1000 linhas do PostgREST (armadilha 8).
--
-- A formula espelha `calculateTotals` (ScaleGrid.tsx):
--   Regular        -> LEAST(horas_computadas, jornada.horas_totais - intervalo_minutos/60)
--   Extra, Plantao -> horas_computadas
--   Sobreaviso     -> NAO entra nas horas; conta unidades, em coluna propria
--
-- A decomposicao de plantao em unidades de pagamento (decomporPlantao, armadilha 16) NAO e'
-- replicada aqui, e tentar isso e' o erro: o total de calculateTotals e'
-- pl12*12 + pl6*6 + pl4*4 + avulso, que e' EXATAMENTE SUM(horas_computadas). As unidades PL
-- existem para as COLUNAS de pagamento, nunca para o total. Somar por faixa de duracao aqui
-- reintroduziria, dentro da trava, o bug de 21/08/2026 (44 dos 53 codigos contando errado).
--
-- Escala com ativo = false fica de fora: foi retirada pela tela de escalas, e as horas dela
-- nao pesam mais sobre a pessoa.
--
-- SECURITY DEFINER de proposito: a RLS de escala_mensal impediria o coordenador da LAVANDERIA
-- de enxergar a escala do ACOLHIMENTO -- e e' exatamente isso que ele precisa saber para decidir.
-- A funcao devolve unidade, setor, status e o AGREGADO; nunca dia a dia nem codigo de turno.
-- Essa fronteira e' deliberada: o minimo para a decisao, e nada da escala alheia alem disso.
DROP FUNCTION IF EXISTS public.fn_carga_mensal_servidor(uuid[], integer, integer);

CREATE FUNCTION public.fn_carga_mensal_servidor(
    p_servidor_ids uuid[],
    p_mes integer,
    p_ano integer
)
RETURNS TABLE (
    servidor_id uuid,
    escala_mensal_id uuid,
    unidade_id uuid,
    setor_id uuid,
    unidade_nome text,
    setor_caminho text,
    status text,
    horas numeric,
    sobreavisos integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT
        em.servidor_id,
        em.id,
        em.unidade_id,
        em.setor_id,
        COALESCE(u.nome, 'UNIDADE SEM NOME')::text,
        COALESCE(public.fn_setor_caminho(em.setor_id), 'SETOR SEM NOME')::text,
        COALESCE(em.status, 'Rascunho')::text,
        COALESCE(c.horas, 0)::numeric,
        COALESCE(c.sobreavisos, 0)::integer
      FROM public.escala_mensal em
      LEFT JOIN public.unidades u ON u.id = em.unidade_id
      LEFT JOIN public.jornadas j ON j.id = em.jornada_id
      LEFT JOIN LATERAL (
        SELECT
            SUM(
                CASE
                    WHEN ed.categoria = 'Sobreaviso'::public.escala_categoria THEN 0
                    WHEN ed.categoria = 'Regular'::public.escala_categoria
                         AND COALESCE(j.horas_totais, 0) > 0
                        THEN LEAST(
                                 COALESCE(dt.horas_computadas, 0),
                                 GREATEST(0, j.horas_totais - COALESCE(j.intervalo_minutos, 0) / 60.0)
                             )
                    ELSE COALESCE(dt.horas_computadas, 0)
                END
            ) AS horas,
            COUNT(*) FILTER (WHERE ed.categoria = 'Sobreaviso'::public.escala_categoria) AS sobreavisos
          FROM public.escala_diaria ed
          LEFT JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
         WHERE ed.escala_mensal_id = em.id
      ) c ON TRUE
     WHERE em.servidor_id = ANY(p_servidor_ids)
       AND em.mes = p_mes
       AND em.ano = p_ano
       AND COALESCE(em.ativo, true) = true
     ORDER BY em.servidor_id, u.nome, em.id;
$fn$;

COMMENT ON FUNCTION public.fn_carga_mensal_servidor(uuid[], integer, integer) IS
    'Carga de cada escala do servidor na competencia (horas e unidades de sobreaviso). Fonte unica da conta consolidada do teto mensal. Espelha calculateTotals de ScaleGrid.tsx -- ao mexer em um, mexa no outro.';

-- ---------------------------------------------------------------------------
-- 4. O teto efetivo do servidor no mes
-- ---------------------------------------------------------------------------
--
-- Fonte unica: nem a grade nem o modal de autorizacao recalculam `global + excecao` por conta
-- propria. `configuracoes_globais` e' chave/valor com `valor` JSONB -- nao existe coluna
-- `max_horas_escala_servidor`; a leitura correta e' (valor#>>'{}').
--
-- Os defaults 300/10 sao os da 20260811140000, para o caso da chave ter sido apagada. Em
-- producao, medido em 28/08/2026, valem 300h e 20 un (o sobreaviso foi alterado pela tela).
-- Recebe LISTA de servidores, como fn_carga_mensal_servidor: a grade tem dezenas de linhas, e uma
-- chamada por servidor seria uma requisicao por linha a cada carregamento.
DROP FUNCTION IF EXISTS public.fn_teto_carga_servidor(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.fn_teto_carga_servidor(uuid[], integer, integer);

CREATE FUNCTION public.fn_teto_carga_servidor(
    p_servidor_ids uuid[],
    p_mes integer,
    p_ano integer
)
RETURNS TABLE (
    servidor_id uuid,
    teto_horas numeric,
    teto_sobreavisos integer,
    limite_global_horas numeric,
    limite_global_sobreavisos integer,
    horas_autorizadas numeric,
    sobreavisos_autorizados integer,
    motivo_justificativa text,
    autorizado_por uuid,
    autorizado_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH g AS (
        SELECT
            COALESCE(
                (SELECT NULLIF(cg.valor #>> '{}', '')::numeric
                   FROM public.configuracoes_globais cg
                  WHERE cg.chave = 'max_horas_escala_servidor'),
                300
            ) AS horas,
            COALESCE(
                (SELECT NULLIF(cg.valor #>> '{}', '')::integer
                   FROM public.configuracoes_globais cg
                  WHERE cg.chave = 'max_sobreavisos_escala_servidor'),
                10
            ) AS sobreavisos
    ),
    alvos AS (
        SELECT DISTINCT s AS servidor_id
          FROM unnest(COALESCE(p_servidor_ids, ARRAY[]::uuid[])) AS s
    )
    SELECT
        a.servidor_id,
        (g.horas + COALESCE(ex.horas_adicionais_autorizadas, 0))::numeric,
        (g.sobreavisos + COALESCE(ex.sobreavisos_adicionais_autorizados, 0))::integer,
        g.horas::numeric,
        g.sobreavisos::integer,
        COALESCE(ex.horas_adicionais_autorizadas, 0)::numeric,
        COALESCE(ex.sobreavisos_adicionais_autorizados, 0)::integer,
        ex.motivo_justificativa,
        ex.autorizado_por,
        ex.updated_at
      FROM alvos a
     CROSS JOIN g
      LEFT JOIN public.excecoes_escala_servidor ex
             ON ex.servidor_id = a.servidor_id
            AND ex.mes = p_mes
            AND ex.ano = p_ano;
$fn$;

COMMENT ON FUNCTION public.fn_teto_carga_servidor(uuid[], integer, integer) IS
    'Teto mensal efetivo do servidor (global de configuracoes_globais + Autorizacao Extraordinaria do mes). Fonte unica -- a tela nao soma isso por conta propria.';

-- ---------------------------------------------------------------------------
-- 5. Privilegios
-- ---------------------------------------------------------------------------
--
-- Armadilha 24: `CREATE FUNCTION` ja concede EXECUTE a PUBLIC, entao `GRANT ... TO authenticated`
-- sozinho nunca restringiu nada -- quem nao esta na lista continua entrando por PUBLIC. O que
-- fecha e' o REVOKE FROM PUBLIC.
--
-- As tres sao chamadas pela grade com o usuario logado, entao mantem `authenticated`.
REVOKE ALL ON FUNCTION public.fn_setor_caminho(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_carga_mensal_servidor(uuid[], integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_teto_carga_servidor(uuid[], integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_setor_caminho(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_carga_mensal_servidor(uuid[], integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_teto_carga_servidor(uuid[], integer, integer) TO authenticated, service_role;

-- A migration confere o proprio resultado nos DOIS sentidos e aborta na divergencia.
-- REVOKE de quem nao e' dono da funcao nao falha: emite WARNING e segue (armadilha 24). Sem esta
-- checagem, "aplicou com sucesso" e "nao mudou nada" sao indistinguiveis.
DO $$
DECLARE
    v_fn text;
    v_pendentes text := '';
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'public.fn_setor_caminho(uuid)',
        'public.fn_carga_mensal_servidor(uuid[], integer, integer)',
        'public.fn_teto_carga_servidor(uuid[], integer, integer)'
    ]
    LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
            v_pendentes := v_pendentes || format(E'\n  - %s AINDA e executavel por anon', v_fn);
        END IF;
        IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
            v_pendentes := v_pendentes || format(E'\n  - %s PERDEU o acesso de authenticated (a grade quebra)', v_fn);
        END IF;
    END LOOP;

    IF v_pendentes <> '' THEN
        RAISE EXCEPTION E'Privilegios nao ficaram como esperado.\nBanco: % | usuario: %\nPendencias:%',
            current_database(), current_user, v_pendentes;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Conferencia (rodar depois de aplicar)
-- ---------------------------------------------------------------------------
--
-- 1) Quem estoura o teto somando TODAS as escalas da competencia. Em producao, em 28/08/2026,
--    isto devolve 5 linhas -- 3 que so estouram somando (JEANE 409h, EDIVONETE 314h, ERIKA 302h,
--    todas 09/2026 e em Rascunho) e 2 escalas individuais de 07/2026 ja Fechadas, anteriores a
--    criacao da regra em 11/08/2026.
--
-- WITH pessoas AS (
--     SELECT DISTINCT em.servidor_id, em.mes, em.ano
--       FROM public.escala_mensal em
--      WHERE COALESCE(em.ativo, true) = true
-- )
-- SELECT s.nome, s.matricula, p.mes, p.ano,
--        SUM(c.horas) AS horas, t.teto_horas,
--        COUNT(*) FILTER (WHERE c.horas > 0) AS escalas_com_carga,
--        string_agg(c.unidade_nome || ' / ' || c.setor_caminho || ' = ' || c.horas || 'h',
--                   ' + ' ORDER BY c.horas DESC) FILTER (WHERE c.horas > 0) AS onde
--   FROM pessoas p
--   JOIN public.servidores s ON s.id = p.servidor_id
--   CROSS JOIN LATERAL public.fn_carga_mensal_servidor(ARRAY[p.servidor_id], p.mes, p.ano) c
--   CROSS JOIN LATERAL public.fn_teto_carga_servidor(ARRAY[p.servidor_id], p.mes, p.ano) t
--  GROUP BY s.nome, s.matricula, p.mes, p.ano, t.teto_horas
-- HAVING SUM(c.horas) > t.teto_horas
--  ORDER BY horas DESC;
--
-- 2) A conta bate com a tela? Para a JEANE, 09/2026, tem que dar 289h e 120h -- os mesmos
--    numeros que as duas grades mostram em "PREVISAO".
--
-- SELECT c.unidade_nome, c.setor_caminho, c.horas, c.sobreavisos, c.status
--   FROM public.servidores s
--   CROSS JOIN LATERAL public.fn_carga_mensal_servidor(ARRAY[s.id], 9, 2026) c
--  WHERE s.matricula = '15867';
--
-- 3) Uma unica Autorizacao Extraordinaria por (servidor, mes, ano). Tem que devolver 0 linhas.
--
-- SELECT servidor_id, mes, ano, COUNT(*)
--   FROM public.excecoes_escala_servidor
--  GROUP BY servidor_id, mes, ano
-- HAVING COUNT(*) > 1;
