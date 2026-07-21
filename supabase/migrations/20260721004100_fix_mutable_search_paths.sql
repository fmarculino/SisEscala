-- Migration: Fix mutable search paths for critical security definer functions
-- Description: Dynamically alters all functions in the public schema matching the security advisor list to set search_path = public, preventing search path hijacking.

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT 
            n.nspname as schema_name,
            p.proname as function_name,
            pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments
        FROM 
            pg_catalog.pg_proc p
            LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE 
            n.nspname = 'public'
            AND p.proname IN (
                'get_my_role',
                'fn_reverter_presenca_manual',
                'fn_check_shift_conflicts',
                'fn_get_monthly_occupancy',
                'fn_obter_horario_regular_dia',
                'fn_confirmar_presenca_manual'
            )
    LOOP
        EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = public', 
                       r.schema_name, r.function_name, r.identity_arguments);
    END LOOP;
END;
$$;
