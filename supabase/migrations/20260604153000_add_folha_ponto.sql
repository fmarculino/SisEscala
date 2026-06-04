-- Migration: Add Folha Ponto (Timesheet) Table and Configurations
-- Description: Creates folha_ponto table, RLS policies for admins and coordinators, and seeds global configurations.

-- =========================================================================
-- 1. TABLES
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.folha_ponto (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escala_mensal_id UUID NOT NULL REFERENCES public.escala_mensal(id) ON DELETE CASCADE,
    servidor_id UUID NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    mes INTEGER NOT NULL CHECK (mes >= 1 AND mes <= 12),
    ano INTEGER NOT NULL CHECK (ano >= 2000),
    status TEXT NOT NULL DEFAULT 'Rascunho' CHECK (status IN ('Rascunho', 'Gerada', 'Revisada')),
    registros JSONB NOT NULL DEFAULT '[]',
    escala_fingerprint TEXT,
    total_horas_normais NUMERIC(6,2) DEFAULT 0,
    total_horas_extras_50 NUMERIC(6,2) DEFAULT 0,
    total_horas_extras_100 NUMERIC(6,2) DEFAULT 0,
    total_faltas INTEGER DEFAULT 0,
    gerado_por_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    gerado_em TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    ultima_edicao_por_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ultima_edicao_em TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Ensure exactly one timesheet per server per month/year
    CONSTRAINT unique_servidor_mes_ano UNIQUE(servidor_id, mes, ano)
);

-- =========================================================================
-- 2. SEED DEFAULT CONFIGURATIONS
-- =========================================================================

INSERT INTO public.configuracoes_globais (chave, valor, descricao, created_at, updated_at)
VALUES 
(
    'folha_ponto_habilitada',
    'false'::jsonb,
    'Habilitar ou desabilitar o módulo de Folha de Ponto no SisEscala.',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
),
(
    'folha_ponto_variacao_minutos',
    '15'::jsonb,
    'Janela de tolerância/variação máxima em minutos para geração de horários fictícios de entrada/saída (ex: 15 gera horários variando em até 14 minutos, nunca no minuto exato).',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
) ON CONFLICT (chave) DO NOTHING;

-- =========================================================================
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

ALTER TABLE public.folha_ponto ENABLE ROW LEVEL SECURITY;

-- Select Policy
DROP POLICY IF EXISTS "Admins e Coordenadores podem ler folhas de ponto" ON public.folha_ponto;
CREATE POLICY "Admins e Coordenadores podem ler folhas de ponto" ON public.folha_ponto
    FOR SELECT TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.servidores s
             WHERE s.id = folha_ponto.servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
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
             SELECT 1 FROM public.servidores s
             WHERE s.id = servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
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
             SELECT 1 FROM public.servidores s
             WHERE s.id = folha_ponto.servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
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
             SELECT 1 FROM public.servidores s
             WHERE s.id = folha_ponto.servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );

-- =========================================================================
-- 4. GRANTS
-- =========================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.folha_ponto TO authenticated, service_role;
GRANT SELECT ON public.folha_ponto TO anon;
