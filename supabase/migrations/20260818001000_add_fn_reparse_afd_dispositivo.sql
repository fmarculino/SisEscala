-- ============================================================================
-- Migration: Reprocessa batidas orfas de REP para vincular aos servidores resolvidos
-- Data: 2026-08-18
-- ============================================================================
-- CONTEXTO E GARANTIAS DE SEGURANCA:
--   1. SUPORTE A IDENTIDADE MISTA (CPF ou PIS):
--      Utiliza a fonte unica `fn_servidor_por_identificador_afd` (criada em 17/08/2026),
--      que resolve a identidade tentando: 1) Vinculo ativo, 2) CPF, 3) PIS/NIS.
--      Isso garante suporte completo a relogios com cadastros legados por PIS e cadastros
--      novos por CPF no mesmo equipamento.
--
--   2. ZERO PERDA DE DADOS / NAO DESTRUTIVO:
--      * `rep_afd_registros` (memoria fiscal do relogio) e APENAS LEITURA — nunca alterada/deletada.
--      * `marcacoes_ponto` e alterada SOMENTE nas linhas onde `servidor_id IS NULL` (orfas).
--        Nenhuma marcação que ja pertence a um servidor e alterada, movida ou sobrescrita.
--
--   3. PROTECAO CONTRA AMBIGUIDADE (NAO BAGUNCA PONTO ALHEIO):
--      Se um identificador do relogio apontar para mais de um servidor ativo (ou CPF/PIS
--      divergentes), `fn_servidor_por_identificador_afd` devolve NULL e a batida permanece
--      orfa. O sistema NUNCA atribui ponto por chute.
--
--   4. ESCOPO TEMPORAL PROTEGIDO:
--      Por padrao, reprocessa apenas a partir do inicio do mes em curso (`p_desde` NULL),
--      protegendo competencias passadas ja fechadas pelo RH.
-- ============================================================================

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
    v_criados     integer := 0;
    r             record;
    v_servidor_id uuid;
    v_unidade_id  uuid;
    v_setor_id    uuid;
BEGIN
    -- Se p_desde for NULL, assume inicio do mes atual (no fuso America/Sao_Paulo)
    IF p_desde IS NULL THEN
        v_desde := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
    ELSE
        v_desde := p_desde;
    END IF;

    -- 1. Atualiza marcacoes em marcacoes_ponto que eram orfas (servidor_id IS NULL)
    --    usando a fonte unica (fn_servidor_por_identificador_afd) -> aceita vinculo, CPF e PIS.
    FOR r IN
        SELECT m.id AS marcacao_id,
               m.dispositivo_id,
               m.identificador_bruto,
               m.ocorrido_em
          FROM public.marcacoes_ponto m
         WHERE m.servidor_id IS NULL
           AND m.origem = 'rep'
           AND m.ocorrido_em >= v_desde
           AND (p_dispositivo_id IS NULL OR m.dispositivo_id = p_dispositivo_id)
    LOOP
        SELECT servidor_id INTO v_servidor_id
          FROM public.fn_servidor_por_identificador_afd(r.dispositivo_id, r.identificador_bruto);

        IF v_servidor_id IS NOT NULL THEN
            SELECT s.unidade_id, s.setor_id INTO v_unidade_id, v_setor_id
              FROM public.servidores s WHERE s.id = v_servidor_id;

            -- Trava estrita: so atualiza se CONTINUAR sendo orfa (evita race condition)
            UPDATE public.marcacoes_ponto
               SET servidor_id = v_servidor_id,
                   unidade_id  = COALESCE(v_unidade_id, marcacoes_ponto.unidade_id),
                   setor_id    = COALESCE(v_setor_id, marcacoes_ponto.setor_id)
             WHERE id = r.marcacao_id
               AND servidor_id IS NULL;

            v_atualizados := v_atualizados + 1;
        END IF;
    END LOOP;

    -- 2. Registros de rep_afd_registros tipo '3' que nao tinham marcacao com dono
    FOR r IN
        SELECT a.id AS afd_id,
               a.dispositivo_id,
               a.nsr,
               a.ocorrido_em,
               a.identificador_afd,
               a.via_pendrive
          FROM public.rep_afd_registros a
         WHERE a.tipo_registro = '3'
           AND a.ocorrido_em >= v_desde
           AND (p_dispositivo_id IS NULL OR a.dispositivo_id = p_dispositivo_id)
           AND NOT EXISTS (
               SELECT 1 FROM public.marcacoes_ponto m
                WHERE m.dispositivo_id = a.dispositivo_id
                  AND m.nsr = a.nsr
                  AND m.servidor_id IS NOT NULL
           )
    LOOP
        SELECT servidor_id INTO v_servidor_id
          FROM public.fn_servidor_por_identificador_afd(r.dispositivo_id, r.identificador_afd);

        IF v_servidor_id IS NOT NULL THEN
            SELECT s.unidade_id, s.setor_id INTO v_unidade_id, v_setor_id
              FROM public.servidores s WHERE s.id = v_servidor_id;

            UPDATE public.marcacoes_ponto
               SET servidor_id = v_servidor_id,
                   unidade_id  = COALESCE(v_unidade_id, marcacoes_ponto.unidade_id),
                   setor_id    = COALESCE(v_setor_id, marcacoes_ponto.setor_id)
             WHERE dispositivo_id = r.dispositivo_id
               AND nsr = r.nsr
               AND servidor_id IS NULL;

            IF NOT FOUND THEN
                PERFORM public.fn_registrar_marcacao(
                    v_servidor_id,
                    'rep'::public.marcacao_origem,
                    r.ocorrido_em,
                    v_unidade_id, v_setor_id,
                    NULL, NULL, NULL,
                    false, true,
                    r.dispositivo_id, r.nsr, r.afd_id, r.identificador_afd,
                    r.via_pendrive,
                    'AFD NSR ' || r.nsr::text || ' (reprocessado)'
                );
                v_criados := v_criados + 1;
            ELSE
                v_atualizados := v_atualizados + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'sucesso', true,
        'marcacoes_atualizadas', v_atualizados,
        'marcacoes_criadas', v_criados
    );
END;
$fn$;

COMMENT ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) IS
    'Reprocessa batidas orfas de REP a partir de p_desde (default: inicio do mes atual) usando a '
    'fonte unica fn_servidor_por_identificador_afd (suporta vinculo, CPF e PIS). Nao destrutivo: '
    'so atua em linhas com servidor_id NULL e recusa qualquer ambiguidade.';

REVOKE ALL ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) TO authenticated, service_role;

-- Integra ao fn_vincular_cadastros_por_cpf para que a criacao de vinculos re-associe
-- automaticamente as batidas orfas passadas desde a data vigente do vinculo.
CREATE OR REPLACE FUNCTION public.fn_vincular_cadastros_por_cpf(
    p_dispositivo_id uuid,
    p_vigente_de     timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_role        public.user_role;
    v_vigente_de  timestamptz;
    v_criados     integer := 0;
    v_reprocesso  jsonb;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        v_role := (SELECT public.get_my_role());
        IF v_role IS NULL OR v_role IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
            RAISE EXCEPTION 'Sem permissao para criar vinculos de relogio.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.dispositivos_rep d
         WHERE d.id = p_dispositivo_id
           AND (auth.uid() IS NULL
                OR public.fn_unidade_no_escopo(d.unidade_id)
                OR public.fn_unidade_alcancavel_por_setor(d.unidade_id))
    ) THEN
        RAISE EXCEPTION 'Dispositivo inexistente ou fora do seu escopo.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT COALESCE(p_vigente_de, d.created_at, now()) INTO v_vigente_de
      FROM public.dispositivos_rep d WHERE d.id = p_dispositivo_id;

    IF v_vigente_de > now() THEN
        v_vigente_de := now();
    END IF;

    WITH candidatos AS (
        SELECT u.identificador_afd, u.registration_bruto, u.nome_no_device, u.servidor_id, u.tem_biometria
          FROM public.rep_usuarios_dispositivo u
          JOIN public.servidores s ON s.id = u.servidor_id
         WHERE u.dispositivo_id = p_dispositivo_id
           AND u.servidor_id IS NOT NULL
           AND s.status = 'Ativo'
           AND NOT EXISTS (
               SELECT 1 FROM public.rep_vinculos_servidor v
                WHERE v.dispositivo_id = p_dispositivo_id
                  AND v.servidor_id = u.servidor_id
                  AND v.vigente_ate IS NULL
           )
           AND NOT EXISTS (
               SELECT 1 FROM public.rep_vinculos_servidor v
                WHERE v.dispositivo_id = p_dispositivo_id
                  AND v.identificador_afd = u.identificador_afd
                  AND v.vigente_ate IS NULL
           )
    ),
    inseridos AS (
        INSERT INTO public.rep_vinculos_servidor (
            dispositivo_id, servidor_id, identificador_afd, matricula_device,
            nome_device, tem_biometria, vigente_de, vigente_ate, criado_por_id
        )
        SELECT p_dispositivo_id, c.servidor_id, c.identificador_afd, c.registration_bruto,
               c.nome_no_device, c.tem_biometria, v_vigente_de, NULL, auth.uid()
          FROM candidatos c
        RETURNING 1
    )
    SELECT count(*) INTO v_criados FROM inseridos;

    -- Reprocessa marcacoes orfas a partir da data de inicio do vinculo
    v_reprocesso := public.fn_reparse_afd_dispositivo(p_dispositivo_id, v_vigente_de);

    RETURN jsonb_build_object(
        'criados', v_criados,
        'vigente_de', v_vigente_de,
        'reprocesso', v_reprocesso
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_vincular_cadastros_por_cpf(uuid, timestamptz) TO authenticated, service_role;
