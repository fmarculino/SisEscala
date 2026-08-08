-- Migration: Restringe a insercao em logs_tentativas_presenca a funcao oficial de log
-- Data: 2026-08-07
--
-- SINTOMA
--   Nenhum sintoma visivel. E um vetor de escrita, nao um bug de comportamento.
--
-- CAUSA
--   20260611185000_add_presence_attempts_logging.sql criou:
--
--     CREATE POLICY "Allow authenticated insert logs" ON public.logs_tentativas_presenca
--         FOR INSERT TO authenticated
--         WITH CHECK (true);
--
--   WITH CHECK (true) significa que QUALQUER usuario autenticado pode inserir uma linha
--   arbitraria nessa tabela: servidor_id de outra pessoa, data_hora_tentativa escolhida a dedo
--   e mensagem_erro contendo a palavra "janela".
--
--   Isso deixou de ser inofensivo em 20260807090000, quando fn_batidas_reais_recusadas passou
--   a ler essa tabela para recuperar o horario real de uma batida recusada e grava-lo na folha
--   de ponto durante a validacao manual. O filtro de elegibilidade daquela funcao e:
--
--     AND (lt.mensagem_erro ILIKE '%janela%' OR lt.mensagem_erro ILIKE '%erro interno%')
--     AND lt.mensagem_erro NOT ILIKE '%matr_cula ou pin%'
--
--   Ou seja: uma linha forjada com mensagem_erro = 'Fora da janela de presenca permitida.' e
--   o horario desejado passa no filtro e vira horario de ponto na folha. O caminho completo,
--   partindo de um usuario autenticado comum, e insercao direta -> validacao manual do
--   coordenador -> horario fabricado na folha de ponto de um servidor publico.
--
-- CORRECAO
--   Remover a policy de INSERT e revogar o privilegio de INSERT dos roles de aplicacao.
--   A tabela passa a ser gravavel exclusivamente por public.fn_log_tentativa_negada, que e
--   SECURITY DEFINER SET search_path = public (20260721203000) e portanto executa como dona
--   da tabela, sem passar por RLS.
--
-- POR QUE ISSO NAO QUEBRA O TERMINAL DE PONTO
--   O unico caminho de escrita real hoje ja e a funcao. Conferido em 07/08/2026:
--     - todas as chamadas de fn_log_tentativa_negada estao dentro de fn_confirmar_presenca
--       (que tambem e SECURITY DEFINER);
--     - grep -rn "logs_tentativas_presenca" src/ retorna apenas SELECT (auditoria/page.tsx
--       nas abas de leitura e ScaleGrid.tsx no modal de validacao manual). Nenhum insert.
--
--   A leitura NAO e alterada: a policy "Allow authorized users read logs" (20260804060000),
--   que libera super_admin, admin e coordenador, continua valendo.
--
-- IDEMPOTENTE
--   DROP POLICY IF EXISTS e REVOKE sao seguros em repeticao e nos dois ambientes
--   (CLAUDE.md armadilha 3). REVOKE de privilegio ja ausente nao e erro.

-- 1. Remove a policy permissiva de INSERT.
DROP POLICY IF EXISTS "Allow authenticated insert logs" ON public.logs_tentativas_presenca;

-- Sem policy de INSERT e com RLS habilitado, todo INSERT vindo de authenticated/anon e negado.
-- Nenhuma policy nova e criada de proposito: nao existe insercao legitima fora da funcao.

-- 2. Defesa em profundidade: revoga o privilegio de tabela.
--    RLS sozinha nao protegeria service_role, que tem BYPASSRLS; grants sim.
REVOKE INSERT, UPDATE, DELETE ON public.logs_tentativas_presenca FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.logs_tentativas_presenca FROM authenticated;

-- 3. Garante que a funcao oficial continua executavel por quem usa o terminal.
GRANT EXECUTE ON FUNCTION public.fn_log_tentativa_negada(
    UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO authenticated, service_role;


COMMENT ON TABLE public.logs_tentativas_presenca IS
    'Tentativas de batida negadas no terminal. Gravada exclusivamente por fn_log_tentativa_negada '
    '(SECURITY DEFINER). Alimenta fn_batidas_reais_recusadas, que transforma tentativa recusada em '
    'horario de folha de ponto - por isso a insercao direta e bloqueada.';


-- CONFERENCIA APOS APLICAR
--   1) Nao deve existir mais nenhuma policy de INSERT (esperado: 0 linhas):
--
--   SELECT policyname, cmd, with_check
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename = 'logs_tentativas_presenca'
--      AND cmd = 'INSERT';
--
--   2) A policy de leitura deve continuar existindo:
--
--   SELECT policyname, cmd
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename = 'logs_tentativas_presenca';
--   -- esperado: "Allow authorized users read logs" | SELECT
--
--   3) authenticated nao deve mais ter INSERT (esperado: 0 linhas):
--
--   SELECT grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND table_name = 'logs_tentativas_presenca'
--      AND grantee IN ('anon', 'authenticated')
--      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
--
--   4) TESTE FUNCIONAL OBRIGATORIO - o terminal precisa continuar logando recusa.
--      Em /presenca, bater com uma matricula valida fora da janela de presenca e conferir que
--      a tentativa aparece na auditoria (aba "Negadas"):
--
--   SELECT data_hora_tentativa, matricula_digitada, mensagem_erro
--     FROM public.logs_tentativas_presenca
--    ORDER BY data_hora_tentativa DESC
--    LIMIT 5;
