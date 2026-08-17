-- ============================================================================
-- Migration: 20260817100000_allow_coordinators_enfileirar_cadastros_rep.sql
-- Descrição: Permite que coordenadores e gestores no escopo enfileirem cadastros
--            para o relógio REP e vinculem cadastros por CPF.
-- ============================================================================

-- 1. fn_enfileirar_cadastros_rep (por lotação)
CREATE OR REPLACE FUNCTION public.fn_enfileirar_cadastros_rep(p_dispositivo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_role          public.user_role;
    v_unidade_id    uuid;
    v_restrito      boolean;
    v_enfileirados  integer := 0;
    v_sem_cpf       integer := 0;
    v_ja_vinculados integer := 0;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        v_role := (SELECT public.get_my_role());
        IF v_role IS NULL OR v_role IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
            RAISE EXCEPTION 'Sem permissao para sincronizar cadastros com o rele.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    SELECT unidade_id INTO v_unidade_id
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    IF auth.uid() IS NOT NULL THEN
        IF NOT (public.fn_unidade_no_escopo(v_unidade_id) OR public.fn_unidade_alcancavel_por_setor(v_unidade_id)) THEN
            RAISE EXCEPTION 'Dispositivo fora do seu escopo de atuacao.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- 0 linhas em dispositivos_rep_setores = "toda a unidade" (mesma semantica de
    -- dispositivos_rep.setor_id IS NULL); >=1 linha = so os setores listados.
    SELECT EXISTS (
        SELECT 1 FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id
    ) INTO v_restrito;

    WITH candidatos AS (
        SELECT s.id, s.cpf
          FROM public.servidores s
         WHERE s.status = 'Ativo'
           AND s.unidade_id = v_unidade_id
           AND (NOT v_restrito OR EXISTS (
                 SELECT 1 FROM public.dispositivos_rep_setores ds
                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = s.setor_id))
    ),
    sem_cpf AS (
        SELECT count(*) AS n FROM candidatos
         WHERE regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = ''
    ),
    ja_vinculados AS (
        SELECT count(*) AS n
          FROM candidatos c
          JOIN public.rep_vinculos_servidor v
            ON v.servidor_id = c.id AND v.dispositivo_id = p_dispositivo_id AND v.vigente_ate IS NULL
    ),
    inseridos AS (
        INSERT INTO public.rep_cadastros_fila (dispositivo_id, servidor_id, criado_por_id)
        SELECT p_dispositivo_id, c.id, auth.uid()
          FROM candidatos c
         WHERE regexp_replace(COALESCE(c.cpf, ''), '\D', '', 'g') <> ''
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_vinculos_servidor v
                  WHERE v.servidor_id = c.id AND v.dispositivo_id = p_dispositivo_id AND v.vigente_ate IS NULL)
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_cadastros_fila f
                  WHERE f.servidor_id = c.id AND f.dispositivo_id = p_dispositivo_id AND f.status = 'pendente')
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM inseridos), (SELECT n FROM sem_cpf), (SELECT n FROM ja_vinculados)
      INTO v_enfileirados, v_sem_cpf, v_ja_vinculados;

    RETURN jsonb_build_object(
        'enfileirados', v_enfileirados,
        'sem_cpf', v_sem_cpf,
        'ja_vinculados', v_ja_vinculados
    );
END;
$fn$;

COMMENT ON FUNCTION public.fn_enfileirar_cadastros_rep(uuid) IS
    'Enfileira para o rele servidores ativos lotados na unidade/setor do dispositivo sem vinculo vigente. '
    'Permitido para gestores e administradores no escopo da unidade.';

GRANT EXECUTE ON FUNCTION public.fn_enfileirar_cadastros_rep(uuid) TO authenticated, service_role;


-- 2. fn_enfileirar_cadastros_por_escala (por escala do mês)
CREATE OR REPLACE FUNCTION public.fn_enfileirar_cadastros_por_escala(
    p_dispositivo_id uuid,
    p_mes            integer DEFAULT NULL,
    p_ano            integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_role         public.user_role;
    v_enfileirados integer := 0;
    v_ja_na_fila   integer := 0;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        v_role := (SELECT public.get_my_role());
        IF v_role IS NULL OR v_role IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
            RAISE EXCEPTION 'Sem permissao para enfileirar cadastros para o rele.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- A checagem de escopo do dispositivo vem de graca: fn_cobertura_ponto_dispositivo levanta
    -- excecao para dispositivo fora do escopo do caller antes de devolver qualquer linha.
    WITH alvo AS (
        SELECT c.servidor_id, c.fila_status
          FROM public.fn_cobertura_ponto_dispositivo(p_dispositivo_id, p_mes, p_ano) c
         WHERE c.situacao = 'fora_do_relogio'
    ), inseridos AS (
        INSERT INTO public.rep_cadastros_fila (dispositivo_id, servidor_id, criado_por_id)
        SELECT p_dispositivo_id, a.servidor_id, auth.uid()
          FROM alvo a
         WHERE NOT EXISTS (
             SELECT 1 FROM public.rep_cadastros_fila f
              WHERE f.dispositivo_id = p_dispositivo_id
                AND f.servidor_id = a.servidor_id
                AND f.status = 'pendente'
         )
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM inseridos),
           (SELECT count(*) FROM alvo WHERE fila_status = 'pendente')
      INTO v_enfileirados, v_ja_na_fila;

    RETURN jsonb_build_object(
        'enfileirados', v_enfileirados,
        'ja_na_fila', v_ja_na_fila
    );
END;
$fn$;

COMMENT ON FUNCTION public.fn_enfileirar_cadastros_por_escala(uuid, integer, integer) IS
    'Enfileira para o rele quem esta ESCALADO na unidade do dispositivo e nao esta cadastrado la, '
    'inclusive quem esta lotado em outra unidade/setor. Permitido para gestores e administradores no escopo.';

GRANT EXECUTE ON FUNCTION public.fn_enfileirar_cadastros_por_escala(uuid, integer, integer) TO authenticated, service_role;


-- 3. fn_vincular_cadastros_por_cpf (criação de vínculo SisEscala para usuários já existentes no relógio)
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
    v_role       public.user_role;
    v_vigente_de timestamptz;
    v_criados    integer := 0;
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
            dispositivo_id, servidor_id, identificador_afd, registration_bruto,
            nome_no_device, tem_biometria, vigente_de, vigente_ate, criado_por_id
        )
        SELECT p_dispositivo_id, c.servidor_id, c.identificador_afd, c.registration_bruto,
               c.nome_no_device, c.tem_biometria, v_vigente_de, NULL, auth.uid()
          FROM candidatos c
        RETURNING 1
    )
    SELECT count(*) INTO v_criados FROM inseridos;

    RETURN jsonb_build_object(
        'criados', v_criados,
        'vigente_de', v_vigente_de
    );
END;
$fn$;

COMMENT ON FUNCTION public.fn_vincular_cadastros_por_cpf(uuid, timestamptz) IS
    'Cria vinculos no SisEscala casando por CPF os servidores com usuario ja existente no relogio. '
    'Permitido para gestores e administradores no escopo.';

GRANT EXECUTE ON FUNCTION public.fn_vincular_cadastros_por_cpf(uuid, timestamptz) TO authenticated, service_role;


-- 4. RLS na rep_cadastros_fila
DROP POLICY IF EXISTS "Gestao de fila de cadastros REP por admin" ON public.rep_cadastros_fila;
DROP POLICY IF EXISTS "Gestao de fila de cadastros REP por gestor e admin" ON public.rep_cadastros_fila;
CREATE POLICY "Gestao de fila de cadastros REP por gestor e admin" ON public.rep_cadastros_fila
    FOR ALL TO authenticated
    USING (
        (SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role)
        OR EXISTS (
            SELECT 1 FROM public.dispositivos_rep d
             WHERE d.id = rep_cadastros_fila.dispositivo_id
               AND (public.fn_unidade_no_escopo(d.unidade_id) OR public.fn_unidade_alcancavel_por_setor(d.unidade_id))
        )
    )
    WITH CHECK (
        (SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role)
        OR EXISTS (
            SELECT 1 FROM public.dispositivos_rep d
             WHERE d.id = rep_cadastros_fila.dispositivo_id
               AND (public.fn_unidade_no_escopo(d.unidade_id) OR public.fn_unidade_alcancavel_por_setor(d.unidade_id))
        )
    );
