-- Migration: Ancora as familias T?N, MT?, MTN e INTERMEDIARIO
--            (fecha a armadilha dos codigos nunca usados)
-- Data: 2026-08-08
--
-- POR QUE ISTO EXISTE
--   Levantamento de 08/08/2026: dos 53 codigos de Plantao selecionaveis na grade,
--     11 tinham ancora (20260808100000)
--      5 sem ancora mas JA usados em producao (M4, M7, N4, N6, T4) - tem a valvula da
--        Fase 2, o coordenador informa a hora ao escalar
--     37 sem ancora e NUNCA usados em 3 meses de producao
--
--   Esses 37 continuavam no dropdown da grade. Lancar qualquer um deles num dia SEM turno
--   Regular cai no mesmo fallback que quebrou a LUCILIA em 08/08/2026: a cascata nao acha
--   referencia, chega no ultimo recurso e ancora o plantao na JORNADA PESSOAL do servidor.
--
--   Nao era um bug existente - era um bug esperando alguem escalar um MTN.
--
-- O QUE ESTA MIGRATION FAZ
--   Grava a ancora de 16 desses 37, nas familias em que o codigo determina a hora:
--   T?N (7), MT? + MTN (6) e INTERMEDIARIO (3). Sobem de 11 para 27 os codigos ancorados.
--   Regras confirmadas pelo usuario em 08/08/2026, conferidas contra a planilha original
--   que serviu de base para o sistema.
--
--   NENHUMA FUNCAO E ALTERADA. O mecanismo de ancora (NIVEL 2 da cadeia) ja existe desde
--   20260808100000; esta migration so preenche dados. Por isso nao ha copia mecanica aqui.
--
-- FAMILIA T?N - a tarde vem ANTES da noite
--   Simetrica a familia M?N (onde a noite emenda na manha seguinte). Aqui a noite termina
--   sempre as 07:00 e o trecho "tarde" e o que vem antes:  inicio = 19h - (duracao - 12)
--
--     TN  18h -> 13:00-07:00(+1)     T5N 17h -> 14:00-07:00(+1)
--     T2N 14h -> 17:00-07:00(+1)     T7N 19h -> 12:00-07:00(+1)
--     T3N 15h -> 16:00-07:00(+1)     T8N 20h -> 11:00-07:00(+1)
--     T4N 16h -> 15:00-07:00(+1)
--
--   T7N e T8N comecam ao meio-dia e as 11h, que nao sao "tarde". Foi levantado explicitamente
--   com o usuario, que confirmou: o nome e convencao, o que vale e emendar na noite que
--   termina as 07:00. Fica registrado aqui porque e o tipo de coisa que parece erro depois.
--
-- FAMILIA MT? - manha cheia + tarde truncada ou estendida, sempre comecando as 07:00
--     MT3  9h -> 07:00-16:00     MT7 13h -> 07:00-20:00
--     MT4 10h -> 07:00-17:00     MT8 14h -> 07:00-21:00
--     MT5 11h -> 07:00-18:00
--
-- MTN - 24h corridas, 07:00 as 07:00 do dia seguinte.
--
-- O QUE CONTINUA NULL DE PROPOSITO (21 codigos)
--   M1 M2 M3 M5 M8 | T1 T2 T3 T5 T7 T8 | N1 N2 N3 N5 N7 N8 N9 N10 N11
--     Sao a Classe B: o codigo da a duracao e o periodo, nao a hora. Nas palavras do usuario,
--     "M2 sao 2h de plantao mas ele pode se encaixar em qualquer periodo da manha". Ancorar
--     seria voltar a adivinhar exatamente o que este trabalho todo veio eliminar. Eles usam
--     escala_diaria.hora_inicio_prevista (Fase 2).
--
--   MT4N (22h) - manha 6 + tarde 4 + noite 12. Terminando as 07:00 comecaria as 09:00;
--     comecando as 07:00 terminaria as 05:00, e a "noite" cairia em 17:00-05:00, fora do
--     padrao 19-07. Nenhuma leitura fecha limpo. Nao se deduz, e nunca foi usado.
--
--   (I, M4I e IT4 estavam nesta lista ate a planilha original chegar - ver secao 3, que os
--    resolve. Se voce esta lendo uma copia antiga deste arquivo, e por isso.)
--
-- EFEITO: ZERO, E ISSO E DEMONSTRAVEL
--   Nenhum dos 16 codigos aparece em uma unica linha de escala_diaria em producao
--   (6.514 linhas, 06/07/08 de 2026). A migration aborta se isso deixar de ser verdade -
--   ver a trava abaixo. Nao ha escala existente para mudar de comportamento.
--
--   Isto e prevencao, nao correcao.
--
-- CONFERENCIA APOS APLICAR
--   -- 1. passaram a ser 27 codigos ancorados, e todo fim bate com horas_computadas:
--   SELECT codigo, horario_inicio,
--          ((extract(hour from horario_inicio)::int + horas_computadas::int) % 24) AS fim,
--          (extract(hour from horario_inicio)::int + horas_computadas::int) >= 24 AS vira_o_dia
--     FROM public.dicionario_turnos
--    WHERE horario_inicio IS NOT NULL
--    ORDER BY horario_inicio, codigo;
--   -- esperado: 27 linhas. Toda a familia T?N e a N terminam em fim=7, vira_o_dia=true.
--
--   -- 2. nada mudou de comportamento (tem que continuar identico ao pos-Fase-3):
--   SELECT count(*) FROM public.escala_diaria ed
--     JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
--    WHERE dt.codigo IN ('TN','T2N','T3N','T4N','T5N','T7N','T8N',
--                        'MT3','MT4','MT5','MT7','MT8','MTN',
--                        'I','M4I','IT4');
--   -- esperado: 0
--
--   RESULTADO EM 08/08/2026: 27 ancorados em homologacao e producao, nenhum de Sobreaviso,
--   e as travas da secao 4 passaram - inclusive a que exige efeito zero.


-- ============================================================================
-- 1. Familia T?N - tarde antes da noite, noite terminando as 07:00
-- ============================================================================

UPDATE public.dicionario_turnos SET horario_inicio = TIME '13:00' WHERE codigo = 'TN';
UPDATE public.dicionario_turnos SET horario_inicio = TIME '17:00' WHERE codigo = 'T2N';
UPDATE public.dicionario_turnos SET horario_inicio = TIME '16:00' WHERE codigo = 'T3N';
UPDATE public.dicionario_turnos SET horario_inicio = TIME '15:00' WHERE codigo = 'T4N';
UPDATE public.dicionario_turnos SET horario_inicio = TIME '14:00' WHERE codigo = 'T5N';
UPDATE public.dicionario_turnos SET horario_inicio = TIME '12:00' WHERE codigo = 'T7N';
UPDATE public.dicionario_turnos SET horario_inicio = TIME '11:00' WHERE codigo = 'T8N';


-- ============================================================================
-- 2. Familia MT? e MTN - manha cheia, comecando as 07:00
-- ============================================================================

UPDATE public.dicionario_turnos SET horario_inicio = TIME '07:00'
 WHERE codigo IN ('MT3', 'MT4', 'MT5', 'MT7', 'MT8', 'MTN');


-- ============================================================================
-- 3. Familia INTERMEDIARIO - resolvida pela planilha original
-- ============================================================================
-- A planilha (passada pelo usuario em 08/08/2026) define:
--     I   = 4HRS - INTERMEDIARIO: 4HRS
--     M4I = 8HRS - MANHA: 4HRS, INTERMEDIARIO: 4HRS
--     IT4 = 8HRS - INTERMEDIARIO: 4HRS, TARDE: 4HRS
--
-- Os tres so fecham contiguos com INTERMEDIARIO = 11:00-15:00, que e a unica leitura possivel:
--     M4I : manha 4h (07:00-11:00) + intermediario (11:00-15:00) = 07:00-15:00, 8h  ok
--     IT4 : intermediario (11:00-15:00) + tarde 4h (15:00-19:00) = 11:00-19:00, 8h  ok
--     I   : intermediario sozinho                                 = 11:00-15:00, 4h  ok
--
-- Faz sentido operacional: e o turno que cobre o vale entre a saida da manha e a entrada da
-- tarde, justamente o horario de almoco em que a equipe fica reduzida.
--
-- Nenhum dos tres foi usado em producao. Isto e prevencao, nao correcao.

UPDATE public.dicionario_turnos SET horario_inicio = TIME '11:00' WHERE codigo IN ('I', 'IT4');
UPDATE public.dicionario_turnos SET horario_inicio = TIME '07:00' WHERE codigo = 'M4I';


-- ============================================================================
-- 4. Travas
-- ============================================================================

DO $guard$
DECLARE
    v_n     integer;
    v_bad   text;
    v_usos  integer;
BEGIN
    -- Sobreaviso nunca pode receber ancora: nao entra na montagem de blocos, e dar hora a ele
    -- reabriria a fusao que 20260807000000 fechou (CLAUDE.md armadilha 6).
    IF EXISTS (
        SELECT 1 FROM public.dicionario_turnos
         WHERE horario_inicio IS NOT NULL AND tipo ILIKE '%Sobreaviso%'
    ) THEN
        RAISE EXCEPTION 'Codigo de Sobreaviso com horario_inicio preenchido.';
    END IF;

    SELECT count(*) INTO v_n FROM public.dicionario_turnos WHERE horario_inicio IS NOT NULL;
    IF v_n <> 27 THEN
        RAISE EXCEPTION 'Esperava 27 codigos ancorados apos esta migration (11 da Fase 1 + 13 das familias T?N/MT?/MTN + 3 do intermediario), achei %', v_n;
    END IF;

    -- Familia intermediario: I e IT4 comecam as 11:00, M4I as 07:00, e os tres terminam
    -- coerentes (I 15:00, M4I 15:00, IT4 19:00).
    SELECT string_agg(codigo || ' -> ' || horario_inicio, ', ') INTO v_bad
      FROM public.dicionario_turnos
     WHERE (codigo IN ('I','IT4') AND horario_inicio <> TIME '11:00')
        OR (codigo = 'M4I'        AND horario_inicio <> TIME '07:00');
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Familia intermediario com ancora errada: %', v_bad;
    END IF;

    -- T?N e N terminam as 07:00 do dia seguinte -> inicio + duracao = 31.
    -- Pega erro de digitacao nas 7 linhas acima melhor que revisao a olho.
    -- A familia M?N NAO entra aqui: la a noite vem primeiro e a manha emenda depois, entao
    -- ela COMECA as 19:00 e termina mais tarde (MN 19+18=37, M2N 19+14=33).
    SELECT string_agg(codigo || ' (' || horario_inicio || ' + ' || horas_computadas || 'h)', ', ')
      INTO v_bad
      FROM public.dicionario_turnos
     WHERE codigo IN ('TN','T2N','T3N','T4N','T5N','T7N','T8N','N')
       AND (extract(hour from horario_inicio)::int + horas_computadas::int) <> 31;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Familia T?N/N nao termina as 07:00 do dia seguinte: %', v_bad;
    END IF;

    -- A familia M?N comeca as 19:00 (noite primeiro, manha emendando no dia seguinte).
    SELECT string_agg(codigo || ' -> ' || horario_inicio, ', ') INTO v_bad
      FROM public.dicionario_turnos
     WHERE codigo IN ('MN','M2N','M3N','M4N','M5N','M7N','M8N')
       AND horario_inicio <> TIME '19:00';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Familia M?N deveria comecar as 19:00: %', v_bad;
    END IF;

    -- A familia MT? e MTN comeca as 07:00.
    SELECT string_agg(codigo || ' -> ' || horario_inicio, ', ') INTO v_bad
      FROM public.dicionario_turnos
     WHERE codigo IN ('MT','MT3','MT4','MT5','MT7','MT8','MTN')
       AND horario_inicio <> TIME '07:00';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Familia MT? deveria comecar as 07:00: %', v_bad;
    END IF;

    -- Nenhum turno ancorado pode passar de 24h.
    SELECT string_agg(codigo, ', ') INTO v_bad
      FROM public.dicionario_turnos
     WHERE horario_inicio IS NOT NULL AND horas_computadas > 24;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Turno ancorado com horas_computadas > 24: %', v_bad;
    END IF;

    -- O efeito tem que ser zero: se algum dos 16 tiver passado a ser usado entre o
    -- levantamento e a aplicacao, a migration deixa de ser inocua e precisa de conferencia.
    SELECT count(*) INTO v_usos
      FROM public.escala_diaria ed
      JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
     WHERE dt.codigo IN ('TN','T2N','T3N','T4N','T5N','T7N','T8N',
                         'MT3','MT4','MT5','MT7','MT8','MTN',
                         'I','M4I','IT4');
    IF v_usos > 0 THEN
        RAISE EXCEPTION 'Esperava efeito ZERO, mas % linha(s) de escala_diaria ja usam um dos 16 codigos. Conferir o impacto antes de aplicar.', v_usos;
    END IF;
END
$guard$;
