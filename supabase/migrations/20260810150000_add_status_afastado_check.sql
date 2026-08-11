-- Migration: status ganha Afastado como valor real, com CHECK
-- Data: 2026-08-10
--
-- Plano: docs/planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md
-- Estudo: docs/planos/2026-08-10-estudo-importacao-dados-cadastrais-rh.md § 3.4
--
-- CONTEXTO
--   servidores.status e texto livre, sem CHECK - em producao so 'Ativo' existe hoje (191/191).
--   O relatorio de RH distingue At. Normal / Afastado / Demitido. 'Afastado' e uma situacao real
--   (licenca etc.), diferente de 'Inativo' (desligado) - forcar um dos dois binarios perderia
--   informacao que o proprio RH ja separa.
--
--   'Falecido' fica de fora: nem a fonte (o relatorio do RH) tem essa categoria propria - seria
--   inventar uma distincao que a fonte nao da como confirmar. Se for necessario, e decisao futura
--   separada, possivelmente com outra fonte.
--
--   Afastado NAO muda nenhum comportamento de escala/ponto nesta migration - e so a categoria
--   correta para nao gravar dado errado. Efeito em escala/geracao de folha fica para quando (e se)
--   for decidido tratar Afastado de forma diferente de Ativo na geracao - fora de escopo aqui.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_servidores_status'
           AND conrelid = 'public.servidores'::regclass
    ) THEN
        ALTER TABLE public.servidores
            ADD CONSTRAINT chk_servidores_status
            CHECK (status IN ('Ativo', 'Afastado', 'Inativo'));
    END IF;
END
$$;

COMMENT ON CONSTRAINT chk_servidores_status ON public.servidores IS
    'Situacao do vinculo. Afastado adicionado em 10/08/2026 para acompanhar o relatorio de RH - '
    'nao muda comportamento de escala/ponto por si so.';

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--   1. A constraint existe:
--      SELECT conname FROM pg_constraint
--       WHERE conname = 'chk_servidores_status' AND conrelid = 'public.servidores'::regclass;
--   2. Nao ha valor fora da lista gravado (esperado: zero linhas):
--      SELECT DISTINCT status FROM public.servidores WHERE status NOT IN ('Ativo','Afastado','Inativo');
