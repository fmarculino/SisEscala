-- Migration: Fix folha_ponto RLS and support mid-month transfers
-- Description: Updates public.folha_ponto RLS policies to check permissions based on the linked escala_mensal rather than the current servidores row.

-- Select Policy
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
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );

-- Insert Policy
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
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );

-- Update Policy
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
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );

-- Delete Policy
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
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );
