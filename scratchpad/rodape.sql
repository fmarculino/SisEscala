
-- ============================================================================
-- 6. Permissoes
-- ============================================================================
-- fn_blocos_previstos_dia foi recriada por DROP + CREATE em 20260808040000; o GRANT original
-- vive naquela migration. CREATE OR REPLACE preserva os grants, mas repetir e barato e evita
-- que a funcao fique inacessivel se alguem trocar o REPLACE por DROP no futuro.

GRANT EXECUTE ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) TO authenticated, service_role;
