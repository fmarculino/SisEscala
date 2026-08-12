-- Migration: corrige revalidacao de conflito em fn_atualizar_cadastro_via_pendencia_rh pra aceitar
-- colisao por matricula, nao so por CPF
-- Data: 2026-08-12
--
-- MOTIVACAO
--   20260812110000 ensinou a tela a detectar conflito por MATRICULA (fn_servidor_por_matricula),
--   alem do conflito por CPF que ja existia. Mas a revalidacao dentro de
--   fn_atualizar_cadastro_via_pendencia_rh ficou intacta, exigindo sempre que
--   fn_cpf_ja_cadastrado(v_pend.cpf_normalizado) achasse o MESMO p_servidor_id.
--
--   Isso quebra o caso que a 20260812110000 foi escrita pra resolver: a pendencia de FLAVIA
--   BARROS CAVALCANTE tem um CPF preenchido, mas esse CPF NAO e o que esta gravado no cadastro
--   ativo dela (SMS) - o conflito so aparece por MATRICULA. A tela acertava a deteccao (mostrava
--   o aviso vermelho certo) mas confirmar "Atualizar cadastro existente" batia em
--   `RAISE EXCEPTION 'Este CPF nao corresponde mais ao cadastro informado...'`, porque a funcao
--   insistia em validar por CPF mesmo quando foi a MATRICULA que provou que e o mesmo registro.
--
--   Achado testando em producao a propria correcao da 20260812110000, no mesmo dia.
--
-- O QUE MUDA
--   fn_atualizar_cadastro_via_pendencia_rh passa a redrivar o conflito por MATRICULA primeiro
--   (fn_servidor_por_matricula) - se bater com p_servidor_id, segue direto, sem nem olhar o CPF.
--   So cai pra revalidar por CPF quando a matricula NAO bate (o caso original, conflito
--   detectado só por CPF, onde a matrícula da pendência pode nem existir em `servidores` ainda).
--
-- IDEMPOTENTE: CREATE OR REPLACE, mesma assinatura de 20260812110000 (nao precisa DROP).


CREATE OR REPLACE FUNCTION public.fn_atualizar_cadastro_via_pendencia_rh(
    p_pendencia_id uuid,
    p_servidor_id  uuid,
    p_cpf          text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_pend      public.importacao_rh_pendentes%ROWTYPE;
    v_existente record;
    v_mat_alvo  record;  -- NOVO
    v_alvo      record;
    v_dados     jsonb;
    v_cpf_novo  text;
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

    -- CORRIGIDO: redriva o conflito por MATRICULA primeiro - se bater, e prova suficiente de que
    -- e o mesmo registro (essa e a propria definicao de fn_servidor_por_matricula), sem precisar
    -- que o CPF tambem bata. So cai pra revalidar por CPF quando a matricula nao aponta pra
    -- p_servidor_id (o caso original: conflito descoberto so por CPF).
    SELECT * INTO v_mat_alvo FROM public.fn_servidor_por_matricula(v_pend.matricula) LIMIT 1;
    IF v_mat_alvo.servidor_id IS DISTINCT FROM p_servidor_id THEN
        IF v_pend.cpf_normalizado IS NULL THEN
            RAISE EXCEPTION 'Esta matricula nao corresponde mais ao cadastro informado - atualize a pagina e tente de novo.';
        END IF;
        SELECT * INTO v_existente FROM public.fn_cpf_ja_cadastrado(v_pend.cpf_normalizado) LIMIT 1;
        IF NOT FOUND OR v_existente.servidor_id IS DISTINCT FROM p_servidor_id THEN
            RAISE EXCEPTION 'Este CPF ou matricula nao correspondem mais ao cadastro informado - atualize a pagina e tente de novo.';
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

    -- CPF que vai preencher o cadastro existente, se ele ainda nao tiver um - prioridade pro CPF
    -- da propria pendencia (dado do relatorio do RH) sobre o digitado na tela agora.
    v_cpf_novo := COALESCE(v_pend.cpf_normalizado, NULLIF(regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g'), ''));
    IF v_cpf_novo IS NOT NULL AND NOT public.fn_cpf_digito_valido(v_cpf_novo) THEN
        RAISE EXCEPTION 'CPF invalido - confira os digitos.';
    END IF;

    v_dados := COALESCE(v_pend.dados_complementares, '{}'::jsonb);

    UPDATE public.servidores SET
        cpf                          = COALESCE(cpf, v_cpf_novo),
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
    'Redriva o conflito por MATRICULA primeiro (fn_servidor_por_matricula) e so cai pra CPF '
    '(fn_cpf_ja_cadastrado) quando a matricula nao bate - corrigido em 20260812120000, a '
    'versao anterior exigia CPF bater sempre, mesmo quando a colisao foi so por matricula. '
    'Papel restrito a super_admin/admin/coordenador/rh/rh_unidade. Escopo de unidade aceita '
    'profile_unidades OU um setor da unidade em profile_setores. Nunca toca '
    'matricula/unidade_id/setor_id/status: mudanca de lotacao continua exigindo o fluxo de '
    'solicitacao com aprovacao do super_admin (v1.43.0).';

GRANT EXECUTE ON FUNCTION public.fn_atualizar_cadastro_via_pendencia_rh(uuid, uuid, text) TO authenticated;


-- CONFERENCIA APOS APLICAR
--
--   Reabrir a pendencia da FLAVIA BARROS CAVALCANTE (matricula 58144) e clicar em "Atualizar
--   cadastro existente" - espera-se sucesso (linha sai da fila), nao mais
--   "Este CPF nao corresponde mais ao cadastro informado".
