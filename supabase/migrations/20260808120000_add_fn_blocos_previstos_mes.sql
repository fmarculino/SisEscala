-- Migration: fn_blocos_previstos_mes - a grade passa a ler a previsao do banco (Fase 3)
-- Data: 2026-08-08
--
-- O PROBLEMA QUE ISTO FECHA
--   O horario previsto de um turno e calculado em DOIS lugares que discordam:
--
--     backend  fn_confirmar_presenca / fn_confirmar_presenca_manual / fn_blocos_previstos_dia
--              cadeia: hora do coordenador -> ancora do codigo -> jornada -> cascata legada
--     frontend ScaleGrid.tsx: getShiftStartHour / getShiftEndHour / getShiftForecastTime
--              regras proprias por prefixo do codigo
--
--   Medido em 08/08/2026: num dia de ANDRESA (Regular M jornada 08H-14H + Plantao T) a grade
--   mostra previsao de 13:00 e o terminal exige 14:00. E o coordenador nao tem como descobrir
--   isso pela tela - ele ve uma coisa e o servidor apanha do terminal com outra.
--
--   Pior: ScaleGrid.tsx tambem usa a regra local para GRAVAR os timestamps sinteticos de
--   entrada e saida ao salvar a previsao com presenca marcada. Divergencia ali nao e cosmetica,
--   vira horario errado em escala_diaria.
--
-- POR QUE NAO EXTRAIR fn_horario_previsto_turno DE fn_confirmar_presenca
--   Era o desenho original do plano. Foi descartado: extrair o COALESCE de start_hour exige
--   REESTRUTURAR o corpo de fn_confirmar_presenca, que e exatamente a operacao que ja produziu
--   seis regressoes reais (CLAUDE.md armadilha 1). E desnecessario, porque
--   fn_blocos_previstos_dia JA e essa fonte unica - ela nasceu como copia mecanica do motor de
--   blocos e as Fases 1 e 2 a mantiveram em sincronia, com as tres funcoes alteradas pelo mesmo
--   script no mesmo commit.
--
--   Falta apenas poder consulta-la para uma GRADE INTEIRA de uma vez.
--
-- O QUE ESTA MIGRATION FAZ
--   Cria um envelope em lote. ZERO logica nova: e um LATERAL sobre fn_blocos_previstos_dia,
--   o mesmo padrao que fn_conferir_reconciliacao ja usa. Por construcao, o que a grade passa a
--   desenhar e literalmente o que o terminal vai cobrar - nao "uma regra equivalente".
--
--   ESTA MIGRATION NAO ALTERA NENHUMA FUNCAO EXISTENTE.
--   Cria uma funcao nova que ninguem chama ainda. Efeito no comportamento: nenhum.
--
-- POR QUE SO OS DIAS QUE TEM ESCALA
--   Iterar 1..31 por servidor faria 651 chamadas na maior grade de producao (21 servidores em
--   08/2026). Percorrendo so os dias com linha em escala_diaria, e DISTINCT porque um dia pode
--   ter Regular + Extra + Plantao, o volume cai para os dias realmente escalados.
--
--   Medido em 08/08/2026: uma a uma via HTTP a maior grade levaria ~34s (52ms/chamada, quase
--   tudo latencia de rede). Em lote, o LATERAL roda inteiro no servidor, numa ida so.
--
-- SERVIDOR COM MAIS DE UMA escala_mensal NO MES
--   fn_blocos_previstos_dia resolve por (servidor, mes, ano), nao por escala_mensal_id - ela
--   agrega os turnos de TODAS as escalas mensais do servidor naquele mes, que e o comportamento
--   correto (o terminal faz igual: a pessoa e uma so). Se o servidor tiver duas escalas mensais
--   no mes, o mesmo bloco aparece uma vez por escala_mensal_id pedido. O DISTINCT evita linha
--   repetida identica; a coluna escala_mensal_id diz de qual pedido veio.
--
-- EXPOSICAO (a mesma de fn_blocos_previstos_dia, deliberadamente)
--   SECURITY DEFINER e GRANT para authenticated, igual a funcao que ela envelopa. Isso significa
--   que um usuario autenticado pode consultar a previsao de escalas_mensais que nao sao do setor
--   dele, se souber os UUIDs. Nao e uma exposicao nova - fn_blocos_previstos_dia (20260808040000)
--   ja tem exatamente essa, e a grade ja carrega escala_diaria do setor por RLS.
--
--   FICA REGISTRADO COMO PENDENCIA: as duas deveriam validar o acesso do chamador ao setor,
--   como fn_confirmar_presenca faz. Nao foi feito aqui para nao misturar mudanca de seguranca
--   com mudanca de comportamento na mesma migration.
--
-- CONFERENCIA APOS APLICAR
--   -- 1. o lote tem que devolver exatamente o mesmo que as chamadas individuais.
--   --    Compara os dois caminhos para um setor inteiro de agosto/2026:
--   WITH ids AS (
--       SELECT array_agg(id) AS v FROM public.escala_mensal WHERE ano = 2026 AND mes = 8
--   ),
--   lote AS (
--       SELECT servidor_id, dia, bloco_ordem, inicio_previsto, fim_previsto
--         FROM ids, public.fn_blocos_previstos_mes(ids.v)
--   ),
--   individual AS (
--       SELECT em.servidor_id, ed.dia, b.bloco_ordem, b.inicio_previsto, b.fim_previsto
--         FROM public.escala_mensal em
--         JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
--         CROSS JOIN LATERAL public.fn_blocos_previstos_dia(
--                  em.servidor_id, make_date(em.ano, em.mes, ed.dia)) b
--        WHERE em.ano = 2026 AND em.mes = 8
--   )
--   SELECT (SELECT count(*) FROM (SELECT * FROM lote EXCEPT SELECT * FROM individual) x)
--        + (SELECT count(*) FROM (SELECT * FROM individual EXCEPT SELECT * FROM lote) y)
--          AS divergencias;
--   -- esperado: 0
--
--   -- 2. custo. Tem que responder rapido o suficiente para a grade carregar.
--   EXPLAIN ANALYZE
--   SELECT count(*) FROM public.fn_blocos_previstos_mes(
--       (SELECT array_agg(em.id) FROM public.escala_mensal em
--         WHERE em.ano = 2026 AND em.mes = 8
--           AND em.setor_id = (SELECT setor_id FROM public.escala_mensal
--                               WHERE ano = 2026 AND mes = 8
--                            GROUP BY setor_id ORDER BY count(*) DESC LIMIT 1)));
--   -- o maior setor de 08/2026 tem 21 servidores.


DROP FUNCTION IF EXISTS public.fn_blocos_previstos_mes(uuid[]);

CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_mes(
    p_escala_mensal_ids uuid[]
)
RETURNS TABLE (
    escala_mensal_id          uuid,
    servidor_id               uuid,
    dia                       integer,
    bloco_ordem               integer,
    escala_diaria_ids         uuid[],
    categoria                 text,
    inicio_previsto           timestamptz,
    fim_previsto              timestamptz,
    intervalo_inicio_previsto timestamptz,
    intervalo_fim_previsto    timestamptz,
    permite_intervalo         boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT
           em.id                       AS escala_mensal_id,
           em.servidor_id              AS servidor_id,
           d.dia                       AS dia,
           b.bloco_ordem,
           b.escala_diaria_ids,
           b.categoria,
           b.inicio_previsto,
           b.fim_previsto,
           b.intervalo_inicio_previsto,
           b.intervalo_fim_previsto,
           b.permite_intervalo
      FROM public.escala_mensal em
      -- So os dias que realmente tem escala. DISTINCT porque um dia pode ter Regular + Extra
      -- + Plantao, e fn_blocos_previstos_dia ja devolve o dia inteiro de uma vez.
      CROSS JOIN LATERAL (
          SELECT DISTINCT ed.dia
            FROM public.escala_diaria ed
           WHERE ed.escala_mensal_id = em.id
      ) d
      CROSS JOIN LATERAL public.fn_blocos_previstos_dia(
          em.servidor_id,
          make_date(em.ano, em.mes, d.dia)
      ) b
     WHERE em.id = ANY(p_escala_mensal_ids);
$$;

COMMENT ON FUNCTION public.fn_blocos_previstos_mes(uuid[]) IS
'Blocos de trabalho previstos para varias escalas mensais de uma vez - o que a grade precisa
para desenhar a previsao de presenca sem re-derivar horario por conta propria.

ZERO logica propria: e um LATERAL sobre fn_blocos_previstos_dia. Por construcao devolve
exatamente o que o terminal vai cobrar. Se algum dia divergir, o bug esta na funcao envelopada,
nunca nesta.

Percorre apenas os dias com linha em escala_diaria, nao 1..31.

Ver docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md (Fase 3).';

GRANT EXECUTE ON FUNCTION public.fn_blocos_previstos_mes(uuid[]) TO authenticated, service_role;
