-- Escopo de setor passa a alcancar os SUBSETORES (descendentes em parent_id).
--
-- Ate aqui o vinculo de um perfil a um setor era testado de forma PLANA:
--   setor_id IN (SELECT setor_id FROM profile_setores WHERE profile_id = auth.uid())
-- Quem estava vinculado a DMAC nao enxergava DMAC/REGULACAO nem DMAC/TFD; quem estava em
-- ADMINISTRACAO/APOIO nao enxergava ADMINISTRACAO/APOIO/SERVICOS GERAIS. A hierarquia de
-- setores so era usada para DESENHAR a lista, nunca para permissao -- nao havia um unico
-- WITH RECURSIVE sobre setores no projeto.
--
-- Medido em producao em 14/08/2026, antes desta migration:
--   12 perfis escopados por setor vinculados a um setor com filhos;
--   7 deles (DMAC) sem enxergar 34 servidores Ativos cada;
--   3 servidores lotados em setor de nivel 3 invisiveis para o coordenador do setor-pai.
-- Duas coordenadoras do CAF ja contornavam o problema na mao, vinculadas aos 4 polos um a um.
--
-- Esta migration NAO amplia escopo para quem nao tinha nenhum: so faz o vinculo existente
-- alcancar o que a arvore da tela de Setores sempre sugeriu que ele alcancava.

-- ============================================================================
-- 1. Fonte unica da expansao hierarquica
-- ============================================================================

-- SECURITY DEFINER e obrigatorio: o passo recursivo precisa enxergar setores que o proprio
-- usuario ainda nao alcanca -- e justamente o que estamos calculando. Sem isso a policy de
-- `setores` limitaria a recursao a si mesma.
-- UNION (nao UNION ALL) encerra a recursao se algum parent_id formar ciclo.
CREATE OR REPLACE FUNCTION public.fn_setores_no_escopo(p_profile_id uuid DEFAULT auth.uid())
RETURNS TABLE (setor_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH RECURSIVE base AS (
    SELECT ps.setor_id AS id
    FROM public.profile_setores ps
    WHERE ps.profile_id = p_profile_id
    UNION
    SELECT s.id
    FROM public.setores s
    JOIN base b ON s.parent_id = b.id
  )
  SELECT id FROM base;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_setores_no_escopo(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_setores_no_escopo(uuid) IS
  'Setores do perfil MAIS todos os descendentes por parent_id. Fonte unica do escopo de setor nas policies. Ver tambem setores_no_escopo(profiles), a versao coluna computada usada pelo frontend.';

-- Coluna computada do PostgREST: `select=setores_no_escopo` sobre `profiles` devolve o mesmo
-- conjunto ja expandido, para o filtro do lado do cliente (applyAccessFilters) nao divergir
-- da RLS. O frontend montava `permitted_setores` lendo o embed cru de profile_setores.
CREATE OR REPLACE FUNCTION public.setores_no_escopo(public.profiles)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(array_agg(e.setor_id), '{}'::uuid[])
  FROM public.fn_setores_no_escopo($1.id) e;
$fn$;

GRANT EXECUTE ON FUNCTION public.setores_no_escopo(public.profiles) TO authenticated;

-- ============================================================================
-- 2. Policies -- 17 policies em 9 tabelas
--
-- Corpos copiados VERBATIM da migration que define a versao vigente de cada uma; a unica
-- alteracao e a troca do subselect de profile_setores por fn_setores_no_escopo().
-- ============================================================================

-- ---------- escala_diaria ----------

-- origem: 20260812070000_scope_rh_roles_in_escala_folha_rls.sql  (1x)
DROP POLICY IF EXISTS "Admins e Coordenadores gerenciam escala_diaria" ON public.escala_diaria;
CREATE POLICY "Admins e Coordenadores gerenciam escala_diaria" ON public.escala_diaria
  FOR ALL TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    ((SELECT get_my_role()) = 'rh'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
     EXISTS (
       SELECT 1 FROM public.escala_mensal em
       WHERE em.id = escala_diaria.escala_mensal_id AND (
         (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
         (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
          AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
         (em.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
       )
     )) OR
    (((SELECT get_my_role()) = 'rh_unidade'::user_role) AND
     EXISTS (
       SELECT 1 FROM public.escala_mensal em
       WHERE em.id = escala_diaria.escala_mensal_id
         AND em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
     ))
  );

-- ---------- escala_mensal ----------

-- origem: 20260812070000_scope_rh_roles_in_escala_folha_rls.sql  (1x)
DROP POLICY IF EXISTS "Admins e Coordenadores gerenciam escalas" ON public.escala_mensal;
CREATE POLICY "Admins e Coordenadores gerenciam escalas" ON public.escala_mensal
  FOR ALL TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    ((SELECT get_my_role()) = 'rh'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
       AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
      (setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
    )) OR
    (((SELECT get_my_role()) = 'rh_unidade'::user_role) AND
     (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())))
  );

-- ---------- folha_ponto ----------

-- origem: 20260812070000_scope_rh_roles_in_escala_folha_rls.sql  (1x)
DROP POLICY IF EXISTS "Admins e Coordenadores podem ler folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem ler folhas de ponto" ON public.folha_ponto
    FOR SELECT TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        ((SELECT get_my_role()) = 'rh'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
                  AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
                 (em.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
             )
         )) OR
        (((SELECT get_my_role()) = 'rh_unidade'::user_role) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id
               AND em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
         ))
    );

-- origem: 20260812070000_scope_rh_roles_in_escala_folha_rls.sql  (1x)
DROP POLICY IF EXISTS "Admins e Coordenadores podem inserir folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem inserir folhas de ponto" ON public.folha_ponto
    FOR INSERT TO authenticated
    WITH CHECK (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        ((SELECT get_my_role()) = 'rh'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = escala_mensal_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
                  AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
                 (em.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
             )
         )) OR
        (((SELECT get_my_role()) = 'rh_unidade'::user_role) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = escala_mensal_id
               AND em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
         ))
    );

-- origem: 20260812070000_scope_rh_roles_in_escala_folha_rls.sql  (1x)
DROP POLICY IF EXISTS "Admins e Coordenadores podem atualizar folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem atualizar folhas de ponto" ON public.folha_ponto
    FOR UPDATE TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        ((SELECT get_my_role()) = 'rh'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
                  AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
                 (em.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
             )
         )) OR
        (((SELECT get_my_role()) = 'rh_unidade'::user_role) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id
               AND em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
         ))
    );

-- origem: 20260812070000_scope_rh_roles_in_escala_folha_rls.sql  (1x)
DROP POLICY IF EXISTS "Admins e Coordenadores podem deletar folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem deletar folhas de ponto" ON public.folha_ponto
    FOR DELETE TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        ((SELECT get_my_role()) = 'rh'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
                  AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
                 (em.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
             )
         )) OR
        (((SELECT get_my_role()) = 'rh_unidade'::user_role) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id
               AND em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
         ))
    );

-- ---------- historico_transferencias ----------

-- origem: 20260612100000_add_servidores_transfer_history.sql  (1x)
DROP POLICY IF EXISTS "Admins e Coordenadores podem ler historico_transferencias" ON public.historico_transferencias;
CREATE POLICY "Admins e Coordenadores podem ler historico_transferencias" ON public.historico_transferencias
    FOR SELECT TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.servidores s
             WHERE s.id = historico_transferencias.servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
             )
         ))
    );

-- origem: 20260612100000_add_servidores_transfer_history.sql  (1x)
DROP POLICY IF EXISTS "Admins e Coordenadores podem inserir historico_transferencias" ON public.historico_transferencias;
CREATE POLICY "Admins e Coordenadores podem inserir historico_transferencias" ON public.historico_transferencias
    FOR INSERT TO authenticated
    WITH CHECK (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.servidores s
             WHERE s.id = servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
             )
         ))
    );

-- ---------- logs_sobreaviso ----------

-- origem: 20260808180000_fn_acionar_sobreaviso.sql  (1x)
DROP POLICY IF EXISTS "Admins e Coordenadores leem logs_sobreaviso" ON public.logs_sobreaviso;
CREATE POLICY "Admins e Coordenadores leem logs_sobreaviso" ON public.logs_sobreaviso
  FOR SELECT TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
       AND (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
      (EXISTS (
        SELECT 1 FROM public.escala_mensal em
        WHERE em.id = logs_sobreaviso.escala_mensal_id AND
        em.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e)
      ))
    ))
  );

-- origem: 20260808180000_fn_acionar_sobreaviso.sql  (1x)
DROP POLICY IF EXISTS "Admins e Coordenadores atualizam logs_sobreaviso" ON public.logs_sobreaviso;
CREATE POLICY "Admins e Coordenadores atualizam logs_sobreaviso" ON public.logs_sobreaviso
  FOR UPDATE TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
       AND (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
      (EXISTS (
        SELECT 1 FROM public.escala_mensal em
        WHERE em.id = logs_sobreaviso.escala_mensal_id AND
        em.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e)
      ))
    ))
  );

-- origem: 20260808180000_fn_acionar_sobreaviso.sql  (1x)
DROP POLICY IF EXISTS "Admins e Coordenadores apagam logs_sobreaviso" ON public.logs_sobreaviso;
CREATE POLICY "Admins e Coordenadores apagam logs_sobreaviso" ON public.logs_sobreaviso
  FOR DELETE TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
       AND (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
      (EXISTS (
        SELECT 1 FROM public.escala_mensal em
        WHERE em.id = logs_sobreaviso.escala_mensal_id AND
        em.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e)
      ))
    ))
  );

-- ---------- servidores ----------

-- origem: 20260626225000_fix_external_servers_rls.sql  (2x)
DROP POLICY IF EXISTS "Users can view relevant servers" ON public.servidores;
CREATE POLICY "Users can view relevant servers" ON public.servidores
  FOR SELECT TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role) OR 
     (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
     (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))
      AND (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR 
     (setor_id IN ( SELECT e.setor_id FROM public.fn_setores_no_escopo() e)) OR
     (EXISTS (
        SELECT 1 FROM public.escala_mensal em
        WHERE em.servidor_id = servidores.id
          AND (
            em.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e)
            OR em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
            OR (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true)))
          )
     ))
    )
  );

-- origem: 20260618080000_restrict_admin_by_sector.sql  (1x)
DROP POLICY IF EXISTS "Scoped access for Admins and Coordinators" ON public.servidores;
CREATE POLICY "Scoped access for Admins and Coordinators" ON public.servidores
  FOR ALL TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))
       AND (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR 
      (setor_id IN ( SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
    ))
  );

-- ---------- servidores_eventos ----------

-- origem: 20260812070000_scope_rh_roles_in_escala_folha_rls.sql  (1x)
DROP POLICY IF EXISTS "Coordinators and Admins can manage relevant servant events" ON public.servidores_eventos;
CREATE POLICY "Coordinators and Admins can manage relevant servant events" ON public.servidores_eventos
  FOR ALL TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role)) OR
    (( SELECT get_my_role() AS get_my_role) = 'rh'::user_role) OR
    (
      (( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
      EXISTS (
        SELECT 1 FROM public.servidores s
        WHERE s.id = servidores_eventos.servidor_id AND (
          (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
          (s.unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))) OR
          (s.setor_id IN ( SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
        )
      )
    ) OR
    (
      (( SELECT get_my_role() AS get_my_role) = 'rh_unidade'::user_role) AND
      EXISTS (
        SELECT 1 FROM public.servidores s
        WHERE s.id = servidores_eventos.servidor_id
          AND s.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
      )
    )
  );

-- ---------- setores ----------

-- origem: 20260523000000_v1_0_0_production_hardening.sql  (1x)
DROP POLICY IF EXISTS "Scoped access for Setores" ON public.setores;
CREATE POLICY "Scoped access for Setores" ON public.setores
  FOR ALL TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role) OR 
     (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
     (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))) OR 
     (id IN ( SELECT e.setor_id FROM public.fn_setores_no_escopo() e)))
  );

-- ---------- solicitacoes_transferencia_servidor ----------

-- origem: 20260812100000_rh_geral_e_rh_unidade_acesso_a_pendencias_e_transferencia.sql  (1x)
DROP POLICY IF EXISTS "Leitura de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Leitura de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor
    FOR SELECT TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role, 'rh'::user_role, 'rh_unidade'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.servidores s
             WHERE s.id = solicitacoes_transferencia_servidor.servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
             )
         ))
    );

-- origem: 20260812100000_rh_geral_e_rh_unidade_acesso_a_pendencias_e_transferencia.sql  (1x)
DROP POLICY IF EXISTS "Insercao de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Insercao de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor
    FOR INSERT TO authenticated
    WITH CHECK (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role, 'rh'::user_role, 'rh_unidade'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.servidores s
             WHERE s.id = servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
             )
         ))
    );

-- ============================================================================
-- 3. Conferencia
-- ============================================================================
--
-- (a) Nenhuma policy pode ter sobrado com o teste plano:
--
--   SELECT tablename, policyname
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%profile_setores%'
--     AND (COALESCE(qual, '') || COALESCE(with_check, '')) NOT LIKE '%fn_setores_no_escopo%';
--   -- esperado: 0 linhas
--
-- (b) Expansao de um perfil concreto (o coordenador de ADMINISTRACAO/APOIO):
--
--   SELECT ds.nome
--   FROM public.fn_setores_no_escopo('<profile_id>') e
--   JOIN public.setores s ON s.id = e.setor_id
--   JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id;
--   -- esperado: APOIO + SERVICOS GERAIS + PORTARIA + MANUTECAO + ENGENHARIA
