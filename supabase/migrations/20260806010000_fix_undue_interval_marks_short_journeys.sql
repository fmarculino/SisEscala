-- Migration: Corrige marcacoes de intervalo indevidas em jornadas de ate 6h (agosto/2026)
-- Data: 2026-08-06
--
-- CONTEXTO
--   A regressao corrigida em 20260806000000 (perda do guard de duracao em fn_confirmar_presenca)
--   e a ausencia historica de guard em fn_confirmar_presenca_manual permitiram gravar
--   presenca_intervalo_saida_em / presenca_intervalo_retorno_em para servidores com jornada
--   de 4h e 6h, que nao possuem intervalo intrajornada (CLT Art. 71).
--
-- AUDITORIA EM PRODUCAO (06/08/2026)
--   166 registros com marca de intervalo, todos na competencia 08/2026.
--    31 deles em jornadas de ate 6h (indevidos):
--        - 21 ja possuem presenca_saida_em correta  -> apenas limpar o intervalo
--        - 10 estao sem presenca_saida_em           -> limpar e preencher a saida prevista
--   Distribuidos em USF ENFERMEIRA ZEZINHA (10), SMS (18) e LACEM (3).
--
-- POR QUE NAO "MOVER" O TIMESTAMP
--   Os horarios gravados nos campos de intervalo NAO sao batidas reais: foram gerados
--   sinteticamente por fn_confirmar_presenca_manual como "inicio da jornada + 4h"
--   (horarios redondos, e 10 deles com saida == retorno, ou seja, intervalo de duracao zero).
--   Move-los para presenca_saida_em registraria uma saida falsa - por exemplo, saida as 11h
--   para um servidor com jornada 07H AS 13H. A saida faltante e portanto reconstruida a
--   partir do horario de termino previsto da jornada, e sinalizada como ajuste manual.
--
-- ESCOPO
--   Apenas competencia 08/2026. Nenhuma outra competencia possui registros afetados.
--   Idempotente: apos rodar, o conjunto alvo fica vazio e reexecucoes nao alteram nada.

DO $$
DECLARE
    v_timezone TEXT;
    v_total    INTEGER := 0;
    v_saidas   INTEGER := 0;
    v_limpos   INTEGER := 0;
BEGIN
    SELECT (valor#>>'{}')::text INTO v_timezone
    FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    -- Conjunto alvo: marca de intervalo presente E jornada sem direito a intervalo.
    -- A duracao segue a mesma resolucao usada por fn_confirmar_presenca: horas_totais da
    -- jornada para Regular, horas_computadas do turno para Plantao/Extra.
    CREATE TEMP TABLE tmp_intervalo_indevido ON COMMIT DROP AS
    SELECT ed.id,
           em.ano,
           em.mes,
           ed.dia,
           j.nome                                                  AS jornada_nome,
           substring(j.nome from '^([0-9]+)')::integer              AS hora_inicio,
           substring(j.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer AS hora_fim
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    LEFT JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    LEFT JOIN public.jornadas j
           ON j.id = public.obter_jornada_servidor_data(
                        em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
    WHERE em.ano = 2026
      AND em.mes = 8
      AND (ed.presenca_intervalo_saida_em IS NOT NULL
        OR ed.presenca_intervalo_retorno_em IS NOT NULL)
      AND NOT public.fn_jornada_tem_intervalo(
              (CASE
                   WHEN ed.categoria::text = 'Regular' AND COALESCE(j.horas_totais, 0) > 0
                       THEN j.horas_totais
                   ELSE COALESCE(dt.horas_computadas, 0)
               END * 60)::integer,
              COALESCE(j.intervalo_minutos, 60)
          );

    SELECT count(*) INTO v_total FROM tmp_intervalo_indevido;
    RAISE NOTICE 'Registros com marca de intervalo indevida em 08/2026: %', v_total;

    IF v_total = 0 THEN
        RAISE NOTICE 'Nada a corrigir. Migration encerrada sem alteracoes.';
        RETURN;
    END IF;

    -- 1. Reconstroi a saida faltante a partir do termino previsto da jornada.
    --    Jornadas que cruzam a meia-noite (fim <= inicio) caem no dia seguinte.
    UPDATE public.escala_diaria ed
    SET presenca_saida_em = (
            MAKE_TIMESTAMP(a.ano, a.mes, a.dia, a.hora_fim, 0, 0)
            + CASE WHEN a.hora_fim <= a.hora_inicio THEN interval '1 day' ELSE interval '0' END
        ) AT TIME ZONE v_timezone,
        presenca_saida_manual = true,
        presenca_confirmada   = true
    FROM tmp_intervalo_indevido a
    WHERE ed.id = a.id
      AND ed.presenca_saida_em IS NULL
      AND a.hora_fim IS NOT NULL
      AND a.hora_fim BETWEEN 0 AND 23
      AND a.hora_inicio IS NOT NULL;
    GET DIAGNOSTICS v_saidas = ROW_COUNT;
    RAISE NOTICE 'Saidas reconstruidas a partir do fim previsto da jornada: %', v_saidas;

    -- 2. Limpa os campos de intervalo indevidos, preservando entrada e saida.
    UPDATE public.escala_diaria ed
    SET presenca_intervalo_saida_em      = NULL,
        presenca_intervalo_retorno_em    = NULL,
        presenca_intervalo_saida_manual  = false,
        presenca_intervalo_retorno_manual = false
    FROM tmp_intervalo_indevido a
    WHERE ed.id = a.id;
    GET DIAGNOSTICS v_limpos = ROW_COUNT;
    RAISE NOTICE 'Registros com campos de intervalo limpos: %', v_limpos;

    -- Registros que seguem sem saida (jornada com nome fora do padrao "HH AS HH")
    -- ficam pendentes de validacao manual pelo coordenador, com horario real.
    IF v_saidas < v_total THEN
        RAISE NOTICE 'Pendentes de validacao manual (saida nao reconstruida): %', v_total - v_saidas;
    END IF;
END;
$$;


-- CONSULTA DE CONFERENCIA (executar apos a migration; deve retornar zero linhas)
--
-- SELECT s.nome, j.nome AS jornada, j.horas_totais, ed.dia, ed.categoria,
--        ed.presenca_entrada_em, ed.presenca_intervalo_saida_em,
--        ed.presenca_intervalo_retorno_em, ed.presenca_saida_em
-- FROM escala_diaria ed
-- JOIN escala_mensal em ON ed.escala_mensal_id = em.id
-- JOIN servidores s ON em.servidor_id = s.id
-- LEFT JOIN jornadas j ON j.id = obter_jornada_servidor_data(
--                             em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
-- WHERE em.ano = 2026 AND em.mes = 8
--   AND j.horas_totais <= 6
--   AND (ed.presenca_intervalo_saida_em IS NOT NULL OR ed.presenca_intervalo_retorno_em IS NOT NULL)
-- ORDER BY s.nome, ed.dia;
