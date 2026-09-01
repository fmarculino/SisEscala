-- ==============================================================================
-- MIGRATION: Alinhar fn_contar_pendencias_justificativa às regras de Sobreaviso
-- Data: 01/09/2026
--
-- Contexto:
-- Desde 23/08/2026 e 28/08/2026, Sobreaviso cumprido sem acionamento não exige
-- justificativa motivacional textual obrigatória (sem_acao_necessaria = true).
-- A função SQL fn_contar_pendencias_justificativa continuava exigindo
-- justificativas_eventos com status='aprovada' para Sobreaviso, bloqueando o
-- fechamento de escalas com 10 sobreavisos sem acionamento mesmo quando a tela
-- indicava "Pendentes: 0 (+10 cumpridos sem justificativa — opcional)".
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_contar_pendencias_justificativa(
    p_unidade_id UUID,
    p_setor_id UUID,
    p_mes INT,
    p_ano INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*)
    INTO v_count
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    LEFT JOIN public.justificativas_eventos je 
        ON je.servidor_id = em.servidor_id 
       AND je.dia = ed.dia 
       AND je.mes = em.mes 
       AND je.ano = em.ano 
       AND (je.categoria = ed.categoria::text OR LOWER(je.categoria) = LOWER(ed.categoria::text))
       AND je.status = 'aprovada'
    WHERE em.unidade_id = p_unidade_id
      AND em.setor_id = p_setor_id
      AND em.mes = p_mes
      AND em.ano = p_ano
      AND (
          ed.categoria::text IN ('Extra', 'Plantão', 'Plantao', 'EXTRA', 'PLANTAO')
          OR LOWER(ed.categoria::text) IN ('extra', 'plantão', 'plantao')
      )
      AND je.id IS NULL;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.fn_contar_pendencias_justificativa(UUID, UUID, INT, INT) IS 
'Conta pendências obrigatórias de justificativa motivacional (Extra e Plantão). Sobreaviso cumprido é avaliado pelo gate de desfecho.';
