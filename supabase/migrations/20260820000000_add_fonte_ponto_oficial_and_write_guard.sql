-- ============================================================================
-- Migration: Fase 5 - chave de corte por unidade e guard de escrita de presenca
-- Data: 2026-08-20
--
-- Motivo: a Fase 5 do plano do REP sempre previu o corte por
-- unidades.fonte_ponto_oficial, mas a COLUNA NUNCA FOI CRIADA - ela so existia
-- em comentarios da 20260808060000. Enquanto isso, a 20260818080000 fez
-- fn_ingerir_afd chamar fn_reconciliar_marcacoes_dia automaticamente, entao a
-- batida do relogio JA escreve em escala_diaria, em qualquer unidade, sem
-- nenhum corte e sem forma de reverter por unidade.
--
-- Esta migration devolve a reversibilidade prometida pelo plano. Ela NAO muda
-- comportamento nenhum ao ser aplicada: toda unidade nasce em 'terminal', e o
-- guard so tem efeito onde alguem trocar para 'rep' deliberadamente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A chave de corte, por unidade
-- ----------------------------------------------------------------------------
ALTER TABLE public.unidades
    ADD COLUMN IF NOT EXISTS fonte_ponto_oficial text NOT NULL DEFAULT 'terminal';

DO $do$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_unidades_fonte_ponto_oficial'
           AND conrelid = 'public.unidades'::regclass
    ) THEN
        ALTER TABLE public.unidades
            ADD CONSTRAINT chk_unidades_fonte_ponto_oficial
            CHECK (fonte_ponto_oficial IN ('terminal', 'rep'));
    END IF;
END
$do$;

COMMENT ON COLUMN public.unidades.fonte_ponto_oficial IS
    'Fase 5 do plano REP. terminal = o terminal web grava presenca direto (comportamento '
    'historico). rep = so a reconciliacao grava presenca; qualquer outro caminho e recusado '
    'pelo trigger trg_guard_escrita_presenca_rep. Reversivel invertendo o valor.';

-- ----------------------------------------------------------------------------
-- 2. O guard de escrita
--
--    fn_reconciliar_marcacoes_dia ja declara sisescala.reconciliacao = 'on'
--    (desde a 20260808060000, linha 167) - o guard so precisava passar a exigir.
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
    -- 2.1 Curto-circuito barato. A grade faz upsert de TODAS as linhas do mes a cada
    --     'Salvar Previsao', entao o caminho comum nao pode pagar um SELECT.
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

    -- 2.2 A reconciliacao se declara e e sempre o caminho autorizado.
    IF COALESCE(current_setting('sisescala.reconciliacao', true), '') = 'on' THEN
        RETURN NEW;
    END IF;

    SELECT u.fonte_ponto_oficial
      INTO v_fonte
      FROM public.escala_mensal em
      JOIN public.unidades u ON u.id = em.unidade_id
     WHERE em.id = NEW.escala_mensal_id;

    IF v_fonte = 'rep' THEN
        RAISE EXCEPTION
            'Unidade com fonte de ponto oficial REP: a presenca so pode ser gravada pela '
            'reconciliacao (fn_reconciliar_marcacoes_dia). escala_diaria_id=%', NEW.id
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_guard_escrita_presenca_rep() IS
    'Fase 5: em unidade com fonte_ponto_oficial = rep, recusa escrita de presenca que nao '
    'venha da reconciliacao. Inerte enquanto a unidade estiver em terminal.';

DROP TRIGGER IF EXISTS trg_guard_escrita_presenca_rep ON public.escala_diaria;
CREATE TRIGGER trg_guard_escrita_presenca_rep
    BEFORE INSERT OR UPDATE ON public.escala_diaria
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guard_escrita_presenca_rep();

-- ----------------------------------------------------------------------------
-- 3. Conferencia (rodar depois de aplicar)
-- ----------------------------------------------------------------------------
-- 3.1 Toda unidade tem que estar em 'terminal' - nada mudou de comportamento:
--     SELECT fonte_ponto_oficial, count(*) FROM public.unidades GROUP BY 1;
--     esperado: terminal | <total de unidades>   (nenhuma linha 'rep')
--
-- 3.2 O trigger existe e esta ativo:
--     SELECT tgname, tgenabled FROM pg_trigger
--      WHERE tgrelid = 'public.escala_diaria'::regclass
--        AND tgname = 'trg_guard_escrita_presenca_rep';
--     esperado: 1 linha, tgenabled = 'O'
--
-- 3.3 O guard funciona (teste em UMA unidade, e DESFAZER depois):
--     UPDATE public.unidades SET fonte_ponto_oficial = 'rep' WHERE id = '<uuid>';
--     UPDATE public.escala_diaria SET presenca_entrada_em = now()
--      WHERE id = '<uuid de linha dessa unidade>';   -- deve falhar com 42501
--     SELECT public.fn_reconciliar_marcacoes_dia('<servidor>', '<data>');  -- deve passar
--     UPDATE public.unidades SET fonte_ponto_oficial = 'terminal' WHERE id = '<uuid>';
