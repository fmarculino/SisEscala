-- ============================================================================
-- Migration: 20260817190000_fix_vincular_cadastros_por_cpf_column_names.sql
-- Descrição: Corrige nomes de colunas de rep_vinculos_servidor na funcao
--            fn_vincular_cadastros_por_cpf (matricula_device e nome_device).
-- ============================================================================

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
            dispositivo_id, servidor_id, identificador_afd, matricula_device,
            nome_device, tem_biometria, vigente_de, vigente_ate, criado_por_id
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

-- ⚠️ NAO restaurar aqui o COMMENT antigo ("casando por CPF"). Ele e' FALSO desde a
-- 20260817170000: esta funcao nao casa por CPF nenhum - ela le rep_usuarios_dispositivo.servidor_id,
-- que o snapshot ja resolveu tentando vinculo, CPF **e** PIS (fn_servidor_por_identificador_afd).
-- Como esta migration roda DEPOIS da 170000, repetir o texto antigo apagaria a correcao no catalogo
-- do banco e mandaria a proxima pessoa procurar CPF onde o relogio da SMS usa PIS.
COMMENT ON FUNCTION public.fn_vincular_cadastros_por_cpf(uuid, timestamptz) IS
    'Cria vinculos para os servidores que o snapshot do relogio JA resolveu '
    '(rep_usuarios_dispositivo.servidor_id). Apesar do nome, nao casa por CPF aqui: quem casa e '
    'fn_servidor_por_identificador_afd, na ingestao do snapshot, tentando vinculo, CPF e PIS. '
    'Nao escreve no equipamento e NAO reprocessa AFD ja ingerido - p_vigente_de decide quais '
    'batidas passam a ter dono num futuro fn_reparse_afd_dispositivo. Permitido para gestores e '
    'administradores no escopo.';

GRANT EXECUTE ON FUNCTION public.fn_vincular_cadastros_por_cpf(uuid, timestamptz) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA - OBRIGATORIA (plpgsql so falha na EXECUCAO, armadilha 1)
-- ============================================================================
-- Foi exatamente assim que o defeito passou: CREATE OR REPLACE aceitou a funcao com nome de
-- coluna inexistente, e so quebrou quando alguem clicou no botao. "Aplicou sem erro" nao prova
-- nada aqui - tem que EXECUTAR.
--
-- 1. Teste de fumaca (uuid inexistente cai no guard de escopo, entao use um dispositivo real
--    em homologacao, ou aceite a excecao de escopo como prova de que a funcao COMPILA e RODA):
--
-- SELECT public.fn_vincular_cadastros_por_cpf('<dispositivo>');
--   -- esperado: {"criados": N, "vigente_de": "..."}
--   -- REPROVA: qualquer 'column ... does not exist'
--
-- 2. Em producao, o teste de fumaca e' o proprio botao "Criar vinculos por CPF" na aba
--    Cobertura da Escala - que antes desta migration devolvia
--    'column "registration_bruto" of relation "rep_vinculos_servidor" does not exist'.
--
-- 3. O que os vinculos criados AQUI tem que ter de diferente dos que o push cria: o identificador
--    vem do SNAPSHOT (no relogio da SMS, o PIS do cadastro legado, com biometria), enquanto o push
--    grava o CPF do cadastro novo. Sao as duas pontas do mesmo relogio misturado:
--
-- SELECT v.identificador_afd, v.tem_biometria, s.nome,
--        (v.identificador_afd = lpad(regexp_replace(COALESCE(s.cpf,''),      '\D','','g'),12,'0')) AS e_cpf,
--        (v.identificador_afd = lpad(regexp_replace(COALESCE(s.pis_pasep,''),'\D','','g'),12,'0')) AS e_pis
--   FROM public.rep_vinculos_servidor v
--   JOIN public.servidores s ON s.id = v.servidor_id
--  WHERE v.dispositivo_id = '3d8547de-8dd7-4a30-b035-6b7d64fb49f7'
--    AND v.vigente_ate IS NULL
--  ORDER BY v.vigente_de DESC LIMIT 40;
--   -- esperado depois do botao: linhas com e_pis = true E tem_biometria = true (os 28 que batem
--   -- ponto hoje pelo cadastro legado). Sem elas, o dedo continua emitindo PIS sem dono.
