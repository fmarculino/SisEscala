-- ============================================================================
-- 1. escala_diaria.hora_inicio_prevista - a hora que o coordenador informou
-- ============================================================================

ALTER TABLE public.escala_diaria
    ADD COLUMN IF NOT EXISTS hora_inicio_prevista time;

COMMENT ON COLUMN public.escala_diaria.hora_inicio_prevista IS
'Hora de inicio que o coordenador informou ao escalar este turno neste dia.
NIVEL 1 (o mais alto) da cadeia de precedencia de horario - vence a ancora do codigo em
dicionario_turnos.horario_inicio e toda a cascata de inferencia.

Existe para os codigos em que o codigo do turno da a DURACAO e o PERIODO, mas nao a HORA:
T4, N4, N6, M7 e afins. "M2 sao 2h em qualquer ponto da manha" - so quem escala sabe onde.

NULL em toda linha existente e o padrao para linhas novas: enquanto ninguem preencher, o
comportamento e exatamente o de antes. Ver
docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md.

NAO tem efeito em categoria Regular: la o nome da jornada continua sendo a fonte, porque
folha de ponto e motor de compliance dependem dela.';

-- O motor de blocos trabalha em HORAS INTEIRAS (v_start_min := r.start_hour * 60), entao um
-- horario com minutos seria truncado sem aviso. A constraint faz a gravacao FALHAR em vez de
-- truncar em silencio. Remover na Fase 3, quando o motor passar a minutos - e uma constraint,
-- nao exige reescrever funcao de presenca.
--
-- Conferido em 08/08/2026: as 17 jornadas de producao sao todas de hora cheia, e todo turno
-- do dicionario comeca em hora cheia. Nao ha caso real perdido por esta restricao.
ALTER TABLE public.escala_diaria
    DROP CONSTRAINT IF EXISTS chk_hora_inicio_prevista_hora_cheia;

ALTER TABLE public.escala_diaria
    ADD CONSTRAINT chk_hora_inicio_prevista_hora_cheia
    CHECK (
        hora_inicio_prevista IS NULL
        OR (extract(minute from hora_inicio_prevista) = 0 AND extract(second from hora_inicio_prevista) = 0)
    );

COMMENT ON CONSTRAINT chk_hora_inicio_prevista_hora_cheia ON public.escala_diaria IS
'O motor de blocos le extract(hour from hora_inicio_prevista) e descartaria os minutos sem
avisar. Enquanto ele trabalhar em horas inteiras, a hora precisa ser cheia.';

-- Regular nao deve receber hora_inicio_prevista: a funcao ignora o campo para essa categoria
-- (o nome da jornada manda), entao um valor gravado ali seria dado morto que aparenta valer.
-- Falhar na gravacao e melhor que silenciosamente nao ter efeito.
ALTER TABLE public.escala_diaria
    DROP CONSTRAINT IF EXISTS chk_hora_prevista_nao_regular;

ALTER TABLE public.escala_diaria
    ADD CONSTRAINT chk_hora_prevista_nao_regular
    CHECK (hora_inicio_prevista IS NULL OR categoria <> 'Regular');

COMMENT ON CONSTRAINT chk_hora_prevista_nao_regular ON public.escala_diaria IS
'A funcao de presenca ignora hora_inicio_prevista quando a categoria e Regular. Sem esta
constraint, um valor gravado ali seria dado morto que aparenta estar valendo.';


-- ============================================================================
-- 2. Nenhum backfill
-- ============================================================================
-- A coluna nasce NULL em todas as 6.514 linhas de escala_diaria, de proposito.
--
-- Preencher automaticamente seria reintroduzir a adivinhacao que esta migration existe para
-- eliminar - e o valor inferido ficaria gravado como se fosse decisao do coordenador,
-- exatamente o tipo de dado que ninguem consegue mais auditar depois.
--
-- Os 84 lancamentos de Classe B em producao (81 T4, 1 N4, 1 N6, 1 M7) continuam na cascata
-- ate que alguem informe a hora pela grade.
