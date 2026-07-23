-- Migration: Add Solicitações de Férias e Licença Prêmio
-- Description: Creates tables, indexes, RLS policies and global config for the
--   vacation/license request workflow (servidor → coordenador → deferimento → escala).

-- =========================================================================
-- 1. ENUM-LIKE TYPES VIA CHECK CONSTRAINTS (keeps it simple & compatible)
-- =========================================================================

-- =========================================================================
-- 2. MAIN TABLE: solicitacoes_ferias_licencas
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.solicitacoes_ferias_licencas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Servidor & lotação snapshot (captured at request time)
    servidor_id UUID NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    unidade_id  UUID REFERENCES public.unidades(id) ON DELETE SET NULL,
    setor_id    UUID REFERENCES public.setores(id)  ON DELETE SET NULL,

    -- Benefit type & modality
    tipo_beneficio TEXT NOT NULL
        CHECK (tipo_beneficio IN ('ferias', 'licenca_premio')),

    exercicio TEXT NOT NULL,  -- e.g. '2024/2025' for férias, '2015/2020' for LP quinquênio

    modalidade TEXT NOT NULL
        CHECK (modalidade IN (
            'integral_30',       -- Férias integral 30d
            'fracionado_15_15',  -- Férias fracionado 15+15
            'abono_10_20',       -- Férias abono pecuniário 10d + gozo 20d
            'integral_90',       -- Licença Prêmio integral 90d
            'fracionado_45_45'   -- Licença Prêmio fracionado 45+45
        )),

    -- Cross-validation: modalidade must match tipo_beneficio
    CONSTRAINT chk_modalidade_tipo CHECK (
        (tipo_beneficio = 'ferias'        AND modalidade IN ('integral_30', 'fracionado_15_15', 'abono_10_20'))
        OR
        (tipo_beneficio = 'licenca_premio' AND modalidade IN ('integral_90', 'fracionado_45_45'))
    ),

    -- When servidor picks integral_30, they must also provide a 15/15 alternative
    sugestao_fracionamento JSONB,  -- {p1_inicio, p1_fim, p2_inicio, p2_fim}

    -- Up to 3 date options suggested by the servidor
    opcoes_datas JSONB NOT NULL,  -- [{p1_inicio, p1_fim, p2_inicio?, p2_fim?}, ...]

    -- Workflow status
    status TEXT NOT NULL DEFAULT 'aguardando_validacao'
        CHECK (status IN (
            'aguardando_validacao',
            'deferido',
            'indeferido',
            'contraproposta',
            'cancelado'
        )),

    -- Which option the coordinator selected (1, 2, or 3), NULL if contraproposta
    opcao_selecionada INTEGER CHECK (opcao_selecionada IS NULL OR opcao_selecionada BETWEEN 1 AND 3),

    -- Approved periods (filled upon deferimento)
    periodo_deferido_p1_inicio DATE,
    periodo_deferido_p1_fim    DATE,
    periodo_deferido_p2_inicio DATE,
    periodo_deferido_p2_fim    DATE,

    -- Abono pecuniário flag
    abono_pecuniario BOOLEAN NOT NULL DEFAULT false,

    -- Adicional de 1/3 constitucional (art. 7°, XVII, CF)
    adicional_terco BOOLEAN NOT NULL DEFAULT true,

    -- Textual fields
    observacao_servidor TEXT,
    parecer_coordenador TEXT,

    -- Contraproposta dates from coordinator
    contraproposta_datas JSONB,  -- {p1_inicio, p1_fim, p2_inicio?, p2_fim?}

    -- Validation tracking
    validado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    validado_em  TIMESTAMPTZ,

    -- References to generated servidores_eventos rows
    eventos_gerados_ids UUID[],

    -- Cancellation tracking
    cancelado_por       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    cancelado_em        TIMESTAMPTZ,
    motivo_cancelamento TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Prevent duplicate active requests for the same exercicio
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitacoes_unique_active
    ON public.solicitacoes_ferias_licencas (servidor_id, tipo_beneficio, exercicio)
    WHERE status NOT IN ('cancelado', 'indeferido');

-- =========================================================================
-- 3. AUDIT TABLE: solicitacoes_ferias_licencas_historico
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.solicitacoes_ferias_licencas_historico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    solicitacao_id UUID NOT NULL REFERENCES public.solicitacoes_ferias_licencas(id) ON DELETE CASCADE,

    acao TEXT NOT NULL
        CHECK (acao IN (
            'criada',
            'avaliada',
            'deferida',
            'indeferida',
            'contraproposta',
            'aceita_contraproposta',
            'rejeitada_contraproposta',
            'cancelada',
            'cancelada_admin'
        )),

    status_anterior TEXT,
    status_novo     TEXT NOT NULL,

    executado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    detalhes      JSONB,  -- Snapshot of relevant data at the moment of action

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- =========================================================================
-- 4. PERFORMANCE INDEXES
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_solicitacoes_servidor_id
    ON public.solicitacoes_ferias_licencas (servidor_id);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_setor_status
    ON public.solicitacoes_ferias_licencas (setor_id, status);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_unidade_status
    ON public.solicitacoes_ferias_licencas (unidade_id, status);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_historico_solicitacao
    ON public.solicitacoes_ferias_licencas_historico (solicitacao_id);

-- =========================================================================
-- 5. UPDATED_AT TRIGGER
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_update_solicitacoes_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_solicitacoes_updated_at ON public.solicitacoes_ferias_licencas;
CREATE TRIGGER trg_solicitacoes_updated_at
    BEFORE UPDATE ON public.solicitacoes_ferias_licencas
    FOR EACH ROW EXECUTE FUNCTION public.fn_update_solicitacoes_updated_at();

-- =========================================================================
-- 6. ROW LEVEL SECURITY
-- =========================================================================

ALTER TABLE public.solicitacoes_ferias_licencas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_ferias_licencas_historico ENABLE ROW LEVEL SECURITY;

-- Super Admin: full access
CREATE POLICY "super_admin_solicitacoes_all" ON public.solicitacoes_ferias_licencas
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    );

-- Admin: access to their assigned units/sectors
CREATE POLICY "admin_solicitacoes_all" ON public.solicitacoes_ferias_licencas
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role = 'admin'
              AND (
                  p.acesso_todas_unidades = true
                  OR EXISTS (SELECT 1 FROM public.profile_unidades pu WHERE pu.profile_id = p.id AND pu.unidade_id = solicitacoes_ferias_licencas.unidade_id)
              )
              AND (
                  p.acesso_todos_setores = true
                  OR EXISTS (SELECT 1 FROM public.profile_setores ps WHERE ps.profile_id = p.id AND ps.setor_id = solicitacoes_ferias_licencas.setor_id)
              )
        )
    );

-- Coordenador: access to their assigned sectors
CREATE POLICY "coordenador_solicitacoes_all" ON public.solicitacoes_ferias_licencas
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role = 'coordenador'
              AND (
                  p.acesso_todos_setores = true
                  OR EXISTS (SELECT 1 FROM public.profile_setores ps WHERE ps.profile_id = p.id AND ps.setor_id = solicitacoes_ferias_licencas.setor_id)
              )
        )
    );

-- Historico: same pattern
CREATE POLICY "super_admin_historico_all" ON public.solicitacoes_ferias_licencas_historico
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    );

CREATE POLICY "admin_historico_select" ON public.solicitacoes_ferias_licencas_historico
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.solicitacoes_ferias_licencas s
            JOIN public.profiles p ON p.id = auth.uid()
            WHERE s.id = solicitacoes_ferias_licencas_historico.solicitacao_id
              AND p.role = 'admin'
              AND (
                  p.acesso_todas_unidades = true
                  OR EXISTS (SELECT 1 FROM public.profile_unidades pu WHERE pu.profile_id = p.id AND pu.unidade_id = s.unidade_id)
              )
        )
    );

CREATE POLICY "coordenador_historico_select" ON public.solicitacoes_ferias_licencas_historico
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.solicitacoes_ferias_licencas s
            JOIN public.profiles p ON p.id = auth.uid()
            WHERE s.id = solicitacoes_ferias_licencas_historico.solicitacao_id
              AND p.role = 'coordenador'
              AND (
                  p.acesso_todos_setores = true
                  OR EXISTS (SELECT 1 FROM public.profile_setores ps WHERE ps.profile_id = p.id AND ps.setor_id = s.setor_id)
              )
        )
    );

-- =========================================================================
-- 7. GLOBAL CONFIGURATION: minimum advance days
-- =========================================================================

INSERT INTO public.configuracoes_globais (chave, valor, descricao, created_at, updated_at)
VALUES (
    'antecedencia_minima_ferias_dias',
    '60'::jsonb,
    'Número mínimo de dias de antecedência que o servidor deve respeitar ao solicitar férias ou licença prêmio. Padrão: 60 dias.',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
) ON CONFLICT (chave) DO NOTHING;
