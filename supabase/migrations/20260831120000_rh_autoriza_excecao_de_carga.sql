-- ============================================================================
-- O RH passa a CONCEDER a Autorizacao Extraordinaria de carga mensal
-- ============================================================================
-- 31/08/2026 - decisao do usuario: "no caso dos RH sao eles quem autoriza, entao se tiver no
-- perfil deles eles ja deveriam poder incluir".
--
-- O QUE ESTAVA ERRADO
--   O teto mensal (300h / 20 unidades de sobreaviso) so podia ser ultrapassado com uma linha em
--   `excecoes_escala_servidor`, e a escrita ali era `role IN ('super_admin','admin')` desde
--   20260811140000 -- de novo escrita antes de `rh`/`rh_unidade` existirem.
--
--   Medido em producao em 31/08/2026: 2 super_admin + 3 admin = **5 pessoas** podem autorizar,
--   contra 73 coordenadores, 8 RH Geral, 7 RH da Unidade e 8 Ass. Administrativo que lancam
--   escala. E as duas unicas autorizacoes que existem na base foram dadas pelo mesmo
--   super_admin (sobreaviso da TI da SMS, 08 e 09/2026) -- o mecanismo funciona, o gargalo e
--   quem tem a chave.
--
-- O QUE MUDA
--   Passam a conceder: super_admin, admin, RH Geral (`rh`) e RH da Unidade (`rh_unidade`).
--   Coordenador e Ass. Administrativo continuam SEM conceder -- eles passam a SOLICITAR, na
--   migration seguinte (20260831130000).
--
-- ATENCAO: RH DA UNIDADE E ESCOPO, E ISTO NAO E FORMALIDADE
--   A autorizacao e UMA por (servidor, mes, ano) desde 20260828120000, e vale para a soma de
--   TODAS as escalas da pessoa na competencia -- por construcao (armadilha 26: se fosse por
--   unidade, duas unidades concederiam +100h cada e o teto viraria 500h sem ninguem decidir
--   isso). Consequencia direta: quem autoriza mexe num numero que a OUTRA unidade tambem usa.
--
--   Por isso `fn_pode_autorizar_excecao_carga` exige que o servidor esteja no escopo do RH da
--   Unidade -- por escala da competencia OU por lotacao. E por isso `fn_excecao_carga_detalhe`
--   existe: a tela mostra quem concedeu a autorizacao vigente e quando, ANTES de gravar por
--   cima. Sobrescrever continua possivel (as vezes e o certo: reduzir o que se concedeu demais);
--   o que nao pode e sobrescrever sem ver.
--
-- ATENCAO: policies permissivas se somam com OR -- por isso a policy antiga e DERRUBADA em vez
--   de ganhar uma irma. Duas policies de escrita na mesma tabela seria a armadilha de
--   `solicitacoes_transferencia_servidor` (20260828100000) outra vez: a estrita existe, a
--   permissiva ao lado dela e que decide.
--
-- A leitura (`USING (true)` de 20260811140000) NAO muda: e decisao registrada na armadilha 39 --
-- sao UUID, numeros e data, sem nome nem CPF, e escopar quebraria o teto consolidado, que
-- precisa enxergar a autorizacao dada a partir de outra unidade.
--
-- IDEMPOTENTE: CREATE OR REPLACE + DROP POLICY IF EXISTS + verificacao que aborta.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Fonte unica de "quem autoriza" -- policy e tela leem a MESMA funcao
-- ----------------------------------------------------------------------------
-- Se a tela decidisse por conta propria quem ve o botao, ela e a policy divergiriam no primeiro
-- papel novo -- exatamente o defeito que esta migration corrige. A tela chama esta funcao.
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

        WHEN (SELECT get_my_role()) IN ('super_admin'::public.user_role,
                                        'admin'::public.user_role,
                                        'rh'::public.user_role) THEN true

        -- RH da Unidade: so alcanca quem e dele. Por ESCALA da competencia (cobre o servidor
        -- externo, que e lotado noutro lugar mas esta escalado aqui) OU por LOTACAO (cobre o
        -- caso de a escala do mes ainda nao existir).
        WHEN (SELECT get_my_role()) = 'rh_unidade'::public.user_role THEN
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
    'policy de escrita de excecoes_escala_servidor E a tela chamam esta funcao. RH da Unidade so '
    'alcanca servidor do escopo dele (escala da competencia ou lotacao) porque a autorizacao e '
    'uma por (servidor, mes, ano) e vale para a rede toda.';


-- ----------------------------------------------------------------------------
-- 2. Detalhe da autorizacao vigente, com o NOME de quem concedeu
-- ----------------------------------------------------------------------------
-- `fn_teto_carga_servidor` ja devolve `autorizado_por` (uuid) e `autorizado_em`, mas nao o nome
-- -- e a tela nao consegue resolver isso sozinha: a policy de `profiles` ("Users can view own
-- profile") so libera a tabela inteira para super_admin, entao um coordenador consultando o
-- autor receberia zero linhas.
--
-- ATENCAO: funcao NOVA em vez de acrescentar coluna a fn_teto_carga_servidor de proposito.
-- Mudar a lista de colunas de um RETURNS TABLE exige DROP + CREATE (42P13), e aquela funcao tem
-- tres consumidores vivos, um deles dentro de outra funcao SQL (fn_carga_mensal_consolidada).
-- Nao vale arriscar o caminho do teto para exibir um nome.
CREATE OR REPLACE FUNCTION public.fn_excecao_carga_detalhe(
    p_servidor_ids uuid[],
    p_mes integer,
    p_ano integer
)
RETURNS TABLE (
    servidor_id                        uuid,
    horas_adicionais_autorizadas       numeric,
    sobreavisos_adicionais_autorizados integer,
    motivo_justificativa               text,
    autorizado_por                     uuid,
    autorizado_por_nome                text,
    autorizado_em                      timestamptz,
    unidade_id                         uuid,
    unidade_nome                       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT ex.servidor_id,
           ex.horas_adicionais_autorizadas,
           ex.sobreavisos_adicionais_autorizados,
           ex.motivo_justificativa,
           ex.autorizado_por,
           COALESCE(NULLIF(btrim(pr.full_name), ''), 'Usuario do sistema'),
           ex.updated_at,
           ex.unidade_id,
           u.nome
      FROM public.excecoes_escala_servidor ex
      LEFT JOIN public.profiles  pr ON pr.id = ex.autorizado_por
      LEFT JOIN public.unidades  u  ON u.id  = ex.unidade_id
     WHERE ex.mes = p_mes
       AND ex.ano = p_ano
       AND ex.servidor_id = ANY(COALESCE(p_servidor_ids, ARRAY[]::uuid[]))
       -- Mesma populacao de quem opera escala: os papeis do Portal nao tem esta tela.
       AND public.fn_pode_escalar_servidor_externo();
$fn$;

COMMENT ON FUNCTION public.fn_excecao_carga_detalhe(uuid[], integer, integer) IS
    'Autorizacao Extraordinaria vigente do mes com o NOME de quem concedeu e a unidade de onde '
    'ela partiu, para a tela nunca gravar por cima da decisao de outra unidade sem mostra-la.';


-- ----------------------------------------------------------------------------
-- 3. A policy de escrita passa a ler a funcao
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Escrita de excecoes por admins" ON public.excecoes_escala_servidor;
DROP POLICY IF EXISTS "Escrita de excecoes por quem autoriza carga" ON public.excecoes_escala_servidor;

CREATE POLICY "Escrita de excecoes por quem autoriza carga"
ON public.excecoes_escala_servidor
FOR ALL
TO authenticated
USING (public.fn_pode_autorizar_excecao_carga(servidor_id, mes, ano))
WITH CHECK (public.fn_pode_autorizar_excecao_carga(servidor_id, mes, ano));


-- ============================================================================
-- PRIVILEGIOS (armadilha 24)
-- ============================================================================
REVOKE ALL ON FUNCTION public.fn_pode_autorizar_excecao_carga(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_excecao_carga_detalhe(uuid[], integer, integer) FROM PUBLIC, anon;

-- `fn_pode_autorizar_excecao_carga` e avaliada DENTRO da policy, com os privilegios de quem
-- consulta: sem EXECUTE para authenticated, toda escrita na tabela falharia (armadilha 39).
GRANT EXECUTE ON FUNCTION public.fn_pode_autorizar_excecao_carga(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_excecao_carga_detalhe(uuid[], integer, integer) TO authenticated, service_role;


-- ============================================================================
-- A MIGRATION CONFERE O PROPRIO RESULTADO
-- ============================================================================
DO $verificacao$
DECLARE
    v_policies integer;
BEGIN
    IF has_function_privilege('anon', 'public.fn_pode_autorizar_excecao_carga(uuid, integer, integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.fn_excecao_carga_detalhe(uuid[], integer, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: funcao de autorizacao de carga continua executavel por anon. Banco=%, usuario=%.',
            current_database(), current_user;
    END IF;

    IF NOT has_function_privilege('authenticated', 'public.fn_pode_autorizar_excecao_carga(uuid, integer, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated sem EXECUTE em fn_pode_autorizar_excecao_carga -- TODA escrita de excecao falharia, porque a policy a avalia com os privilegios de quem consulta.';
    END IF;

    -- Duas policies de escrita voltariam a se somar com OR e a mais frouxa decidiria.
    SELECT count(*) INTO v_policies
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'excecoes_escala_servidor'
       AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');

    IF v_policies <> 1 THEN
        RAISE EXCEPTION 'ABORTADO: % policies de escrita em excecoes_escala_servidor (esperado 1). Policies permissivas se somam com OR.', v_policies;
    END IF;

    RAISE NOTICE 'OK: RH Geral e RH da Unidade passam a conceder Autorizacao Extraordinaria; policy unica.';
END
$verificacao$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) Como RH Geral, numa grade com servidor acima do teto: o escudo tem de abrir a Autorizacao
--    Extraordinaria e o "Salvar" tem de gravar (antes era erro de RLS).
--
-- 2) Como RH da Unidade, sobre servidor de OUTRA unidade sem escala nas unidades dele: a
--    gravacao tem de ser RECUSADA pela policy. Sobre servidor escalado numa unidade dele
--    (inclusive servidor externo), tem de gravar.
--
-- 3) Como coordenador: continua sem conceder. Ele solicita (20260831130000).
--
-- 4) Autorizacao ja existente concedida por outra unidade: o modal tem de exibir quem concedeu
--    e quando, vindo de fn_excecao_carga_detalhe, antes de qualquer gravacao.
--
-- 5) A chave anon nao pode alcancar nenhuma das duas funcoes novas.
