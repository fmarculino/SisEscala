-- ============================================================================
-- A TELA PASSA A SABER ONDE A BATIDA FOI FEITA
-- ============================================================================
-- Terceira peca do par 20260908140000 (o bloco nao atravessa unidade) e 20260908150000 (a
-- alocacao nao atravessa unidade).
--
-- Com aquelas duas, a batida feita no relogio de outra unidade deixa de virar presenca sozinha
-- e passa a ficar disponivel para o coordenador decidir. Mas o modal de validacao manual da
-- grade nao tinha como dizer de ONDE ela veio: fn_marcacoes_mes devolvia id, servidor,
-- instante, observacao e origem, e mais nada.
--
-- Sem o lugar na tela, a peca 2 troca um erro silencioso por outro: a batida some da presenca,
-- aparece na lista do modal identica as demais, e o coordenador a seleciona de volta sem saber
-- que ela foi feita a quilometros dali. A regra da casa e que o sistema nao decide sozinho E o
-- coordenador nao decide as cegas — as duas metades, nunca so a primeira.
--
-- ⚠️ DROP antes do CREATE: `CREATE OR REPLACE FUNCTION` NAO altera a lista de colunas de um
--    RETURNS TABLE (42P13, "cannot change return type of existing function"). Sem CASCADE, de
--    proposito: se existir um dependente de verdade, que a migration falhe em vez de o
--    dependente sumir em silencio.
--
-- ⚠️ E o DROP faz um objeto NOVO, que nasce com EXECUTE para PUBLIC (armadilha 24). Os
--    privilegios precisam ser REESCRITOS aqui — nao sao herdados. Estado medido em 08/09/2026,
--    antes desta migration: anon NAO pode, authenticated pode, service_role pode. E' esse
--    estado que as linhas abaixo restauram, e a conferencia confere os dois sentidos.

DROP FUNCTION IF EXISTS public.fn_marcacoes_mes(uuid[], integer, integer);

CREATE OR REPLACE FUNCTION public.fn_marcacoes_mes(
    p_servidor_ids uuid[],
    p_mes          integer,
    p_ano          integer
)
RETURNS TABLE (
    id             uuid,
    servidor_id    uuid,
    ocorrido_em    timestamptz,
    observacao     text,
    origem         public.marcacao_origem,
    -- O lugar so e' preenchido para batida de RELOGIO. Em origem `terminal`,
    -- marcacoes_ponto.unidade_id e' a LOTACAO do servidor (fn_registrar_ponto le
    -- servidores.unidade_id), nao onde a pessoa bateu: rotular isso como lugar diria ao
    -- coordenador uma coisa que o dado nao afirma, e no Servidor Externo (lotado em A,
    -- escalado em B) diria o oposto da verdade.
    unidade_id     uuid,
    unidade_nome   text,
    dispositivo_id uuid,
    dispositivo_nome text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_start timestamptz;
    v_end   timestamptz;
BEGIN
    v_start := make_timestamptz(p_ano, p_mes, 1, 0, 0, 0, 'UTC') - interval '1 day';
    v_end   := (make_timestamptz(p_ano, p_mes, 1, 0, 0, 0, 'UTC') + interval '1 month') + interval '1 day';

    RETURN QUERY
    SELECT m.id, m.servidor_id, m.ocorrido_em, m.observacao, m.origem,
           CASE WHEN m.origem = 'rep' AND m.dispositivo_id IS NOT NULL THEN m.unidade_id END,
           CASE WHEN m.origem = 'rep' AND m.dispositivo_id IS NOT NULL THEN u.nome END,
           m.dispositivo_id,
           d.nome
      FROM public.marcacoes_ponto m
      LEFT JOIN public.unidades u        ON u.id = m.unidade_id
      LEFT JOIN public.dispositivos_rep d ON d.id = m.dispositivo_id
     WHERE m.servidor_id = ANY(p_servidor_ids)
       AND m.origem IN ('terminal', 'rep', 'ajuste_servidor', 'ajuste_coordenador')
       AND m.ocorrido_em >= v_start
       AND m.ocorrido_em <= v_end
     ORDER BY m.ocorrido_em;
END;
$fn$;

COMMENT ON FUNCTION public.fn_marcacoes_mes(uuid[], integer, integer) IS
    'Batidas do mes dos servidores da grade, com o LUGAR onde foram feitas. unidade_id e '
    'unidade_nome so vem preenchidos para origem rep com dispositivo: e a unica origem em que '
    'marcacoes_ponto.unidade_id significa onde a pessoa bateu, e nao a lotacao dela.';

REVOKE ALL ON FUNCTION public.fn_marcacoes_mes(uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_marcacoes_mes(uuid[], integer, integer) TO authenticated, service_role;

-- ============================================================================
-- CONFERENCIA — roda junto e ABORTA se qualquer assercao falhar
-- ============================================================================
DO $conf$
DECLARE
    v_anon  boolean;
    v_auth  boolean;
    v_srole boolean;
    v_cols  integer;
BEGIN
    -- Colunas de saida = parametros em modo TABLE ('t'). Contar pelo texto de
    -- pg_get_function_result quebraria no primeiro tipo que tenha virgula dentro.
    SELECT count(*) INTO v_cols
      FROM pg_proc p, unnest(p.proargmodes) AS m
     WHERE p.proname = 'fn_marcacoes_mes'
       AND p.pronamespace = 'public'::regnamespace
       AND m = 't';

    IF v_cols <> 9 THEN
        RAISE EXCEPTION 'ABORTADO: fn_marcacoes_mes devolve % coluna(s), esperado 9.', v_cols;
    END IF;
    RAISE NOTICE 'ok  fn_marcacoes_mes devolve % colunas', v_cols;

    -- Os DOIS sentidos do privilegio: fechar demais derruba a grade do coordenador com a mesma
    -- discricao com que abrir demais vaza dado (armadilha 24).
    SELECT has_function_privilege('anon',          p.oid, 'EXECUTE'),
           has_function_privilege('authenticated', p.oid, 'EXECUTE'),
           has_function_privilege('service_role',  p.oid, 'EXECUTE')
      INTO v_anon, v_auth, v_srole
      FROM pg_proc p
     WHERE p.proname = 'fn_marcacoes_mes' AND p.pronamespace = 'public'::regnamespace;

    IF v_anon THEN
        RAISE EXCEPTION 'ABORTADO: anon voltou a poder executar fn_marcacoes_mes (o DROP recriou o objeto com EXECUTE para PUBLIC).';
    END IF;
    IF NOT v_auth OR NOT v_srole THEN
        RAISE EXCEPTION 'ABORTADO: authenticated=% service_role=% — a grade do coordenador chama esta funcao com sessao de usuario.', v_auth, v_srole;
    END IF;
    RAISE NOTICE 'ok  privilegios: anon=% authenticated=% service_role=%', v_anon, v_auth, v_srole;

    -- E ela EXECUTA (armadilha 42). Lista vazia: nao devolve nada e nao tem efeito colateral.
    PERFORM * FROM public.fn_marcacoes_mes(ARRAY[]::uuid[], 9, 2026);
    RAISE NOTICE 'ok  fn_marcacoes_mes executou';
END;
$conf$;
