-- Migration: tira ass_adm do acesso a Pendencias de Cadastro / conclusao de importacao do RH
-- Data: 2026-08-12
--
-- MOTIVACAO
--   20260812020000 liberou coordenador E ass_adm, replicando o agrupamento `isCoord` que a
--   sidebar ja usava pra outras decisoes de menu. O usuario corrigiu: o pedido era coordenador
--   e diretor (admin, que ja tinha acesso) - ass_adm nao deveria ter chegado a essas duas telas.
--
--   fn_unidade_no_escopo (usada nas duas funcoes) nao filtra por papel especifico alem de
--   super_admin/admin - ela so confere se o profile tem a unidade em profile_unidades,
--   independente do papel. Um profile ass_adm com profile_unidades preenchido (pra qualquer
--   outra finalidade do app) passaria nela mesmo assim. Por isso a correcao certa e' um
--   allowlist de papel explicito nas duas funcoes, nao so trocar a policy de RLS - a RLS fecha
--   a listagem pela UI, mas a RPC continua alcancavel direto (Supabase client, SQL) se nao
--   checar papel ela mesma.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS antes de recriar, CREATE OR REPLACE nas funcoes. Seguro
-- rodar nos dois ambientes (CLAUDE.md armadilha 3).


-- ============================================================================
-- 1. RLS: so coordenador (nao mais coordenador OU ass_adm)
-- ============================================================================

DROP POLICY IF EXISTS "Coordenadores leem importacao_rh_pendentes da propria unidade" ON public.importacao_rh_pendentes;
CREATE POLICY "Coordenadores leem importacao_rh_pendentes da propria unidade" ON public.importacao_rh_pendentes
    FOR SELECT TO authenticated
    USING (
        (SELECT get_my_role()) = 'coordenador'::user_role
        AND (
            EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todas_unidades = true)
            OR unidade_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu WHERE pu.profile_id = auth.uid())
        )
    );


-- ============================================================================
-- 2. fn_promover_pendencia_rh: allowlist de papel explicito (super_admin/admin/coordenador)
-- ============================================================================
-- Corpo identico a 20260812020000, so troca a checagem de escopo do topo. Copiado por
-- completo porque CREATE OR REPLACE troca a funcao inteira (CLAUDE.md armadilha 1).

CREATE OR REPLACE FUNCTION public.fn_promover_pendencia_rh(
    p_pendencia_id                uuid,
    p_unidade_id                  uuid,
    p_setor_id                    uuid,
    p_cargo                       text,
    p_confirma_vinculo_adicional  boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_pend          public.importacao_rh_pendentes%ROWTYPE;
    v_existente     record;
    v_dados         jsonb;
    v_novo_id       uuid;
    v_vinculo_multiplo boolean := false;
    v_vinculo_enum  public.vinculo_type;
BEGIN
    IF (SELECT get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role, 'coordenador'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores, diretores e coordenadores podem concluir cadastros pendentes de importacao do RH.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT public.fn_unidade_no_escopo(p_unidade_id) THEN
        RAISE EXCEPTION 'Voce nao tem acesso a esta unidade.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_pend
      FROM public.importacao_rh_pendentes
     WHERE id = p_pendencia_id AND promovido_em IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pendencia nao encontrada, ou ja foi promovida.';
    END IF;

    IF p_unidade_id IS NULL OR p_setor_id IS NULL THEN
        RAISE EXCEPTION 'Unidade e setor sao obrigatorios para concluir o cadastro.';
    END IF;

    IF p_cargo IS NULL OR btrim(p_cargo) = '' THEN
        RAISE EXCEPTION 'Cargo e obrigatorio para concluir o cadastro.';
    END IF;

    -- Mesmo gate de vinculo multiplo da action (20260810140000) - a pendencia pode ter sido
    -- marcada vinculo_adicional_de_cpf no momento da carga, mas confere de novo aqui porque outra
    -- pendencia do mesmo CPF pode ter sido promovida entre a carga e agora.
    SELECT * INTO v_existente FROM public.fn_cpf_ja_cadastrado(v_pend.cpf_normalizado) LIMIT 1;
    IF FOUND THEN
        IF NOT p_confirma_vinculo_adicional THEN
            RAISE EXCEPTION 'CPF ja cadastrado como % (matricula %). Confirme se e vinculo adicional da mesma pessoa.',
                v_existente.nome, v_existente.matricula;
        END IF;
        v_vinculo_multiplo := true;
    END IF;

    v_dados := COALESCE(v_pend.dados_complementares, '{}'::jsonb);

    -- Mapeia a classificacao (text) para o ENUM public.vinculo_type de servidores.vinculo
    CASE v_pend.classificacao
        WHEN 'Efetiva' THEN v_vinculo_enum := 'Efetiva'::public.vinculo_type;
        WHEN 'Efetivo' THEN v_vinculo_enum := 'Efetiva'::public.vinculo_type;
        WHEN 'Contratada' THEN v_vinculo_enum := 'Contratada'::public.vinculo_type;
        WHEN 'Contratado' THEN v_vinculo_enum := 'Contratada'::public.vinculo_type;
        WHEN 'Concursada' THEN v_vinculo_enum := 'Concursada'::public.vinculo_type;
        WHEN 'Concursado' THEN v_vinculo_enum := 'Concursada'::public.vinculo_type;
        WHEN 'Comissionada' THEN v_vinculo_enum := 'Comissionada'::public.vinculo_type;
        WHEN 'Comissionado' THEN v_vinculo_enum := 'Comissionada'::public.vinculo_type;
        WHEN 'Estagiária' THEN v_vinculo_enum := 'Estagiária'::public.vinculo_type;
        WHEN 'Estagiaria' THEN v_vinculo_enum := 'Estagiária'::public.vinculo_type;
        WHEN 'Estagiário' THEN v_vinculo_enum := 'Estagiária'::public.vinculo_type;
        WHEN 'Estagiario' THEN v_vinculo_enum := 'Estagiária'::public.vinculo_type;
        ELSE v_vinculo_enum := 'Contratada'::public.vinculo_type;
    END CASE;

    INSERT INTO public.servidores (
        nome, matricula, cpf, cargo, vinculo, unidade_id, setor_id, status,
        financiamento_bloco_id, vinculo_multiplo_confirmado,
        data_nascimento, sexo, nacionalidade, naturalidade, nome_mae, nome_pai,
        escolaridade, estado_civil, nome_conjuge,
        endereco_logradouro, endereco_numero, bairro, cep, municipio_residencia,
        telefone_residencial, rg_numero, rg_orgao_emissor, rg_data_emissao, pis_pasep,
        registro_profissional, registro_profissional_orgao, data_admissao_pmm, observacao
    ) VALUES (
        v_pend.nome, v_pend.matricula, v_pend.cpf_normalizado, p_cargo,
        v_vinculo_enum, p_unidade_id, p_setor_id, 'Ativo',
        v_pend.financiamento_bloco_id, v_vinculo_multiplo,
        NULLIF(v_dados->>'data_nascimento','')::date,
        NULLIF(v_dados->>'sexo',''),
        NULLIF(v_dados->>'nacionalidade',''),
        NULLIF(v_dados->>'naturalidade',''),
        NULLIF(v_dados->>'nome_mae',''),
        NULLIF(v_dados->>'nome_pai',''),
        NULLIF(v_dados->>'escolaridade',''),
        NULLIF(v_dados->>'estado_civil',''),
        NULLIF(v_dados->>'nome_conjuge',''),
        NULLIF(v_dados->>'endereco_logradouro',''),
        NULLIF(v_dados->>'endereco_numero',''),
        NULLIF(v_dados->>'bairro',''),
        NULLIF(v_dados->>'cep',''),
        NULLIF(v_dados->>'municipio_residencia',''),
        NULLIF(v_dados->>'telefone_residencial',''),
        NULLIF(v_dados->>'rg_numero',''),
        NULLIF(v_dados->>'rg_orgao_emissor',''),
        NULLIF(v_dados->>'rg_data_emissao','')::date,
        NULLIF(v_dados->>'pis_pasep',''),
        NULLIF(v_dados->>'registro_profissional',''),
        NULLIF(v_dados->>'registro_profissional_orgao',''),
        NULLIF(v_dados->>'data_admissao_pmm','')::date,
        NULLIF(v_dados->>'observacao','')
    )
    RETURNING id INTO v_novo_id;

    UPDATE public.importacao_rh_pendentes
       SET promovido_em = now(), promovido_servidor_id = v_novo_id
     WHERE id = p_pendencia_id;

    RETURN v_novo_id;
END;
$fn$;

COMMENT ON FUNCTION public.fn_promover_pendencia_rh(uuid, uuid, uuid, text, boolean) IS
    'Grava em servidores o vinculo pendente de importacao do RH, depois de unidade/setor/cargo '
    'confirmados. Papel restrito a super_admin/admin/coordenador (ass_adm NAO tem acesso, '
    'decisao de 12/08/2026); coordenador so promove pra dentro da propria unidade '
    '(fn_unidade_no_escopo).';

GRANT EXECUTE ON FUNCTION public.fn_promover_pendencia_rh(uuid, uuid, uuid, text, boolean) TO authenticated, service_role;


-- ============================================================================
-- 3. fn_atualizar_cadastro_via_pendencia_rh: mesmo allowlist de papel
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_atualizar_cadastro_via_pendencia_rh(
    p_pendencia_id uuid,
    p_servidor_id  uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_pend      public.importacao_rh_pendentes%ROWTYPE;
    v_existente record;
    v_alvo      record;
    v_dados     jsonb;
BEGIN
    IF (SELECT get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role, 'coordenador'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores, diretores e coordenadores podem concluir cadastros pendentes de importacao do RH.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_pend
      FROM public.importacao_rh_pendentes
     WHERE id = p_pendencia_id AND promovido_em IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pendencia nao encontrada, ou ja foi promovida.';
    END IF;

    -- Redriva o conflito - p_servidor_id tem que ser exatamente quem fn_cpf_ja_cadastrado acha
    -- pra este CPF agora, nao um id qualquer que o cliente mandou.
    SELECT * INTO v_existente FROM public.fn_cpf_ja_cadastrado(v_pend.cpf_normalizado) LIMIT 1;
    IF NOT FOUND OR v_existente.servidor_id IS DISTINCT FROM p_servidor_id THEN
        RAISE EXCEPTION 'Este CPF nao corresponde mais ao cadastro informado - atualize a pagina e tente de novo.';
    END IF;

    SELECT id, unidade_id INTO v_alvo FROM public.servidores WHERE id = p_servidor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cadastro existente nao encontrado.';
    END IF;

    IF NOT public.fn_unidade_no_escopo(v_alvo.unidade_id) THEN
        RAISE EXCEPTION 'Voce nao tem acesso a unidade deste cadastro.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_dados := COALESCE(v_pend.dados_complementares, '{}'::jsonb);

    UPDATE public.servidores SET
        financiamento_bloco_id       = COALESCE(financiamento_bloco_id, v_pend.financiamento_bloco_id),
        data_nascimento              = COALESCE(data_nascimento, NULLIF(v_dados->>'data_nascimento','')::date),
        sexo                         = COALESCE(sexo, NULLIF(v_dados->>'sexo','')),
        nacionalidade                = COALESCE(nacionalidade, NULLIF(v_dados->>'nacionalidade','')),
        naturalidade                 = COALESCE(naturalidade, NULLIF(v_dados->>'naturalidade','')),
        nome_mae                     = COALESCE(nome_mae, NULLIF(v_dados->>'nome_mae','')),
        nome_pai                     = COALESCE(nome_pai, NULLIF(v_dados->>'nome_pai','')),
        escolaridade                 = COALESCE(escolaridade, NULLIF(v_dados->>'escolaridade','')),
        estado_civil                 = COALESCE(estado_civil, NULLIF(v_dados->>'estado_civil','')),
        nome_conjuge                 = COALESCE(nome_conjuge, NULLIF(v_dados->>'nome_conjuge','')),
        endereco_logradouro          = COALESCE(endereco_logradouro, NULLIF(v_dados->>'endereco_logradouro','')),
        endereco_numero              = COALESCE(endereco_numero, NULLIF(v_dados->>'endereco_numero','')),
        bairro                       = COALESCE(bairro, NULLIF(v_dados->>'bairro','')),
        cep                          = COALESCE(cep, NULLIF(v_dados->>'cep','')),
        municipio_residencia         = COALESCE(municipio_residencia, NULLIF(v_dados->>'municipio_residencia','')),
        telefone_residencial         = COALESCE(telefone_residencial, NULLIF(v_dados->>'telefone_residencial','')),
        rg_numero                    = COALESCE(rg_numero, NULLIF(v_dados->>'rg_numero','')),
        rg_orgao_emissor             = COALESCE(rg_orgao_emissor, NULLIF(v_dados->>'rg_orgao_emissor','')),
        rg_data_emissao              = COALESCE(rg_data_emissao, NULLIF(v_dados->>'rg_data_emissao','')::date),
        pis_pasep                    = COALESCE(pis_pasep, NULLIF(v_dados->>'pis_pasep','')),
        registro_profissional        = COALESCE(registro_profissional, NULLIF(v_dados->>'registro_profissional','')),
        registro_profissional_orgao  = COALESCE(registro_profissional_orgao, NULLIF(v_dados->>'registro_profissional_orgao','')),
        data_admissao_pmm            = COALESCE(data_admissao_pmm, NULLIF(v_dados->>'data_admissao_pmm','')::date),
        observacao                   = COALESCE(observacao, NULLIF(v_dados->>'observacao',''))
    WHERE id = p_servidor_id;

    -- matricula/unidade_id/setor_id/status deliberadamente de fora do UPDATE acima - mudar
    -- lotacao continua exigindo o fluxo de solicitacao (v1.43.0). Cadastro existente que ja
    -- tinha unidade diferente da do import fica como estava; a UI mostra isso como aviso.

    UPDATE public.importacao_rh_pendentes
       SET promovido_em = now(), promovido_servidor_id = p_servidor_id
     WHERE id = p_pendencia_id;

    RETURN p_servidor_id;
END;
$fn$;

COMMENT ON FUNCTION public.fn_atualizar_cadastro_via_pendencia_rh(uuid, uuid) IS
    'Completa um servidor ja cadastrado com os dados complementares de uma pendencia de '
    'importacao do RH - so preenche campo vazio (COALESCE), nunca sobrescreve. Papel restrito a '
    'super_admin/admin/coordenador (ass_adm NAO tem acesso, decisao de 12/08/2026). Nunca toca '
    'matricula/unidade_id/setor_id/status: mudanca de lotacao continua exigindo o fluxo de '
    'solicitacao com aprovacao do super_admin (v1.43.0).';

GRANT EXECUTE ON FUNCTION public.fn_atualizar_cadastro_via_pendencia_rh(uuid, uuid) TO authenticated;


-- CONFERENCIA APOS APLICAR
--
--   1) Policy so cita coordenador agora:
--
--   SELECT policyname, qual FROM pg_policies
--    WHERE tablename = 'importacao_rh_pendentes'
--      AND policyname = 'Coordenadores leem importacao_rh_pendentes da propria unidade';
--   -- esperado: qual nao menciona 'ass_adm'
--
--   2) Logado como ass_adm (ou testando via RPC direto com esse papel), as duas funcoes
--      recusam com "Apenas administradores, diretores e coordenadores...":
--
--   SELECT public.fn_promover_pendencia_rh('<pendencia_id>', '<unidade_id>', '<setor_id>', 'Cargo X');
--   SELECT public.fn_atualizar_cadastro_via_pendencia_rh('<pendencia_id>', '<servidor_id>');
