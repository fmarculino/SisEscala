-- Migration: Recupera saidas recusadas por causa da fusao de bloco com Sobreaviso
-- Data: 2026-08-07
--
-- CONTEXTO
--   Antes de 20260807000000, um Sobreaviso escalado no mesmo dia era fundido no bloco de
--   trabalho, empurrando a janela de SAIDA para o fim do sobreaviso (tipicamente 06:00 do
--   dia seguinte). O servidor batia o ponto no horario correto e era recusado.
--
--   As batidas recusadas ficaram registradas em logs_tentativas_presenca. Esta migration
--   reconstroi presenca_saida_em a partir desses registros - ou seja, usa o horario REAL
--   em que o servidor bateu o ponto, nao um horario presumido.
--
-- CASOS CONHECIDOS (producao, 08/2026)
--   LUCIA LAYANE ROSA SAMPAIO, jornada 08H AS 18H:
--     dia 5 -> tentativas as 18:26 e 18:29 (usa a primeira)
--     dia 6 -> tentativas as 18:17 e 18:18 (usa a primeira)
--
-- ALEM DISSO
--   A fusao tambem gravava a entrada do turno na linha de Sobreaviso (mesmo timestamp),
--   porque o bloco continha os dois ids. Sobreaviso nao marca presenca: essas marcas sao
--   artefato e sao removidas.
--
-- ESCOPO
--   Competencia 08/2026. Idempotente: so age onde presenca_saida_em ainda esta NULL e onde
--   a marca de Sobreaviso e comprovadamente identica a do turno de trabalho do mesmo dia.

DO $$
DECLARE
    v_timezone TEXT;
    v_saidas   INTEGER := 0;
    v_limpos   INTEGER := 0;
BEGIN
    SELECT (valor#>>'{}')::text INTO v_timezone
    FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    -- 1. Reconstroi a saida a partir da PRIMEIRA tentativa recusada do dia posterior a entrada.
    WITH afetados AS (
        SELECT ed.id,
               em.servidor_id,
               MAKE_DATE(em.ano, em.mes, ed.dia) AS data_local,
               ed.presenca_entrada_em
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        WHERE em.ano = 2026 AND em.mes = 8
          AND ed.categoria::text IN ('Regular', 'Plantão', 'Extra')
          AND ed.presenca_entrada_em IS NOT NULL
          AND ed.presenca_saida_em IS NULL
          -- so os dias em que havia Sobreaviso concorrente (causa da fusao)
          AND EXISTS (
                SELECT 1 FROM public.escala_diaria so
                WHERE so.escala_mensal_id = ed.escala_mensal_id
                  AND so.dia = ed.dia
                  AND so.categoria::text = 'Sobreaviso'
              )
    ),
    recuperadas AS (
        SELECT a.id,
               (
                 SELECT MIN(l.data_hora_tentativa)
                 FROM public.logs_tentativas_presenca l
                 WHERE l.servidor_id = a.servidor_id
                   AND (l.data_hora_tentativa AT TIME ZONE v_timezone)::date = a.data_local
                   AND l.data_hora_tentativa > a.presenca_entrada_em
                   AND l.mensagem_erro ILIKE '%janela%'
               ) AS saida_real
        FROM afetados a
    )
    UPDATE public.escala_diaria ed
    SET presenca_saida_em   = r.saida_real,
        presenca_saida_manual = true,
        presenca_confirmada = true
    FROM recuperadas r
    WHERE ed.id = r.id
      AND r.saida_real IS NOT NULL;
    GET DIAGNOSTICS v_saidas = ROW_COUNT;
    RAISE NOTICE 'Saidas recuperadas a partir das tentativas recusadas: %', v_saidas;

    -- 2. Remove as marcas de presenca gravadas indevidamente nas linhas de Sobreaviso.
    --    Criterio conservador: so remove quando o timestamp e IDENTICO ao do turno de
    --    trabalho do mesmo dia, o que prova ser artefato da fusao de bloco.
    UPDATE public.escala_diaria so
    SET presenca_entrada_em  = NULL,
        presenca_entrada_manual = false,
        presenca_saida_em    = NULL,
        presenca_saida_manual = false,
        presenca_confirmada  = false
    FROM public.escala_diaria trab
    JOIN public.escala_mensal em ON trab.escala_mensal_id = em.id
    WHERE so.escala_mensal_id = trab.escala_mensal_id
      AND so.dia = trab.dia
      AND so.categoria::text = 'Sobreaviso'
      AND trab.categoria::text IN ('Regular', 'Plantão', 'Extra')
      AND em.ano = 2026 AND em.mes = 8
      AND so.presenca_entrada_em IS NOT NULL
      AND so.presenca_entrada_em = trab.presenca_entrada_em;
    GET DIAGNOSTICS v_limpos = ROW_COUNT;
    RAISE NOTICE 'Marcas de presenca removidas de linhas de Sobreaviso: %', v_limpos;
END;
$$;


-- CONSULTA DE CONFERENCIA (deve mostrar a saida preenchida e o Sobreaviso limpo)
--
-- SELECT s.nome, ed.dia, ed.categoria,
--        ed.presenca_entrada_em AT TIME ZONE 'America/Sao_Paulo' AS entrada_local,
--        ed.presenca_saida_em   AT TIME ZONE 'America/Sao_Paulo' AS saida_local,
--        ed.presenca_saida_manual
-- FROM escala_diaria ed
-- JOIN escala_mensal em ON ed.escala_mensal_id = em.id
-- JOIN servidores s ON em.servidor_id = s.id
-- WHERE em.ano = 2026 AND em.mes = 8
--   AND s.nome ILIKE '%LUCIA LAYANE%'
--   AND ed.dia IN (5, 6)
-- ORDER BY ed.dia, ed.categoria;
