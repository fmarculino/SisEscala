-- Estatistica de escala por setor, para o Gerador Inteligente.
--
-- POR QUE ISTO VIVE NO BANCO E NAO NO NAVEGADOR
--
-- O gerador antigo baixava escala_diaria crua do mes anterior e contava no cliente. Duas
-- consequencias medidas em 25/08/2026:
--
--   1) A busca nao paginava. O maior setor tem 692 linhas em UM mes; passar a olhar 3 meses
--      da 2.076 linhas e o PostgREST corta em 1000 EM SILENCIO (armadilha 8 do CLAUDE.md).
--      A estatistica sairia errada sem erro nenhum na tela.
--   2) O custo cresce com o numero de meses olhados, e trafega turno a turno.
--
-- Aqui a agregacao acontece uma vez, no Postgres, e o que trafega e o resumo:
-- (servidor, categoria, dia da semana) -> turno vencedor + confianca. Dezenas de linhas.
-- Medido em homologacao: 94 linhas de resumo para 390 celulas cruas de um mes so.
--
-- O QUE E "CONFIANCA"
--
-- peso do turno vencedor naquele dia da semana / peso total daquele dia da semana.
-- O denominador conta TODAS as ocorrencias do dia da semana nos meses de origem, inclusive as
-- que ficaram vazias: "trabalhou 4 das 5 segundas" = 0.80. E o que permite a tela exigir
-- confianca alta onde errar custa caro (Plantao, Extra) e baixa onde errar custa pouco.
--
-- PESO POR RECENCIA -- medido, nao arbitrado
--
-- Backtest de 25/08/2026 (prever 08/2026 a partir do que os coordenadores lancaram de fato,
-- 63 servidores com 07 e 08 completos):
--
--   fonte                        Regular cobertura/precisao   Plantao cobertura/precisao
--   so o mes anterior            83.7% / 84.6%                61.6% / 58.0%
--   2 meses, peso IGUAL          74.2% / 81.4%                57.1% / 54.3%
--   2 meses, recencia 5:1        82.6% / 85.2%                59.3% / 58.7%
--
-- Somar meses com peso IGUAL PIORA: o parque muda de mes para mes (servidor troca de setor,
-- jornada muda) e o mes antigo vota contra o recente. Daqui saem os pesos 5 / 2 / 1.
--
-- ATENCAO -- p_meses DEFAULT 3, mas a TELA pede 1, e isso e deliberado. O backtest de ponta a
-- ponta do motor (que aplica limiar de confianca por categoria, coisa que a comparacao acima
-- nao fazia) mediu 1 mes MELHOR que 3 em todas as linhas:
--
--   historico    Regular            Plantao            Extra
--   1 mes        76.1% / 94.1%      50.6% / 75.8%      39.8% / 66.2%
--   3 meses      68.7% / 93.4%      45.0% / 73.6%      36.7% / 69.1%
--
-- O motivo esta no denominador: cada mes a mais aumenta o total de ocorrencias daquele dia da
-- semana, entao quem foi consistente no mes passado e diferente dois meses atras cai ABAIXO do
-- limiar e para de ser sugerido. Mais historico vira mais silencio, nao mais acerto.
-- A funcao continua aceitando 1..12 porque o limiar e decisao da tela, nao dela.
--
-- Mes em que o servidor NAO tinha escala no setor nao entra no denominador dele -- senao quem
-- chegou agora e diluido por meses em que nem existia ali (+1.5pp de cobertura, medido).
--
-- AS COLUNAS DE CICLO
--
-- O dia da semana nao descreve 12x36: um ciclo de passo 2 anda pelos dias da semana e faz toda
-- confianca cair para perto de 0.50, o que leva o motor a escalar dia sim, dia sim. Por isso
-- vao junto passo/consistencia/ultimo dia do mes MAIS RECENTE, que e o que o gerador ja usava
-- para continuar o ciclo na virada. Sao escalares por (servidor, categoria), repetidos nas
-- linhas de dia da semana -- de proposito: cabe no mesmo resultado e evita uma segunda ida ao
-- banco que voltaria a trafegar dia a dia.
--
-- Medido em 25/08/2026: so 2 dos 63 servidores tinham 12x36 detectavel, e nem ciclo nem dia da
-- semana acertam bem neles (precisao 50% e 48%). As colunas existem para NAO REGREDIR esse
-- caso, nao porque o ciclo esteja calibrado. Nao aumente a confianca nele sem medir de novo.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_estatistica_escala_setor(uuid, integer, integer, integer);

CREATE FUNCTION public.fn_estatistica_escala_setor(
  p_setor_id uuid,
  p_mes integer,
  p_ano integer,
  p_meses integer DEFAULT 3
)
RETURNS TABLE (
  servidor_id uuid,
  categoria text,
  dia_semana integer,
  dicionario_turnos_id uuid,
  peso numeric,
  peso_total numeric,
  confianca numeric,
  meses_com_escala integer,
  ciclo_passo integer,
  ciclo_consistencia numeric,
  ciclo_ultimo_dia integer,
  ciclo_dias_no_mes integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unidade_id uuid;
  v_meses integer := LEAST(GREATEST(COALESCE(p_meses, 3), 1), 12);
BEGIN
  SELECT s.unidade_id INTO v_unidade_id FROM public.setores s WHERE s.id = p_setor_id;

  IF v_unidade_id IS NULL THEN
    RAISE EXCEPTION 'Setor % nao encontrado', p_setor_id;
  END IF;

  -- Mesmo guard de fn_blocos_previstos_dia: auth.uid() nulo e service_role, e
  -- fn_unidade_no_escopo sozinha nao enxerga quem tem acesso apenas por setor vinculado --
  -- por isso o OR com fn_unidade_alcancavel_por_setor. Ver CLAUDE.md, pendencia 3 da Fase 5.
  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.fn_unidade_no_escopo(v_unidade_id)
            OR public.fn_unidade_alcancavel_por_setor(v_unidade_id)) THEN
      RAISE EXCEPTION 'Sem permissao para ler a escala deste setor';
    END IF;
  END IF;

  RETURN QUERY
  WITH origens AS (
    -- Os v_meses meses imediatamente anteriores a competencia alvo, com peso por recencia.
    SELECT
      g.ordinal,
      EXTRACT(MONTH FROM ref.d)::integer AS mes,
      EXTRACT(YEAR  FROM ref.d)::integer AS ano,
      (CASE g.ordinal WHEN 1 THEN 5.0 WHEN 2 THEN 2.0 ELSE 1.0 END)::numeric AS peso
    FROM generate_series(1, v_meses) AS g(ordinal)
    CROSS JOIN LATERAL (
      SELECT (make_date(p_ano, p_mes, 1) - (g.ordinal || ' month')::interval)::date AS d
    ) AS ref
  ),
  escalas AS (
    -- Escalas mensais daquele setor nos meses de origem. E a lista de quem estava la.
    SELECT em.id AS escala_mensal_id, em.servidor_id AS sid, o.ordinal, o.mes, o.ano, o.peso
    FROM public.escala_mensal em
    JOIN origens o ON o.mes = em.mes AND o.ano = em.ano
    WHERE em.setor_id = p_setor_id
      AND em.servidor_id IS NOT NULL
  ),
  dias AS (
    -- Todo dia civil de cada mes de origem em que o servidor TINHA escala no setor.
    -- Dia vazio conta no denominador -- e o que distingue "toda segunda" de "uma segunda".
    SELECT
      e.sid,
      e.escala_mensal_id,
      e.ordinal,
      e.peso,
      EXTRACT(DAY FROM ser.d)::integer AS dia_do_mes,
      EXTRACT(DOW FROM ser.d)::integer AS dow
    FROM escalas e
    CROSS JOIN LATERAL generate_series(
      make_date(e.ano, e.mes, 1),
      (make_date(e.ano, e.mes, 1) + interval '1 month' - interval '1 day')::date,
      interval '1 day'
    ) AS ser(d)
  ),
  denominador AS (
    SELECT
      d.sid,
      d.dow,
      SUM(d.peso) AS peso_total,
      COUNT(DISTINCT d.escala_mensal_id)::integer AS meses_com_escala
    FROM dias d
    GROUP BY d.sid, d.dow
  ),
  numerador AS (
    SELECT
      d.sid,
      ed.categoria::text AS cat,
      d.dow,
      ed.dicionario_turnos_id AS turno_id,
      SUM(d.peso) AS peso
    FROM dias d
    JOIN public.escala_diaria ed
      ON ed.escala_mensal_id = d.escala_mensal_id
     AND ed.dia = d.dia_do_mes
    WHERE ed.dicionario_turnos_id IS NOT NULL
    GROUP BY d.sid, ed.categoria, d.dow, ed.dicionario_turnos_id
  ),
  ranqueado AS (
    -- Um vencedor por (servidor, categoria, dia da semana). O desempate por id do turno existe
    -- para o resultado nao depender da ordem de leitura: regerar duas vezes tem que dar igual.
    SELECT
      n.sid, n.cat, n.dow, n.turno_id, n.peso,
      ROW_NUMBER() OVER (
        PARTITION BY n.sid, n.cat, n.dow
        ORDER BY n.peso DESC, n.turno_id
      ) AS pos
    FROM numerador n
  ),
  -- ---- ciclo, so do mes de origem MAIS RECENTE (ordinal 1) ----
  trabalhados AS (
    SELECT DISTINCT d.sid, ed.categoria::text AS cat, d.dia_do_mes
    FROM dias d
    JOIN public.escala_diaria ed
      ON ed.escala_mensal_id = d.escala_mensal_id
     AND ed.dia = d.dia_do_mes
    WHERE d.ordinal = 1
      AND ed.dicionario_turnos_id IS NOT NULL
  ),
  intervalos AS (
    SELECT
      t.sid, t.cat, t.dia_do_mes,
      t.dia_do_mes - LAG(t.dia_do_mes) OVER (
        PARTITION BY t.sid, t.cat ORDER BY t.dia_do_mes
      ) AS gap
    FROM trabalhados t
  ),
  passos AS (
    SELECT
      i.sid, i.cat, i.gap, COUNT(*) AS n,
      ROW_NUMBER() OVER (PARTITION BY i.sid, i.cat ORDER BY COUNT(*) DESC, i.gap) AS pos
    FROM intervalos i
    WHERE i.gap IS NOT NULL
    GROUP BY i.sid, i.cat, i.gap
  ),
  ciclo AS (
    SELECT
      tot.sid,
      tot.cat,
      p.gap                                                   AS ciclo_passo,
      ROUND(p.n::numeric / NULLIF(tot.dias - 1, 0), 4)        AS ciclo_consistencia,
      tot.ultimo_dia                                          AS ciclo_ultimo_dia,
      tot.dias                                                AS ciclo_dias_no_mes
    FROM (
      SELECT t.sid, t.cat, COUNT(*)::integer AS dias, MAX(t.dia_do_mes)::integer AS ultimo_dia
      FROM trabalhados t GROUP BY t.sid, t.cat
    ) tot
    LEFT JOIN passos p ON p.sid = tot.sid AND p.cat = tot.cat AND p.pos = 1
  )
  SELECT
    r.sid,
    r.cat,
    r.dow,
    r.turno_id,
    ROUND(r.peso, 3),
    ROUND(den.peso_total, 3),
    ROUND(r.peso / NULLIF(den.peso_total, 0), 4),
    den.meses_com_escala,
    c.ciclo_passo,
    c.ciclo_consistencia,
    c.ciclo_ultimo_dia,
    c.ciclo_dias_no_mes
  FROM ranqueado r
  JOIN denominador den
    ON den.sid = r.sid
   AND den.dow = r.dow
  LEFT JOIN ciclo c
    ON c.sid = r.sid
   AND c.cat = r.cat
  WHERE r.pos = 1
  ORDER BY r.sid, r.cat, r.dow;
END;
$$;

COMMENT ON FUNCTION public.fn_estatistica_escala_setor(uuid, integer, integer, integer) IS
'Resumo estatistico das ultimas competencias de um setor, para o Gerador Inteligente. Devolve, '
'por (servidor, categoria, dia da semana), o turno mais frequente e a confianca (peso do '
'vencedor / peso total daquele dia da semana), com peso por recencia 5/2/1, mais os escalares '
'de ciclo do mes mais recente (passo/consistencia/ultimo dia) para continuar 12x36 na virada. '
'A agregacao roda no banco de proposito: no cliente ela dependia de baixar escala_diaria crua '
'e estourava o corte de 1000 linhas do PostgREST em silencio.';

GRANT EXECUTE ON FUNCTION public.fn_estatistica_escala_setor(uuid, integer, integer, integer)
  TO authenticated, service_role;

COMMIT;

-- CONFERENCIA (rodar depois de aplicar)
--
-- 1) A estatistica reproduz a escala que ja existe? Para o setor da TI da SMS, prevendo
--    08/2026 a partir de 07/2026, o esperado e MT de segunda a sexta com confianca 1.0000
--    para DAIANE, FERNANDO, HUGO e LUCIA -- que e exatamente o que esta lancado em 08/2026.
--
-- SELECT s.nome, e.categoria, e.dia_semana, t.codigo, e.confianca, e.meses_com_escala
--   FROM public.fn_estatistica_escala_setor(
--          '649f513a-94f1-4db9-aca2-69b67bbdce9e'::uuid, 8, 2026, 1) e
--   JOIN public.servidores s ON s.id = e.servidor_id
--   JOIN public.dicionario_turnos t ON t.id = e.dicionario_turnos_id
--  ORDER BY s.nome, e.categoria, e.dia_semana;
--
-- 2) Confianca tem que ficar sempre em (0, 1]. Qualquer linha aqui e bug de denominador.
--
-- SELECT count(*) AS fora_da_faixa
--   FROM public.fn_estatistica_escala_setor(
--          '649f513a-94f1-4db9-aca2-69b67bbdce9e'::uuid, 8, 2026, 3)
--  WHERE confianca IS NULL OR confianca <= 0 OR confianca > 1;
--
-- 3) Determinismo: duas execucoes tem que dar exatamente o mesmo conjunto.
--
-- WITH a AS (SELECT * FROM public.fn_estatistica_escala_setor(
--              '649f513a-94f1-4db9-aca2-69b67bbdce9e'::uuid, 9, 2026, 3)),
--      b AS (SELECT * FROM public.fn_estatistica_escala_setor(
--              '649f513a-94f1-4db9-aca2-69b67bbdce9e'::uuid, 9, 2026, 3))
-- SELECT (SELECT count(*) FROM (SELECT * FROM a EXCEPT SELECT * FROM b) x)
--      + (SELECT count(*) FROM (SELECT * FROM b EXCEPT SELECT * FROM a) y) AS diferencas;
--
-- 4) Custo: o resumo tem que ser muito menor que o volume cru que o cliente baixava antes.
--
-- SELECT (SELECT count(*) FROM public.fn_estatistica_escala_setor(
--           '649f513a-94f1-4db9-aca2-69b67bbdce9e'::uuid, 8, 2026, 3)) AS linhas_do_resumo,
--        (SELECT count(*) FROM public.escala_diaria ed
--           JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--          WHERE em.setor_id = '649f513a-94f1-4db9-aca2-69b67bbdce9e'
--            AND (em.ano, em.mes) IN ((2026,5),(2026,6),(2026,7))
--            AND ed.dicionario_turnos_id IS NOT NULL) AS linhas_cruas_antes;
