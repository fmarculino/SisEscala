-- ============================================================================
-- Diretor passa a AUTORIZAR carga extraordinaria -- e passa a ficar ESCOPADO
-- ============================================================================
-- 03/09/2026 - decisao do usuario: "preciso que o diretor e o RH de unidade tambem possam
-- autorizar essas pendencias [...] eles so podem autorizar as pendencias de suas proprias
-- unidades".
--
-- O QUE FOI MEDIDO EM PRODUCAO ANTES DE MEXER (03/09/2026)
--   A premissa de que so `super_admin` e `rh` autorizavam esta ERRADA pela metade -- e as duas
--   metades pedem coisas opostas:
--
--     * RH da Unidade JA autorizava, e ja exerceu: das 3 excecoes concedidas na base, 1 foi de
--       ANA CAROLINA DOS REIS DE SOUZA (rh_unidade, HMI). O escopo por unidade dela ja vinha da
--       20260831120000. Nada a fazer para esse papel.
--
--     * Diretor (`admin`) JA autorizava tambem -- mas SEM ESCOPO NENHUM, no mesmo ramo de
--       `super_admin`/`rh`. Os 3 diretores da base tem `acesso_todas_unidades = false` e uma
--       unica unidade em `profile_unidades` (2 na SMS, 1 no HMI), e ainda assim os dois da SMS
--       podiam decidir os 5 pedidos pendentes do HMI.
--
--   Ou seja: o pedido do usuario nao e uma ampliacao, e um FECHAMENTO. O Diretor deixa de
--   decidir a rede inteira e passa a decidir so o que e da unidade dele -- a mesma regra que o
--   RH da Unidade ja obedece.
--
-- ATENCAO: ISTO E UMA RESTRICAO, E ELA TIRA ALCANCE DE QUEM TEM HOJE
--   Depois desta migration, um Diretor da SMS nao decide mais pedido do HMI. Se aparecer
--   "sumiram os pedidos da tela de Autorizacoes" vindo de um diretor, e isto, e e o
--   comportamento pedido. Quem decide fora do proprio escopo continua sendo `super_admin` e
--   `rh` (RH Geral) -- de proposito: a autorizacao e UMA por (servidor, mes, ano) e vale para a
--   soma de TODAS as escalas da pessoa (armadilha 26), entao precisa existir alguem que enxergue
--   a rede toda quando duas unidades disputam o mesmo numero.
--
-- POR QUE O ESCOPO E O MESMO DO RH DA UNIDADE (escala da competencia OU lotacao)
--   Nao se inventa criterio novo. `fn_pode_autorizar_excecao_carga` recebe (servidor, mes, ano)
--   e nao recebe a unidade do PEDIDO -- e nao deve receber: ela e avaliada tambem dentro da
--   policy de escrita de `excecoes_escala_servidor`, no caminho do escudo da grade, onde nao ha
--   pedido nenhum. Escopar pela unidade do pedido daria duas regras diferentes para a mesma
--   pergunta, e a do escudo ficaria sem defesa.
--
--   O ramo de ESCALA cobre o Servidor Externo (v1.2.4): lotado noutro lugar, escalado aqui. O
--   ramo de LOTACAO cobre o mes cuja escala ainda nao existe. Os 5 pedidos pendentes de hoje sao
--   todos do HMI, sobre servidores escalados no HMI -- passam pelo primeiro ramo.
--
-- IDEMPOTENTE: CREATE OR REPLACE (mesma assinatura, entao os GRANTs sobrevivem) + verificacao
-- que aborta.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A funcao -- unica fonte de "quem autoriza", lida pela policy E pela tela
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_pode_autorizar_excecao_carga(
    p_servidor_id uuid,
    p_mes integer,
    p_ano integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT CASE
        -- service_role (script de conferencia, rota de maquina), mesmo bypass de
        -- fn_blocos_previstos_dia. anon nao alcanca: EXECUTE revogado abaixo.
        WHEN auth.uid() IS NULL THEN true

        -- Sem escopo: sao os dois papeis que enxergam a secretaria inteira, e a autorizacao e
        -- uma so para o mes da pessoa em TODAS as unidades. Tirar `admin` daqui e o objetivo
        -- desta migration.
        WHEN (SELECT get_my_role()) IN ('super_admin'::public.user_role,
                                        'rh'::public.user_role) THEN true

        -- Diretor e RH da Unidade: so alcancam quem e deles. Por ESCALA da competencia (cobre o
        -- servidor externo, que e lotado noutro lugar mas esta escalado aqui) OU por LOTACAO
        -- (cobre o caso de a escala do mes ainda nao existir).
        WHEN (SELECT get_my_role()) IN ('rh_unidade'::public.user_role,
                                        'admin'::public.user_role) THEN
            EXISTS (
                SELECT 1
                  FROM public.escala_mensal em
                 WHERE em.servidor_id = p_servidor_id
                   AND em.mes = p_mes
                   AND em.ano = p_ano
                   AND em.unidade_id IN (
                        SELECT pu.unidade_id FROM public.profile_unidades pu
                         WHERE pu.profile_id = auth.uid())
            )
            OR EXISTS (
                SELECT 1
                  FROM public.servidores s
                 WHERE s.id = p_servidor_id
                   AND s.unidade_id IN (
                        SELECT pu.unidade_id FROM public.profile_unidades pu
                         WHERE pu.profile_id = auth.uid())
            )

        ELSE false
    END;
$fn$;

COMMENT ON FUNCTION public.fn_pode_autorizar_excecao_carga(uuid, integer, integer) IS
    'Quem pode conceder a Autorizacao Extraordinaria de carga do servidor no mes. Fonte unica: a '
    'policy de escrita de excecoes_escala_servidor, fn_avaliar_solicitacao_excecao_carga e a tela '
    'chamam esta funcao. Sem escopo: super_admin e rh. Escopados por profile_unidades (escala da '
    'competencia ou lotacao): admin (Diretor) e rh_unidade. Demais papeis solicitam, nao concedem.';


-- ============================================================================
-- PRIVILEGIOS (armadilha 24 e 41)
-- ============================================================================
-- A assinatura nao mudou, entao os GRANTs de 20260831120000 sobrevivem ao CREATE OR REPLACE.
-- Reafirmados assim mesmo: se um dia a lista de parametros mudar, o objeto e NOVO e nasce aberto
-- a PUBLIC -- e este bloco e o que impede isso de passar despercebido.
REVOKE ALL ON FUNCTION public.fn_pode_autorizar_excecao_carga(uuid, integer, integer) FROM PUBLIC, anon;

-- Avaliada DENTRO da policy, com os privilegios de quem consulta: sem EXECUTE para
-- authenticated, TODA escrita em excecoes_escala_servidor falharia (armadilha 39).
GRANT EXECUTE ON FUNCTION public.fn_pode_autorizar_excecao_carga(uuid, integer, integer) TO authenticated, service_role;


-- ============================================================================
-- A MIGRATION CONFERE O PROPRIO RESULTADO
-- ============================================================================
DO $verificacao$
DECLARE
    v_src      text;
    v_policies integer;
BEGIN
    SELECT p.prosrc INTO v_src
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'fn_pode_autorizar_excecao_carga';

    IF v_src IS NULL THEN
        RAISE EXCEPTION 'ABORTADO: fn_pode_autorizar_excecao_carga nao existe. Banco=%, usuario=%.',
            current_database(), current_user;
    END IF;

    -- O erro que esta migration corrige, em forma de assercao: `admin` no mesmo IN de
    -- super_admin/rh e autorizacao sem escopo. SQL/plpgsql so resolve nome em execucao
    -- (armadilha 1), entao a unica conferencia possivel aqui e sobre o texto do corpo.
    IF v_src ~ 'super_admin''::public\.user_role,\s*''admin''::public\.user_role' THEN
        RAISE EXCEPTION 'ABORTADO: admin continua no ramo sem escopo -- o Diretor decidiria a rede inteira.';
    END IF;

    IF v_src NOT LIKE '%''rh_unidade''::public.user_role,%'
    OR v_src NOT LIKE '%''admin''::public.user_role%' THEN
        RAISE EXCEPTION 'ABORTADO: o ramo escopado nao contem rh_unidade E admin.';
    END IF;

    IF v_src NOT LIKE '%profile_unidades%' THEN
        RAISE EXCEPTION 'ABORTADO: o ramo escopado perdeu a checagem de profile_unidades -- escopo nenhum.';
    END IF;

    IF has_function_privilege('anon', 'public.fn_pode_autorizar_excecao_carga(uuid, integer, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: funcao continua executavel por anon. Banco=%, usuario=%.',
            current_database(), current_user;
    END IF;

    IF NOT has_function_privilege('authenticated', 'public.fn_pode_autorizar_excecao_carga(uuid, integer, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated sem EXECUTE -- TODA escrita de excecao falharia, porque a policy a avalia com os privilegios de quem consulta.';
    END IF;

    -- Policies permissivas se somam com OR: uma segunda policy de escrita decidiria no lugar
    -- desta funcao e o escopo novo nao valeria nada.
    SELECT count(*) INTO v_policies
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'excecoes_escala_servidor'
       AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');

    IF v_policies <> 1 THEN
        RAISE EXCEPTION 'ABORTADO: % policies de escrita em excecoes_escala_servidor (esperado 1).', v_policies;
    END IF;

    RAISE NOTICE 'OK: Diretor e RH da Unidade autorizam apenas dentro das proprias unidades; super_admin e rh seguem sem escopo.';
END
$verificacao$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) Como Diretor do HMI (VAGNER): os 5 pedidos pendentes do HMI tem de continuar com
--    "Autorizar"/"Recusar" habilitados em /autorizacoes-escala.
--
-- 2) Como Diretor da SMS (PATRICIA / ANA AMELIA): os pedidos do HMI tem de SUMIR da tela.
--    Isto e a mudanca -- antes eles decidiam.
--
-- 3) Como RH da Unidade do HMI: nada muda (ja funcionava; ANA CAROLINA ja concedeu 1 excecao).
--
-- 4) Como RH Geral e Administrador Geral: continuam vendo e decidindo tudo.
--
-- 5) Coordenador e Ass. Administrativo: continuam apenas solicitando.
--
-- Consulta de apoio (papel x unidades declaradas), para explicar quem enxerga o que:
--   SELECT p.role, p.full_name, u.nome
--     FROM profiles p
--     LEFT JOIN profile_unidades pu ON pu.profile_id = p.id
--     LEFT JOIN unidades u ON u.id = pu.unidade_id
--    WHERE p.role IN ('admin', 'rh_unidade')
--    ORDER BY p.role, p.full_name;
