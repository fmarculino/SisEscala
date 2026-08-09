-- Migration: RLS alinhada ao que as telas restringem
-- Data: 2026-08-09
--
-- Estudo: docs/planos/2026-08-09-auditoria-logs-retencao.md (Fase E)
--
-- O PRINCIPIO
--   Restringir so na tela nao restringe. O grupo AUDITORIA & GESTAO e oculto para coordenadores
--   desde a v1.2.1, e a aba de tentativas negadas e super_admin apenas - mas se a policy libera
--   SELECT, um coordenador le os mesmos dados pela API. E o mesmo raciocinio que fez o Portal do
--   Servidor validar no servidor em vez de so desabilitar o input.
--
-- O QUE MUDA
--   1. As tres tabelas do aviso de ponto passam a ser super_admin/admin. Foram criadas por mim em
--      20260809120000 e 20260809130000 liberando SELECT tambem a coordenador - excesso meu.
--      Nenhuma tela le essas tabelas hoje, entao apertar e risco zero.
--
--   2. logs_sistema deixa de expor as entradas de PERFIL a quem nao e super_admin. Depois da
--      Fase B, essa tabela carrega o diff de mudanca de papel e de escopo de acesso
--      (USUARIO_PAPEL_ALTERADO, USUARIO_PERMISSOES_ALTERADAS, USUARIO_SENHA_REDEFINIDA). A policy
--      vigente libera por unidade, e um coordenador com acesso_todas_unidades passaria a enxergar
--      quem concedeu qual privilegio a quem - informacao de governanca, nao de operacao.
--
-- O QUE NAO MUDA, E POR QUE
--   logs_tentativas_presenca CONTINUA legivel por coordenador. A grade de escala lista as batidas
--   recusadas no modal de validacao manual atraves de fn_tentativas_recusadas_mes, que e
--   SECURITY INVOKER de proposito - a RLS da tabela e que autoriza. Apertar aqui quebraria a
--   validacao manual em producao, que e justamente o fluxo que recupera horario real de batida
--   negada por bug.
--
--   logs_sobreaviso tambem continua: a grade, os relatorios e o NotificationListener leem direto.
--
--   A insercao em logs_sistema segue liberada a qualquer autenticado com WITH CHECK
--   (auth.uid() = user_id) - apertar a leitura nao pode impedir ninguem de PRODUZIR trilha.


-- ============================================================================
-- 1. TABELAS DO AVISO DE PONTO
-- ============================================================================
-- Guardam consentimento, telefone e o TEXTO das mensagens - que inclui os horarios de ponto da
-- pessoa. Sao dado pessoal, e a tela que os exibe e restrita ao administrador geral.

DO $rls$
DECLARE
    v_tabela text;
BEGIN
    FOREACH v_tabela IN ARRAY ARRAY['logs_preferencia_aviso_ponto', 'avisos_ponto_fila', 'logs_webhook_whatsapp']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
            CASE v_tabela
                WHEN 'logs_preferencia_aviso_ponto' THEN 'Consentimento visivel a quem administra'
                WHEN 'avisos_ponto_fila'            THEN 'Fila visivel a quem administra'
                ELSE 'Webhook visivel a quem administra'
            END, v_tabela);

        EXECUTE format($sql$
            CREATE POLICY "Visivel apenas a administradores" ON public.%I
                FOR SELECT TO authenticated
                USING (EXISTS (
                    SELECT 1 FROM public.profiles p
                     WHERE p.id = (SELECT auth.uid())
                       AND p.role IN ('admin', 'super_admin')
                ))
        $sql$, v_tabela);
    END LOOP;
END
$rls$;


-- ============================================================================
-- 2. logs_sistema — entradas de PERFIL sao so do administrador geral
-- ============================================================================
-- A policy vigente e permissiva por unidade. Adicionar uma segunda policy nao restringe nada
-- (policies permissivas se somam com OR), entao a existente precisa ser RECRIADA com a condicao
-- extra. Tudo que nao e entidade 'profile' mantem exatamente o comportamento anterior.

DROP POLICY IF EXISTS "Logs visiveis por quem tem acesso a unidade" ON public.logs_sistema;

CREATE POLICY "Logs visiveis por quem tem acesso a unidade" ON public.logs_sistema
    FOR SELECT TO public
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
             WHERE p.id = (SELECT auth.uid())
               AND (
                     p.role = 'super_admin'::user_role
                  OR p.acesso_todas_unidades
                  OR logs_sistema.unidade_id = p.unidade_id
                  OR EXISTS (SELECT 1 FROM public.profile_unidades pu
                              WHERE pu.profile_id = p.id
                                AND pu.unidade_id = logs_sistema.unidade_id)
                   )
               -- Mudanca de papel, de escopo de acesso e redefinicao de senha sao governanca.
               -- Quem administra a propria unidade nao precisa ver quem deu privilegio a quem.
               AND (logs_sistema.entidade IS DISTINCT FROM 'profile'
                    OR p.role = 'super_admin'::user_role)
        )
    );


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. As policies estao onde se espera:
--
--      SELECT tablename, policyname, cmd FROM pg_policies
--       WHERE tablename IN ('logs_preferencia_aviso_ponto','avisos_ponto_fila',
--                           'logs_webhook_whatsapp','logs_sistema')
--       ORDER BY tablename, policyname;
--
--   2. logs_tentativas_presenca NAO foi tocada - a validacao manual depende dela
--      (esperado: a policy de 20260804060000 continua ali):
--
--      SELECT policyname FROM pg_policies WHERE tablename = 'logs_tentativas_presenca';
--
--   3. Teste funcional que importa: abrir a grade de escala como COORDENADOR e conferir que o
--      modal de validacao manual continua listando as batidas recusadas. Se parar de listar,
--      esta migration foi longe demais - reverta o item 2.
--
--   4. A trilha continua sendo PRODUZIDA normalmente (o INSERT nao foi tocado):
--
--      SELECT count(*) FROM logs_sistema WHERE created_at > now() - interval '1 day';
