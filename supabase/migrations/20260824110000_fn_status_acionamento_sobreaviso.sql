-- Migration: fonte unica do status de acionamento de sobreaviso
-- Data: 2026-08-24
-- Plano: docs/planos/2026-08-23-desfecho-de-plantao-e-sobreaviso.md (fase 0, migration 2 de 3)
--
-- MOTIVACAO
--   "Falhou" nunca foi um estado do sistema: e uma conta feita na RENDERIZACAO, comparando
--   sobreaviso_tempo_aceite_minutos (30) e sobreaviso_tempo_chegada_minutos (90) contra o
--   relogio do navegador. A conta esta COPIADA em quatro lugares:
--
--     src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx:943
--     src/app/(dashboard)/auditoria/page.tsx:664
--     src/app/sobreaviso/[token]/page.tsx:77
--     src/app/sobreaviso/[token]/page.tsx:117
--
--   A coluna logs_sobreaviso.motivo_falha existe desde sempre e esta NULA nas 526 linhas de
--   producao (medido em 23/08/2026). Nenhum relatorio le status de acionamento para julgar
--   cumprimento - a falha nao chega ao anexo nem ao relatorio de plantao/sobreaviso.
--
--   Com a decisao de 23/08/2026 (secao 5.2 do plano), falha de acionamento passa a ser FALTA.
--   Uma regra dessas nao pode continuar morando em quatro copias de JavaScript: a fila de
--   justificativas e a grade discordariam sobre o que e falha, exatamente como
--   fn_projecao_marcacoes_dia precisou ser fonte unica de reconciliar e conferir.
--
-- ESTADO REAL EM PRODUCAO (23/08/2026)
--   8 acionamentos de verdade, TODOS terminados em 'Chegou'. O caminho da falha nunca rodou.
--   Os outros 518 registros de logs_sobreaviso sao artefatos de fn_confirmar_presenca (o
--   terminal e a grade tambem escrevem nesta tabela - ver armadilha 6 do CLAUDE.md).
--
-- ESTA MIGRATION NAO MUDA COMPORTAMENTO NENHUM.
--   Ela so cria as funcoes. Quem passa a consumi-las e a migration 3 (fn_desfecho_evento_dia) e,
--   depois, os quatro sitios de JS na fase 3. Aplicavel sozinha, sem efeito visivel.

BEGIN;

-- ============================================================================
-- 1. O FILTRO DE ARTEFATO
-- ============================================================================
--
-- logs_sobreaviso NAO e uma tabela de acionamentos. fn_confirmar_presenca e
-- fn_confirmar_presenca_manual tambem escrevem aqui quando validam presenca, e os artefatos
-- entram com status 'Chegou' - contar tudo ja produziu um relatorio afirmando o oposto da
-- realidade (CLAUDE.md, armadilha 6).
--
-- O predicado abaixo e o mesmo de fn_painel_sobreaviso_dia (20260808190000) e de
-- `ehAcionamentoReal` em relatorios/plantao-sobreaviso/page.tsx:176. Extraido aqui porque a
-- migration 3 precisa dele e o anexo tambem - hoje o anexo NAO filtra, e por isso lista
-- artefato de Plantao como "acionamento presencial de Sobreaviso" no documento assinado
-- (1 caso medido em 08/2026).
CREATE OR REPLACE FUNCTION public.fn_acionamento_sobreaviso_real(
    p_acionado_por uuid,
    p_motivo       text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_acionado_por IS NOT NULL
        OR NOT (
               COALESCE(p_motivo, '') ILIKE 'O próprio usuário confirmou%'
            OR COALESCE(p_motivo, '') ILIKE 'Validação Manual%'
            OR COALESCE(p_motivo, '') ILIKE 'REVERSÃO%'
           )
$$;

COMMENT ON FUNCTION public.fn_acionamento_sobreaviso_real(uuid, text) IS
    'Separa acionamento de verdade do artefato que fn_confirmar_presenca grava em '
    'logs_sobreaviso. Mesmo predicado de fn_painel_sobreaviso_dia e de ehAcionamentoReal no '
    'relatorio de plantao/sobreaviso - extraido para o anexo e fn_desfecho_evento_dia usarem o '
    'mesmo criterio. Sem ele, 518 das 526 linhas de producao passam por acionamento.';

GRANT EXECUTE ON FUNCTION public.fn_acionamento_sobreaviso_real(uuid, text) TO authenticated, service_role;


-- ============================================================================
-- 2. OS PRAZOS, LIDOS DE configuracoes_globais
-- ============================================================================
--
-- configuracoes_globais e chave/valor com `valor` jsonb - nao existe coluna por nome. A forma
-- abaixo e a unica correta e e a que fn_confirmar_presenca ja usa (CLAUDE.md, Convencoes).
-- Em producao os valores sao jsonb string ("30", "90"); #>>'{}' devolve o texto de dentro.
CREATE OR REPLACE FUNCTION public.fn_config_int(p_chave text, p_default integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        NULLIF(btrim((SELECT (valor#>>'{}')::text
                        FROM public.configuracoes_globais
                       WHERE chave = p_chave)), '')::integer,
        p_default
    )
$$;

COMMENT ON FUNCTION public.fn_config_int(text, integer) IS
    'Le uma configuracao global numerica. configuracoes_globais e chave/valor com valor jsonb; '
    'o acesso por (valor#>>NULL-path) e a unica forma correta - "configuracoes_globais.timezone" '
    'nao existe e ja causou 42703 em producao (13/08/2026).';

GRANT EXECUTE ON FUNCTION public.fn_config_int(text, integer) TO authenticated, service_role;


-- ============================================================================
-- 3. O STATUS DERIVADO
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_status_acionamento_sobreaviso(text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.fn_status_acionamento_sobreaviso(uuid);

-- Forma pura: nao le tabela nenhuma, para poder rodar em LATERAL sobre milhares de linhas.
-- p_agora e OBRIGATORIO, sem DEFAULT, de proposito - a licao da armadilha 20 do CLAUDE.md
-- (p_ocorrido_em) e que parametro opcional em funcao de decisao vira bypass silencioso assim
-- que uma segunda assinatura aparece. Aqui tambem torna o simulador deterministico.
CREATE OR REPLACE FUNCTION public.fn_status_acionamento_sobreaviso(
    p_status           text,
    p_created_at       timestamptz,
    p_acionamento_em   timestamptz,
    p_aceite_em        timestamptz,
    p_chegada_em       timestamptz,
    p_agora            timestamptz
)
RETURNS TABLE (estado text, motivo text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_lim_aceite  integer := public.fn_config_int('sobreaviso_tempo_aceite_minutos', 30);
    v_lim_chegada integer := public.fn_config_int('sobreaviso_tempo_chegada_minutos', 90);
    -- created_at e o relogio que os quatro sitios de JS ja usam para o prazo de aceite.
    -- data_hora_acionamento e o fallback: e o mesmo instante na pratica, e nao ha linha em
    -- producao com created_at nulo - mas nulo aqui viraria "nunca expira", o pior default.
    v_inicio timestamptz := COALESCE(p_created_at, p_acionamento_em);
BEGIN
    IF p_status = 'Chegou' THEN
        RETURN QUERY SELECT 'atendido'::text, NULL::text;
        RETURN;
    END IF;

    IF p_status = 'Recusado' THEN
        RETURN QUERY SELECT 'recusado'::text, 'O servidor recusou o acionamento'::text;
        RETURN;
    END IF;

    IF p_status = 'Cancelado' THEN
        RETURN QUERY SELECT 'cancelado'::text, NULL::text;
        RETURN;
    END IF;

    -- Aceitou e nao compareceu dentro do prazo de deslocamento.
    IF p_status = 'Aceito' THEN
        IF p_chegada_em IS NULL
           AND p_aceite_em IS NOT NULL
           AND (p_aceite_em + make_interval(mins => v_lim_chegada)) < p_agora THEN
            RETURN QUERY SELECT 'falhou_chegada'::text,
                                'Tempo limite de deslocamento excedido'::text;
            RETURN;
        END IF;
        RETURN QUERY SELECT 'em_andamento'::text, NULL::text;
        RETURN;
    END IF;

    -- Nem chegou a aceitar dentro do prazo.
    IF p_status = 'Aguardando' THEN
        IF v_inicio IS NOT NULL
           AND (v_inicio + make_interval(mins => v_lim_aceite)) < p_agora THEN
            RETURN QUERY SELECT 'falhou_aceite'::text,
                                'Tempo limite para aceite excedido'::text;
            RETURN;
        END IF;
        RETURN QUERY SELECT 'em_andamento'::text, NULL::text;
        RETURN;
    END IF;

    -- Status desconhecido nao vira falha: falha e' acusacao, e chutar seria acusar por bug.
    RETURN QUERY SELECT 'em_andamento'::text, NULL::text;
END;
$fn$;

COMMENT ON FUNCTION public.fn_status_acionamento_sobreaviso(text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) IS
    'Fonte unica do status de um acionamento de sobreaviso: atendido, em_andamento, '
    'falhou_aceite, falhou_chegada, recusado, cancelado. Reproduz exatamente a derivacao que '
    'estava copiada em 4 sitios de JS (ScaleGrid.tsx:943, auditoria/page.tsx:664, '
    'sobreaviso/[token]/page.tsx:77 e :117), que passam a consumir esta funcao na fase 3. '
    'Status desconhecido devolve em_andamento, NUNCA falha - falha e acusacao sobre conduta.';

GRANT EXECUTE ON FUNCTION public.fn_status_acionamento_sobreaviso(text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated, service_role;


-- Forma por id, para a tela chamar via RPC sem repetir a lista de colunas.
CREATE OR REPLACE FUNCTION public.fn_status_acionamento_sobreaviso(p_log_id uuid)
RETURNS TABLE (estado text, motivo text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT st.estado, st.motivo
      FROM public.logs_sobreaviso l
      CROSS JOIN LATERAL public.fn_status_acionamento_sobreaviso(
          l.status::text, l.created_at, l.data_hora_acionamento,
          l.data_hora_aceite, l.data_hora_chegada, now()
      ) st
     WHERE l.id = p_log_id
$$;

COMMENT ON FUNCTION public.fn_status_acionamento_sobreaviso(uuid) IS
    'Envelope por id da forma pura. Usa now() - para conta reproduzivel (simulador, conferencia '
    'de migration), chame a forma de 6 argumentos passando o instante explicitamente.';

GRANT EXECUTE ON FUNCTION public.fn_status_acionamento_sobreaviso(uuid) TO authenticated, service_role;

COMMIT;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar; nao faz parte da migration)
-- ============================================================================
--
-- 1. Os prazos vieram mesmo de configuracoes_globais:
--
--    SELECT public.fn_config_int('sobreaviso_tempo_aceite_minutos', 30)  AS aceite,
--           public.fn_config_int('sobreaviso_tempo_chegada_minutos', 90) AS chegada;
--    -- esperado em producao: aceite = 30, chegada = 90
--
-- 2. O filtro de artefato reproduz a proporcao ja conhecida - 8 acionamentos reais em 526:
--
--    SELECT count(*) FILTER (WHERE public.fn_acionamento_sobreaviso_real(acionado_por, motivo_acionamento)) AS reais,
--           count(*) AS total
--      FROM public.logs_sobreaviso;
--    -- esperado: reais = 8, total = 526 (medido em 23/08/2026)
--
-- 3. Todos os acionamentos reais de producao estao 'atendido' - nenhuma falta e' criada por
--    esta migration, que e' o resultado esperado de um caminho que nunca rodou:
--
--    SELECT st.estado, count(*)
--      FROM public.logs_sobreaviso l
--      CROSS JOIN LATERAL public.fn_status_acionamento_sobreaviso(
--          l.status::text, l.created_at, l.data_hora_acionamento,
--          l.data_hora_aceite, l.data_hora_chegada, now()) st
--     WHERE public.fn_acionamento_sobreaviso_real(l.acionado_por, l.motivo_acionamento)
--     GROUP BY st.estado;
--    -- esperado: atendido = 8, e mais nada
