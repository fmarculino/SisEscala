-- ============================================================================
-- Migration: reparse/reconciliacao disparados pela criacao de vinculo
-- Data: 2026-08-20
--
-- Problema (medido em producao em 19/08/2026): criar um vinculo em
-- rep_vinculos_servidor NAO fazia nada com as batidas que ja estavam no banco
-- esperando por ele. O proprio comentario de fn_vincular_cadastros_por_cpf
-- admitia: "batidas passam a ter dono num FUTURO fn_reparse_afd_dispositivo" -
-- e nenhum caminho chamava esse futuro. A auto-reconciliacao da 20260818080000
-- so dispara na INGESTAO do lote, entao batida que chega antes do vinculo fica
-- com dono e fora da folha, em silencio nas duas pontas.
--
-- Foi assim que SAMANTA (CEI, 18/08/2026) ficou com 3 batidas do relogio fora
-- da folha. Eram 2 casos em 580 pares (servidor, dia) - pequeno hoje, mas cada
-- vinculo novo de quem ja bateu reproduz o mesmo.
--
-- Duas partes:
--   1. fn_reparse_afd_dispositivo passa a reconciliar SO os pares que acabaram
--      de ganhar dono (antes reconciliava o mes inteiro do dispositivo).
--   2. trigger de statement em rep_vinculos_servidor dispara o reparse.
--
-- A parte 1 e pre-requisito da 2: sem ela, o trigger viraria reconciliacao em
-- massa a cada vinculo criado - e reconciliacao em massa nao e neutra (medido:
-- corrige 4 dias, piora 11).
--
-- Gerada por copia mecanica do corpo vigente (20260818200000) via
-- scratchpad/gen_reparse.js, com conferencia de invariantes - nunca redigitada
-- a mao (armadilha 1 do CLAUDE.md: seis regressoes ja sairam disso).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reconciliar so o que mudou
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reparse_afd_dispositivo(
    p_dispositivo_id uuid DEFAULT NULL,
    p_desde          timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_desde       timestamptz;
    v_atualizados integer := 0;
    r             record;
    r_rec         record;
    v_servidor_id uuid;
    v_unidade_id  uuid;
    v_setor_id    uuid;
    v_pares       text[] := '{}';
BEGIN
    -- Declara sessao de reprocessamento autorizada
    PERFORM set_config('sisescala.reparse_afd', 'on', true);

    IF p_desde IS NULL THEN
        v_desde := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
    ELSE
        v_desde := p_desde;
    END IF;

    -- Atualiza marcacoes_ponto onde servidor_id IS NULL
    FOR r IN
        SELECT m.id AS marcacao_id,
               m.dispositivo_id,
               COALESCE(m.identificador_bruto, a.identificador_afd) AS identificador
          FROM public.marcacoes_ponto m
          LEFT JOIN public.rep_afd_registros a ON a.id = m.afd_registro_id
         WHERE m.servidor_id IS NULL
           AND m.origem = 'rep'
           AND m.ocorrido_em >= v_desde
           AND (p_dispositivo_id IS NULL OR m.dispositivo_id = p_dispositivo_id)
    LOOP
        SELECT servidor_id INTO v_servidor_id
          FROM public.fn_servidor_por_identificador_afd(r.dispositivo_id, r.identificador);

        IF v_servidor_id IS NOT NULL THEN
            SELECT s.unidade_id, s.setor_id INTO v_unidade_id, v_setor_id
              FROM public.servidores s WHERE s.id = v_servidor_id;

            UPDATE public.marcacoes_ponto
               SET servidor_id = v_servidor_id,
                   unidade_id  = COALESCE(v_unidade_id, marcacoes_ponto.unidade_id),
                   setor_id    = COALESCE(v_setor_id, marcacoes_ponto.setor_id)
             WHERE id = r.marcacao_id
               AND servidor_id IS NULL;

            v_atualizados := v_atualizados + 1;

            -- So o que ACABOU de ganhar dono entra na reconciliacao (ver bloco abaixo).
            v_pares := v_pares || (
                v_servidor_id::text || '|' ||
                ((SELECT m2.ocorrido_em FROM public.marcacoes_ponto m2 WHERE m2.id = r.marcacao_id)
                   AT TIME ZONE 'America/Sao_Paulo')::date::text
            );
        END IF;
    END LOOP;

    -- Auto-reconcilia APENAS os pares (servidor, dia) que acabaram de ganhar dono.
    --
    -- A versao anterior reconciliava TODO servidor com marcacao no periodo daquele
    -- dispositivo. Isso transformava "criar um vinculo" em "reconciliar o mes inteiro
    -- da unidade" - e reconciliacao em massa nao e neutra: medido em producao em
    -- 19/08/2026, reprojetar 08/2026 corrigia 4 dias e PIORAVA 11 (a projecao aloca
    -- 3 batidas por proximidade e as vezes sacrifica a entrada). Reconciliar so o que
    -- mudou mantem o ganho e tira o efeito colateral.
    IF v_atualizados > 0 THEN
        FOR r_rec IN
            SELECT DISTINCT
                   split_part(p, '|', 1)::uuid AS servidor_id,
                   split_part(p, '|', 2)::date AS data_batida
              FROM unnest(v_pares) AS p
        LOOP
            BEGIN
                PERFORM public.fn_reconciliar_marcacoes_dia(r_rec.servidor_id, r_rec.data_batida);
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'Falha ao auto-reconciliar servidor % na data %: %', r_rec.servidor_id, r_rec.data_batida, SQLERRM;
            END;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'sucesso', true,
        'marcacoes_vinculadas', v_atualizados
    );
END;
$fn$;
-- Privilegios: identicos aos da 20260818200000. CREATE OR REPLACE preserva os
-- privilegios existentes, mas a migration precisa valer tambem em banco limpo.
REVOKE ALL ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Criar vinculo passa a acionar o reparse
--
--    FOR EACH STATEMENT (nao FOR EACH ROW): a vinculacao em massa por CPF/PIS
--    insere centenas de vinculos num comando so, e um reparse por dispositivo
--    por comando basta. A transition table da os dispositivos distintos.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reparse_apos_vinculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fnv$
DECLARE
    v_disp  uuid;
    v_desde timestamptz;
BEGIN
    -- Recursao: fn_reparse_afd_dispositivo tambem cria vinculo. Ela se declara
    -- com sisescala.reparse_afd = 'on', entao aqui basta respeitar a marca.
    IF COALESCE(current_setting('sisescala.reparse_afd', true), '') = 'on' THEN
        RETURN NULL;
    END IF;

    -- Janela: mes corrente, o mesmo default de fn_reparse_afd_dispositivo.
    -- Deliberadamente NAO usa vigente_de do vinculo: um vigente_de antigo
    -- transformaria anos de ponto de outro sistema em ponto do SisEscala
    -- (a SMS chegou com ~250 mil marcacoes desde 2021). Recuperar historico
    -- continua sendo decisao humana, por chamada explicita ao reparse.
    v_desde := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
                   AT TIME ZONE 'America/Sao_Paulo';

    FOR v_disp IN
        SELECT DISTINCT n.dispositivo_id
          FROM novos n
         WHERE n.dispositivo_id IS NOT NULL
    LOOP
        BEGIN
            PERFORM public.fn_reparse_afd_dispositivo(v_disp, v_desde);
        EXCEPTION WHEN OTHERS THEN
            -- Nunca derrubar a criacao do vinculo por falha no reprocessamento:
            -- o vinculo e o dado; a reconciliacao e consequencia e pode ser refeita.
            RAISE WARNING 'Falha ao reparsear dispositivo % apos criacao de vinculo: %', v_disp, SQLERRM;
        END;
    END LOOP;

    RETURN NULL;
END;
$fnv$;

COMMENT ON FUNCTION public.fn_reparse_apos_vinculo() IS
    'Apos criar vinculo, resolve autoria das batidas orfas do mes corrente daquele '
    'dispositivo e reconcilia so os dias afetados. Nao recupera historico antigo de proposito.';

REVOKE ALL ON FUNCTION public.fn_reparse_apos_vinculo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reparse_apos_vinculo ON public.rep_vinculos_servidor;
CREATE TRIGGER trg_reparse_apos_vinculo
    AFTER INSERT ON public.rep_vinculos_servidor
    REFERENCING NEW TABLE AS novos
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.fn_reparse_apos_vinculo();

-- ----------------------------------------------------------------------------
-- 3. Conferencia (rodar depois de aplicar)
-- ----------------------------------------------------------------------------
-- 3.1 O trigger existe e esta ativo:
--     SELECT tgname, tgenabled FROM pg_trigger
--      WHERE tgrelid = 'public.rep_vinculos_servidor'::regclass
--        AND tgname = 'trg_reparse_apos_vinculo';
--     esperado: 1 linha, tgenabled = 'O'
--
-- 3.2 Nenhuma batida com dono ficou fora da folha no mes corrente. Esperado: 0 linhas.
--     SELECT m.servidor_id, (m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
--       FROM public.marcacoes_ponto m
--       JOIN public.escala_mensal em ON em.servidor_id = m.servidor_id
--                                   AND em.mes = extract(month from m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')
--                                   AND em.ano = extract(year  from m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')
--       JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
--                                   AND ed.dia = extract(day from m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')
--      WHERE m.origem = 'rep' AND m.servidor_id IS NOT NULL
--        AND m.ocorrido_em >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
--        AND ed.reconciliado_em IS NULL
--      GROUP BY 1, 2;
--
-- 3.3 Teste ponta a ponta (dispositivo com batida orfa recente):
--     INSERT em rep_vinculos_servidor -> conferir que as marcacoes daquele
--     identificador ganharam servidor_id E que escala_diaria.reconciliado_em subiu
--     SO nos dias dessas batidas (nenhum outro servidor do dispositivo tocado).
