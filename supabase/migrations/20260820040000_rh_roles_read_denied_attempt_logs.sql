-- ============================================================================
-- Migration: RH (Geral e da Unidade) passa a ler as tentativas recusadas de
--            ponto
-- Data: 2026-08-20
--
-- MOTIVACAO
--   Pedido do usuario: os perfis de RH nao conseguiam abrir "Validar Presenca"
--   na grade da escala - clicar no segmento da celula nao fazia nada. A causa
--   principal era um gate de TELA (ScaleGrid.tsx: canEditPresence so aceitava
--   admin/super_admin/coordenador/ass_adm), corrigido no mesmo commit. O banco
--   nunca barrou ninguem ali: fn_validar_presenca_manual e SECURITY DEFINER com
--   GRANT a authenticated, e a RLS de escala_diaria ja reconhece 'rh' e
--   'rh_unidade' desde a 20260812070000.
--
--   Falta esta segunda camada. O modal so consegue OFERECER a batida real
--   quando le logs_tentativas_presenca (via fn_tentativas_recusadas_mes, que e
--   SECURITY INVOKER de proposito - "a RLS da tabela continua valendo"). A
--   policy vigente (20260804060000) cita apenas super_admin/admin/coordenador,
--   entao para os dois papeis de RH a lista de batidas recusadas viria VAZIA e
--   sobraria so digitar o horario. Isso e o oposto do que a v1.26.0
--   estabeleceu: onde existe horario real, ele tem de ganhar da declaracao
--   (CLAUDE.md, secao da v1.26.0).
--
--   'ass_adm' NAO entra aqui, por decisao do usuario em 20/08/2026. Ele valida
--   presenca na grade e continua so' podendo DIGITAR o horario - estado de
--   hoje, sem regressao. Se um dia isso mudar, e' acrescentar o papel na lista
--   abaixo, nada mais.
--
--   marcacoes_ponto nao precisa de alteracao: a grade a le por fn_marcacoes_mes
--   (20260818005000), que e SECURITY DEFINER.
--
-- ESCOPO
--   'rh' (RH Geral) entra na lista de papeis, junto com os demais - e a
--   definicao do papel enxergar tudo. 'rh_unidade' NAO: ele ganha um branch
--   proprio, escopado pela lotacao do servidor da tentativa
--   (servidores.unidade_id IN profile_unidades). A tabela nao tem unidade_id -
--   so unidade_nome/setor_nome em texto (20260611185000) - entao a lotacao do
--   servidor e a unica ancora confiavel de escopo.
--   Efeito colateral conhecido e aceito: tentativa de "Servidor Externo"
--   (v1.2.4), lotado em outra unidade, nao aparece para o RH da Unidade que
--   gerencia a escala. Mesma escolha ja feita no terminal local (escopo por
--   servidores.unidade_id/setor_id).
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS antes do CREATE. Corpo copiado da versao
-- vigente (20260804060000), so ampliando quem e reconhecido - mesma disciplina
-- da armadilha 1 aplicada a policy. Seguro nos dois ambientes (armadilha 3).
-- ============================================================================

ALTER TABLE public.logs_tentativas_presenca ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow super_admin read logs" ON public.logs_tentativas_presenca;
DROP POLICY IF EXISTS "Allow authorized users read logs" ON public.logs_tentativas_presenca;

CREATE POLICY "Allow authorized users read logs" ON public.logs_tentativas_presenca
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND (
                  p.role IN ('super_admin', 'admin', 'coordenador', 'rh')
                  OR p.acesso_todas_unidades = true
              )
        )
        OR EXISTS (
            SELECT 1
              FROM public.profiles p
              JOIN public.servidores s ON s.id = logs_tentativas_presenca.servidor_id
             WHERE p.id = auth.uid()
               AND p.role = 'rh_unidade'
               AND s.unidade_id IN (
                   SELECT pu.unidade_id
                     FROM public.profile_unidades pu
                    WHERE pu.profile_id = p.id
               )
        )
    );

COMMENT ON TABLE public.logs_tentativas_presenca IS
    'Tentativas de marcacao recusadas. Leitura: super_admin/admin/coordenador/rh sem escopo; '
    'rh_unidade escopado pela lotacao do servidor. Nem toda linha prova presenca - use '
    'fn_tentativa_recusada_elegivel antes de transformar em horario de folha (armadilha 7).';


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
-- SELECT polname, pg_get_expr(polqual, polrelid) AS usando
--   FROM pg_policy
--  WHERE polrelid = 'public.logs_tentativas_presenca'::regclass;
--
-- Esperado: uma policy de SELECT citando 'rh' e 'rh_unidade'.
