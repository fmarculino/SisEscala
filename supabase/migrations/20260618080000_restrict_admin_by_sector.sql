-- Migration: Restrict Admin by Sector
-- Description: Updates RLS policies to restrict administrators and coordinators to specific sectors unless they have acesso_todos_setores = true.

-- 1. escala_mensal
DROP POLICY IF EXISTS "Admins manage scales in their units" ON public.escala_mensal;
DROP POLICY IF EXISTS "Coordinators manage scales in their sectors" ON public.escala_mensal;
DROP POLICY IF EXISTS "Scoped access for Escala Mensal" ON public.escala_mensal;

CREATE POLICY "Admins e Coordenadores gerenciam escalas" ON public.escala_mensal
  FOR ALL TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid()) 
       AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
      (setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
    ))
  );

-- 2. escala_diaria
DROP POLICY IF EXISTS "Admins manage daily scales in their units" ON public.escala_diaria;
DROP POLICY IF EXISTS "Coordinators manage daily scales in their sectors" ON public.escala_diaria;

CREATE POLICY "Admins e Coordenadores gerenciam escala_diaria" ON public.escala_diaria
  FOR ALL TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
     EXISTS (
       SELECT 1 FROM public.escala_mensal em
       WHERE em.id = escala_diaria.escala_mensal_id AND (
         (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
         (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid()) 
          AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
         (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
       )
     ))
  );

-- 3. servidores (SELECT)
DROP POLICY IF EXISTS "Users can view relevant servers" ON public.servidores;
CREATE POLICY "Users can view relevant servers" ON public.servidores
  FOR SELECT TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role) OR 
     (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
     (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))
      AND (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR 
     (setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid)))))
  );

-- 4. servidores (ALL)
DROP POLICY IF EXISTS "Scoped access for Admins and Coordinators" ON public.servidores;
CREATE POLICY "Scoped access for Admins and Coordinators" ON public.servidores
  FOR ALL TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))
       AND (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR 
      (setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid))))
    ))
  );

-- 5. logs_sobreaviso
DROP POLICY IF EXISTS "Admins manage on-call logs in their units" ON public.logs_sobreaviso;
DROP POLICY IF EXISTS "Coordinators manage on-call logs in their sectors" ON public.logs_sobreaviso;

CREATE POLICY "Admins e Coordenadores gerenciam logs_sobreaviso" ON public.logs_sobreaviso
  FOR ALL TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
       AND (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
      (EXISTS (
        SELECT 1 FROM public.escala_mensal em
        WHERE em.id = logs_sobreaviso.escala_mensal_id AND 
        em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid())
      ))
    ))
  );

-- 6. folha_ponto (SELECT) - Update to also restrict unit check by access_todos_setores
DROP POLICY IF EXISTS "Admins e Coordenadores podem ler folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem ler folhas de ponto" ON public.folha_ponto
    FOR SELECT TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
                  AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );

-- 7. folha_ponto (INSERT)
DROP POLICY IF EXISTS "Admins e Coordenadores podem inserir folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem inserir folhas de ponto" ON public.folha_ponto
    FOR INSERT TO authenticated
    WITH CHECK (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = escala_mensal_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
                  AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );

-- 8. folha_ponto (UPDATE)
DROP POLICY IF EXISTS "Admins e Coordenadores podem atualizar folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem atualizar folhas de ponto" ON public.folha_ponto
    FOR UPDATE TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
                  AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );

-- 9. folha_ponto (DELETE)
DROP POLICY IF EXISTS "Admins e Coordenadores podem deletar folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem deletar folhas de ponto" ON public.folha_ponto
    FOR DELETE TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
                  AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );
