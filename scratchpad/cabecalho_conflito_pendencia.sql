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

