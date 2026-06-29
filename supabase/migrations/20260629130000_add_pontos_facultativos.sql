-- Migration: Add Pontos Facultativos support and update fn_confirmar_presenca

-- 1. Add "essencial" flag to sectors table if not exists
ALTER TABLE public.setores ADD COLUMN IF NOT EXISTS essencial BOOLEAN DEFAULT FALSE;

-- 2. Create pontos_facultativos table
CREATE TABLE IF NOT EXISTS public.pontos_facultativos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data DATE NOT NULL,
    descricao TEXT NOT NULL,
    inicio_liberacao_em TIME DEFAULT NULL, -- NULL means full day (Saída Antecipada)
    fim_liberacao_em TIME DEFAULT NULL,    -- NULL means full day (Entrada Tardia)
    gera_he_para_essenciais BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for pontos_facultativos
ALTER TABLE public.pontos_facultativos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to pontos facultativos for authenticated" ON public.pontos_facultativos;
CREATE POLICY "Allow read access to pontos facultativos for authenticated" ON public.pontos_facultativos
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow write access to pontos facultativos for admins" ON public.pontos_facultativos;
CREATE POLICY "Allow write access to pontos facultativos for admins" ON public.pontos_facultativos
    FOR ALL TO authenticated USING (((SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])));

-- 3. Create punto_facultativo_setores junction table
CREATE TABLE IF NOT EXISTS public.ponto_facultativo_setores (
    ponto_facultativo_id UUID REFERENCES public.pontos_facultativos(id) ON DELETE CASCADE,
    setor_id UUID REFERENCES public.setores(id) ON DELETE CASCADE,
    tipo_regra TEXT NOT NULL CHECK (tipo_regra IN ('incluido', 'excluido')),
    PRIMARY KEY (ponto_facultativo_id, setor_id)
);

-- Enable RLS for ponto_facultativo_setores
ALTER TABLE public.ponto_facultativo_setores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to rules for authenticated" ON public.ponto_facultativo_setores;
CREATE POLICY "Allow read access to rules for authenticated" ON public.ponto_facultativo_setores
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow write access to rules for admins" ON public.ponto_facultativo_setores;
CREATE POLICY "Allow write access to rules for admins" ON public.ponto_facultativo_setores
    FOR ALL TO authenticated USING (((SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])));
