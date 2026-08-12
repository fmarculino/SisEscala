-- Migration: RLS de escala_mensal/escala_diaria/folha_ponto/servidores_eventos passa a
-- reconhecer 'rh' e 'rh_unidade'
-- Data: 2026-08-12
--
-- MOTIVACAO
--   Investigacao a pedido do usuario: o perfil 'rh' (20260811130000) ficou incompleto quando foi
--   criado. Em `src/utils/permissions.ts` (applyAccessFilters) ele tem bypass INCONDICIONAL
--   (enxerga tudo em qualquer tela, mesmo escopado no cadastro - excesso de acesso). Mas nestas
--   quatro tabelas a RLS nunca foi atualizada para incluir 'rh' - as policies vigentes (todas de
--   20260618080000, a mais recente pra cada uma, confirmado por busca) so' citam
--   `role = ANY(['admin','coordenador'])`. Resultado: um usuario 'rh' hoje tem ZERO linhas de
--   escala_mensal/escala_diaria/folha_ponto via RLS, nao importa o que esteja marcado no perfil -
--   exatamente as telas que um RH mais precisa (/escalas, /folha-ponto, /relatorios/rh) vinham
--   vazias, mascaradas como "nenhuma escala fechada" em vez de um erro.
--
--   Ver docs/evolucao/2026-08-12-desdobramento-do-perfil-rh.md para o desenho completo (RH Geral
--   vs RH da Unidade) e o restante da correcao (permissions.ts, tela de Usuarios, sidebar,
--   paginas do dashboard).
--
-- DESENHO DESTAS POLICIES
--   'rh' (RH Geral) ganha um branch de bypass incondicional, no mesmo nivel do super_admin -
--   e' o que o comentario original da migration de 20260811130000 ja descrevia ("mesmos dados de
--   gestao/cadastros/relatorios") e nunca foi implementado aqui.
--   'rh_unidade' (RH da Unidade) ganha um branch proprio: `unidade_id IN profile_unidades`, SEM
--   exigir `acesso_todos_setores = true` junto (diferente do branch de admin/coordenador) -
--   decisao deliberada para que vincular uma unidade garanta todos os setores dela de verdade,
--   sem depender de dois checkboxes lembrados na hora do cadastro (a nota que ja existe na tela
--   de Usuarios promete isso, mas so' era verdade nas tabelas que nao checam papel). A tela de
--   Usuarios (proxima migration/commit) forca `acesso_todos_setores = true` tambem, para o filtro
--   client-side (`applyAccessFilters`) que ainda depende dessa flag - as duas camadas devem
--   concordar.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS antes de recriar. Corpo de cada policy copiado integralmente
-- da versao vigente (20260618080000/20260528180000), so' ampliando quem e' reconhecido - mesma
-- disciplina do CLAUDE.md (armadilha 1) aplicada a policy em vez de funcao. Seguro rodar nos dois
-- ambientes (CLAUDE.md armadilha 3).


-- ============================================================================
-- 1. escala_mensal
-- ============================================================================

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
      (setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
    )) OR
    (((SELECT get_my_role()) = 'rh_unidade'::user_role) AND
     (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())))
  );


-- ============================================================================
-- 2. escala_diaria
-- ============================================================================

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
         (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
       )
     )) OR
    (((SELECT get_my_role()) = 'rh_unidade'::user_role) AND
     EXISTS (
       SELECT 1 FROM public.escala_mensal em
       WHERE em.id = escala_diaria.escala_mensal_id
         AND em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
     ))
  );


-- ============================================================================
-- 3. folha_ponto (SELECT / INSERT / UPDATE / DELETE)
-- ============================================================================

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
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
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
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = escala_mensal_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
                  AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
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
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
                  AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
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
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
                  AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
                 (em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         )) OR
        (((SELECT get_my_role()) = 'rh_unidade'::user_role) AND
         EXISTS (
             SELECT 1 FROM public.escala_mensal em
             WHERE em.id = folha_ponto.escala_mensal_id
               AND em.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
         ))
    );


-- ============================================================================
-- 4. servidores_eventos (ferias, licencas, afastamentos)
-- ============================================================================

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
          (s.setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid))))
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


-- CONFERENCIA APOS APLICAR
--
--   1) As policies existem e citam os dois papeis novos:
--
--   SELECT policyname, qual FROM pg_policies
--    WHERE tablename IN ('escala_mensal','escala_diaria','folha_ponto','servidores_eventos')
--      AND qual LIKE '%rh_unidade%';
--   -- esperado: 7 linhas (escala_mensal, escala_diaria, 4 de folha_ponto, servidores_eventos)
--
--   2) Logado como 'rh' (RH Geral): SELECT em escala_mensal/escala_diaria/folha_ponto devolve
--      linhas de QUALQUER unidade (antes vinha vazio nas tres).
--
--   3) Logado como 'rh_unidade' vinculado a uma unidade so' (profile_unidades com uma linha):
--      SELECT nessas tabelas devolve so' linhas daquela unidade, de QUALQUER setor dela, sem
--      precisar de nenhuma linha em profile_setores nem de acesso_todos_setores = true.
