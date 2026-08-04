-- Migration: Allow Coordenadores and Administradores to read denied attempt logs
-- Description: Updates Row Level Security (RLS) policy on logs_tentativas_presenca table so that super_admin, admin, and coordenador profiles can read denied presence attempt logs when justifying manual presence in scale grid.

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
                  p.role IN ('super_admin', 'admin', 'coordenador')
                  OR p.acesso_todas_unidades = true
              )
        )
    );
