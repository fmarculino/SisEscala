-- Migration: Add servidores transfer history and adjust folha_ponto constraints
-- Description: Creates historico_transferencias table, adjusts constraints on folha_ponto to support mid-month transfers, and configures RLS.

-- 1. Create historico_transferencias table
CREATE TABLE IF NOT EXISTS public.historico_transferencias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id UUID NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    unidade_origem_id UUID REFERENCES public.unidades(id) ON DELETE SET NULL,
    setor_origem_id UUID REFERENCES public.setores(id) ON DELETE SET NULL,
    unidade_destino_id UUID REFERENCES public.unidades(id) ON DELETE SET NULL,
    setor_destino_id UUID REFERENCES public.setores(id) ON DELETE SET NULL,
    data_transferencia DATE NOT NULL,
    motivo TEXT NOT NULL,
    criado_por_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Adjust folha_ponto unique constraints
ALTER TABLE public.folha_ponto DROP CONSTRAINT IF EXISTS unique_servidor_mes_ano;
ALTER TABLE public.folha_ponto DROP CONSTRAINT IF EXISTS unique_escala_mensal_id;
ALTER TABLE public.folha_ponto ADD CONSTRAINT unique_escala_mensal_id UNIQUE (escala_mensal_id);

-- 3. Enable RLS on historico_transferencias
ALTER TABLE public.historico_transferencias ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies
DROP POLICY IF EXISTS "Admins e Coordenadores podem ler historico_transferencias" ON public.historico_transferencias;
CREATE POLICY "Admins e Coordenadores podem ler historico_transferencias" ON public.historico_transferencias
    FOR SELECT TO authenticated
    USING (
        ((SELECT get_my_role()) = 'super_admin'::user_role) OR
        (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
         EXISTS (
             SELECT 1 FROM public.servidores s
             WHERE s.id = historico_transferencias.servidor_id AND (
                 (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
                 (s.unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR
                 (s.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid()))
             )
         ))
    );

DROP POLICY IF EXISTS "Admins e Coordenadores podem inserir historico_transferencias" ON public.historico_transferencias;
CREATE POLICY "Admins e Coordenadores podem inserir historico_transferencias" ON public.historico_transferencias
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

-- 5. Grants
GRANT SELECT, INSERT ON public.historico_transferencias TO authenticated, service_role;
