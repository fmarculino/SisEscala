-- =============================================================================
-- `acesso_todos_setores` SOZINHO NAO E ALCANCE GLOBAL  (29/08/2026)
-- =============================================================================
--
-- 🚨 O DEFEITO
--   fn_pode_gerir_justificativa (20260824130000) abria o ramo dos papeis escopados com
--
--       EXISTS (SELECT 1 FROM profiles p
--                WHERE p.id = auth.uid()
--                  AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))
--
--   Esse OR devolve TRUE para qualquer p_unidade_id. Mas `acesso_todos_setores` significa
--   "todos os setores DAS UNIDADES a que estou vinculado", nunca "de toda a rede" - e e assim
--   que applyAccessFilters (src/utils/permissions.ts) sempre a tratou: la, so
--   `acesso_todas_unidades` libera tudo.
--
--   Resultado: a LISTAGEM escondia as outras unidades e a GRAVACAO as aceitava. Um Coordenador
--   podia justificar, ou registrar FALTA, para servidor de qualquer unidade da rede chamando a
--   server action / o PostgREST direto. E armadilha 12 do CLAUDE.md ("tela filtrada nao protege
--   a RPC"), agora sobre veredito de conduta de servidor publico.
--
--   O espelho em TypeScript (alcancaEvento, src/utils/gestaoJustificativas.ts) tinha o MESMO
--   OR - as duas camadas concordavam entre si e divergiam de applyAccessFilters. Corrigido no
--   mesmo commit; ao mexer numa ponta, mexa na outra.
--
-- ✅ MEDIDO EM PRODUCAO EM 29/08/2026, ANTES DE CORRIGIR
--   Contas na condicao exata (papel escopado + acesso_todos_setores + NAO acesso_todas_unidades):
--     coordenador 19 de 72 | ass_adm 4 de 8 | admin 1 de 3   -> 24 contas
--   Inclusive um ass_adm SEM NENHUMA unidade vinculada: applyAccessFilters devolvia zero linha
--   para ele, e esta funcao devolvia a rede inteira.
--
--   E NUNCA FOI EXERCIDO: cruzando registrado_por_id com o escopo real de cada autor nas 314
--   linhas de justificativas_eventos, ZERO gravacoes fora do escopo. Risco, nao incidente - por
--   isso a correcao so reduz privilegio e nenhum fluxo real depende do que ela fecha.
--
-- ⚠️ O QUE NAO MUDA
--   Para as 24 contas, o alcance na PROPRIA unidade continua identico (o ramo naUnidade abaixo).
--   O que sai e apenas o alcance cross-unidade, que a tela ja escondia. Os 53 coordenadores sem
--   a flag - todos com setor vinculado, medido - passam pelo ramo de profile_setores, intacto.
--   fn_pode_reverter_desfecho NAO e tocada: ela nunca teve o OR (so super_admin/rh/rh_unidade).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_pode_gerir_justificativa(
    p_unidade_id uuid,
    p_setor_id   uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        -- service_role (sem sessao): a autorizacao daquele caminho e da server action.
        auth.uid() IS NULL
     OR (SELECT get_my_role()) = 'super_admin'::user_role
     OR (SELECT get_my_role()) = 'rh'::user_role
     OR (
            (SELECT get_my_role()) = 'rh_unidade'::user_role
        AND p_unidade_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu
                              WHERE pu.profile_id = auth.uid())
        )
     OR (
            (SELECT get_my_role()) = ANY (ARRAY['admin'::user_role,
                                                'coordenador'::user_role,
                                                'ass_adm'::user_role])
        AND (
               -- Caso 1 de applyAccessFilters: acesso a TODAS as unidades.
               -- Com acesso_todos_setores junto, e alcance total. Sem ela, os setores
               -- vinculados recortam; se nao houver nenhum, segue total (mesmo `return query`).
               (
                   EXISTS (SELECT 1 FROM public.profiles p
                            WHERE p.id = auth.uid() AND p.acesso_todas_unidades = true)
               AND (
                      EXISTS (SELECT 1 FROM public.profiles p
                               WHERE p.id = auth.uid() AND p.acesso_todos_setores = true)
                   OR NOT EXISTS (SELECT 1 FROM public.profile_setores ps
                                   WHERE ps.profile_id = auth.uid())
                   OR p_setor_id IN (SELECT ps.setor_id FROM public.profile_setores ps
                                      WHERE ps.profile_id = auth.uid())
                   )
               )

               -- Caso 2: unidades especificas. A flag herda os setores DELAS, nao os da rede -
               -- e este AND, no lugar do OR antigo, e a correcao inteira.
            OR (
                   p_unidade_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu
                                     WHERE pu.profile_id = auth.uid())
               AND EXISTS (SELECT 1 FROM public.profiles p
                            WHERE p.id = auth.uid() AND p.acesso_todos_setores = true)
               )

               -- Caso 3: setor vinculado diretamente. E por ele que passa o coordenador cujo
               -- acesso vem inteiramente de profile_setores, sem a unidade-pai vinculada
               -- (o caso do piloto da TI - ver fn_unidade_alcancavel_por_setor).
            OR p_setor_id IN (SELECT ps.setor_id FROM public.profile_setores ps
                               WHERE ps.profile_id = auth.uid())
            OR public.fn_unidade_alcancavel_por_setor(p_unidade_id)
            )
        )
$$;

COMMENT ON FUNCTION public.fn_pode_gerir_justificativa(uuid, uuid) IS
    'Quem pode ler/justificar/validar/marcar falta num evento desta unidade+setor. Espelho exato '
    'de applyAccessFilters (src/utils/permissions.ts) e de alcancaEvento '
    '(src/utils/gestaoJustificativas.ts) - as tres precisam concordar. acesso_todos_setores '
    'sozinho NAO da alcance global: ate 29/08/2026 dava, e 24 contas escopadas alcancavam a rede '
    'inteira na gravacao enquanto a listagem mostrava so a unidade delas.';

GRANT EXECUTE ON FUNCTION public.fn_pode_gerir_justificativa(uuid, uuid) TO authenticated, service_role;

-- Funcao nova nao e: o REVOKE de PUBLIC ja foi feito para ela na 20260827050000 e sobrevive ao
-- CREATE OR REPLACE (privilegios sao do objeto, nao do corpo). Reafirmado por seguranca -
-- armadilha 24: GRANT a `authenticated` nunca restringiu nada sozinho.
REVOKE EXECUTE ON FUNCTION public.fn_pode_gerir_justificativa(uuid, uuid) FROM PUBLIC, anon;


-- =============================================================================
-- CONFERENCIA (rodar depois de aplicar)
-- =============================================================================
-- 1. anon nao executa; authenticated executa.
--    SELECT has_function_privilege('anon',          'public.fn_pode_gerir_justificativa(uuid,uuid)', 'EXECUTE') AS anon_nao_deve,
--           has_function_privilege('authenticated', 'public.fn_pode_gerir_justificativa(uuid,uuid)', 'EXECUTE') AS auth_deve;
--
-- 2. As 24 contas continuam alcancando a PROPRIA unidade e perdem as outras. Substitua o uuid
--    por um dos perfis medidos; roda como service_role, entao compara so o corpo do escopo:
--    WITH alvo AS (
--      SELECT p.id,
--             (SELECT array_agg(pu.unidade_id) FROM profile_unidades pu WHERE pu.profile_id = p.id) AS unids
--        FROM profiles p
--       WHERE p.role IN ('admin','coordenador','ass_adm')
--         AND p.acesso_todos_setores AND NOT p.acesso_todas_unidades
--    )
--    SELECT count(*) AS contas_afetadas FROM alvo;   -- esperado: 24 em 29/08/2026
--
-- 3. Nenhuma justificativa foi gravada fora do escopo ate aqui (esperado: 0). O cruzamento
--    completo esta em scratchpad/an_escrita_fora_escopo.mjs, que roda por PostgREST.
