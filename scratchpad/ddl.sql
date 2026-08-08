-- ============================================================================
-- 1. dicionario_turnos.horario_inicio - a ancora
-- ============================================================================

ALTER TABLE public.dicionario_turnos
    ADD COLUMN IF NOT EXISTS horario_inicio time;

COMMENT ON COLUMN public.dicionario_turnos.horario_inicio IS
'Hora de inicio fixa do turno, quando o proprio codigo a determina (M, T, N, MT).
NULL para os codigos em que o codigo da apenas duracao e periodo (M2, T1, N4, T4...) -
para esses a hora e decidida ao escalar e vive em escala_diaria (Fase 2).
Nivel 2 da cadeia de precedencia de horario. Ver
docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md.
NAO preencher para codigos de Sobreaviso: Sobreaviso nao entra na montagem de blocos
(CLAUDE.md armadilha 6) e dar ancora a ele reabriria a fusao que 20260807000000 fechou.';

-- O motor de blocos de fn_confirmar_presenca trabalha em HORAS INTEIRAS (v_start_min =
-- start_hour * 60). Enquanto for assim, um horario com minutos seria truncado em silencio.
-- A constraint impede isso. Remover quando o motor passar a minutos (Fase 3).
ALTER TABLE public.dicionario_turnos
    DROP CONSTRAINT IF EXISTS chk_horario_inicio_hora_cheia;

ALTER TABLE public.dicionario_turnos
    ADD CONSTRAINT chk_horario_inicio_hora_cheia
    CHECK (
        horario_inicio IS NULL
        OR (extract(minute from horario_inicio) = 0 AND extract(second from horario_inicio) = 0)
    );

COMMENT ON CONSTRAINT chk_horario_inicio_hora_cheia ON public.dicionario_turnos IS
'O motor de blocos le extract(hour from horario_inicio) e descartaria os minutos sem avisar.
Enquanto ele trabalhar em horas inteiras, a ancora precisa ser hora cheia.';


-- ============================================================================
-- 2. Preenchimento - 11 codigos, todos confirmados pelo usuario em 08/08/2026
-- ============================================================================
--
-- (a) TURNOS DE PERIODO CHEIO - confirmados um a um:
--     MT = 07:00-19:00 | M = 07:00-13:00 | T = 13:00-19:00 | N = 19:00-07:00
--
-- (b) FAMILIA M?N - "a noite emenda na manha seguinte", regra confirmada pelo usuario:
--     todos comecam as 19:00 (igual ao N) e o trecho "manha" e a continuacao a partir
--     das 07:00. O fim sai sozinho de 19 + horas_computadas:
--
--       MN  18h -> 19:00-13:00   (manha 07-13, que e exatamente o M canonico)
--       M2N 14h -> 19:00-09:00   (manha 07-09)   <- 5 lancamentos em producao
--       M3N 15h -> 19:00-10:00   (manha 07-10)
--       M4N 16h -> 19:00-11:00   (manha 07-11)   <- 1 lancamento em producao
--       M5N 17h -> 19:00-12:00   (manha 07-12)
--       M7N 19h -> 19:00-14:00   (manha 07-14)
--       M8N 20h -> 19:00-15:00   (manha 07-15)
--
--     M2N e M4N tem uso real em producao (6 lancamentos, todos em 15, 22 e 29/08/2026,
--     ainda no futuro e sem nenhuma presenca gravada). Os outros cinco nunca foram usados;
--     recebem a ancora porque seguem a MESMA regra confirmada, e sem isso o primeiro
--     lancamento de um M5N cairia exatamente no bug que esta migration corrige.
--
-- NAO recebem ancora (o codigo da duracao e periodo, nao a hora - Fase 2):
--     T4 (81x), N4, N6, M7, e toda a familia T?N / MT? / I / IT4 / M4I.
--     "M2 sao 2h em qualquer ponto da manha" - essa hora e decidida ao escalar.
--
-- O FIM nunca precisa ser gravado: sai de start_hour + horas_computadas e ja bate em todos
-- os 11. Por isso esta fase NAO cria coluna horario_fim - deixar no schema uma coluna que o
-- motor ignora silenciosamente foi como justificativa_manual passou tres dias sendo escrita
-- sem existir (CLAUDE.md armadilha 1).

-- (a) periodo cheio
UPDATE public.dicionario_turnos SET horario_inicio = TIME '07:00' WHERE codigo = 'MT';
UPDATE public.dicionario_turnos SET horario_inicio = TIME '07:00' WHERE codigo = 'M';
UPDATE public.dicionario_turnos SET horario_inicio = TIME '13:00' WHERE codigo = 'T';
UPDATE public.dicionario_turnos SET horario_inicio = TIME '19:00' WHERE codigo = 'N';

-- (b) familia M?N - noite emendando na manha seguinte
UPDATE public.dicionario_turnos SET horario_inicio = TIME '19:00'
 WHERE codigo IN ('MN', 'M2N', 'M3N', 'M4N', 'M5N', 'M7N', 'M8N');

-- Trava de seguranca: aborta a migration inteira se a ancora vazar para Sobreaviso, se o
-- numero de codigos ancorados divergir, ou se algum codigo ancorado ficar com fim
-- incoerente com horas_computadas.
DO $guard$
DECLARE
    v_n integer;
    v_bad text;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.dicionario_turnos
         WHERE horario_inicio IS NOT NULL AND tipo ILIKE '%Sobreaviso%'
    ) THEN
        RAISE EXCEPTION 'Codigo de Sobreaviso com horario_inicio preenchido. Sobreaviso nao marca presenca (CLAUDE.md armadilha 6).';
    END IF;

    SELECT count(*) INTO v_n FROM public.dicionario_turnos WHERE horario_inicio IS NOT NULL;
    IF v_n <> 11 THEN
        RAISE EXCEPTION 'Esperava exatamente 11 codigos com ancora, achei %', v_n;
    END IF;

    -- nenhum turno ancorado pode passar de 24h de duracao
    SELECT string_agg(codigo, ', ') INTO v_bad
      FROM public.dicionario_turnos
     WHERE horario_inicio IS NOT NULL AND horas_computadas > 24;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Turno ancorado com horas_computadas > 24: %', v_bad;
    END IF;
END
$guard$;
