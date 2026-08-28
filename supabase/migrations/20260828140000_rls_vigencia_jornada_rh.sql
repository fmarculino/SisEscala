-- Migration: RLS de servidores_jornadas_temporarias passa a reconhecer 'rh' e 'rh_unidade',
--            e a justificativa vira regra do banco
-- Data: 2026-08-28
--
-- MOTIVACAO (medida em producao em 28/08/2026)
--   "new row violates row-level security policy for table servidores_jornadas_temporarias" ao
--   salvar uma vigencia pela ficha do servidor, logado como RH da Unidade.
--
--   A policy de escrita e' a original da tabela (20260626230000) e lista tres papeis:
--     p.role IN ('super_admin', 'admin', 'coordenador')
--   Os papeis de RH nasceram DEPOIS dela e nunca foram acrescentados:
--     'rh'         -> 20260811130000
--     'ass_adm'    -> 20260811170000
--     'rh_unidade' -> 20260812060000
--   E' o mesmo buraco que 20260812070000 fechou em escala_mensal/escala_diaria/folha_ponto/
--   servidores_eventos - esta tabela ficou de fora daquela varredura.
--
--   Extensao medida: 8 contas 'rh' + 7 'rh_unidade' abrem a ficha do servidor (a sidebar libera
--   /servidores para os dois) e veem o formulario, mas nenhuma consegue gravar. As 6 vigencias
--   existentes na tabela foram criadas por 'coordenador' (3) e 'super_admin' (3) - nenhum RH
--   jamais inseriu uma. Recurso inoperante para esse papel desde que o papel existe.
--
-- DESENHO
--   1. A policy antiga e' FOR ALL com USING e SEM WITH CHECK. Funciona (o Postgres cai para o
--      USING no INSERT), mas e' a mesma forma frouxa que custou caro em 20260828100000
--      (solicitacoes_transferencia). Aqui ela e' derrubada e substituida por INSERT/UPDATE/DELETE
--      separados, cada um com o seu WITH CHECK explicito.
--
--   2. Quem pode gerir tem FONTE UNICA: fn_pode_gerir_vigencia_jornada(servidor_id). As tres
--      policies chamam ela, e a tela tambem (para nao oferecer um formulario que o banco vai
--      recusar - o defeito de origem deste bug era exatamente esse).
--
--   3. 'rh_unidade' e' ESCOPADO pela unidade do servidor (profile_unidades), como em
--      20260812070000. Sem escopo, o papel escopado teria alcance maior que o do RH Geral por
--      acidente. Servidor sem unidade_id (1 em producao) fica fora do alcance dele - na duvida,
--      fecha.
--
--   4. 'admin' e 'coordenador' continuam SEM escopo, exatamente como hoje. Ampliar quem e'
--      reconhecido e' o objetivo desta migration; estreitar quem ja' grava e' mudanca de
--      comportamento com risco proprio (coordenador cujo acesso vem so' de profile_setores -
--      ver fn_unidade_alcancavel_por_setor no CLAUDE.md) e fica para uma decisao separada.
--
--   5. 'ass_adm' fica de fora: nao ve "Servidores" no menu (sidebar.tsx, decisao de 12/08/2026).
--
--   6. JUSTIFICATIVA VIRA REGRA DO BANCO. criarVigenciaJornada (grade de escala) ja' exigia
--      motivo; createJornadaTemporaria (ficha do servidor) aceitava nulo. Duas portas para a
--      mesma tabela com regras diferentes e' o que produz vigencia sem rastro. O CHECK abaixo e'
--      a fonte unica; as duas actions passam a recusar antes, so' para dar mensagem legivel.
--      As 6 linhas existentes ja' tem motivo preenchido - a constraint entra VALIDADA.
--
--   7. A policy de SELECT ("Everyone authenticated can view temporary journeys", USING true) NAO
--      e' tocada. Estreitar leitura alcancaria a folha, a grade e o portal do servidor, que leem
--      esta tabela - escopo proprio, decisao propria.
--
-- IDEMPOTENTE: DROP ... IF EXISTS antes de cada criacao. Seguro reaplicar nos dois bancos
-- (CLAUDE.md armadilha 3). O bloco final confere o proprio resultado e ABORTA se divergir
-- (mesma disciplina de 20260827040000/20260827050000).


-- ============================================================================
-- 0. Guard: get_my_role() nao esta versionada (CLAUDE.md armadilha 2), mas as policies de
--    20260812070000 dependem dela. Se nao existir, este banco nao e' o esperado.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regprocedure('public.get_my_role()') IS NULL THEN
    RAISE EXCEPTION 'get_my_role() nao existe em % (usuario %) - banco inesperado, nada foi alterado',
      current_database(), current_user;
  END IF;
END
$guard$;


-- ============================================================================
-- 1. Justificativa obrigatoria
-- ============================================================================

ALTER TABLE public.servidores_jornadas_temporarias
  DROP CONSTRAINT IF EXISTS chk_vigencia_jornada_motivo;

ALTER TABLE public.servidores_jornadas_temporarias
  ADD CONSTRAINT chk_vigencia_jornada_motivo
  CHECK (motivo IS NOT NULL AND btrim(motivo) <> '');


-- ============================================================================
-- 2. Fonte unica de quem pode gerir vigencia de jornada
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_pode_gerir_vigencia_jornada(p_servidor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE((
    SELECT CASE
      -- Administrador Geral, RH Geral, Diretor e Coordenador: sem escopo, como ja' era antes
      -- desta migration para os tres papeis que a policy antiga reconhecia.
      WHEN p.role IN ('super_admin'::public.user_role,
                      'rh'::public.user_role,
                      'admin'::public.user_role,
                      'coordenador'::public.user_role)
        THEN true
      -- RH da Unidade: so' servidor lotado numa das unidades vinculadas ao perfil.
      WHEN p.role = 'rh_unidade'::public.user_role
        THEN EXISTS (
          SELECT 1
          FROM public.servidores s
          WHERE s.id = p_servidor_id
            AND s.unidade_id IN (
              SELECT pu.unidade_id
              FROM public.profile_unidades pu
              WHERE pu.profile_id = auth.uid()
            )
        )
      ELSE false
    END
    FROM public.profiles p
    WHERE p.id = auth.uid()
  ), false);
$fn$;

-- CLAUDE.md armadilha 24: CREATE FUNCTION ja' concede EXECUTE a PUBLIC. A restricao real e' o
-- REVOKE. A tela chama esta funcao com o usuario logado, entao 'authenticated' fica.
REVOKE ALL ON FUNCTION public.fn_pode_gerir_vigencia_jornada(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_pode_gerir_vigencia_jornada(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_pode_gerir_vigencia_jornada(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_pode_gerir_vigencia_jornada(uuid) IS
  'Fonte unica de quem pode criar/alterar/remover vigencia de jornada (servidores_jornadas_temporarias). '
  'super_admin/rh/admin/coordenador: sem escopo. rh_unidade: so servidor lotado em unidade vinculada '
  '(profile_unidades). Usada pelas policies de escrita da tabela E pela tela, para nao oferecer '
  'formulario que o banco vai recusar.';


-- ============================================================================
-- 3. Policies de escrita
-- ============================================================================

-- A antiga cobre INSERT/UPDATE/DELETE de uma vez (FOR ALL) e nao conhece os papeis de RH.
DROP POLICY IF EXISTS "Admins and coordinators can manage temporary journeys"
  ON public.servidores_jornadas_temporarias;

DROP POLICY IF EXISTS "Gestores criam vigencia de jornada"
  ON public.servidores_jornadas_temporarias;
CREATE POLICY "Gestores criam vigencia de jornada"
  ON public.servidores_jornadas_temporarias
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_pode_gerir_vigencia_jornada(servidor_id));

-- USING = a linha que ele ja' pode alcancar; WITH CHECK = a linha depois do UPDATE. Os dois sao
-- necessarios: sem o WITH CHECK, um rh_unidade moveria a vigencia para um servidor fora do
-- escopo dele so' trocando servidor_id.
DROP POLICY IF EXISTS "Gestores alteram vigencia de jornada"
  ON public.servidores_jornadas_temporarias;
CREATE POLICY "Gestores alteram vigencia de jornada"
  ON public.servidores_jornadas_temporarias
  FOR UPDATE TO authenticated
  USING (public.fn_pode_gerir_vigencia_jornada(servidor_id))
  WITH CHECK (public.fn_pode_gerir_vigencia_jornada(servidor_id));

DROP POLICY IF EXISTS "Gestores removem vigencia de jornada"
  ON public.servidores_jornadas_temporarias;
CREATE POLICY "Gestores removem vigencia de jornada"
  ON public.servidores_jornadas_temporarias
  FOR DELETE TO authenticated
  USING (public.fn_pode_gerir_vigencia_jornada(servidor_id));


-- ============================================================================
-- 4. Conferencia do proprio resultado - ABORTA se divergir
-- ============================================================================

DO $conf$
DECLARE
  v_all      int;
  v_esperado int;
  v_check    int;
BEGIN
  -- 4.1 nenhuma policy FOR ALL sobrou (era ela que decidia a escrita antes)
  SELECT count(*) INTO v_all
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'servidores_jornadas_temporarias'
    AND cmd = 'ALL';

  IF v_all <> 0 THEN
    RAISE EXCEPTION 'Ainda existem % policy(ies) FOR ALL em servidores_jornadas_temporarias - a escrita continua decidida por elas',
      v_all;
  END IF;

  -- 4.2 as tres policies novas existem, cada uma no seu comando
  SELECT count(*) INTO v_esperado
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'servidores_jornadas_temporarias'
    AND policyname IN ('Gestores criam vigencia de jornada',
                       'Gestores alteram vigencia de jornada',
                       'Gestores removem vigencia de jornada');

  IF v_esperado <> 3 THEN
    RAISE EXCEPTION 'Esperava 3 policies de escrita, encontrei % em % (usuario %)',
      v_esperado, current_database(), current_user;
  END IF;

  -- 4.3 a justificativa e' regra do banco e esta VALIDADA (nao NOT VALID)
  SELECT count(*) INTO v_check
  FROM pg_constraint
  WHERE conrelid = 'public.servidores_jornadas_temporarias'::regclass
    AND conname = 'chk_vigencia_jornada_motivo'
    AND convalidated;

  IF v_check <> 1 THEN
    RAISE EXCEPTION 'chk_vigencia_jornada_motivo ausente ou nao validada';
  END IF;

  RAISE NOTICE 'OK: 3 policies de escrita, nenhuma FOR ALL, justificativa obrigatoria validada';
END
$conf$;


-- ============================================================================
-- CONFERENCIA (rodar depois, com service_role)
-- ============================================================================
--
-- 1) Policies vigentes da tabela:
--
--   SELECT policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE tablename = 'servidores_jornadas_temporarias'
--   ORDER BY cmd, policyname;
--
-- 2) Alcance do RH da Unidade (esperado: so os servidores das unidades vinculadas):
--
--   SELECT p.id, p.full_name,
--          count(*) FILTER (WHERE s.unidade_id IN (
--            SELECT pu.unidade_id FROM profile_unidades pu WHERE pu.profile_id = p.id)) AS no_escopo,
--          count(*) AS total_servidores
--   FROM profiles p CROSS JOIN servidores s
--   WHERE p.role = 'rh_unidade'
--   GROUP BY p.id, p.full_name;
--
-- 3) Nenhuma vigencia sem justificativa (esperado: 0):
--
--   SELECT count(*) FROM servidores_jornadas_temporarias
--   WHERE motivo IS NULL OR btrim(motivo) = '';
