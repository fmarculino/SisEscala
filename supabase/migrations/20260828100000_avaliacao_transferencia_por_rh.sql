-- Migration: quem AVALIA (aprova/rejeita) solicitacao de transferencia de unidade/setor
-- Data: 2026-08-28
--
-- MOTIVACAO
--   Pedido do usuario: alem do Administrador Geral, o RH Geral ('rh') e o RH da Unidade
--   ('rh_unidade') passam a autorizar transferencia. O RH Geral avalia qualquer pedido; o RH da
--   Unidade so' dentro das unidades vinculadas a ele.
--
--   Regra unica no app: src/utils/avaliacaoTransferencia.ts, aplicada na tela (o que mostra
--   botao) e na server action (o que aceita). Esta migration e a terceira camada - o que o banco
--   deixa gravar. Server action e um POST cujo id sai no bundle; tela filtrada nunca protegeu
--   action nenhuma (CLAUDE.md, armadilha 12).
--
-- O QUE ESTA MIGRATION DESCOBRIU, e que e' o motivo dela existir de verdade
--   A policy "Avaliacao de solicitacoes_transferencia so super_admin" (20260811110000) NUNCA
--   restringiu a avaliacao. Policies permissivas se somam com OR, e 20260818100000 criou, na
--   MESMA tabela, uma policy FOR ALL - "Permitir gerenciamento de solicitacoes_transferencia
--   para autorizados" - que 20260818170000 ampliou para 'ass_adm'. FOR ALL cobre UPDATE, e sem
--   WITH CHECK proprio o WITH CHECK cai para o USING. Resultado medido no texto das policies:
--   admin, coordenador, rh_unidade e ass_adm podiam marcar um pedido como 'aprovada' chamando o
--   PostgREST direto, com a sessao deles - a unica coisa que os segurava era o `if` da action.
--   E' exatamente o mesmo padrao da armadilha 24 (o GRANT que nao restringia nada): a policy
--   estrita existe, e a permissiva ao lado dela e' que decide.
--
--   Por isso a FOR ALL sai e as tres operacoes passam a ser escritas separadamente. SELECT e
--   INSERT continuam com o alcance que a FOR ALL dava (inclusive para 'ass_adm', que so' entra
--   na tabela por ela) - quem SOLICITA nao muda. So' o UPDATE fica restrito.
--
-- ⚠️ 'rh_unidade' precisa de ORIGEM **e** DESTINO no escopo dele para APROVAR, e isso nao e'
--   rigor gratuito: a policy "Scoped access for Admins and Coordinators" (20260818100000) so'
--   deixa esse papel escrever em `servidores` cuja unidade_id esta em profile_unidades, e o
--   WITH CHECK roda sobre a linha NOVA. Mandar o servidor para outra unidade seria recusado la'
--   de qualquer forma, e o sintoma seria "nenhuma alteracao foi gravada" sem explicacao nenhuma.
--   Transferencia ENTRE unidades continua com o RH Geral / Administrador Geral, que enxergam as
--   duas pontas. REJEITAR nao escreve em `servidores`, entao basta a origem - o USING cobre os
--   dois casos e o WITH CHECK e' que exige o destino.
--
-- ⚠️ `acesso_todas_unidades` NAO e' aceito como bypass para 'rh_unidade' aqui. A policy de
--   escrita de `servidores` tem esse bypass so' no braco de admin/coordenador; o braco de
--   'rh_unidade' olha unicamente profile_unidades. Aceitar a flag aqui liberaria o UPDATE da
--   solicitacao para depois o UPDATE de `servidores` falhar - pedido marcado como aprovado com o
--   servidor parado no lugar, que e' o defeito de 10/08/2026 (KETTELE) de volta.
--
-- NAO TOCA em historico_transferencias. A FOR ALL de la' tem a mesma folga (coordenador/ass_adm
-- conseguem inserir), mas aquilo e' log: escrever nele nao move ninguem, e mexer no que a
-- aprovacao usa para gravar historico no mesmo passo em que se mexe em quem aprova aumentaria a
-- superficie desta mudanca sem necessidade. Fica registrado como pendencia.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS / CREATE POLICY.


-- ============================================================================
-- 1. Fora a policy FOR ALL, que dava UPDATE (= aprovar) a quem so' devia SOLICITAR
-- ============================================================================

DROP POLICY IF EXISTS "Permitir gerenciamento de solicitacoes_transferencia para autorizados" ON public.solicitacoes_transferencia_servidor;


-- ============================================================================
-- 2. SELECT/INSERT: preserva o alcance que a FOR ALL dava, sem alcancar UPDATE
-- ============================================================================
-- As policies "Leitura ..." e "Insercao ... por escopo" (20260812100000, reescritas por
-- 20260814120000 para fn_setores_no_escopo) continuam intactas - elas escopam pela unidade/setor
-- ATUAL do servidor. As duas abaixo repoem o outro braco, o que a FOR ALL dava: enxergar/pedir
-- pela unidade de ORIGEM ou de DESTINO da propria solicitacao. E' por elas que 'ass_adm' entra.

DROP POLICY IF EXISTS "Leitura de solicitacoes_transferencia por unidade do pedido" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Leitura de solicitacoes_transferencia por unidade do pedido" ON public.solicitacoes_transferencia_servidor
    FOR SELECT TO authenticated
    USING (
        (SELECT get_my_role()) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role, 'rh_unidade'::user_role, 'ass_adm'::user_role])
        AND (
            unidade_origem_id  IN (SELECT pu.unidade_id FROM public.profile_unidades pu WHERE pu.profile_id = auth.uid())
         OR unidade_destino_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu WHERE pu.profile_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Insercao de solicitacoes_transferencia por unidade do pedido" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Insercao de solicitacoes_transferencia por unidade do pedido" ON public.solicitacoes_transferencia_servidor
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT get_my_role()) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role, 'rh_unidade'::user_role, 'ass_adm'::user_role])
        AND (
            unidade_origem_id  IN (SELECT pu.unidade_id FROM public.profile_unidades pu WHERE pu.profile_id = auth.uid())
         OR unidade_destino_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu WHERE pu.profile_id = auth.uid())
        )
    );


-- ============================================================================
-- 3. UPDATE: super_admin e RH Geral sem escopo; RH da Unidade dentro das unidades dele
-- ============================================================================

DROP POLICY IF EXISTS "Avaliacao de solicitacoes_transferencia so super_admin" ON public.solicitacoes_transferencia_servidor;
DROP POLICY IF EXISTS "Avaliacao de solicitacoes_transferencia por super_admin e RH" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Avaliacao de solicitacoes_transferencia por super_admin e RH" ON public.solicitacoes_transferencia_servidor
    FOR UPDATE TO authenticated
    USING (
        (SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'rh'::user_role])
        OR (
            (SELECT get_my_role()) = 'rh_unidade'::user_role
            AND unidade_origem_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu WHERE pu.profile_id = auth.uid())
        )
    )
    WITH CHECK (
        (SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'rh'::user_role])
        OR (
            (SELECT get_my_role()) = 'rh_unidade'::user_role
            AND unidade_origem_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu WHERE pu.profile_id = auth.uid())
            -- Aprovar preenche o destino; rejeitar/cancelar deixa como estava. Exigir o destino
            -- no escopo so' quando ele existe cobre os dois sem uma policy por status.
            AND (
                unidade_destino_id IS NULL
                OR unidade_destino_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu WHERE pu.profile_id = auth.uid())
            )
        )
    );


-- ============================================================================
-- 4. VERIFICACAO - aborta se o resultado nao for o esperado
-- ============================================================================
-- Mesma disciplina de 20260827040000/20260827050000: policy aplicada "com sucesso" e sem efeito
-- foi exatamente o que aconteceu na armadilha 24. Aqui a conferencia e' estrutural (o texto das
-- policies), porque avaliar RLS de verdade exigiria um JWT de cada papel.

DO $verifica$
DECLARE
    v_all      int;
    v_update   int;
    v_nomes    text;
BEGIN
    -- (a) Nenhuma policy FOR ALL pode ter sobrado - e' o que reabriria o UPDATE em silencio.
    SELECT count(*), string_agg(policyname, ', ')
      INTO v_all, v_nomes
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'solicitacoes_transferencia_servidor'
       AND cmd = 'ALL';

    IF v_all > 0 THEN
        RAISE EXCEPTION
            'RLS de solicitacoes_transferencia_servidor ainda tem % policy(ies) FOR ALL (%), que cobrem UPDATE e anulam a restricao de quem avalia. Banco: %, usuario: %.',
            v_all, v_nomes, current_database(), current_user;
    END IF;

    -- (b) Exatamente uma policy de UPDATE, e e' a nova.
    SELECT count(*) INTO v_update
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'solicitacoes_transferencia_servidor'
       AND cmd = 'UPDATE'
       AND policyname = 'Avaliacao de solicitacoes_transferencia por super_admin e RH';

    IF v_update <> 1 THEN
        RAISE EXCEPTION
            'Policy de UPDATE esperada nao encontrada em solicitacoes_transferencia_servidor (achou % linha(s)). Banco: %, usuario: %.',
            v_update, current_database(), current_user;
    END IF;

    SELECT count(*) INTO v_update
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'solicitacoes_transferencia_servidor'
       AND cmd = 'UPDATE';

    IF v_update <> 1 THEN
        RAISE EXCEPTION
            'Existe mais de uma policy de UPDATE em solicitacoes_transferencia_servidor (%) - policies permissivas se somam com OR, entao a mais frouxa vence. Banco: %, usuario: %.',
            v_update, current_database(), current_user;
    END IF;

    -- (c) Quem SOLICITA nao pode ter perdido nada: SELECT e INSERT continuam existindo.
    SELECT count(*) INTO v_update
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'solicitacoes_transferencia_servidor'
       AND cmd IN ('SELECT', 'INSERT');

    IF v_update < 4 THEN
        RAISE EXCEPTION
            'Esperava 4 policies de SELECT/INSERT em solicitacoes_transferencia_servidor, achei % - alguem que SOLICITA transferencia perdeu acesso. Banco: %, usuario: %.',
            v_update, current_database(), current_user;
    END IF;

    RAISE NOTICE 'OK: avaliacao de transferencia restrita a super_admin/rh (livre) e rh_unidade (escopado); solicitacao inalterada.';
END
$verifica$;


-- ============================================================================
-- CONFERENCIA MANUAL DEPOIS DE APLICAR
-- ============================================================================
--
--   1) O mapa de policies da tabela (esperado: 1 UPDATE, 2 SELECT, 2 INSERT, 0 ALL):
--
--      SELECT cmd, policyname FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'solicitacoes_transferencia_servidor'
--       ORDER BY cmd, policyname;
--
--   2) Logado como 'rh_unidade' de uma unidade com pedido pendente DENTRO dela: os botoes
--      Aprovar/Rejeitar aparecem e a aprovacao efetiva (servidores.setor_id muda,
--      historico_transferencias ganha linha, a solicitacao vai a 'aprovada').
--
--   3) Logado como o MESMO 'rh_unidade', num pedido cujo destino e' outra unidade: a linha
--      aparece SEM botao, com a explicacao. Chamando a action direto, a resposta e a mensagem de
--      escopo - e nao um erro cru de RLS.
--
--   4) Logado como 'coordenador': continua conseguindo SOLICITAR (editar a ficha do servidor
--      mudando unidade/setor gera a solicitacao) e continua sem avaliar nada.
