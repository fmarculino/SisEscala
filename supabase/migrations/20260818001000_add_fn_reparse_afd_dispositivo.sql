-- ============================================================================
-- Migration: Reprocessa batidas orfas de REP para vincular aos servidores resolvidos
-- Data: 2026-08-18
-- ============================================================================

-- 1. Permite atribuir servidor a marcacao orfa durante reprocessamento autorizado
CREATE OR REPLACE FUNCTION public.fn_bloquear_alteracao_marcacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    -- Permite associar servidor_id a uma batida orfa durante sessao de reparse declarada
    IF TG_OP = 'UPDATE'
       AND OLD.servidor_id IS NULL
       AND NEW.servidor_id IS NOT NULL
       AND NEW.ocorrido_em = OLD.ocorrido_em
       AND NEW.nsr IS NOT DISTINCT FROM OLD.nsr
       AND NEW.dispositivo_id IS NOT DISTINCT FROM OLD.dispositivo_id
       AND COALESCE(current_setting('sisescala.reparse_afd', true), 'off') = 'on' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'Marcacao de ponto e imutavel (Portaria 671/2021). Operacao rejeitada: %. '
        'Para desconsiderar, reclassificar ou reatribuir uma marcacao, registre um tratamento '
        'em marcacoes_tratamentos - a marcacao original permanece para auditoria.',
        TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$fn$;

-- 2. Funcao de reprocessamento de marcacoes orfas
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
    v_servidor_id uuid;
    v_unidade_id  uuid;
    v_setor_id    uuid;
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
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'sucesso', true,
        'marcacoes_vinculadas', v_atualizados
    );
END;
$fn$;

COMMENT ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) IS
    'Reprocessa marcacoes orfas de REP a partir de p_desde (default: inicio do mes atual) usando a '
    'fonte unica fn_servidor_por_identificador_afd (suporta vinculo, CPF e PIS).';

REVOKE ALL ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) TO authenticated, service_role;

-- 3. Integra ao fn_vincular_cadastros_por_cpf
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
