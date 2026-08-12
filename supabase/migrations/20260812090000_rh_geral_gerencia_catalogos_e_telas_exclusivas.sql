-- Migration: RH Geral passa a gerenciar os catalogos globais e telas ja liberadas so' pra ele
-- Data: 2026-08-12
--
-- MOTIVACAO
--   Pedido do usuario, testando o RH da Unidade em producao: Ferias e Licencas, Marcacoes,
--   Pendencias de Cadastro, Feriados, Cargos, Jornadas, Dicionario de Turnos e Tipos de
--   Afastamento sao telas exclusivas de RH Geral - RH da Unidade nem deveria ver o item de
--   menu. O lado do frontend (sidebar.tsx, gates de pagina) ja foi corrigido no mesmo commit
--   desta migration.
--
--   Falta o lado do banco: feriados/pontos_facultativos/dicionario_turnos/tipos_eventos/cargos/
--   jornadas tem policy de ESCRITA restrita a super_admin (algumas) ou super_admin/admin
--   (outras) - sem 'rh', a tela abriria pro RH Geral mas qualquer tentativa de salvar seria
--   recusada pela RLS. LEITURA ja e' `USING (true)` pra qualquer autenticado nas seis, entao so'
--   a policy de escrita precisa mudar.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS + CREATE POLICY, corpo copiado da versao vigente de cada
-- uma (confirmado por busca - nenhuma foi redefinida depois de 20260523000000/20260528180000/
-- 20260629130000), so' ampliando o array de papel. Seguro rodar nos dois ambientes (CLAUDE.md
-- armadilha 3).

-- 1. feriados
DROP POLICY IF EXISTS "Allow write access to holidays for admins" ON public.feriados;
CREATE POLICY "Allow write access to holidays for admins" ON public.feriados
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role, 'rh'::user_role])));

-- 2. pontos_facultativos
DROP POLICY IF EXISTS "Allow write access to pontos facultativos for admins" ON public.pontos_facultativos;
CREATE POLICY "Allow write access to pontos facultativos for admins" ON public.pontos_facultativos
    FOR ALL TO authenticated USING (((SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role, 'rh'::user_role])));

-- 3. dicionario_turnos (era super_admin apenas)
DROP POLICY IF EXISTS "Admins can manage shifts" ON public.dicionario_turnos;
CREATE POLICY "Admins can manage shifts" ON public.dicionario_turnos
  FOR ALL TO public USING ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'rh'::user_role])));

-- 4. tipos_eventos
DROP POLICY IF EXISTS "Permitir gerenciamento de tipos_eventos para admins" ON public.tipos_eventos;
CREATE POLICY "Permitir gerenciamento de tipos_eventos para admins" ON public.tipos_eventos
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role, 'rh'::user_role])));

-- 5. cargos
DROP POLICY IF EXISTS "Permitir gerenciamento de cargos para administradores" ON public.cargos;
CREATE POLICY "Permitir gerenciamento de cargos para administradores" ON public.cargos
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role, 'rh'::user_role])));

-- 6. jornadas (era super_admin apenas)
DROP POLICY IF EXISTS "Admins can manage journeys" ON public.jornadas;
CREATE POLICY "Admins can manage journeys" ON public.jornadas
  FOR ALL TO public USING ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'rh'::user_role])));

-- CONFERENCIA APOS APLICAR
--
--   SELECT tablename, policyname, qual FROM pg_policies
--    WHERE tablename IN ('feriados','pontos_facultativos','dicionario_turnos','tipos_eventos','cargos','jornadas')
--      AND qual LIKE '%rh%'
--      AND cmd = 'ALL';
--   -- esperado: 6 linhas
