-- ============================================================================
-- Migration: Permitir que perfis 'rh' e 'rh_unidade' gerenciem servidores na RLS
-- Data: 2026-08-18
-- Motivo: O perfil 'rh' (RH Geral) tem acesso irrestrito a todos os servidores,
-- e o perfil 'rh_unidade' tem acesso a todos os setores de sua unidade.
-- A policy de servidores estava limitando a 'super_admin', 'admin' e 'coordenador',
-- causando erro de RLS (42501) quando usuários com perfil 'rh' tentavam cadastrar ou editar servidores.
-- ============================================================================

-- 1. Tabela servidores: Leitura (SELECT)
DROP POLICY IF EXISTS "Users can view relevant servers" ON public.servidores;
CREATE POLICY "Users can view relevant servers" ON public.servidores
  FOR SELECT TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role) OR 
     (( SELECT get_my_role() AS get_my_role) = 'rh'::user_role) OR
     (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
     (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))
      AND (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR 
     (setor_id IN ( SELECT e.setor_id FROM public.fn_setores_no_escopo() e)) OR
     ((( SELECT get_my_role() AS get_my_role) = 'rh_unidade'::user_role) AND
      (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid()))) OR
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

-- 2. Tabela servidores: Escrita e Gerenciamento (ALL)
DROP POLICY IF EXISTS "Scoped access for Admins and Coordinators" ON public.servidores;
CREATE POLICY "Scoped access for Admins and Coordinators" ON public.servidores
  FOR ALL TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role)) OR
    ((( SELECT get_my_role() AS get_my_role) = 'rh'::user_role)) OR
    ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))
       AND (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR 
      (setor_id IN ( SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
    )) OR
    ((( SELECT get_my_role() AS get_my_role) = 'rh_unidade'::user_role) AND
     (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())))
  );

-- 3. Tabela historico_transferencias
DROP POLICY IF EXISTS "Permitir leitura de historico_transferencias para autorizados" ON public.historico_transferencias;
CREATE POLICY "Permitir leitura de historico_transferencias para autorizados" ON public.historico_transferencias
  FOR ALL TO authenticated USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    ((SELECT get_my_role()) = 'rh'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'rh_unidade'::user_role])) AND (
      (unidade_origem_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
      (unidade_destino_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid()))
    ))
  );

-- 4. Tabela solicitacoes_transferencia_servidor
DROP POLICY IF EXISTS "Permitir gerenciamento de solicitacoes_transferencia para autorizados" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Permitir gerenciamento de solicitacoes_transferencia para autorizados" ON public.solicitacoes_transferencia_servidor
  FOR ALL TO authenticated USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    ((SELECT get_my_role()) = 'rh'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'rh_unidade'::user_role])) AND (
      (unidade_origem_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
      (unidade_destino_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid()))
    ))
  );
