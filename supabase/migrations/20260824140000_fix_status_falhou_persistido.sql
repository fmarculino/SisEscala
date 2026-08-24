-- Migration: fn_status_acionamento_sobreaviso passa a reconhecer o status 'Falhou' GRAVADO
-- Data: 2026-08-24
-- Plano: docs/planos/2026-08-23-desfecho-de-plantao-e-sobreaviso.md (fase 3)
--
-- 🚨 DEFEITO CORRIGIDO AQUI
--   `20260824110000` foi escrita com a premissa de que "Falhou" nunca era persistido - a coluna
--   `logs_sobreaviso.motivo_falha` esta nula nas 526 linhas de producao, e os quatro sitios de
--   JS derivam o estado na renderizacao. A premissa estava ERRADA pela metade.
--
--   `mark_sobreaviso_timeout(magic_token, p_motivo)` GRAVA `status = 'Falhou'`:
--
--       UPDATE public.logs_sobreaviso
--          SET status = 'Falhou', motivo_falha = p_motivo
--        WHERE token_magic_link = magic_token AND status IN ('Aguardando', 'Aceito');
--
--   Quem a chama e a propria pagina do servidor (src/app/sobreaviso/[token]/page.tsx, dois
--   pontos): ao abrir o link magico depois do prazo, ela persiste a falha. Nunca aconteceu em
--   producao porque ninguem abriu o link atrasado - os status existentes hoje sao apenas
--   `Chegou` (522) e `Cancelado` (4).
--
--   Com a funcao como estava, um `Falhou` gravado nao casava com nenhum ramo e caia no default
--   `em_andamento`. Efeito: o acionamento que o BANCO ja declarou falho seria tratado como "em
--   andamento" e o sobreaviso viraria `previsto` em vez de `falta` - exatamente o oposto da
--   decisao do usuario de 23/08/2026. A falha so apareceria enquanto o prazo pudesse ser
--   recalculado; assim que fosse gravada, sumiria.
--
--   Modo de falha silencioso e assimetrico para o lado errado: deixaria de acusar quem o
--   proprio sistema ja tinha registrado como faltoso.
--
-- POR QUE `CREATE OR REPLACE` BASTA AQUI
--   A assinatura e as colunas do RETURNS TABLE nao mudam, entao nao ha o 42P13 de
--   `cannot change return type` (a armadilha que exige DROP antes). fn_desfecho_evento_dia
--   continua chamando a mesma funcao, sem alteracao nenhuma - ela herda a correcao.

BEGIN;

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
    v_inicio timestamptz := COALESCE(p_created_at, p_acionamento_em);
BEGIN
    IF p_status = 'Chegou' THEN
        RETURN QUERY SELECT 'atendido'::text, NULL::text;
        RETURN;
    END IF;

    -- FALHA JA GRAVADA (mark_sobreaviso_timeout). Vem ANTES dos ramos por prazo: o fato ja
    -- aconteceu e foi registrado; recalcular o relogio aqui poderia desfaze-lo.
    -- Ter chegado a aceitar separa os dois tipos - quem aceitou e nao apareceu e caso diferente
    -- de quem nem respondeu ao chamado, e o coordenador precisa dessa distincao para decidir.
    IF p_status IN ('Falhou', 'Timeout') THEN
        IF p_aceite_em IS NOT NULL THEN
            RETURN QUERY SELECT 'falhou_chegada'::text,
                                'Aceitou o chamado e nao compareceu no prazo'::text;
        ELSE
            RETURN QUERY SELECT 'falhou_aceite'::text,
                                'Nao aceitou o chamado no prazo'::text;
        END IF;
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
    'falhou_aceite, falhou_chegada, recusado, cancelado. Reconhece tanto a falha DERIVADA do '
    'prazo quanto a falha JA GRAVADA por mark_sobreaviso_timeout (status = Falhou), que a '
    'primeira versao desta funcao tratava como em_andamento. Espelhada em '
    'src/utils/sobreaviso/statusAcionamento.ts - ao mexer numa ponta, mexa na outra.';

COMMIT;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar; nao faz parte da migration)
-- ============================================================================
--
-- 1. Producao nao muda: nao existe nenhuma linha 'Falhou' hoje (522 'Chegou' + 4 'Cancelado').
--
--    SELECT status, count(*) FROM public.logs_sobreaviso GROUP BY status;
--    -- esperado: Chegou 522, Cancelado 4
--
-- 2. O caso que a correcao cobre, testado sem gravar nada:
--
--    SELECT * FROM public.fn_status_acionamento_sobreaviso(
--        'Falhou', now() - interval '2 days', now() - interval '2 days',
--        now() - interval '2 days', NULL, now());
--    -- esperado: falhou_chegada | Aceitou o chamado e nao compareceu no prazo
--
--    SELECT * FROM public.fn_status_acionamento_sobreaviso(
--        'Falhou', now() - interval '2 days', now() - interval '2 days',
--        NULL, NULL, now());
--    -- esperado: falhou_aceite | Nao aceitou o chamado no prazo
--
--    ANTES desta migration as duas devolviam: em_andamento | NULL
