-- ============================================================================
-- Migration: Permitir perfil 'ass_adm' (Ass. Administrativo) nas policies de RLS
-- Data: 2026-08-18
-- Motivo: O perfil 'ass_adm' foi criado em 20260811170000 para ter as mesmas permissões
-- operacionais do perfil 'coordenador' (gestão de escalas, folhas, afastamentos e servidores).
-- Como as policies de RLS filtravam apenas por 'admin' e 'coordenador', usuários com o perfil
-- 'ass_adm' recebiam erro de violação de RLS (42501) ao cadastrar afastamentos em servidores_eventos
-- e ao operar escalas/folhas.
-- ============================================================================

-- 1. servidores_eventos (afastamentos, férias, licenças)
DROP POLICY IF EXISTS "Coordinators and Admins can manage relevant servant events" ON public.servidores_eventos;
CREATE POLICY "Coordinators and Admins can manage relevant servant events" ON public.servidores_eventos
  FOR ALL TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role)) OR
    (( SELECT get_my_role() AS get_my_role) = 'rh'::user_role) OR
    (
      (( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role])) AND
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

-- 2. servidores (gestão de servidores no escopo)
DROP POLICY IF EXISTS "Scoped access for Admins and Coordinators" ON public.servidores;
CREATE POLICY "Scoped access for Admins and Coordinators" ON public.servidores
  FOR ALL TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role)) OR
    ((( SELECT get_my_role() AS get_my_role) = 'rh'::user_role)) OR
    ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role])) AND (
      (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))
       AND (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR 
      (setor_id IN ( SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
    )) OR
    ((( SELECT get_my_role() AS get_my_role) = 'rh_unidade'::user_role) AND
     (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())))
  );

-- 3. escala_mensal
DROP POLICY IF EXISTS "Admins e Coordenadores gerenciam escalas" ON public.escala_mensal;
CREATE POLICY "Admins e Coordenadores gerenciam escalas" ON public.escala_mensal
  FOR ALL TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    ((SELECT get_my_role()) = 'rh'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role])) AND (
      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
       AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
      (setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e))
    )) OR
    (((SELECT get_my_role()) = 'rh_unidade'::user_role) AND
     (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())))
  );

-- 4. escala_diaria
DROP POLICY IF EXISTS "Admins e Coordenadores gerenciam escala_diaria" ON public.escala_diaria;
CREATE POLICY "Admins e Coordenadores gerenciam escala_diaria" ON public.escala_diaria
  FOR ALL TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    ((SELECT get_my_role()) = 'rh'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role])) AND
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

-- 5. folha_ponto
DROP POLICY IF EXISTS "Admins e Coordenadores podem ler folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem ler folhas de ponto" ON public.folha_ponto
    FOR SELECT TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        ((SELECT get_my_role()) = 'rh'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role])) AND
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

DROP POLICY IF EXISTS "Admins e Coordenadores podem inserir folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem inserir folhas de ponto" ON public.folha_ponto
    FOR INSERT TO authenticated
    WITH CHECK (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        ((SELECT get_my_role()) = 'rh'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role])) AND
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

DROP POLICY IF EXISTS "Admins e Coordenadores podem atualizar folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem atualizar folhas de ponto" ON public.folha_ponto
    FOR UPDATE TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        ((SELECT get_my_role()) = 'rh'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role])) AND
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

DROP POLICY IF EXISTS "Admins e Coordenadores podem deletar folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem deletar folhas de ponto" ON public.folha_ponto
    FOR DELETE TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        ((SELECT get_my_role()) = 'rh'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role])) AND
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

-- 6. logs_sobreaviso
DROP POLICY IF EXISTS "Admins e Coordenadores leem logs_sobreaviso" ON public.logs_sobreaviso;
CREATE POLICY "Admins e Coordenadores leem logs_sobreaviso" ON public.logs_sobreaviso
  FOR SELECT TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role])) AND (
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

DROP POLICY IF EXISTS "Admins e Coordenadores atualizam logs_sobreaviso" ON public.logs_sobreaviso;
CREATE POLICY "Admins e Coordenadores atualizam logs_sobreaviso" ON public.logs_sobreaviso
  FOR UPDATE TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role])) AND (
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

DROP POLICY IF EXISTS "Admins e Coordenadores apagam logs_sobreaviso" ON public.logs_sobreaviso;
CREATE POLICY "Admins e Coordenadores apagam logs_sobreaviso" ON public.logs_sobreaviso
  FOR DELETE TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role])) AND (
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

-- 7. historico_transferencias & solicitacoes_transferencia_servidor
DROP POLICY IF EXISTS "Permitir leitura de historico_transferencias para autorizados" ON public.historico_transferencias;
CREATE POLICY "Permitir leitura de historico_transferencias para autorizados" ON public.historico_transferencias
  FOR ALL TO authenticated USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    ((SELECT get_my_role()) = 'rh'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'rh_unidade'::user_role, 'ass_adm'::user_role])) AND (
      (unidade_origem_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
      (unidade_destino_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid()))
    ))
  );

DROP POLICY IF EXISTS "Permitir gerenciamento de solicitacoes_transferencia para autorizados" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Permitir gerenciamento de solicitacoes_transferencia para autorizados" ON public.solicitacoes_transferencia_servidor
  FOR ALL TO authenticated USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    ((SELECT get_my_role()) = 'rh'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role, 'rh_unidade'::user_role, 'ass_adm'::user_role])) AND (
      (unidade_origem_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
      (unidade_destino_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid()))
    ))
  );

-- 8. solicitacoes_ferias_licencas & solicitacoes_ferias_licencas_historico
DROP POLICY IF EXISTS "coordenador_solicitacoes_all" ON public.solicitacoes_ferias_licencas;
CREATE POLICY "coordenador_solicitacoes_all" ON public.solicitacoes_ferias_licencas
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND (p.role = 'coordenador' OR p.role = 'ass_adm')
              AND (
                  p.acesso_todas_unidades = true
                  OR EXISTS (SELECT 1 FROM public.profile_setores ps WHERE ps.profile_id = p.id AND ps.setor_id = solicitacoes_ferias_licencas.setor_id)
              )
        )
    );

DROP POLICY IF EXISTS "coordenador_historico_select" ON public.solicitacoes_ferias_licencas_historico;
CREATE POLICY "coordenador_historico_select" ON public.solicitacoes_ferias_licencas_historico
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.solicitacoes_ferias_licencas s
            JOIN public.profiles p ON p.id = auth.uid()
            WHERE s.id = solicitacoes_ferias_licencas_historico.solicitacao_id
              AND (p.role = 'coordenador' OR p.role = 'ass_adm')
              AND (
                  p.acesso_todas_unidades = true
                  OR EXISTS (SELECT 1 FROM public.profile_setores ps WHERE ps.profile_id = p.id AND ps.setor_id = s.setor_id)
              )
        )
    );
