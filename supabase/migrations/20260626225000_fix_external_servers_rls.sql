-- Migration: Fix External Servers RLS in Scale
-- Description: Updates the SELECT policy on public.servidores to allow coordinators and administrators to view servers that are actively scheduled on the scales (escala_mensal) under their management.

DROP POLICY IF EXISTS "Users can view relevant servers" ON public.servidores;

CREATE POLICY "Users can view relevant servers" ON public.servidores
  FOR SELECT TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role) OR 
     (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
     (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))
      AND (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR 
     (setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid)))) OR
     (EXISTS (
        SELECT 1 FROM public.escala_mensal em
        WHERE em.servidor_id = servidores.id
          AND (
            em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid())
            OR em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
            OR (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true)))
          )
     ))
    )
  );
