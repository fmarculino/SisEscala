-- Migration: Cria as colunas de auditoria da validacao manual em escala_diaria
-- Data: 2026-08-07
--
-- SINTOMA
--   Depois de corrigir o cast enum x text (20260807060000), a validacao manual passou a
--   falhar com:
--     ERROR: column "justificativa_manual" of relation "escala_diaria" does not exist
--
-- CAUSA
--   20260804080000_fix_shift_n_18h_jornada_start.sql passou a escrever
--   justificativa_manual e confirmacao_manual em escala_diaria, mas NENHUMA migration
--   jamais criou essas colunas. Conferido em 07/08/2026:
--     grep -rn "ADD COLUMN.*justificativa_manual" supabase/migrations/  -> nada
--   e a consulta REST em homologacao retorna 42703 para as duas colunas.
--
--   E a segunda quebra originada na mesma migration 20260804080000 (a outra foi a perda do
--   cast ::public.escala_categoria). As duas juntas deixaram a validacao manual - individual
--   e em massa - inteiramente inoperante desde 04/08/2026.
--
-- POR QUE CRIAR AS COLUNAS EM VEZ DE REMOVER AS ESCRITAS
--   Ate 20260804050000 a justificativa informada pelo coordenador so era persistida quando
--   a categoria era Sobreaviso (concatenada em logs_sobreaviso.motivo_acionamento). Para
--   Regular, Plantao e Extra ela era simplesmente descartada, embora o modal da grade a exija
--   como obrigatoria e informe ao usuario que "esta acao sera gravada nos registros de
--   auditoria". Persistir a justificativa na propria linha e o comportamento correto para um
--   sistema de ponto - manter a escrita e criar as colunas preserva essa intencao.
--
-- IDEMPOTENTE
--   Usa ADD COLUMN IF NOT EXISTS porque os schemas de homologacao e producao divergem
--   (CLAUDE.md armadilha 3): tabelas base foram criadas fora do versionamento. Rodar nos
--   dois ambientes e seguro, mesmo que um deles ja possua as colunas.
--
--   confirmacao_manual entra com DEFAULT false sem NOT NULL: em Postgres 11+ o default
--   e gravado no catalogo, sem reescrever a tabela.

ALTER TABLE public.escala_diaria
    ADD COLUMN IF NOT EXISTS justificativa_manual text;

ALTER TABLE public.escala_diaria
    ADD COLUMN IF NOT EXISTS confirmacao_manual boolean DEFAULT false;

COMMENT ON COLUMN public.escala_diaria.justificativa_manual IS
    'Justificativa informada pelo coordenador ao validar a presenca manualmente pela grade.';

COMMENT ON COLUMN public.escala_diaria.confirmacao_manual IS
    'true quando a linha teve algum passo de presenca gravado por validacao manual.';


-- CONFERENCIA APOS APLICAR
--   Deve retornar as duas colunas:
--
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'escala_diaria'
--      AND column_name IN ('justificativa_manual', 'confirmacao_manual');
