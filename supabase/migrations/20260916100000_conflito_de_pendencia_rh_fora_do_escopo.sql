-- ============================================================================
-- CONFLITO DE PENDENCIA DE RH FORA DO ESCOPO: A TELA PERGUNTAVA E NAO DEIXAVA RESPONDER
-- ============================================================================
-- 16/09/2026
--
-- O DEFEITO, RELATADO E MEDIDO EM PRODUCAO
--   Coordenadora do CAPS III abriu "Busque em toda a base", achou NEZILDA RIBEIRO DE SOUZA
--   (matricula 53599), preencheu unidade/setor/cargo, digitou o CPF que a tela pedia, clicou em
--   "Confirmar cadastro" e levou:
--
--     CPF ja cadastrado como NEZILDA RIBEIRO DE SOUZA (matricula 68182).
--     Confirme se e vinculo adicional da mesma pessoa.
--
--   Sem NENHUM lugar onde confirmar. A tela pergunta e nao oferece a resposta.
--
--   CAUSA: a busca cross-unidade (fn_buscar_pendencia_rh_por_termo) e SECURITY DEFINER e ignora
--   o escopo DE PROPOSITO - 564 das 860 pendencias abertas nao tem unidade resolvida e so
--   aparecem por ali. Mas a deteccao de conflito (buscarConflitoPendencia, em
--   servidores/actions.ts) lia importacao_rh_pendentes com o cliente DO USUARIO, ou seja sob RLS,
--   e a policy de coordenador exige unidade_id no escopo. unidade_id NULL nao pertence a lista
--   nenhuma: a leitura devolvia zero linhas, a action retornava "Pendencia nao encontrada", e a
--   tela tratava isso como "nao ha conflito".
--
--   Os dois lados mentiam juntos: a linha dizia "a importacao do RH nao trouxe CPF para este
--   vinculo" quando a pendencia TEM cpf_normalizado = 02535278138, e nenhuma das duas opcoes
--   (atualizar cadastro existente / e vinculo adicional) chegava a aparecer.
--
--   Medido em 16/09/2026, producao:
--     - pendencias abertas ................................ 860
--     - sem unidade resolvida E com CPF (invisiveis) ...... 564  (65,6%)
--     - dessas, marcadas vinculo_adicional_de_cpf ......... 9
--     - pendencia 53599: cpf_normalizado preenchido, unidade_id NULL
--     - perfil que relatou: coordenador, escopo = so CAPS III, sem acesso total
--
-- O QUE MUDA
--   1. fn_conflito_pendencia_rh (NOVA) - resolve o conflito da pendencia inteiro em UMA chamada
--      SECURITY DEFINER: le a identidade da pendencia sem passar pela RLS (mesmo motivo e mesmo
--      padrao de fn_buscar_pendencia_rh_por_termo, que ja lista essas linhas), aplica a
--      prioridade MATRICULA > CPF e devolve tambem se o cadastro em conflito esta no escopo de
--      quem perguntou.
--
--      O escopo do ALVO importa porque fn_atualizar_cadastro_via_pendencia_rh recusa cadastro de
--      unidade fora do escopo - e recusa CERTO. No caso medido, o cadastro 68182 e do HMI e quem
--      olhava so alcanca o CAPS III: sem esse campo a tela trocaria um beco sem saida por outro,
--      oferecendo "atualizar cadastro existente" para o banco negar depois (CLAUDE.md armadilha
--      31 - botao que convida ao impossivel; armadilha 44 - nunca instrua acao que o sistema nao
--      oferece).
--
--      BOUNDED de proposito: recebe UM id de pendencia, devolve no maximo uma linha. Nao e um
--      oraculo de CPF avulso - o p_cpf so e consultado quando a pendencia nao tem CPF proprio,
--      que e exatamente o caso em que a tela precisa coletar um.
--
--      O guard de papel dela recusa papel NULO explicitamente - ver o comentario no corpo. A
--      primeira tentativa de aplicar esta migration em producao foi ABORTADA pela conferencia
--      justamente por isso, e nada chegou a ser gravado.
--
--   2. fn_promover_pendencia_rh - a checagem de CPF ja cadastrado passa a olhar o CPF QUE VAI SER
--      GRAVADO (v_cpf_final = pendencia OU digitado), nao so o da pendencia. Sem isso, pendencia
--      sem CPF + CPF digitado que ja existe criava a duplicata em silencio, sem perguntar nada -
--      o modo de falha que esta tela existe para impedir (armadilha 50).
--
--      DEFESA EM PROFUNDIDADE, sem caso vivo: importacao_rh_pendentes.cpf_normalizado e NOT NULL,
--      e nenhuma das 858 pendencias abertas esta vazia ou com menos de 11 digitos (medido em
--      16/09/2026), entao p_cpf hoje e sempre ignorado. E a mesma medicao mostra outra coisa: o
--      campo "CPF *" da tela, com o texto "a importacao do RH nao trouxe CPF para este vinculo",
--      NUNCA deveria aparecer - ele so aparecia quando a conferencia falhava calada, que e o
--      defeito 1. Corrigido o 1, ele some sozinho.
--
-- O QUE NAO MUDA
--   - fn_atualizar_cadastro_via_pendencia_rh continua recusando cadastro fora do escopo. Quem so
--     alcanca o CAPS III nao passa a poder editar ficha do HMI; ele passa a SABER disso antes de
--     clicar, e o caminho que lhe resta (vinculo adicional, cadastro novo na propria unidade) e
--     o que fn_promover_pendencia_rh ja autoriza pelo escopo de p_unidade_id.
--   - a RLS de importacao_rh_pendentes fica como esta. Afrouxa-la abriria a fila inteira; o que
--     se quer e responder sobre UMA linha que o proprio usuario ja achou pela busca.
--   - a prioridade MATRICULA > CPF (20260812110000) e preservada nas duas funcoes.
--
-- COPIA MECANICA
--   O corpo de fn_promover_pendencia_rh foi COPIADO do arquivo vigente
--   (20260812110000_cpf_obrigatorio_e_conflito_matricula_pendencia_rh.sql) por
--   scratchpad/gen_conflito_pendencia.js, com duas substituicoes pontuais e conferencia de
--   invariantes antes e depois - CLAUDE.md armadilha 1.
--
-- IDEMPOTENTE
--   CREATE OR REPLACE nas duas. A funcao nova nasce com REVOKE ... FROM PUBLIC no mesmo arquivo
--   (armadilha 24 - GRANT TO authenticated nunca restringiu nada), e a conferencia do fim
--   EXECUTA as funcoes em vez de so conferir que existem (armadilha 42).
-- ============================================================================


-- ============================================================================
-- 1. fn_conflito_pendencia_rh - a deteccao que a RLS derrubava
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_conflito_pendencia_rh(uuid, text);

CREATE OR REPLACE FUNCTION public.fn_conflito_pendencia_rh(
    p_pendencia_id uuid,
    p_cpf          text DEFAULT NULL
)
RETURNS TABLE (
    cpf_pendencia    text,
    tipo             text,
    servidor_id      uuid,
    nome             text,
    matricula        text,
    unidade_nome     text,
    status           text,
    alvo_no_escopo   boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
-- Armadilha 42: RETURNS TABLE declara variavel com o nome de cada coluna de saida, e o alvo de um
-- SET/WHERE nao pode ser qualificado. Aqui o retorno e sempre por RETURN QUERY, entao resolver
-- todo nome ambiguo para a COLUNA e o que se quer. Nao remova esta linha ao regerar.
#variable_conflict use_column
DECLARE
    v_pend       public.importacao_rh_pendentes%ROWTYPE;
    v_mat        record;
    v_cpf        record;
    v_cpf_final  text;
    v_unidade    uuid;
    v_papel      public.user_role;
BEGIN
    -- Mesmo papel de fn_buscar_pendencia_rh_por_termo e de fn_promover_pendencia_rh: quem pode
    -- concluir o cadastro e quem pode saber com quem ele colide.
    --
    -- ATENCAO: O PAPEL NULO E RECUSADO EXPLICITAMENTE, e isto NAO e zelo: as funcoes vizinhas escrevem
    -- `IF (SELECT get_my_role()) NOT IN (...)`, e em SQL `NULL NOT IN (lista)` resolve para NULL,
    -- nao para TRUE - o IF nao dispara e o guard NAO RECUSA. Medido em 16/09/2026 publicando um
    -- JWT com sub inexistente: get_my_role() = NULL e a expressao inteira = NULL. Foi a
    -- conferencia do fim deste arquivo que pegou isso, abortando a primeira tentativa de aplicar
    -- em producao. Nas vizinhas o que segura e' o REVOKE (anon nao executa) mais a RLS; aqui a
    -- funcao e SECURITY DEFINER e le a tabela POR FORA da RLS, entao o guard e' a unica porta -
    -- e o default de uma funcao de seguranca e NEGAR (armadilha 40).
    v_papel := (SELECT get_my_role());
    IF v_papel IS NULL OR v_papel NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role, 'coordenador'::public.user_role, 'rh'::public.user_role, 'rh_unidade'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores, diretores, coordenadores e RH podem conferir pendencias de importacao do RH.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_pend
      FROM public.importacao_rh_pendentes
     WHERE id = p_pendencia_id AND promovido_em IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pendencia nao encontrada, ou ja foi promovida.';
    END IF;

    -- O CPF que a promocao de fato usaria: o da pendencia vence; so quando ela nao tem nenhum e
    -- que o digitado na tela entra. Mesma regra (e mesma ordem) de fn_promover_pendencia_rh -
    -- perguntar por um CPF e gravar outro seria pior que nao perguntar.
    v_cpf_final := COALESCE(v_pend.cpf_normalizado, NULLIF(regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g'), ''));

    -- MATRICULA TEM PRIORIDADE (20260812110000): colisao por matricula nunca e vinculo adicional
    -- valido, e sempre o MESMO registro. So 'cpf' pode virar cadastro novo.
    SELECT * INTO v_mat FROM public.fn_servidor_por_matricula(v_pend.matricula) LIMIT 1;
    IF FOUND THEN
        SELECT s.unidade_id INTO v_unidade FROM public.servidores s WHERE s.id = v_mat.servidor_id;
        RETURN QUERY SELECT
            v_pend.cpf_normalizado,
            'matricula'::text,
            v_mat.servidor_id, v_mat.nome, v_mat.matricula, v_mat.unidade_nome, v_mat.status,
            COALESCE(public.fn_unidade_no_escopo(v_unidade) OR public.fn_unidade_alcancavel_por_setor(v_unidade), false);
        RETURN;
    END IF;

    SELECT * INTO v_cpf FROM public.fn_cpf_ja_cadastrado(v_cpf_final) LIMIT 1;
    IF FOUND THEN
        SELECT s.unidade_id INTO v_unidade FROM public.servidores s WHERE s.id = v_cpf.servidor_id;
        RETURN QUERY SELECT
            v_pend.cpf_normalizado,
            'cpf'::text,
            v_cpf.servidor_id, v_cpf.nome, v_cpf.matricula, v_cpf.unidade_nome, v_cpf.status,
            COALESCE(public.fn_unidade_no_escopo(v_unidade) OR public.fn_unidade_alcancavel_por_setor(v_unidade), false);
        RETURN;
    END IF;

    -- Sem conflito: devolve UMA linha mesmo assim, com tipo NULL. Zero linhas seria
    -- indistinguivel de "a chamada falhou", que e exatamente o defeito que esta migration
    -- conserta - a tela precisa poder separar "conferi e nao ha" de "nao consegui conferir".
    RETURN QUERY SELECT v_pend.cpf_normalizado, NULL::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::text, NULL::text, NULL::boolean;
END;
$fn$;

COMMENT ON FUNCTION public.fn_conflito_pendencia_rh(uuid, text) IS
    'Com quem uma pendencia de importacao do RH colide (matricula primeiro, depois CPF), mais o '
    'CPF que a propria pendencia traz e se o cadastro em conflito esta no escopo de quem '
    'pergunta. SECURITY DEFINER de proposito, mesmo motivo de fn_buscar_pendencia_rh_por_termo: '
    'a linha pode ter unidade_id NULL (564 de 860 em 16/09/2026) e ficar fora da RLS de quem a '
    'achou pela busca cross-unidade. Bounded a UMA pendencia - nunca lista a fila, e so olha '
    'p_cpf quando a pendencia nao tem CPF proprio.';

-- Armadilha 24: CREATE FUNCTION ja concede EXECUTE a PUBLIC. GRANT TO authenticated nao
-- restringe nada - quem restringe e o REVOKE, e este e o unico momento em que somos o dono.
REVOKE ALL ON FUNCTION public.fn_conflito_pendencia_rh(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conflito_pendencia_rh(uuid, text) TO authenticated, service_role;


-- ============================================================================
-- 2. fn_promover_pendencia_rh - a checagem olha o CPF QUE VAI SER GRAVADO
-- ============================================================================
-- Corpo copiado integralmente de 20260812110000 por scratchpad/gen_conflito_pendencia.js.
-- Os pontos alterados estao marcados "NOVO (16/09/2026)".

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

    -- NOVO (16/09/2026): o CPF que de fato vai ser gravado ja e conhecido aqui - o da pendencia,
    -- ou o que a tela coletou quando o relatorio do RH nao trouxe nenhum. A checagem de
    -- duplicidade abaixo passa a olhar ELE. Antes ela olhava so v_pend.cpf_normalizado, entao um
    -- CPF digitado na tela que ja pertence a outro cadastro criava a duplicata EM SILENCIO, sem
    -- perguntar nada - que e exatamente o que esta tela existe para impedir (armadilha 50).
    -- A validacao de obrigatoriedade e de digito continua onde estava, logo antes do INSERT:
    -- mover so a atribuicao mantem a ordem das mensagens que a tela ja conhece.
    v_cpf_final := COALESCE(v_pend.cpf_normalizado, NULLIF(regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g'), ''));

    -- NOVO: colisao de matricula nunca e vinculo valido - e sempre o MESMO registro. Sem isto o
    -- INSERT abaixo estoura servidores_matricula_key como erro cru (achado em producao, FLAVIA
    -- BARROS CAVALCANTE, 12/08/2026).
    SELECT * INTO v_mat_existente FROM public.fn_servidor_por_matricula(v_pend.matricula) LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'Ja existe um cadastro ativo com a matricula % (%, %). Use "atualizar cadastro existente" em vez de criar um novo - a tela detecta isto automaticamente ao abrir a linha.',
            v_pend.matricula, v_mat_existente.nome, COALESCE(v_mat_existente.unidade_nome, 'sem unidade');
    END IF;

    SELECT * INTO v_existente FROM public.fn_cpf_ja_cadastrado(v_cpf_final) LIMIT 1;
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
-- CONFERENCIA - roda junto e ABORTA se falhar
-- ============================================================================
-- Armadilha 42: conferir que a funcao EXISTE nao serve - a de 30/08/2026 existia e estava
-- quebrada. Esta EXECUTA as duas.
--
-- Armadilha da 20260909170000: migration roda como service_role (auth.uid() = NULL), onde todo
-- guard de papel bypassa. Para exercitar o caminho de verdade a conferencia PUBLICA um JWT
-- sintetico com set_config(..., true) - local a transacao.
--
-- Confere os DOIS sentidos em cada ponto. Afrouxar demais aqui e tao ruim quanto nao corrigir:
-- a deteccao existe para RECUSAR o cadastro novo sem confirmacao.
DO $conf$
DECLARE
    v_super       uuid;
    v_pend        uuid;
    v_pend_nome   text;
    v_unidade     uuid;
    v_setor       uuid;
    v_linha       record;
    v_ok_leitura  boolean := false;
    v_ok_papel    boolean := false;
    v_outro       uuid;
    v_ok_recusa   boolean := false;
BEGIN
    -- ------------------------------------------------------------------
    -- 1) Estrutura de fn_promover_pendencia_rh (a copia mecanica)
    -- ------------------------------------------------------------------
    PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'fn_promover_pendencia_rh'
        AND p.prosrc LIKE '%fn_cpf_ja_cadastrado(v_cpf_final)%';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ABORTADO: fn_promover_pendencia_rh nao passou a checar o CPF final.';
    END IF;

    PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'fn_promover_pendencia_rh'
        AND p.prosrc LIKE '%fn_cpf_ja_cadastrado(v_pend.cpf_normalizado)%';
    IF FOUND THEN
        RAISE EXCEPTION 'ABORTADO: sobrou checagem de CPF sobre v_pend.cpf_normalizado - CPF '
                        'digitado na tela voltaria a escapar da checagem.';
    END IF;

    -- Os guards que a copia nao pode ter perdido (armadilha 1).
    PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'fn_promover_pendencia_rh'
        AND p.prosrc LIKE '%fn_servidor_por_matricula(v_pend.matricula)%'
        AND p.prosrc LIKE '%fn_unidade_no_escopo(p_unidade_id)%'
        AND p.prosrc LIKE '%fn_cpf_digito_valido(v_cpf_final)%'
        AND p.prosrc LIKE '%CPF e obrigatorio para concluir o cadastro%';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ABORTADO: fn_promover_pendencia_rh perdeu um dos guards (matricula, '
                        'escopo de unidade, digito do CPF ou CPF obrigatorio).';
    END IF;

    -- ------------------------------------------------------------------
    -- 2) Privilegio da funcao nova (armadilha 24: o que restringe e o REVOKE)
    -- ------------------------------------------------------------------
    IF has_function_privilege('anon', 'public.fn_conflito_pendencia_rh(uuid, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon continua executando fn_conflito_pendencia_rh.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_conflito_pendencia_rh(uuid, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated perdeu fn_conflito_pendencia_rh - a tela de '
                        'Pendencias de Cadastro pararia inteira.';
    END IF;

    -- ------------------------------------------------------------------
    -- 3) Comportamento: a linha que a RLS derrubava passa a ser lida
    -- ------------------------------------------------------------------
    SELECT id INTO v_super FROM public.profiles WHERE role = 'super_admin' AND ativo IS NOT FALSE LIMIT 1;

    -- O caso exato do defeito: pendencia aberta, SEM unidade resolvida (invisivel a RLS de quem
    -- nao tem acesso total) e COM CPF que ja pertence a outro cadastro.
    SELECT ip.id, ip.nome INTO v_pend, v_pend_nome
      FROM public.importacao_rh_pendentes ip
     WHERE ip.promovido_em IS NULL
       AND ip.unidade_id IS NULL
       AND ip.cpf_normalizado IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.fn_cpf_ja_cadastrado(ip.cpf_normalizado))
       AND NOT EXISTS (SELECT 1 FROM public.fn_servidor_por_matricula(ip.matricula))
     LIMIT 1;

    IF v_super IS NULL OR v_pend IS NULL THEN
        RAISE NOTICE 'CONFERENCIA PARCIAL: sem super_admin ativo ou sem pendencia no caso do '
                     'defeito (sem unidade + com CPF colidindo). A estrutura e os privilegios '
                     'acima passaram.';
        RETURN;
    END IF;

    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);

    SELECT * INTO v_linha FROM public.fn_conflito_pendencia_rh(v_pend) LIMIT 1;
    -- Tem que devolver o CPF da pendencia (era isto que a tela nunca via, e por isso pedia um
    -- CPF que ja estava la) E apontar o conflito como 'cpf' (o unico tipo que pode virar
    -- vinculo adicional).
    v_ok_leitura := (v_linha.cpf_pendencia IS NOT NULL AND v_linha.tipo = 'cpf'
                     AND v_linha.servidor_id IS NOT NULL AND v_linha.alvo_no_escopo IS NOT NULL);

    -- ------------------------------------------------------------------
    -- 4) Sentido inverso: a promocao CONTINUA recusando sem confirmacao
    -- ------------------------------------------------------------------
    -- Executa de verdade. Se por engano ela promover, a SENTINELA abaixo reverte o savepoint
    -- implicito deste bloco - nenhum cadastro sobra.
    SELECT u.id INTO v_unidade FROM public.unidades u WHERE u.ativo IS NOT FALSE ORDER BY u.nome LIMIT 1;
    SELECT s.id INTO v_setor FROM public.setores s WHERE s.unidade_id = v_unidade LIMIT 1;

    IF v_unidade IS NOT NULL AND v_setor IS NOT NULL THEN
        BEGIN
            PERFORM public.fn_promover_pendencia_rh(v_pend, v_unidade, v_setor, 'CONFERENCIA', false, NULL);
            RAISE EXCEPTION 'SENTINELA_PROMOVEU';
        EXCEPTION
            WHEN others THEN
                IF SQLERRM LIKE '%CPF ja cadastrado%' THEN
                    v_ok_recusa := true;
                ELSIF SQLERRM = 'SENTINELA_PROMOVEU' THEN
                    v_ok_recusa := false;
                ELSE
                    RAISE EXCEPTION 'ABORTADO: fn_promover_pendencia_rh falhou por outro motivo '
                                    'na conferencia: %', SQLERRM;
                END IF;
        END;
    ELSE
        v_ok_recusa := true;  -- sem unidade/setor para exercitar; a estrutura ja passou
    END IF;

    -- ------------------------------------------------------------------
    -- 5) E o guard de papel da funcao nova recusa quem nao tem papel
    -- ------------------------------------------------------------------
    -- Sessao cujo sub nao existe em profiles: get_my_role() = NULL. Com o `NOT IN` puro das
    -- funcoes vizinhas isto NAO recusaria (NULL NOT IN (...) = NULL, e o IF nao dispara) - foi
    -- esta assercao que abortou a primeira aplicacao em producao e obrigou o guard a tratar
    -- NULL. Nao afrouxe: esta funcao le a tabela por fora da RLS.
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', '00000000-0000-0000-0000-000000000000',
                                         'role', 'authenticated')::text, true);
    BEGIN
        PERFORM public.fn_conflito_pendencia_rh(v_pend);
        v_ok_papel := false;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_ok_papel := true;
    END;

    -- E papel REAL fora da lista (Portal do Servidor) tambem e recusado, quando existir um.
    SELECT id INTO v_outro FROM public.profiles
     WHERE role NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role,
                        'coordenador'::public.user_role, 'rh'::public.user_role,
                        'rh_unidade'::public.user_role)
     LIMIT 1;
    IF v_outro IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', v_outro::text, 'role', 'authenticated')::text, true);
        BEGIN
            PERFORM public.fn_conflito_pendencia_rh(v_pend);
            v_ok_papel := false;
        EXCEPTION
            WHEN insufficient_privilege THEN
                NULL;  -- continua true
        END;
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);

    RAISE NOTICE 'pendencia % (%) | le fora do escopo: % | promocao ainda recusa sem confirmar: % | papel fechado: %',
        v_pend, v_pend_nome, v_ok_leitura, v_ok_recusa, v_ok_papel;

    IF NOT v_ok_leitura THEN
        RAISE EXCEPTION 'ABORTADO: fn_conflito_pendencia_rh nao enxergou a pendencia fora do '
                        'escopo - o defeito continua.';
    END IF;
    IF NOT v_ok_recusa THEN
        RAISE EXCEPTION 'ABORTADO: fn_promover_pendencia_rh criou cadastro SEM confirmacao de '
                        'vinculo adicional - a duplicata voltaria a nascer em silencio.';
    END IF;
    IF NOT v_ok_papel THEN
        RAISE EXCEPTION 'ABORTADO: fn_conflito_pendencia_rh responde a quem nao tem papel.';
    END IF;

    RAISE NOTICE 'CONFERENCIA OK.';
END;
$conf$;
