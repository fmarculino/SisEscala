-- ============================================================================
-- Migration: em unidade REP, escrita direta de presenca e neutralizada
-- Data: 2026-08-20
--
-- Motivo (medido em producao em 19/08/2026, competencia 08/2026): dos 580 pares
-- (servidor, dia) com batida de relogio, 41 ficaram gravados com entrada de
-- origem 'terminal' e 8 com 'ajuste_coordenador'. fn_precedencia_origem diz
-- rep(1) > terminal(2) > ajuste_coordenador(3), entao em 49 dias o REP perdeu
-- para quem esta ABAIXO dele. A causa e estrutural: fn_confirmar_presenca
-- escreve escala_diaria direto, sem passar pela precedencia. Quem bate no
-- relogio e depois no terminal tem a batida do relogio sobrescrita.
--
-- 105 dias de 08/2026 ja tem batida das duas fontes (99 rep+terminal, 13
-- ajuste+rep, 6 as tres), entao isso deixou de ser hipotetico.
--
-- Desenho escolhido: NAO tocar em fn_confirmar_presenca (1.030 linhas, seis
-- regressoes historicas - armadilha 1). Em vez disso:
--   1. o guard da 20260820000000 passa a NEUTRALIZAR a escrita direta em vez de
--      abortar: os campos de presenca voltam ao valor anterior e a transacao
--      segue. O terminal roda inteiro e nunca mostra erro ao servidor.
--   2. a marcacao continua sendo registrada (Fase 3 ja fez isso: sao 1.175 dias
--      com origem 'terminal' em marcacoes_ponto), e um trigger dispara a
--      reconciliacao, que grava aplicando a precedencia.
--
-- Continua inerte enquanto nenhuma unidade estiver em fonte_ponto_oficial='rep'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Guard: neutralizar, nao abortar
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_guard_escrita_presenca_rep()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_fonte  text;
    v_mudou  boolean;
BEGIN
    -- 1.1 Curto-circuito barato. A grade faz upsert de TODAS as linhas do mes a cada
    --     Salvar Previsao, entao o caminho comum nao pode pagar um SELECT.
    IF TG_OP = 'UPDATE' THEN
        v_mudou :=
               NEW.presenca_entrada_em           IS DISTINCT FROM OLD.presenca_entrada_em
            OR NEW.presenca_intervalo_saida_em   IS DISTINCT FROM OLD.presenca_intervalo_saida_em
            OR NEW.presenca_intervalo_retorno_em IS DISTINCT FROM OLD.presenca_intervalo_retorno_em
            OR NEW.presenca_saida_em             IS DISTINCT FROM OLD.presenca_saida_em;
    ELSE
        v_mudou :=
               NEW.presenca_entrada_em           IS NOT NULL
            OR NEW.presenca_intervalo_saida_em   IS NOT NULL
            OR NEW.presenca_intervalo_retorno_em IS NOT NULL
            OR NEW.presenca_saida_em             IS NOT NULL;
    END IF;

    IF NOT v_mudou THEN
        RETURN NEW;
    END IF;

    -- 1.2 A reconciliacao se declara e e sempre o caminho autorizado.
    IF COALESCE(current_setting('sisescala.reconciliacao', true), '') = 'on' THEN
        RETURN NEW;
    END IF;

    SELECT u.fonte_ponto_oficial
      INTO v_fonte
      FROM public.escala_mensal em
      JOIN public.unidades u ON u.id = em.unidade_id
     WHERE em.id = NEW.escala_mensal_id;

    IF v_fonte IS DISTINCT FROM 'rep' THEN
        RETURN NEW;
    END IF;

    -- 1.3 Neutraliza. A batida NAO se perde: ela ja virou linha em marcacoes_ponto
    --     (INSERT-only) pelo PERFORM aditivo da Fase 3, e a reconciliacao disparada
    --     pelo trigger da secao 2 grava aqui o vencedor por precedencia.
    --
    --     Reverter os 4 timestamps sem reverter origem/marcacao_id/manual deixaria a
    --     linha incoerente (horario antigo com procedencia nova), entao os 16 campos
    --     voltam juntos.
    IF TG_OP = 'UPDATE' THEN
        NEW.presenca_entrada_em                := OLD.presenca_entrada_em;
        NEW.presenca_entrada_origem            := OLD.presenca_entrada_origem;
        NEW.presenca_entrada_marcacao_id       := OLD.presenca_entrada_marcacao_id;
        NEW.presenca_entrada_manual            := OLD.presenca_entrada_manual;

        NEW.presenca_intervalo_saida_em          := OLD.presenca_intervalo_saida_em;
        NEW.presenca_intervalo_saida_origem      := OLD.presenca_intervalo_saida_origem;
        NEW.presenca_intervalo_saida_marcacao_id := OLD.presenca_intervalo_saida_marcacao_id;
        NEW.presenca_intervalo_saida_manual      := OLD.presenca_intervalo_saida_manual;

        NEW.presenca_intervalo_retorno_em          := OLD.presenca_intervalo_retorno_em;
        NEW.presenca_intervalo_retorno_origem      := OLD.presenca_intervalo_retorno_origem;
        NEW.presenca_intervalo_retorno_marcacao_id := OLD.presenca_intervalo_retorno_marcacao_id;
        NEW.presenca_intervalo_retorno_manual      := OLD.presenca_intervalo_retorno_manual;

        NEW.presenca_saida_em                  := OLD.presenca_saida_em;
        NEW.presenca_saida_origem              := OLD.presenca_saida_origem;
        NEW.presenca_saida_marcacao_id         := OLD.presenca_saida_marcacao_id;
        NEW.presenca_saida_manual              := OLD.presenca_saida_manual;

        NEW.presenca_confirmada                := OLD.presenca_confirmada;
        NEW.presenca_confirmada_em             := OLD.presenca_confirmada_em;
    ELSE
        NEW.presenca_entrada_em                := NULL;
        NEW.presenca_entrada_origem            := NULL;
        NEW.presenca_entrada_marcacao_id       := NULL;
        NEW.presenca_entrada_manual            := false;

        NEW.presenca_intervalo_saida_em          := NULL;
        NEW.presenca_intervalo_saida_origem      := NULL;
        NEW.presenca_intervalo_saida_marcacao_id := NULL;
        NEW.presenca_intervalo_saida_manual      := false;

        NEW.presenca_intervalo_retorno_em          := NULL;
        NEW.presenca_intervalo_retorno_origem      := NULL;
        NEW.presenca_intervalo_retorno_marcacao_id := NULL;
        NEW.presenca_intervalo_retorno_manual      := false;

        NEW.presenca_saida_em                  := NULL;
        NEW.presenca_saida_origem              := NULL;
        NEW.presenca_saida_marcacao_id         := NULL;
        NEW.presenca_saida_manual              := false;

        NEW.presenca_confirmada                := false;
        NEW.presenca_confirmada_em             := NULL;
    END IF;

    RAISE WARNING 'Unidade em fonte_ponto_oficial=rep: escrita direta de presenca neutralizada em escala_diaria % (a marcacao foi registrada; a reconciliacao decide).', NEW.id;

    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_guard_escrita_presenca_rep() IS
    'Fase 5/8: em unidade com fonte_ponto_oficial = rep, neutraliza (nao aborta) a escrita '
    'direta de presenca. A marcacao ja foi registrada e a reconciliacao grava o vencedor por '
    'precedencia. Inerte enquanto a unidade estiver em terminal.';

-- ----------------------------------------------------------------------------
-- 2. Marcacao registrada dispara a reconciliacao
--
--    Escopo deliberado: origem <> 'rep'. Batida de relogio JA e reconciliada por
--    fn_ingerir_afd (20260818080000) e por fn_reparse_afd_dispositivo; incluir 'rep'
--    aqui so duplicaria o trabalho de uma operacao que ja e pesada. Este trigger
--    cobre o que nao tinha ninguem: terminal, ajuste_coordenador, ajuste_servidor.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reconciliar_apos_marcacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fnm$
DECLARE
    r record;
BEGIN
    -- Nao reentrar durante a propria reconciliacao nem durante o reparse.
    IF COALESCE(current_setting('sisescala.reconciliacao', true), '') = 'on'
       OR COALESCE(current_setting('sisescala.reparse_afd', true), '') = 'on' THEN
        RETURN NULL;
    END IF;

    FOR r IN
        SELECT DISTINCT
               n.servidor_id,
               (n.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data_batida
          FROM novas n
          JOIN public.escala_mensal em
            ON em.servidor_id = n.servidor_id
           AND em.mes = extract(month from n.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::integer
           AND em.ano = extract(year  from n.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::integer
          JOIN public.unidades u ON u.id = em.unidade_id
         WHERE n.servidor_id IS NOT NULL
           AND n.origem <> 'rep'
           AND u.fonte_ponto_oficial = 'rep'
    LOOP
        BEGIN
            PERFORM public.fn_reconciliar_marcacoes_dia(r.servidor_id, r.data_batida);
        EXCEPTION WHEN OTHERS THEN
            -- Nunca derrubar a marcacao por falha na projecao: a marcacao e o fato.
            RAISE WARNING 'Falha ao reconciliar servidor % em % apos marcacao: %',
                          r.servidor_id, r.data_batida, SQLERRM;
        END;
    END LOOP;

    RETURN NULL;
END;
$fnm$;

COMMENT ON FUNCTION public.fn_reconciliar_apos_marcacao() IS
    'Fase 5/8: em unidade com fonte_ponto_oficial = rep, reconcilia o dia apos marcacao de '
    'origem nao-rep (terminal/ajustes). Batida de relogio ja e coberta por fn_ingerir_afd.';

REVOKE ALL ON FUNCTION public.fn_reconciliar_apos_marcacao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reconciliar_apos_marcacao ON public.marcacoes_ponto;
CREATE TRIGGER trg_reconciliar_apos_marcacao
    AFTER INSERT ON public.marcacoes_ponto
    REFERENCING NEW TABLE AS novas
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.fn_reconciliar_apos_marcacao();

-- ----------------------------------------------------------------------------
-- 3. Conferencia (rodar depois de aplicar)
-- ----------------------------------------------------------------------------
-- 3.1 Nada mudou enquanto ninguem virou a chave:
--     SELECT fonte_ponto_oficial, count(*) FROM public.unidades GROUP BY 1;
--     esperado: so 'terminal'. Com isso, guard e trigger sao inertes.
--
-- 3.2 Os dois triggers existem:
--     SELECT tgrelid::regclass AS tabela, tgname, tgenabled FROM pg_trigger
--      WHERE tgname IN ('trg_guard_escrita_presenca_rep', 'trg_reconciliar_apos_marcacao');
--     esperado: 2 linhas, tgenabled = 'O'
--
-- 3.3 Ensaio real, numa unidade de teste e DESFAZENDO no fim:
--     a) UPDATE public.unidades SET fonte_ponto_oficial = 'rep' WHERE id = '<uuid>';
--     b) bater no terminal por um servidor dessa unidade;
--     c) conferir: o terminal NAO deu erro; existe linha nova em marcacoes_ponto
--        com origem 'terminal'; escala_diaria daquele dia tem reconciliado_em recente
--        e a origem gravada e a de MAIOR precedencia entre as marcacoes do dia;
--     d) UPDATE public.unidades SET fonte_ponto_oficial = 'terminal' WHERE id = '<uuid>';
--
-- 3.4 Depois de virar uma unidade de verdade, a conta que motivou esta migration
--     deve ir a zero nela - nenhum dia com batida REP gravado com origem inferior.
--     Comparar com o levantamento de 19/08/2026: 41 'terminal' + 8 'ajuste_coordenador'.
