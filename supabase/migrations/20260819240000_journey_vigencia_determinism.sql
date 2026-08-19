-- Migration: torna a vigencia de jornada deterministica e nao sobreponivel
--
-- CONTEXTO
--   servidores_jornadas_temporarias e a UNICA forma de dizer "este servidor passou a cumprir
--   outro horario a partir do dia X" sem reescrever o mes inteiro: obter_jornada_servidor_data
--   e chamada de dentro de fn_confirmar_presenca e fn_blocos_previstos_dia, entao terminal,
--   REP, reconciliacao e folha ja a respeitam por data.
--
--   Ela nasceu em 20260626230000 com dois furos que so nao doeram porque o uso e minimo
--   (5 registros em toda a producao, 4 servidores, medido em 19/08/2026):
--
--   1. SELECT ... LIMIT 1 SEM ORDER BY. Com duas vigencias cobrindo a mesma data, o Postgres
--      pode devolver qualquer uma - e pode devolver uma HOJE e outra AMANHA para a mesma
--      pergunta. Num sistema de ponto isso significa a mesma batida sendo julgada contra
--      janelas diferentes em execucoes diferentes.
--   2. Nada impedia criar as duas.
--
--   Correcao em duas camadas de proposito: a trigger impede o dado novo ruim, o ORDER BY
--   garante resposta estavel para o dado legado e para a janela entre uma coisa e outra.
--   Tirar qualquer uma das duas reabre o furo por um lado.
--
-- ESCOLHA DO CRITERIO DE DESEMPATE
--   Vence a vigencia registrada por ULTIMO (created_at DESC), nao a de menor intervalo:
--   se alguem cadastrou uma correcao em cima de um caso ja existente, a decisao mais recente
--   e a que vale. data_inicio DESC entra so como segundo desempate, e o id como terceiro para
--   nao sobrar empate nenhum.

-- 1. Resolucao deterministica
CREATE OR REPLACE FUNCTION public.obter_jornada_servidor_data(
    p_servidor_id UUID,
    p_data DATE,
    p_jornada_mensal_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_jornada_temporaria_id UUID;
BEGIN
    SELECT jornada_id INTO v_jornada_temporaria_id
    FROM public.servidores_jornadas_temporarias
    WHERE servidor_id = p_servidor_id
      AND p_data >= data_inicio
      AND p_data <= data_fim
    ORDER BY created_at DESC, data_inicio DESC, id DESC
    LIMIT 1;

    RETURN COALESCE(v_jornada_temporaria_id, p_jornada_mensal_id);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.obter_jornada_servidor_data(uuid, date, uuid) IS
    'Fonte unica da jornada vigente de um servidor numa data. Chamada de dentro de '
    'fn_confirmar_presenca e fn_blocos_previstos_dia - nao replicar a regra no frontend. '
    'ORDER BY explicito: sem ele, duas vigencias sobrepostas fariam a mesma batida ser '
    'julgada contra janelas diferentes em execucoes diferentes.';

-- 2. Sobreposicao passa a ser recusada
CREATE OR REPLACE FUNCTION public.trg_vigencia_jornada_sem_sobreposicao()
RETURNS TRIGGER AS $$
DECLARE
    v_conflito RECORD;
BEGIN
    SELECT t.id, t.data_inicio, t.data_fim, j.nome AS jornada_nome
      INTO v_conflito
      FROM public.servidores_jornadas_temporarias t
      LEFT JOIN public.jornadas j ON j.id = t.jornada_id
     WHERE t.servidor_id = NEW.servidor_id
       AND t.id <> NEW.id
       AND t.data_inicio <= NEW.data_fim
       AND NEW.data_inicio <= t.data_fim
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Ja existe vigencia de jornada para este servidor entre % e % (%). Ajuste o periodo existente antes de criar outro.',
            to_char(v_conflito.data_inicio, 'DD/MM/YYYY'),
            to_char(v_conflito.data_fim, 'DD/MM/YYYY'),
            COALESCE(v_conflito.jornada_nome, 'jornada removida');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_vigencia_jornada_sem_sobreposicao ON public.servidores_jornadas_temporarias;
CREATE TRIGGER trg_vigencia_jornada_sem_sobreposicao
    BEFORE INSERT OR UPDATE OF servidor_id, data_inicio, data_fim
    ON public.servidores_jornadas_temporarias
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_vigencia_jornada_sem_sobreposicao();

-- 3. Conferencia: tem que devolver 0 linhas ANTES e DEPOIS desta migration.
--    Se devolver alguma, a trigger acima nao vai barrar o passado (ela so olha dado novo) -
--    resolva a sobreposicao na mao antes de confiar na resolucao por data.
-- SELECT a.id, a.servidor_id, a.data_inicio, a.data_fim, b.id, b.data_inicio, b.data_fim
--   FROM public.servidores_jornadas_temporarias a
--   JOIN public.servidores_jornadas_temporarias b
--     ON b.servidor_id = a.servidor_id AND b.id > a.id
--    AND a.data_inicio <= b.data_fim AND b.data_inicio <= a.data_fim;
