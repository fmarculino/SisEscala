-- Migration: fn_janela_sobreaviso_dia
-- Fase 1 do plano docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
--
-- PROBLEMA
--   A janela de horario de um plantao de Sobreaviso nao tem fonte no banco.
--   fn_blocos_previstos_dia exclui Sobreaviso por construcao (armadilha 6: Sobreaviso nao
--   marca presenca, nao entra na montagem de blocos) e os 5 codigos de sobreaviso do
--   dicionario tem horario_inicio = NULL de proposito (ancorar codigo de Sobreaviso e
--   proibido; as migrations de ancora abortam se tentarem).
--
--   Hoje a janela e calculada em DUAS heuristicas diferentes no frontend:
--     - src/app/(dashboard)/home/page.tsx        getShiftWindow, por lista fixa de codigos
--     - .../escalas/unidade/[unidadeId]/ScaleGrid.tsx  por prefixo (code.startsWith)
--
--   A partir da Fase 4 o botao "Acionar" fica habilitado pela janela E o banco valida o
--   acionamento pela janela. Se cada lado usar uma heuristica, o portao deixa de validar o
--   que sera aplicado - o mesmo erro que fn_projecao_marcacoes_dia existe para evitar.
--
-- O QUE ESTA FUNCAO E
--   Fonte unica da janela de Sobreaviso. STABLE, sem escrita, sem efeito visivel sozinha.
--   NAO altera fn_confirmar_presenca, fn_confirmar_presenca_manual nem
--   fn_blocos_previstos_dia (armadilha 1: CREATE OR REPLACE ja apagou logica critica seis
--   vezes). Funcao nova, ao lado.
--
-- PRECEDENCIA DA HORA DE INICIO (primeiro nao-nulo vence)
--   1. escala_diaria.hora_inicio_prevista   o coordenador informou ao escalar.
--                                           Vale para Sobreaviso: chk_hora_prevista_nao_regular
--                                           so barra a categoria Regular.
--   2. dicionario_turnos.horario_inicio     NULL nos 5 codigos de sobreaviso hoje.
--                                           Fica aqui para o dia em que deixar de ser.
--   3. slots / codigo                       o que as duas heuristicas do frontend fazem hoje.
--
--   Medido em producao em 08/08/2026: dos 48 dias-servidor de Sobreaviso de 08/2026,
--   0 tem hora_inicio_prevista e 0 tem horario_inicio no dicionario. Os niveis 1 e 2 estao
--   vazios: hoje quem resolve tudo e o nivel 3. Os codigos em uso sao N12 (29), D12 (16) e
--   MTNS (3).
--
-- FIM DA JANELA
--   inicio + dicionario_turnos.horas_computadas. Reproduz exatamente os pares que o
--   dashboard usa hoje: N12 19->07 (12h), D12 07->19 (12h), MTNS 07->07+1d (24h),
--   M6 07->13 (6h), T6 13->19 (6h), T4 14->18 (4h).

-- ---------------------------------------------------------------------------
-- 1. Hora de inicio a partir de slots/codigo (nivel 3)
-- ---------------------------------------------------------------------------
-- A ORDEM DOS TESTES IMPORTA e replica a ordem de getShiftWindow:
--   noite antes de MTN, e MTN antes de MT - senao MTNS (que contem M e T) cairia no
--   ramo de 07:00-19:00 e perderia as 24h.
CREATE OR REPLACE FUNCTION public.fn_hora_inicio_sobreaviso_codigo(
    p_codigo text,
    p_slots text[]
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- noite
    WHEN upper(coalesce(p_codigo, '')) IN ('N12', 'SN')            THEN 19
    -- parenteses obrigatorios: subscrito direto sobre chamada de funcao e erro de sintaxe
    WHEN (coalesce(p_slots, '{}'::text[]))[1] = 'N'                THEN 19
    -- 24 horas (manha + tarde + noite)
    WHEN upper(coalesce(p_codigo, '')) IN ('MTNS', 'D24')          THEN 7
    WHEN 'M' = ANY(coalesce(p_slots, '{}'))
     AND 'T' = ANY(coalesce(p_slots, '{}'))
     AND 'N' = ANY(coalesce(p_slots, '{}'))                        THEN 7
    -- meio periodo
    WHEN upper(coalesce(p_codigo, '')) IN ('M6', 'M')              THEN 7
    WHEN coalesce(p_slots, '{}') = ARRAY['M']                      THEN 7
    WHEN upper(coalesce(p_codigo, '')) IN ('T6', 'T')              THEN 13
    WHEN coalesce(p_slots, '{}') = ARRAY['T']                      THEN 13
    WHEN upper(coalesce(p_codigo, '')) = 'T4'                      THEN 14
    -- diurno
    WHEN upper(coalesce(p_codigo, '')) IN ('D12', 'SD')            THEN 7
    WHEN 'M' = ANY(coalesce(p_slots, '{}'))
     AND 'T' = ANY(coalesce(p_slots, '{}'))                        THEN 7
    ELSE 7
  END;
$$;

COMMENT ON FUNCTION public.fn_hora_inicio_sobreaviso_codigo(text, text[]) IS
'Nivel 3 da precedencia da janela de Sobreaviso: hora de inicio deduzida de slots/codigo.
A ordem dos testes replica getShiftWindow do dashboard e NAO pode ser reordenada - noite antes
de MTN, MTN antes de MT.';

-- ---------------------------------------------------------------------------
-- 2. A janela completa de um dia de Sobreaviso
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_janela_sobreaviso_dia(
    p_escala_diaria_id uuid
)
RETURNS TABLE (
    inicio          timestamp with time zone,
    fim             timestamp with time zone,
    inicio_local    timestamp,
    fim_local       timestamp,
    hora_inicio     integer,
    duracao_horas   numeric,
    fonte           text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_timezone   text;
    v_dia        integer;
    v_mes        integer;
    v_ano        integer;
    v_prevista   time;
    v_dic_inicio time;
    v_codigo     text;
    v_slots      text[];
    v_horas      numeric;
    v_hora       integer;
    v_fonte      text;
    v_ini_local  timestamp;
    v_fim_local  timestamp;
BEGIN
    SELECT (valor#>>'{}')::text INTO v_timezone
    FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    SELECT ed.dia, em.mes, em.ano, ed.hora_inicio_prevista,
           dt.horario_inicio, dt.codigo, dt.slots, dt.horas_computadas
    INTO v_dia, v_mes, v_ano, v_prevista, v_dic_inicio, v_codigo, v_slots, v_horas
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
    JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
    WHERE ed.id = p_escala_diaria_id
      AND ed.categoria = 'Sobreaviso'::public.escala_categoria;

    -- Nao e Sobreaviso, ou nao existe: devolve conjunto vazio em vez de inventar janela.
    IF v_dia IS NULL THEN
        RETURN;
    END IF;

    -- Precedencia da hora de inicio
    IF v_prevista IS NOT NULL THEN
        v_hora  := extract(hour from v_prevista)::integer;
        v_fonte := 'hora_inicio_prevista';
    ELSIF v_dic_inicio IS NOT NULL THEN
        v_hora  := extract(hour from v_dic_inicio)::integer;
        v_fonte := 'dicionario_turnos';
    ELSE
        v_hora  := public.fn_hora_inicio_sobreaviso_codigo(v_codigo, v_slots);
        v_fonte := 'slots_codigo';
    END IF;

    -- Duracao: horas_computadas do turno. O fallback so existe porque horas_computadas = 0
    -- aparece em cadastros antigos; sem ele a janela teria duracao zero e o botao "Acionar"
    -- nunca habilitaria.
    IF coalesce(v_horas, 0) <= 0 THEN
        v_horas := CASE
            WHEN upper(coalesce(v_codigo, '')) IN ('MTNS', 'D24') THEN 24
            WHEN upper(coalesce(v_codigo, '')) IN ('N12', 'D12', 'SN', 'SD') THEN 12
            ELSE 12
        END;
    END IF;

    v_ini_local := make_timestamp(v_ano, v_mes, v_dia, v_hora, 0, 0);
    v_fim_local := v_ini_local + (v_horas || ' hours')::interval;

    RETURN QUERY SELECT
        (v_ini_local AT TIME ZONE v_timezone),
        (v_fim_local AT TIME ZONE v_timezone),
        v_ini_local,
        v_fim_local,
        v_hora,
        v_horas,
        v_fonte;
END;
$$;

COMMENT ON FUNCTION public.fn_janela_sobreaviso_dia(uuid) IS
'Fonte unica da janela de um plantao de Sobreaviso. Precedencia: escala_diaria.hora_inicio_prevista
-> dicionario_turnos.horario_inicio -> slots/codigo. Fim = inicio + horas_computadas.
Devolve conjunto vazio quando a escala_diaria nao existe ou nao e Sobreaviso - nunca inventa
janela. O botao Acionar do painel e a validacao do acionamento no banco leem DAQUI, para que o
que habilita o botao seja o mesmo que autoriza a gravacao.';

GRANT EXECUTE ON FUNCTION public.fn_hora_inicio_sobreaviso_codigo(text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_janela_sobreaviso_dia(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. PORTAO DE CONFERENCIA
-- ---------------------------------------------------------------------------
-- Nao ha framework de testes. Esta consulta e o portao: roda a funcao sobre todos os
-- Sobreavisos reais e devolve a janela ao lado do codigo, para comparar com o que o
-- dashboard calcula hoje. Toda divergencia precisa de explicacao ANTES da Fase 4.
--
--   SELECT dt.codigo,
--          j.hora_inicio,
--          j.duracao_horas,
--          j.fonte,
--          to_char(j.inicio_local, 'DD/MM HH24:MI') AS inicio,
--          to_char(j.fim_local,    'DD/MM HH24:MI') AS fim,
--          count(*) AS dias
--   FROM public.escala_diaria ed
--   JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--   JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
--   CROSS JOIN LATERAL public.fn_janela_sobreaviso_dia(ed.id) j
--   WHERE ed.categoria = 'Sobreaviso' AND em.ano = 2026 AND em.mes IN (7, 8)
--   GROUP BY 1,2,3,4,5,6
--   ORDER BY dias DESC;
--
-- Esperado em producao (medido em 08/08/2026, 08/2026):
--   N12  -> 19:00 .. 07:00 do dia seguinte (12h), fonte slots_codigo, 29 dias
--   D12  -> 07:00 .. 19:00                 (12h), fonte slots_codigo, 16 dias
--   MTNS -> 07:00 .. 07:00 do dia seguinte (24h), fonte slots_codigo,  3 dias
--
-- Invariante que NAO pode quebrar: nenhuma linha com fonte diferente de 'slots_codigo'
-- enquanto hora_inicio_prevista e horario_inicio estiverem vazios para Sobreaviso. Se
-- aparecer, alguem preencheu um dos dois - e a janela mudou de fonte, o que e legitimo mas
-- precisa ser notado.
