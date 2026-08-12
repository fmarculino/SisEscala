-- Migration: CPF obrigatorio no cadastro do servidor + colisao por matricula na promocao de
-- pendencia de RH
-- Data: 2026-08-12
--
-- MOTIVACAO
--   Produção: promover a pendência de FLAVIA BARROS CAVALCANTE (matricula 58144, DMAC) estourou
--   `duplicate key value violates unique constraint "servidores_matricula_key"` cru na tela — ela
--   já está cadastrada e ativa na escala do DMAC, mas a fila de pendências ainda a lista como
--   "aguardando cadastro" porque a importação original (v1.42.0) nunca resolveu o CPF pra casar
--   com o cadastro existente.
--
--   `fn_promover_pendencia_rh` só detecta conflito pelo CAMINHO do CPF (`fn_cpf_ja_cadastrado`).
--   Se a pendência não tem CPF (ou o cadastro ativo não tem CPF — 57 em produção em 08/2026), a
--   checagem nunca dispara e a função tenta o INSERT direto, que só então esbarra na constraint
--   de matrícula — a UI nunca chega a perguntar "vínculo adicional ou atualização", só mostra o
--   erro cru do Postgres.
--
--   Diferente do CPF (onde duas pessoas podem legitimamente compartilhar o documento por vínculo
--   múltiplo, v1.42.0), colisão por MATRÍCULA nunca é um segundo vínculo válido: matrícula é a
--   própria chave que a fila usa pra identificar "esta pessoa ainda não tem cadastro" — se já
--   existe alguém com essa matrícula, é sempre o MESMO registro, e a única ação correta é
--   atualizar, nunca criar de novo.
--
--   Ao mesmo tempo, o usuário pediu CPF obrigatório no cadastro do servidor daqui pra frente
--   (aplicado em createServidor/updateServidor/importação CSV no app) — para não abrir uma
--   brecha nova, o mesmo vira regra também no caminho de criação da promoção de pendência
--   (fn_promover_pendencia_rh), com uma via de escape: se a pendência não trouxe CPF, a RPC
--   aceita um p_cpf informado pelo coordenador na própria tela.
--
-- O QUE MUDA
--   1. fn_servidor_por_matricula (nova) — mesmo padrão de fn_cpf_ja_cadastrado (SECURITY DEFINER,
--      enxerga a base inteira), usada tanto pela RPC de promoção quanto pela tela, pra detectar a
--      colisão ANTES do INSERT em vez de deixar estourar a constraint.
--   2. fn_promover_pendencia_rh — nova checagem de matrícula (RAISE EXCEPTION direcionando pra
--      "atualizar cadastro existente", nunca oferece a opção de vínculo duplo pra isso) + CPF
--      passa a ser obrigatório pra criar um cadastro novo (da pendência OU do parâmetro p_cpf).
--   3. fn_atualizar_cadastro_via_pendencia_rh — ganha p_cpf opcional e passa a preencher
--      `cpf` do cadastro existente com COALESCE (nunca sobrescreve), igual já faz com todo o
--      resto dos campos — antes CPF ficava de fora do UPDATE porque só era alcançada quando já
--      tinha casado por CPF (logo já preenchido); agora também é alcançada por colisão de
--      matrícula, onde o cadastro existente pode não ter CPF nenhum.
--
-- IDEMPOTENTE: CREATE OR REPLACE. Seguro rodar nos dois ambientes.


-- ============================================================================
-- 1. fn_servidor_por_matricula — mesmo padrao de fn_cpf_ja_cadastrado
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_servidor_por_matricula(
    p_matricula  text,
    p_ignorar_id uuid DEFAULT NULL
)
RETURNS TABLE (
    servidor_id   uuid,
    nome          text,
    matricula     text,
    unidade_nome  text,
    status        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT s.id, s.nome, s.matricula, u.nome, s.status
      FROM public.servidores s
      LEFT JOIN public.unidades u ON u.id = s.unidade_id
     WHERE p_matricula IS NOT NULL AND btrim(p_matricula) <> ''
       AND s.matricula = btrim(p_matricula)
       AND (p_ignorar_id IS NULL OR s.id <> p_ignorar_id)
$fn$;

COMMENT ON FUNCTION public.fn_servidor_por_matricula(text, uuid) IS
    'Servidor ja cadastrado com esta matricula, se houver. SECURITY DEFINER de proposito (mesmo '
    'padrao de fn_cpf_ja_cadastrado) - usado por fn_promover_pendencia_rh e pela tela de '
    'Pendencias de Cadastro pra detectar colisao de matricula ANTES do INSERT, em vez de deixar '
    'estourar a constraint unica servidores_matricula_key como erro cru na tela.';

GRANT EXECUTE ON FUNCTION public.fn_servidor_por_matricula(text, uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. fn_promover_pendencia_rh — guard de matricula + CPF obrigatorio (com p_cpf opcional)
-- ============================================================================
-- Corpo copiado integralmente de 20260812100000 (CLAUDE.md armadilha 1), com os pontos abaixo
-- marcados "NOVO".
--
-- ATENCAO: CREATE OR REPLACE nao substitui uma funcao quando a lista de parametros muda de
-- tamanho - cria uma SEGUNDA funcao (overload), deixando a assinatura antiga de 5 parametros
-- viva e desatualizada ao lado da nova. O DROP explicito evita isso.

DROP FUNCTION IF EXISTS public.fn_promover_pendencia_rh(uuid, uuid, uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.fn_promover_pendencia_rh(
    p_pendencia_id                uuid,
    p_unidade_id                  uuid,
    p_setor_id                    uuid,
    p_cargo                       text,
    p_confirma_vinculo_adicional  boolean DEFAULT false,
    p_cpf                         text DEFAULT NULL  -- NOVO: cpf digitado na tela, quando a pendencia nao traz nenhum
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_pend             public.importacao_rh_pendentes%ROWTYPE;
    v_existente         record;
    v_mat_existente     record;  -- NOVO
    v_dados             jsonb;
    v_novo_id           uuid;
    v_vinculo_multiplo  boolean := false;
    v_vinculo_enum      public.vinculo_type;
    v_cpf_final         text;   -- NOVO
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

    -- NOVO: colisao de matricula nunca e vinculo valido - e sempre o MESMO registro. Sem isto o
    -- INSERT abaixo estoura servidores_matricula_key como erro cru (achado em producao, FLAVIA
    -- BARROS CAVALCANTE, 12/08/2026).
    SELECT * INTO v_mat_existente FROM public.fn_servidor_por_matricula(v_pend.matricula) LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'Ja existe um cadastro ativo com a matricula % (%, %). Use "atualizar cadastro existente" em vez de criar um novo - a tela detecta isto automaticamente ao abrir a linha.',
            v_pend.matricula, v_mat_existente.nome, COALESCE(v_mat_existente.unidade_nome, 'sem unidade');
    END IF;

    SELECT * INTO v_existente FROM public.fn_cpf_ja_cadastrado(v_pend.cpf_normalizado) LIMIT 1;
    IF FOUND THEN
        IF NOT p_confirma_vinculo_adicional THEN
            RAISE EXCEPTION 'CPF ja cadastrado como % (matricula %). Confirme se e vinculo adicional da mesma pessoa.',
                v_existente.nome, v_existente.matricula;
        END IF;
        v_vinculo_multiplo := true;
    END IF;

    IF p_unidade_id IS NULL OR p_setor_id IS NULL THEN
        RAISE EXCEPTION 'Unidade e setor sao obrigatorios para concluir o cadastro.';
    END IF;

    IF p_cargo IS NULL OR btrim(p_cargo) = '' THEN
        RAISE EXCEPTION 'Cargo e obrigatorio para concluir o cadastro.';
    END IF;

    -- NOVO: CPF obrigatorio (12/08/2026, mesma regra do cadastro manual em
    -- createServidor/updateServidor) - a pendencia pode ja trazer CPF do relatorio do RH; quando
    -- nao traz, p_cpf e o que a tela coletou do coordenador na propria linha de promocao.
    v_cpf_final := COALESCE(v_pend.cpf_normalizado, NULLIF(regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g'), ''));
    IF v_cpf_final IS NULL THEN
        RAISE EXCEPTION 'CPF e obrigatorio para concluir o cadastro - preencha o CPF na propria linha antes de confirmar.';
    END IF;
    IF NOT public.fn_cpf_digito_valido(v_cpf_final) THEN
        RAISE EXCEPTION 'CPF invalido - confira os digitos.';
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
        v_pend.nome, v_pend.matricula, v_cpf_final, p_cargo,
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

COMMENT ON FUNCTION public.fn_promover_pendencia_rh(uuid, uuid, uuid, text, boolean, text) IS
    'Grava em servidores o vinculo pendente de importacao do RH, depois de unidade/setor/cargo '
    'confirmados. Papel restrito a super_admin/admin/coordenador/rh/rh_unidade. Recusa se ja '
    'existe cadastro ATIVO com a mesma matricula (nunca e vinculo valido - fn_servidor_por_matricula) '
    'ou, sem confirmacao, com o mesmo CPF (fn_cpf_ja_cadastrado). CPF e obrigatorio pra criar '
    'cadastro novo - vem da pendencia ou do parametro p_cpf, o que a tela coletou do coordenador.';

GRANT EXECUTE ON FUNCTION public.fn_promover_pendencia_rh(uuid, uuid, uuid, text, boolean, text) TO authenticated, service_role;


-- ============================================================================
-- 3. fn_atualizar_cadastro_via_pendencia_rh — ganha p_cpf opcional, preenche cpf por COALESCE
-- ============================================================================
-- Mesmo cuidado do item 2: DROP explicito da assinatura antiga de 2 parametros, senao a nova de
-- 3 parametros fica como overload adicional em vez de substituir.

DROP FUNCTION IF EXISTS public.fn_atualizar_cadastro_via_pendencia_rh(uuid, uuid);

CREATE OR REPLACE FUNCTION public.fn_atualizar_cadastro_via_pendencia_rh(
    p_pendencia_id uuid,
    p_servidor_id  uuid,
    p_cpf          text DEFAULT NULL  -- NOVO: cpf digitado na tela, usado so se o cadastro existente ainda nao tiver
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
    v_cpf_novo  text;  -- NOVO
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

    -- NOVO: so redriva o conflito de CPF quando a pendencia de fato tem um CPF pra casar - a
    -- colisao pode ter vindo por MATRICULA (fn_servidor_por_matricula, checada pela tela antes
    -- de chamar esta funcao), caso em que v_pend.cpf_normalizado pode estar vazio.
    IF v_pend.cpf_normalizado IS NOT NULL THEN
        SELECT * INTO v_existente FROM public.fn_cpf_ja_cadastrado(v_pend.cpf_normalizado) LIMIT 1;
        IF NOT FOUND OR v_existente.servidor_id IS DISTINCT FROM p_servidor_id THEN
            RAISE EXCEPTION 'Este CPF nao corresponde mais ao cadastro informado - atualize a pagina e tente de novo.';
        END IF;
    END IF;

    SELECT id, unidade_id, cpf INTO v_alvo FROM public.servidores WHERE id = p_servidor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cadastro existente nao encontrado.';
    END IF;

    IF NOT (public.fn_unidade_no_escopo(v_alvo.unidade_id) OR public.fn_unidade_alcancavel_por_setor(v_alvo.unidade_id)) THEN
        RAISE EXCEPTION 'Voce nao tem acesso a unidade deste cadastro.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- NOVO: CPF que vai preencher o cadastro existente, se ele ainda nao tiver um - prioridade
    -- pro CPF da propria pendencia (dado do relatorio do RH) sobre o digitado na tela agora.
    v_cpf_novo := COALESCE(v_pend.cpf_normalizado, NULLIF(regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g'), ''));
    IF v_cpf_novo IS NOT NULL AND NOT public.fn_cpf_digito_valido(v_cpf_novo) THEN
        RAISE EXCEPTION 'CPF invalido - confira os digitos.';
    END IF;

    v_dados := COALESCE(v_pend.dados_complementares, '{}'::jsonb);

    UPDATE public.servidores SET
        cpf                          = COALESCE(cpf, v_cpf_novo),  -- NOVO
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

COMMENT ON FUNCTION public.fn_atualizar_cadastro_via_pendencia_rh(uuid, uuid, text) IS
    'Completa um servidor ja cadastrado com os dados complementares de uma pendencia de '
    'importacao do RH - so preenche campo vazio (COALESCE), nunca sobrescreve, inclusive CPF '
    '(preenchido do CPF da pendencia ou, na falta dele, do parametro p_cpf digitado na tela). '
    'Papel restrito a super_admin/admin/coordenador/rh/rh_unidade. Escopo de unidade aceita '
    'profile_unidades OU um setor da unidade em profile_setores. Nunca toca '
    'matricula/unidade_id/setor_id/status: mudanca de lotacao continua exigindo o fluxo de '
    'solicitacao com aprovacao do super_admin (v1.43.0).';

GRANT EXECUTE ON FUNCTION public.fn_atualizar_cadastro_via_pendencia_rh(uuid, uuid, text) TO authenticated;


-- CONFERENCIA APOS APLICAR
--
--   1) Simula o caso da FLAVIA: pega uma pendencia com matricula que ja existe em servidores e
--      tenta promover como cadastro novo - espera-se RAISE EXCEPTION apontando "atualizar
--      cadastro existente", nao mais "duplicate key value violates...".
--
--   SELECT id, matricula FROM public.importacao_rh_pendentes
--    WHERE promovido_em IS NULL AND matricula IN (SELECT matricula FROM public.servidores);
--
--   2) fn_servidor_por_matricula acha o cadastro certo:
--
--   SELECT * FROM public.fn_servidor_por_matricula('<matricula de alguem ja cadastrado>');
--
--   3) fn_promover_pendencia_rh recusa pendencia sem CPF nenhum (nem no dado, nem no parametro):
--
--   SELECT public.fn_promover_pendencia_rh('<id de pendencia sem cpf_normalizado>', '<unidade>', '<setor>', 'CARGO', false, NULL);
--   -- esperado: RAISE EXCEPTION 'CPF e obrigatorio...'
