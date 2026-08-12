-- Migration: RH Geral e RH da Unidade ganham acesso de fato as pendencias de importacao do RH
-- e as solicitacoes de transferencia
-- Data: 2026-08-12
--
-- MOTIVACAO
--   20260812090000 (v1.55.0) corrigiu o GATE da tela /servidores/pendencias (o if de pagina) pra
--   'rh', mas nao chegou a olhar RLS nem RPC - o mesmo padrao "guard de papel escrito antes do
--   papel existir" que ja apareceu 3 vezes nesta sessao (RLS de escala/folha, guard de
--   sobreaviso, gate de pagina) tambem existe aqui, em mais duas camadas:
--
--   1. importacao_rh_pendentes so tem duas policies de SELECT: "para administradores"
--      (super_admin/admin, 20260810160000) e "Coordenadores leem... da propria unidade"
--      (so' 'coordenador', 20260812050000). 'rh' passar no gate de pagina e cair na consulta sem
--      escopo (buscarPendentesRh) so' devolveria RLS vazio - a tela abriria "funcionando" e
--      mostrando zero pendencias, o sintoma mais dificil de flagrar porque nao e' erro nenhum.
--   2. fn_promover_pendencia_rh, fn_atualizar_cadastro_via_pendencia_rh e
--      fn_buscar_pendencia_rh_por_termo tem `IF get_my_role() NOT IN (...) THEN RAISE EXCEPTION`
--      restrito a super_admin/admin/coordenador - um 'rh' clicando em "Concluir cadastro"
--      receberia erro explicito de permissao insuficiente.
--   3. solicitacoes_transferencia_servidor (a secao "Solicitacoes de Transferencia" da mesma
--      tela) tem a mesma lacuna nas policies de SELECT/INSERT.
--
--   Corrigido junto com a correcao de escopo do menu (RH da Unidade continua vendo esta tela,
--   ver sidebar.tsx) porque sem isto a tela voltaria a "abrir" pros dois papeis sem mostrar nada
--   de util - o mesmo tipo de falha silenciosa que a auditoria de 08/08/2026 (logs_sobreaviso)
--   ja documentou herdada de tentar so' consertar UM ponto da cadeia.
--
--   'rh' (RH Geral) entra com o MESMO nivel de admin nessas 4 policies/funcoes (array
--   ['admin','coordenador'] vira ['admin','coordenador','rh']) - RH Geral tipicamente tem
--   acesso_todas_unidades=true no perfil, entao o escopo por unidade dessas policies (que ja
--   aceita esse flag como bypass) se comporta como irrestrito na pratica, sem precisar de um
--   bypass incondicional a mais escrito a mao.
--   'rh_unidade' entra pelo MESMO escopo por unidade que coordenador ja usa
--   (profile_unidades/profile_setores via fn_unidade_alcancavel_por_setor, sem exigir
--   acesso_todos_setores - mesma decisao ja tomada em 20260812070000 pras outras tabelas).
--
-- IDEMPOTENTE: CREATE OR REPLACE / DROP POLICY IF EXISTS.


-- ============================================================================
-- 1. importacao_rh_pendentes - policy de administradores ganha 'rh'
-- ============================================================================

DROP POLICY IF EXISTS "Permitir leitura de importacao_rh_pendentes para administradores" ON public.importacao_rh_pendentes;
CREATE POLICY "Permitir leitura de importacao_rh_pendentes para administradores" ON public.importacao_rh_pendentes
    FOR SELECT TO authenticated
    USING (((SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role, 'rh'::user_role])));


-- ============================================================================
-- 2. importacao_rh_pendentes - policy de coordenador ganha rh_unidade (mesmo escopo)
-- ============================================================================
-- Corpo identico a 20260812050000, so troca o papel unico por um array de dois papeis - o
-- restante da condicao (acesso_todas_unidades, profile_unidades, fn_unidade_alcancavel_por_setor)
-- e' o mesmo escopo, sem diferenca entre os dois papeis.

DROP POLICY IF EXISTS "Coordenadores leem importacao_rh_pendentes da propria unidade" ON public.importacao_rh_pendentes;
CREATE POLICY "Coordenadores leem importacao_rh_pendentes da propria unidade" ON public.importacao_rh_pendentes
    FOR SELECT TO authenticated
    USING (
        (SELECT get_my_role()) = ANY (ARRAY['coordenador'::user_role, 'rh_unidade'::user_role])
        AND (
            EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todas_unidades = true)
            OR unidade_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu WHERE pu.profile_id = auth.uid())
            OR public.fn_unidade_alcancavel_por_setor(unidade_id)
        )
    );


-- ============================================================================
-- 3. fn_promover_pendencia_rh - papel permitido ganha rh/rh_unidade
-- ============================================================================
-- Corpo identico a 20260812050000, so troca a checagem de papel do topo (CREATE OR REPLACE troca
-- a funcao inteira, CLAUDE.md armadilha 1).

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
    IF (SELECT get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role, 'coordenador'::public.user_role, 'rh'::public.user_role, 'rh_unidade'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores, diretores, coordenadores e RH podem concluir cadastros pendentes de importacao do RH.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT (public.fn_unidade_no_escopo(p_unidade_id) OR public.fn_unidade_alcancavel_por_setor(p_unidade_id)) THEN
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
    'confirmados. Papel restrito a super_admin/admin/coordenador/rh/rh_unidade (ass_adm NAO tem '
    'acesso). Escopo de unidade aceita profile_unidades OU um setor da unidade em profile_setores '
    '(fn_unidade_no_escopo OR fn_unidade_alcancavel_por_setor).';

GRANT EXECUTE ON FUNCTION public.fn_promover_pendencia_rh(uuid, uuid, uuid, text, boolean) TO authenticated, service_role;


-- ============================================================================
-- 4. fn_atualizar_cadastro_via_pendencia_rh - mesmo ajuste de papel
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
    IF (SELECT get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role, 'coordenador'::public.user_role, 'rh'::public.user_role, 'rh_unidade'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores, diretores, coordenadores e RH podem concluir cadastros pendentes de importacao do RH.'
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

    IF NOT (public.fn_unidade_no_escopo(v_alvo.unidade_id) OR public.fn_unidade_alcancavel_por_setor(v_alvo.unidade_id)) THEN
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
    'super_admin/admin/coordenador/rh/rh_unidade. Escopo de unidade aceita profile_unidades OU '
    'um setor da unidade em profile_setores. Nunca toca matricula/unidade_id/setor_id/status: '
    'mudanca de lotacao continua exigindo o fluxo de solicitacao com aprovacao do super_admin '
    '(v1.43.0).';

GRANT EXECUTE ON FUNCTION public.fn_atualizar_cadastro_via_pendencia_rh(uuid, uuid) TO authenticated;


-- ============================================================================
-- 5. fn_buscar_pendencia_rh_por_termo - mesmo ajuste de papel
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_buscar_pendencia_rh_por_termo(p_termo text)
RETURNS TABLE (
    id                        uuid,
    nome                      text,
    matricula                 text,
    classificacao             text,
    cargo_sugerido            text,
    unidade_id                uuid,
    unidade_nome              text,
    departamento_origem       text,
    vinculo_adicional_de_cpf  boolean,
    criado_em                 timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_termo_digitos text;
BEGIN
    IF (SELECT get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role, 'coordenador'::public.user_role, 'rh'::public.user_role, 'rh_unidade'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores, diretores, coordenadores e RH podem buscar pendencias de importacao do RH.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_termo IS NULL OR length(btrim(p_termo)) < 3 THEN
        RAISE EXCEPTION 'Digite ao menos 3 caracteres para buscar.';
    END IF;

    v_termo_digitos := regexp_replace(p_termo, '\D', '', 'g');

    RETURN QUERY
    SELECT ip.id, ip.nome, ip.matricula, ip.classificacao, ip.cargo_sugerido,
           ip.unidade_id, u.nome, ip.departamento_origem, ip.vinculo_adicional_de_cpf, ip.criado_em
      FROM public.importacao_rh_pendentes ip
      LEFT JOIN public.unidades u ON u.id = ip.unidade_id
     WHERE ip.promovido_em IS NULL
       AND (
             ip.nome ILIKE '%' || btrim(p_termo) || '%'
          OR ip.matricula ILIKE '%' || btrim(p_termo) || '%'
          OR (length(v_termo_digitos) >= 6 AND ip.cpf_normalizado LIKE '%' || v_termo_digitos || '%')
       )
     ORDER BY ip.nome
     LIMIT 20;
END;
$fn$;

COMMENT ON FUNCTION public.fn_buscar_pendencia_rh_por_termo(text) IS
    'Busca cross-unidade em importacao_rh_pendentes por nome/matricula/CPF, para coordenador/RH '
    'achar o proprio pessoal mesmo quando a importacao nao resolveu a unidade (unidade_id NULL - '
    '38% dos casos, 12/08/2026). SECURITY DEFINER de proposito (mesmo padrao de '
    'get_external_servers_for_scale/fn_cpf_ja_cadastrado) - bounded por termo, nunca lista tudo.';

GRANT EXECUTE ON FUNCTION public.fn_buscar_pendencia_rh_por_termo(text) TO authenticated;


-- ============================================================================
-- 6. solicitacoes_transferencia_servidor - SELECT/INSERT ganham rh/rh_unidade
-- ============================================================================
-- Corpo identico a 20260811110000, so amplia o array de papeis do braco "admin/coordenador" -
-- mesmo escopo por unidade/setor, sem diferenca de tratamento entre os papeis dentro do array.
-- UPDATE (aprovar/rejeitar) continua super_admin apenas - nao alterado, e o ponto inteiro da
-- feature (v1.43.0, decisao pos-incidente THIELE/KETTELE).

DROP POLICY IF EXISTS "Leitura de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Leitura de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor
    FOR SELECT TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role, 'rh'::user_role, 'rh_unidade'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.servidores s
             WHERE s.id = solicitacoes_transferencia_servidor.servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );

DROP POLICY IF EXISTS "Insercao de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Insercao de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor
    FOR INSERT TO authenticated
    WITH CHECK (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role, 'rh'::user_role, 'rh_unidade'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.servidores s
             WHERE s.id = servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );


-- CONFERENCIA APOS APLICAR
--
--   1) Logado como um usuario 'rh': importacao_rh_pendentes deixa de vir vazio.
--
--   SELECT count(*) FROM public.importacao_rh_pendentes WHERE promovido_em IS NULL;
--
--   2) Logado como 'rh_unidade' vinculado a uma unidade com pendencia: linhas aparecem, e so
--      dessa unidade.
--
--   3) fn_promover_pendencia_rh/fn_atualizar_cadastro_via_pendencia_rh/
--      fn_buscar_pendencia_rh_por_termo nao devolvem mais "insufficient_privilege" pra 'rh'/
--      'rh_unidade'.
--
--   4) solicitacoes_transferencia_servidor: 'rh' ve as solicitacoes da(s) unidade(s) dele (ou
--      todas, se acesso_todas_unidades=true); 'rh_unidade' ve so as da propria unidade.
