-- Migration: Colunas de origem em escala_diaria e guard de competencia encerrada
-- Data: 2026-08-08
--
-- OBJETIVO
--   Preparar escala_diaria para ser PROJECAO das marcacoes: cada passo de presenca passa a
--   carregar de qual origem veio e qual marcacao o produziu. As colunas nascem NULL e nada
--   as le ainda - a reconciliacao que as preenche chega na Fase 2.
--
--   Com presenca_*_origem preenchida, a folha de ponto deixa de depender das flags
--   presenca_*_manual (que so distinguem manual de nao-manual) e passa a distinguir as quatro
--   origens reais: relogio, terminal, ajuste do coordenador e ajuste do servidor.
--
-- ATENCAO - ESTA MIGRATION TEM UMA MUDANCA DE COMPORTAMENTO
--   A secao 3 instala um trigger que BLOQUEIA alteracao de presenca em competencia encerrada.
--   Hoje isso e um buraco real: isCompetencyClosed (src/utils/autoClose.ts) protege apenas
--   folha_ponto. Nem fn_confirmar_presenca nem fn_confirmar_presenca_manual consultam
--   competencias_encerradas, entao e possivel gravar batida num mes ja fechado e a folha
--   daquele mes deixar de bater com escala_diaria.
--
--   Isso vira critico com o REP: um AFD coletado por pendrive 40 dias atrasado tentaria
--   escrever numa competencia fechada. A regra correta e aceitar a INGESTAO (o registro
--   existe) e recusar a PROJECAO, abrindo pendencia.
--
--   Se o guard atrapalhar alguma correcao legitima, remova so ele:
--     DROP TRIGGER trg_escala_diaria_guard_competencia ON public.escala_diaria;
--
-- IDEMPOTENTE
--   ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS.


-- ============================================================================
-- 1. ORIGEM E RASTREIO DE CADA PASSO
-- ============================================================================

ALTER TABLE public.escala_diaria
    ADD COLUMN IF NOT EXISTS presenca_entrada_origem           public.marcacao_origem,
    ADD COLUMN IF NOT EXISTS presenca_intervalo_saida_origem   public.marcacao_origem,
    ADD COLUMN IF NOT EXISTS presenca_intervalo_retorno_origem public.marcacao_origem,
    ADD COLUMN IF NOT EXISTS presenca_saida_origem             public.marcacao_origem;

ALTER TABLE public.escala_diaria
    ADD COLUMN IF NOT EXISTS presenca_entrada_marcacao_id           uuid REFERENCES public.marcacoes_ponto(id),
    ADD COLUMN IF NOT EXISTS presenca_intervalo_saida_marcacao_id   uuid REFERENCES public.marcacoes_ponto(id),
    ADD COLUMN IF NOT EXISTS presenca_intervalo_retorno_marcacao_id uuid REFERENCES public.marcacoes_ponto(id),
    ADD COLUMN IF NOT EXISTS presenca_saida_marcacao_id             uuid REFERENCES public.marcacoes_ponto(id);

-- Controle da reconciliacao: permite reprocessar em lote apenas os dias defasados.
ALTER TABLE public.escala_diaria
    ADD COLUMN IF NOT EXISTS reconciliado_em      timestamptz,
    ADD COLUMN IF NOT EXISTS reconciliacao_versao integer;

COMMENT ON COLUMN public.escala_diaria.presenca_entrada_origem IS
    'Origem do horario em presenca_entrada_em. Preenchida por fn_reconciliar_marcacoes_dia. '
    'Substitui a inferencia por presenca_entrada_manual, que so distingue manual de nao-manual.';
COMMENT ON COLUMN public.escala_diaria.presenca_entrada_marcacao_id IS
    'Marcacao que produziu este horario. Permite abrir a linha do tempo completa do dia, '
    'inclusive as marcacoes perdedoras por precedencia.';
COMMENT ON COLUMN public.escala_diaria.reconciliacao_versao IS
    'Versao do algoritmo de reconciliacao que produziu esta projecao. Dias com versao inferior '
    'a atual sao reprocessados pelo cron.';


-- ============================================================================
-- 2. COMPETENCIA ENCERRADA - VERSAO SQL
-- ============================================================================
-- A logica existe hoje apenas em TypeScript (isCompetencyClosed, src/utils/autoClose.ts),
-- lendo configuracoes_globais.competencias_encerradas - um array JSONB de
-- [{mes, ano, encerrado_por, encerrado_em}]. Precisa existir no banco para que triggers e
-- funcoes de presenca possam consulta-la.

CREATE OR REPLACE FUNCTION public.fn_competencia_encerrada(p_mes integer, p_ano integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.configuracoes_globais cg
          CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(cg.valor) = 'array' THEN cg.valor ELSE '[]'::jsonb END
          ) AS c
         WHERE cg.chave = 'competencias_encerradas'
           AND (c->>'mes')::int = p_mes
           AND (c->>'ano')::int = p_ano
    )
$$;

COMMENT ON FUNCTION public.fn_competencia_encerrada(integer, integer) IS
    'Espelha isCompetencyClosed de src/utils/autoClose.ts. Le configuracoes_globais.competencias_encerradas.';

GRANT EXECUTE ON FUNCTION public.fn_competencia_encerrada(integer, integer) TO authenticated, service_role;


-- ============================================================================
-- 3. GUARD - PRESENCA CONGELADA EM COMPETENCIA ENCERRADA
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_escala_diaria_presenca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_mes integer;
    v_ano integer;
BEGIN
    -- So interessa alteracao dos horarios de presenca. Edicao de turno, categoria ou
    -- qualquer outra coluna segue livre.
    IF NEW.presenca_entrada_em           IS NOT DISTINCT FROM OLD.presenca_entrada_em
   AND NEW.presenca_intervalo_saida_em   IS NOT DISTINCT FROM OLD.presenca_intervalo_saida_em
   AND NEW.presenca_intervalo_retorno_em IS NOT DISTINCT FROM OLD.presenca_intervalo_retorno_em
   AND NEW.presenca_saida_em             IS NOT DISTINCT FROM OLD.presenca_saida_em THEN
        RETURN NEW;
    END IF;

    SELECT em.mes, em.ano INTO v_mes, v_ano
      FROM public.escala_mensal em
     WHERE em.id = NEW.escala_mensal_id;

    IF v_mes IS NOT NULL AND public.fn_competencia_encerrada(v_mes, v_ano) THEN
        RAISE EXCEPTION
            'Competencia %/% esta encerrada: a presenca ficou congelada para auditoria. '
            'Reabra a competencia em Configuracoes (super admin) antes de alterar.',
            lpad(v_mes::text, 2, '0'), v_ano
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_escala_diaria_guard_competencia ON public.escala_diaria;
CREATE TRIGGER trg_escala_diaria_guard_competencia
    BEFORE UPDATE ON public.escala_diaria
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_escala_diaria_presenca();


-- CONFERENCIA APOS APLICAR
--   1) As 10 colunas novas devem existir:
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'escala_diaria'
--      AND (column_name LIKE 'presenca_%_origem'
--        OR column_name LIKE 'presenca_%_marcacao_id'
--        OR column_name IN ('reconciliado_em','reconciliacao_versao'))
--    ORDER BY column_name;
--   -- esperado: 10 linhas
--
--   2) A funcao de competencia deve concordar com o que a UI mostra em Configuracoes:
--
--   SELECT c->>'mes' AS mes, c->>'ano' AS ano
--     FROM public.configuracoes_globais cg
--     CROSS JOIN LATERAL jsonb_array_elements(cg.valor) c
--    WHERE cg.chave = 'competencias_encerradas';
--
--   -- e para cada par listado acima, deve retornar true:
--   -- SELECT public.fn_competencia_encerrada(<mes>, <ano>);
--   -- para um mes aberto, deve retornar false:
--   SELECT public.fn_competencia_encerrada(8, 2026);
--
--   3) TESTE DO GUARD - se nao houver nenhuma competencia encerrada, ele nao muda nada.
--      Confirme que validar presenca pela grade em 08/2026 continua funcionando normalmente.
--      Se 08/2026 estiver aberta (esperado), o guard e inerte para o uso do dia a dia.
