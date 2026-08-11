-- Migration: solicitacao de transferencia de unidade/setor, com aprovacao do administrador geral
-- Data: 2026-08-11
--
-- CONTEXTO
--   Ate hoje, qualquer admin/coordenador que edita a ficha do servidor e muda unidade/setor
--   executa a transferencia na hora (updateServidor). O RH pediu, depois do incidente da THIELE e
--   da KETTELE (v1.41.0 - duas tentativas de transferencia recusadas pela RLS sem mensagem clara,
--   e o historico chegou a registrar transferencia que nao aconteceu), que so o super_admin possa
--   EFETIVAR uma transferencia. Coordenador/admin passam a SOLICITAR; o super_admin avalia.
--
--   Modelo espelha solicitacoes_ferias_licencas (20260724000000), que entre os tres fluxos de
--   solicitacao ja existentes no projeto (o outro e solicitacoes_troca) e o mais maduro: status
--   sob CHECK, colunas de aprovacao/rejeicao dedicadas (nao uma coluna generica reaproveitada
--   pras duas coisas, como aprovado_por em solicitacoes_troca), RLS granular por role.
--
--   NAO substitui historico_transferencias - ela continua sendo o log append-only do que
--   realmente aconteceu. Esta tabela e a fila do que foi PEDIDO; ao aprovar, o codigo grava nas
--   duas (ve servidores/actions.ts, avaliarSolicitacaoTransferencia).

CREATE TABLE IF NOT EXISTS public.solicitacoes_transferencia_servidor (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id                 uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    unidade_origem_id           uuid REFERENCES public.unidades(id) ON DELETE SET NULL,
    setor_origem_id             uuid REFERENCES public.setores(id) ON DELETE SET NULL,
    unidade_destino_id          uuid REFERENCES public.unidades(id) ON DELETE SET NULL,
    setor_destino_id            uuid REFERENCES public.setores(id) ON DELETE SET NULL,
    data_transferencia_sugerida date NOT NULL,
    motivo                      text NOT NULL,
    status                      text NOT NULL DEFAULT 'pendente'
                                 CHECK (status IN ('pendente', 'aprovada', 'rejeitada', 'cancelada')),
    solicitado_por_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    solicitado_em               timestamptz NOT NULL DEFAULT now(),
    avaliado_por_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    avaliado_em                 timestamptz,
    parecer                     text,
    historico_transferencia_id  uuid REFERENCES public.historico_transferencias(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.solicitacoes_transferencia_servidor IS
    'Pedido de transferencia de unidade/setor feito por quem nao e super_admin. Ao aprovar, o '
    'codigo grava em historico_transferencias e atualiza servidores - esta tabela nao move '
    'ninguem sozinha, so registra o pedido e o parecer.';

-- No maximo 1 pendente por servidor - mesmo espirito do indice anti-duplicidade de
-- solicitacoes_ferias_licencas. Pedir de novo com o mesmo destino antes de decidirem a primeira
-- so confundiria quem aprova.
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitacoes_transferencia_pendente_unica
    ON public.solicitacoes_transferencia_servidor (servidor_id)
    WHERE status = 'pendente';

CREATE INDEX IF NOT EXISTS idx_solicitacoes_transferencia_servidor_id
    ON public.solicitacoes_transferencia_servidor (servidor_id);

ALTER TABLE public.solicitacoes_transferencia_servidor ENABLE ROW LEVEL SECURITY;

-- SELECT: mesmo escopo de historico_transferencias (20260612100000) - super_admin ve tudo;
-- admin/coordenador so' o que esta na unidade/setor ATUAL do servidor (nao o destino pedido,
-- que pode estar fora do escopo de quem so' esta propondo).
DROP POLICY IF EXISTS "Leitura de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Leitura de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor
    FOR SELECT TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.servidores s
             WHERE s.id = solicitacoes_transferencia_servidor.servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );

-- INSERT: mesmo escopo, com WITH CHECK - so' pode solicitar transferencia de servidor que ja
-- enxerga hoje. O destino (unidade_destino_id/setor_destino_id) NAO e checado contra o escopo -
-- e o ponto de pedir: propor um destino fora do que se administra, pro super_admin decidir.
DROP POLICY IF EXISTS "Insercao de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Insercao de solicitacoes_transferencia por escopo" ON public.solicitacoes_transferencia_servidor
    FOR INSERT TO authenticated
    WITH CHECK (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.servidores s
             WHERE s.id = servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );

-- UPDATE: SO' super_admin - e a acao de aprovar/rejeitar, o ponto inteiro desta feature.
DROP POLICY IF EXISTS "Avaliacao de solicitacoes_transferencia so super_admin" ON public.solicitacoes_transferencia_servidor;
CREATE POLICY "Avaliacao de solicitacoes_transferencia so super_admin" ON public.solicitacoes_transferencia_servidor
    FOR UPDATE TO authenticated
    USING ((SELECT get_my_role()) = 'super_admin'::user_role)
    WITH CHECK ((SELECT get_my_role()) = 'super_admin'::user_role);

GRANT SELECT, INSERT, UPDATE ON public.solicitacoes_transferencia_servidor TO authenticated;
GRANT ALL ON public.solicitacoes_transferencia_servidor TO service_role;

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--   1. Tabela e indices existem, RLS ligada:
--      SELECT count(*) FROM public.solicitacoes_transferencia_servidor;  -- esperado: 0
--      SELECT indexname FROM pg_indexes WHERE tablename = 'solicitacoes_transferencia_servidor';
--   2. So' 1 pendente por servidor (teste manual, opcional): inserir duas linhas pendente pro
--      mesmo servidor_id deve falhar na segunda com violacao do indice unico parcial.
