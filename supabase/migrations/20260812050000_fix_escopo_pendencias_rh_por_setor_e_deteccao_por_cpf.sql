-- Migration: escopo de pendencias de RH por setor (nao so unidade) + deteccao por CPF no
-- cadastro/edicao de servidor
-- Data: 2026-08-12
--
-- MOTIVACAO 1 - BUG DE ESCOPO
--   Coordenador do piloto da TI (perfil so tem profile_setores, ZERO linhas em profile_unidades
--   - confirmado via consulta direta em producao) via a tela de Pendencias de Cadastro sempre
--   com "0", mesmo a SMS (unidade da TI) tendo pendencias de importacao do RH.
--
--   Causa: a policy de RLS de importacao_rh_pendentes (20260812030000) e o parametro de escopo
--   de fn_promover_pendencia_rh/fn_atualizar_cadastro_via_pendencia_rh (fn_unidade_no_escopo)
--   so' verificam profile_unidades. Um coordenador cujo acesso vem inteiramente de
--   profile_setores (setor vinculado, sem a unidade-pai explicitamente vinculada tambem) nunca
--   bate em "unidade_id IN profile_unidades" - fica sem ver NADA, mesmo tendo acesso legitimo a
--   unidade via o proprio setor. E o mesmo padrao que a policy de `servidores` (20260618080000)
--   ja resolve certo (soma unidade-a-partir-de-profile_unidades COM setor-a-partir-de-
--   profile_setores); fn_unidade_no_escopo nunca ganhou o lado do setor.
--
--   Correcao aqui e' cirurgica: nova funcao fn_unidade_alcancavel_por_setor, usada SOMENTE nos
--   dois lugares desta feature (RLS de importacao_rh_pendentes e as duas RPCs de promover/
--   atualizar). fn_unidade_no_escopo em si NAO e' alterada - ela e' usada por bastante coisa do
--   modulo REP (marcacoes_ponto, dispositivos_rep) que nao foi auditado nesta sessao, e mudar o
--   comportamento dela e' risco maior do que o necessario pra resolver isto. Fica registrado
--   como lacuna conhecida no CLAUDE.md.
--
-- MOTIVACAO 2 - BUSCA CROSS-UNIDADE
--   1.284 das 3.361 pendencias (38%) tem unidade_id NULO - o RH nao conseguiu casar o
--   departamento de origem com nenhuma unidade do SisEscala na importacao original (v1.42.0), e
--   nada persiste uma correcao disso depois. Nenhum coordenador consegue VER essas linhas (nem
--   com o fix acima), porque "unidade_id IN (...)" nunca casa com NULL. So' admin/super_admin
--   alcancam. Mas e' o coordenador quem reconhece o proprio pessoal pelo nome - ele e' quem
--   deveria poder resolver a ambiguidade, nao so' o RH central.
--
--   fn_buscar_pendencia_rh_por_termo: busca limitada (>= 3 caracteres, no maximo 20 resultados),
--   SECURITY DEFINER, bypassa RLS de proposito - mesmo padrao ja usado em
--   get_external_servers_for_scale (v1.2.4) e fn_cpf_ja_cadastrado (v1.28.0) para achar uma
--   pessoa especifica fora do proprio escopo. Bounded por termo digitado, nao e' um dump da
--   tabela inteira - o coordenador so' ve quem ele especificamente procurou.
--
-- MOTIVACAO 3 - DETECCAO AUTOMATICA POR CPF NO CADASTRO/EDICAO DE SERVIDOR
--   Pedido do usuario: ao criar ou editar um servidor, o sistema deve consultar sozinho se ha
--   pendencia de importacao do RH pra aquele CPF, e oferecer puxar os dados complementares -
--   sem que ninguem precise saber que a tela de Pendencias existe. fn_pendencia_rh_por_cpf faz
--   essa checagem pontual (um CPF por vez, nao lista nada). O "puxar dados e tirar da fila" em
--   si REUSA fn_atualizar_cadastro_via_pendencia_rh, que ja existe (20260812020000/030000) e ja
--   faz as duas coisas de uma vez: so' preenche campo vazio (COALESCE) e marca promovido_em -
--   nao precisa de funcao nova pra isso.
--
-- IDEMPOTENTE: CREATE OR REPLACE / DROP POLICY IF EXISTS. Seguro rodar nos dois ambientes
-- (CLAUDE.md armadilha 3).


-- ============================================================================
-- 1. fn_unidade_alcancavel_por_setor - complemento pontual de fn_unidade_no_escopo
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_unidade_alcancavel_por_setor(p_unidade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.profile_setores ps
          JOIN public.setores s ON s.id = ps.setor_id
         WHERE ps.profile_id = auth.uid()
           AND s.unidade_id = p_unidade_id
    )
$$;

COMMENT ON FUNCTION public.fn_unidade_alcancavel_por_setor(uuid) IS
    'Complemento de fn_unidade_no_escopo: verdadeiro se o caller tem um setor vinculado (profile_setores) '
    'dentro desta unidade, mesmo sem a unidade estar vinculada diretamente (profile_unidades). '
    'Usado so em importacao_rh_pendentes - fn_unidade_no_escopo em si nao foi alterada.';

GRANT EXECUTE ON FUNCTION public.fn_unidade_alcancavel_por_setor(uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. RLS: policy de coordenador passa a somar unidade-por-setor
-- ============================================================================

DROP POLICY IF EXISTS "Coordenadores leem importacao_rh_pendentes da propria unidade" ON public.importacao_rh_pendentes;
CREATE POLICY "Coordenadores leem importacao_rh_pendentes da propria unidade" ON public.importacao_rh_pendentes
    FOR SELECT TO authenticated
    USING (
        (SELECT get_my_role()) = 'coordenador'::user_role
        AND (
            EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todas_unidades = true)
            OR unidade_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu WHERE pu.profile_id = auth.uid())
            OR public.fn_unidade_alcancavel_por_setor(unidade_id)
        )
    );


-- ============================================================================
-- 3. fn_promover_pendencia_rh: escopo tambem aceita unidade alcancavel por setor
-- ============================================================================
-- Corpo identico a 20260812030000, so troca a checagem de escopo do topo (copia integral -
-- CREATE OR REPLACE troca a funcao inteira, CLAUDE.md armadilha 1).

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
    'confirmados. Papel restrito a super_admin/admin/coordenador (ass_adm NAO tem acesso). '
    'Escopo de unidade aceita profile_unidades OU um setor da unidade em profile_setores '
    '(fn_unidade_no_escopo OR fn_unidade_alcancavel_por_setor).';

GRANT EXECUTE ON FUNCTION public.fn_promover_pendencia_rh(uuid, uuid, uuid, text, boolean) TO authenticated, service_role;


-- ============================================================================
-- 4. fn_atualizar_cadastro_via_pendencia_rh: mesmo ajuste de escopo
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
    'super_admin/admin/coordenador. Escopo de unidade aceita profile_unidades OU um setor da '
    'unidade em profile_setores. Nunca toca matricula/unidade_id/setor_id/status: mudanca de '
    'lotacao continua exigindo o fluxo de solicitacao com aprovacao do super_admin (v1.43.0).';

GRANT EXECUTE ON FUNCTION public.fn_atualizar_cadastro_via_pendencia_rh(uuid, uuid) TO authenticated;


-- ============================================================================
-- 5. Busca cross-unidade por termo (super_admin/admin/coordenador)
-- ============================================================================
-- SECURITY DEFINER bypassando RLS de proposito - mesmo padrao ja usado em
-- get_external_servers_for_scale (v1.2.4) e fn_cpf_ja_cadastrado (v1.28.0). Bounded: exige >= 3
-- caracteres e devolve no maximo 20 linhas - o coordenador so ve quem ele especificamente
-- procurou, nunca um dump da fila inteira (que exporia CPF/nome de gente de outras unidades sem
-- necessidade).

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
    IF (SELECT get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role, 'coordenador'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores, diretores e coordenadores podem buscar pendencias de importacao do RH.'
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
    'Busca cross-unidade em importacao_rh_pendentes por nome/matricula/CPF, para coordenador '
    'achar o proprio pessoal mesmo quando a importacao nao resolveu a unidade (unidade_id NULL - '
    '38% dos casos, 12/08/2026). SECURITY DEFINER de proposito (mesmo padrao de '
    'get_external_servers_for_scale/fn_cpf_ja_cadastrado) - bounded por termo, nunca lista tudo.';

GRANT EXECUTE ON FUNCTION public.fn_buscar_pendencia_rh_por_termo(text) TO authenticated;


-- ============================================================================
-- 6. Deteccao por CPF no cadastro/edicao de servidor
-- ============================================================================
-- Lookup pontual (um CPF por vez) para o formulario de novo/editar servidor oferecer puxar os
-- dados complementares da importacao do RH automaticamente. A aplicacao em si (preencher e tirar
-- da fila) reusa fn_atualizar_cadastro_via_pendencia_rh, que ja faz as duas coisas - nao precisa
-- de funcao nova para isso.

CREATE OR REPLACE FUNCTION public.fn_pendencia_rh_por_cpf(p_cpf text)
RETURNS TABLE (
    id                   uuid,
    nome                 text,
    matricula            text,
    classificacao        text,
    cargo_sugerido       text,
    departamento_origem  text,
    criado_em            timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT ip.id, ip.nome, ip.matricula, ip.classificacao, ip.cargo_sugerido, ip.departamento_origem, ip.criado_em
      FROM public.importacao_rh_pendentes ip
     WHERE ip.promovido_em IS NULL
       AND ip.cpf_normalizado = regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g')
       AND regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g') <> ''
     LIMIT 1
$$;

COMMENT ON FUNCTION public.fn_pendencia_rh_por_cpf(text) IS
    'Lookup pontual por CPF exato em importacao_rh_pendentes (nao promovida) - usado no '
    'cadastro/edicao de servidor pra oferecer puxar dados complementares automaticamente. '
    'SECURITY DEFINER (mesmo bar de fn_cpf_ja_cadastrado, que ja bypassa RLS por CPF exato).';

GRANT EXECUTE ON FUNCTION public.fn_pendencia_rh_por_cpf(text) TO authenticated;


-- CONFERENCIA APOS APLICAR
--
--   1) Coordenador cujo acesso e' so por profile_setores (setor sem a unidade-pai vinculada)
--      passa a ver a pendencia da propria unidade:
--
--   SELECT * FROM public.importacao_rh_pendentes WHERE unidade_id = '<unidade_do_setor_dele>';
--   -- logado como esse coordenador: linhas aparecem agora, antes vinha vazio
--
--   2) Busca cross-unidade encontra alguem mesmo com unidade_id NULL:
--
--   SELECT * FROM public.fn_buscar_pendencia_rh_por_termo('<nome parcial de alguem sem unidade>');
--
--   3) Lookup por CPF:
--
--   SELECT * FROM public.fn_pendencia_rh_por_cpf('<cpf de alguem com pendencia>');
--   -- esperado: a linha da pendencia
--   SELECT * FROM public.fn_pendencia_rh_por_cpf('00000000000');
--   -- esperado: 0 linhas
