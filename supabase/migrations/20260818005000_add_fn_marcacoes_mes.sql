-- Migration: RPC para busca de marcacoes de ponto do mes para a grade de escalas
-- Data: 2026-08-18

CREATE OR REPLACE FUNCTION public.fn_marcacoes_mes(
    p_servidor_ids uuid[],
    p_mes          integer,
    p_ano          integer
)
RETURNS TABLE (
    id          uuid,
    servidor_id uuid,
    ocorrido_em timestamptz,
    observacao  text,
    origem      public.marcacao_origem
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_start timestamptz;
    v_end   timestamptz;
BEGIN
    v_start := make_timestamptz(p_ano, p_mes, 1, 0, 0, 0, 'UTC') - interval '1 day';
    v_end   := (make_timestamptz(p_ano, p_mes, 1, 0, 0, 0, 'UTC') + interval '1 month') + interval '1 day';

    RETURN QUERY
    SELECT m.id, m.servidor_id, m.ocorrido_em, m.observacao, m.origem
      FROM public.marcacoes_ponto m
     WHERE m.servidor_id = ANY(p_servidor_ids)
       AND m.origem IN ('terminal', 'rep', 'pendrive', 'ajuste_servidor')
       AND m.ocorrido_em >= v_start
       AND m.ocorrido_em <= v_end
     ORDER BY m.ocorrido_em;
END;
$fn$;

COMMENT ON FUNCTION public.fn_marcacoes_mes(uuid[], integer, integer) IS
    'Retorna as marcacoes reais de ponto (terminal, rep, pendrive) dos servidores no mes para a grade.';

REVOKE ALL ON FUNCTION public.fn_marcacoes_mes(uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_marcacoes_mes(uuid[], integer, integer) TO authenticated, service_role;
