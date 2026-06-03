-- 1. Criar RPC seguro para buscar servidores ativos de um setor externo bypassing RLS
CREATE OR REPLACE FUNCTION public.get_external_servers_for_scale(p_setor_id uuid)
RETURNS TABLE (
  id uuid,
  nome text,
  unidade_id uuid,
  setor_id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validar autorização: apenas administradores, coordenadores e super_admins podem buscar servidores externos
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('super_admin'::user_role, 'admin'::user_role, 'coordenador'::user_role)
  ) THEN
    RAISE EXCEPTION 'Acesso negado: Perfil sem permissão para buscar servidores externos.';
  END IF;

  RETURN QUERY
  SELECT s.id, s.nome, s.unidade_id, s.setor_id, s.status
  FROM public.servidores s
  WHERE s.setor_id = p_setor_id
    AND s.status = 'Ativo'
  ORDER BY s.nome;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_external_servers_for_scale(uuid) TO authenticated;

-- 2. Atualizar a política RLS SELECT em servidores para permitir leitura caso o servidor esteja na escala do usuário
DROP POLICY IF EXISTS "Users can view relevant servers" ON public.servidores;

CREATE POLICY "Users can view relevant servers" ON public.servidores
  FOR SELECT TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role) OR 
     (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
     (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))) OR 
     (setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid)))) OR
     (EXISTS (
        SELECT 1 FROM public.escala_mensal em
        WHERE em.servidor_id = servidores.id
          AND (
            (( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role) OR
            ((( SELECT get_my_role() AS get_my_role) = 'admin'::user_role) AND (
              (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todas_unidades = true)) OR
              (em.unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = auth.uid())))
            )) OR
            ((( SELECT get_my_role() AS get_my_role) = 'coordenador'::user_role) AND (
              (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true)) OR
              (em.setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = auth.uid())))
            ))
          )
     ))
    )
  );
