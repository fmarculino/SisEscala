-- ============================================================================
-- Painel de cobertura de escala do parque (06/09/2026)
-- ============================================================================
--
-- MOTIVACAO. Servidor lotado numa unidade que faz plantao em OUTRA (o "Servidor Externo", v1.2.4)
-- precisa estar cadastrado COM DIGITAL no relogio de la para registrar ponto. A identidade ja
-- chega sozinha (fn_enfileirar_cadastros_por_escala + o cron de 05/09/2026); a DIGITAL nao tem
-- como chegar - a copia entre relogios so acontece dentro da mesma unidade e da mesma maquina, e
-- nenhuma maquina do parque atende duas unidades (conferido em 06/09/2026, 29 dispositivos).
--
-- O que faltava nao era encanamento, era AVISO: a informacao so existia relogio a relogio, na aba
-- Cobertura de Ponto. Ninguem respondia "quem esta escalado onde nao consegue bater, e a partir de
-- que dia" - entao o coordenador do destino descobria quando a folha vinha vazia.
--
-- Medido em producao em 06/09/2026 (09/2026, 1.026 escalas com dia lancado): 941 ok, 61
-- sem_biometria, 17 sem_relogio_no_setor, 5 fora_do_relogio, 2 parcial. Sao 85 escalas / 84
-- pessoas - e SO 2 SAO EXTERNOS. Restringir o painel a externos esconderia 82 dos 84; por isso o
-- escopo e toda a escala, com o externo apenas sinalizado.
--
-- Plano: docs/planos/2026-09-06-painel-de-cobertura-de-escala-do-parque.md
-- Idempotente: DROP + CREATE (RETURNS TABLE nao aceita mudanca de colunas por CREATE OR REPLACE,
-- erro 42P13).


-- ----------------------------------------------------------------------------
-- 1. Uma linha por (servidor, escala) que NAO consegue bater onde esta escalado
--
--    Devolve SO o que nao esta 'ok'. As 941 linhas ok nao sao o que a tela pergunta e passariam
--    do teto de 1000 do PostgREST em silencio (armadilha 8).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_cobertura_escala_parque(integer, integer);

CREATE FUNCTION public.fn_cobertura_escala_parque(
    p_mes integer DEFAULT NULL,
    p_ano integer DEFAULT NULL
)
RETURNS TABLE (
    servidor_id       uuid,
    servidor_nome     text,
    matricula         text,
    escala_unidade_id uuid,
    unidade_nome      text,
    setor_id          uuid,
    setor_nome        text,
    externo           boolean,
    lotacao_nome      text,
    dias_escalados    integer,
    primeiro_dia      integer,
    situacao          text,
    relogios_alvo     text,
    bate_em           text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
-- RETURNS TABLE declara parametro de SAIDA com o nome de cada coluna, e varios deles se chamam
-- igual a colunas reais (servidor_id, matricula, setor_id, situacao...). Sem esta linha, qualquer
-- referencia nao qualificada vira 42702 "could not refer to either a PL/pgSQL variable or a table
-- column" - e SO EM RUNTIME, porque plpgsql nao resolve nome na criacao (armadilha 42). Aqui o
-- retorno e por RETURN QUERY, entao o parametro de saida nunca precisa ser lido como variavel.
#variable_conflict use_column
DECLARE
    v_role public.user_role;
    v_tz   text;
    v_hoje date;
    v_mes  integer;
    v_ano  integer;
BEGIN
    -- auth.uid() NULL = service_role / SQL direto: passa (mesmo padrao do guard de
    -- fn_blocos_previstos_dia), senao a conferencia no fim deste arquivo reprovaria sozinha.
    IF auth.uid() IS NOT NULL THEN
        v_role := (SELECT public.get_my_role());
        -- DENYLIST, nao allowlist: ver cobertura e visibilidade, nao autoridade. A allowlist de
        -- fn_pode_acionar_sobreaviso deixou 'rh' e 'rh_unidade' de fora por dois meses sem
        -- ninguem perceber (armadilha 44). So os papeis do Portal ficam fora.
        IF v_role IS NULL OR v_role IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
            RAISE EXCEPTION 'Sem permissao para ver a cobertura de escala.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- Mes corrente NO FUSO CONFIGURADO. O Postgres desta instalacao roda em UTC: derivar o mes
    -- sem o fuso vira o mes seguinte nas ultimas 3 horas de todo dia 31 (armadilha 12).
    -- configuracoes_globais e CHAVE/VALOR com `valor` jsonb - nao existe coluna `timezone`.
    SELECT (valor#>>'{}')::text INTO v_tz
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    v_tz := COALESCE(v_tz, 'America/Sao_Paulo');
    v_hoje := (now() AT TIME ZONE v_tz)::date;
    v_mes := COALESCE(p_mes, EXTRACT(MONTH FROM v_hoje)::integer);
    v_ano := COALESCE(p_ano, EXTRACT(YEAR  FROM v_hoje)::integer);

    RETURN QUERY
    WITH escalas AS (
        SELECT em.id, em.servidor_id AS sid, em.unidade_id AS uid, em.setor_id AS setid,
               count(DISTINCT ed.dia)::integer AS dias,
               min(ed.dia)::integer            AS primeiro
          FROM public.escala_mensal em
          JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
         WHERE em.mes = v_mes
           AND em.ano = v_ano
           -- Escopo do usuario. fn_unidade_no_escopo SOZINHA so olha profile_unidades e recusa
           -- coordenador cujo acesso vem de profile_setores (CLAUDE.md, pendencia 3).
           AND (auth.uid() IS NULL
                OR public.fn_unidade_no_escopo(em.unidade_id)
                OR public.fn_unidade_alcancavel_por_setor(em.unidade_id))
           AND ed.categoria IS NOT NULL
           -- Sobreaviso nao marca presenca e tem ciclo proprio (armadilha 6).
           AND ed.categoria::text <> 'Sobreaviso'
         GROUP BY em.id, em.servidor_id, em.unidade_id, em.setor_id
    ),
    -- Relogios ATIVOS que atendem o setor DA ESCALA. 0 linhas em dispositivos_rep_setores =
    -- "toda a unidade" (mesma semantica da aba Cobertura de Ponto).
    alvo AS (
        SELECT e.id AS escala_id, d.id AS dispositivo_id, d.nome AS dnome
          FROM escalas e
          JOIN public.dispositivos_rep d
            ON d.unidade_id = e.uid
           AND d.ativo
         WHERE NOT EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds
                            WHERE ds.dispositivo_id = d.id)
            OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds
                        WHERE ds.dispositivo_id = d.id AND ds.setor_id = e.setid)
    ),
    -- Cadastro/digital no snapshot, casando por servidor_id JA RESOLVIDO. Recalcular
    -- lpad(cpf,12,'0') aqui duplicaria a regra de identidade e reportaria como "fora do relogio"
    -- quem bate todo dia num equipamento cadastrado por PIS (armadilha 10).
    situado AS (
        SELECT e.id, e.sid, e.uid, e.setid, e.dias, e.primeiro,
               (SELECT count(*) FROM alvo a WHERE a.escala_id = e.id) AS n_alvo,
               (SELECT count(*) FROM alvo a
                  JOIN public.rep_usuarios_dispositivo u
                    ON u.dispositivo_id = a.dispositivo_id AND u.servidor_id = e.sid
                 WHERE a.escala_id = e.id) AS n_cad,
               (SELECT count(*) FROM alvo a
                  JOIN public.rep_usuarios_dispositivo u
                    ON u.dispositivo_id = a.dispositivo_id AND u.servidor_id = e.sid
                 WHERE a.escala_id = e.id AND u.tem_biometria) AS n_bio,
               (SELECT string_agg(a.dnome, ', ' ORDER BY a.dnome)
                  FROM alvo a WHERE a.escala_id = e.id) AS relogios
          FROM escalas e
    )
    SELECT s.sid,
           sv.nome,
           sv.matricula,
           s.uid,
           un.nome,
           s.setid,
           dse.nome,
           sv.unidade_id IS DISTINCT FROM s.uid,
           ulot.nome,
           s.dias,
           s.primeiro,
           CASE WHEN s.n_alvo = 0        THEN 'sem_relogio_no_setor'
                WHEN s.n_bio  = s.n_alvo THEN 'ok'
                WHEN s.n_cad  = 0        THEN 'fora_do_relogio'
                WHEN s.n_bio  = 0        THEN 'sem_biometria'
                ELSE                          'parcial' END,
           s.relogios,
           -- Onde ela bate hoje, em QUALQUER unidade: e o que distingue "so falta cadastrar a
           -- digital aqui" de "nunca cadastrou digital em lugar nenhum".
           (SELECT string_agg(DISTINCT u3.nome, ', ')
              FROM public.rep_usuarios_dispositivo ru
              JOIN public.dispositivos_rep d3 ON d3.id = ru.dispositivo_id AND d3.ativo
              JOIN public.unidades u3         ON u3.id = d3.unidade_id
             WHERE ru.servidor_id = s.sid AND ru.tem_biometria)
      FROM situado s
      JOIN public.servidores sv ON sv.id = s.sid AND sv.status = 'Ativo'
      JOIN public.unidades   un ON un.id = s.uid
      LEFT JOIN public.unidades ulot ON ulot.id = sv.unidade_id
      LEFT JOIN public.setores  se  ON se.id  = s.setid
      LEFT JOIN public.dicionario_setores dse ON dse.id = se.dicionario_setor_id
     WHERE NOT (s.n_alvo > 0 AND s.n_bio = s.n_alvo)
     ORDER BY s.primeiro, un.nome, sv.nome;
END;
$fn$;

COMMENT ON FUNCTION public.fn_cobertura_escala_parque(integer, integer) IS
    'Quem esta escalado na competencia e NAO consegue registrar ponto onde foi escalado, com o '
    'primeiro dia (urgencia), se e Servidor Externo e onde a pessoa bate hoje. Devolve apenas o '
    'que nao esta ok. Leitura pura: nao enfileira nem escreve em equipamento.';

-- CREATE FUNCTION ja concede EXECUTE a PUBLIC: sem o REVOKE a funcao nasce aberta a anon
-- (armadilha 24), e ela devolve nome e matricula de servidor.
REVOKE EXECUTE ON FUNCTION public.fn_cobertura_escala_parque(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_cobertura_escala_parque(integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_cobertura_escala_parque(integer, integer) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. Resumo por unidade - envelope da funcao acima, nunca uma segunda derivacao
--
--    Se cada uma classificasse por conta propria, o total do cabecalho deixaria de bater com a
--    lista logo abaixo dele. Mesmo motivo de fn_cobertura_ponto_resumo.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_cobertura_escala_resumo(integer, integer);

CREATE FUNCTION public.fn_cobertura_escala_resumo(
    p_mes integer DEFAULT NULL,
    p_ano integer DEFAULT NULL
)
RETURNS TABLE (
    escala_unidade_id    uuid,
    unidade_nome         text,
    pessoas              integer,
    externos             integer,
    sem_biometria        integer,
    fora_do_relogio      integer,
    sem_relogio_no_setor integer,
    parcial              integer,
    bate_em_outra        integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT c.escala_unidade_id,
           c.unidade_nome,
           count(DISTINCT c.servidor_id)::integer,
           count(DISTINCT c.servidor_id) FILTER (WHERE c.externo)::integer,
           count(*) FILTER (WHERE c.situacao = 'sem_biometria')::integer,
           count(*) FILTER (WHERE c.situacao = 'fora_do_relogio')::integer,
           count(*) FILTER (WHERE c.situacao = 'sem_relogio_no_setor')::integer,
           count(*) FILTER (WHERE c.situacao = 'parcial')::integer,
           -- Quantas dessas pessoas ja batem em alguma outra unidade: para essas basta cadastrar
           -- a digital aqui, acao bem mais barata que a primeira coleta.
           count(DISTINCT c.servidor_id) FILTER (WHERE c.bate_em IS NOT NULL)::integer
      FROM public.fn_cobertura_escala_parque(p_mes, p_ano) c
     GROUP BY c.escala_unidade_id, c.unidade_nome
     ORDER BY 3 DESC, 2
$fn$;

COMMENT ON FUNCTION public.fn_cobertura_escala_resumo(integer, integer) IS
    'Agregado por unidade de fn_cobertura_escala_parque. Envelope: nao reclassifica nada.';

REVOKE EXECUTE ON FUNCTION public.fn_cobertura_escala_resumo(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_cobertura_escala_resumo(integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_cobertura_escala_resumo(integer, integer) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3. Conferencia - aborta em vez de "aplicar com sucesso" sem ter mudado nada
-- ----------------------------------------------------------------------------
DO $conf$
DECLARE
    v_pendentes text;
BEGIN
    -- REVOKE de quem nao e dono da funcao NAO falha: emite WARNING e segue (armadilha 24).
    SELECT string_agg(p.proname, ', ') INTO v_pendentes
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('fn_cobertura_escala_parque', 'fn_cobertura_escala_resumo')
       AND has_function_privilege('anon', p.oid, 'EXECUTE');
    IF v_pendentes IS NOT NULL THEN
        RAISE EXCEPTION 'anon ainda executa: %. Banco=% usuario=%. REVOKE de quem nao e dono so emite WARNING - confira o dono da funcao.',
            v_pendentes, current_database(), current_user;
    END IF;

    -- O outro sentido: revogar demais derruba a tela do gestor com a mesma discricao.
    SELECT string_agg(p.proname, ', ') INTO v_pendentes
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('fn_cobertura_escala_parque', 'fn_cobertura_escala_resumo')
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');
    IF v_pendentes IS NOT NULL THEN
        RAISE EXCEPTION 'authenticated PERDEU execucao em: %. A aba nao abriria para gestor nenhum.', v_pendentes;
    END IF;

    RAISE NOTICE 'Privilegios conferidos nas duas funcoes.';
END;
$conf$;

-- Conferencia de dados (rodar a mao, comparando com scratchpad/an_proto_painel_cobertura.mjs):
--   SELECT situacao, count(*) FROM public.fn_cobertura_escala_parque(9, 2026) GROUP BY 1;
--   SELECT * FROM public.fn_cobertura_escala_resumo(9, 2026);
-- Em producao, 06/09/2026, o prototipo em JS deu: sem_biometria 61, sem_relogio_no_setor 17,
-- fora_do_relogio 5, parcial 2 (85 linhas, 84 pessoas, 2 externos). Divergencia = um dos dois
-- esta errado; nao "acerte" a funcao sem entender qual.
