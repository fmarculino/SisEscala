-- Migration: Fundacao da trilha de auditoria - entidade, autoria e valor anterior
-- Data: 2026-08-09
--
-- Estudo: docs/planos/2026-08-09-auditoria-logs-retencao.md
--
-- O PROBLEMA
--   logs_sistema tem (acao, detalhes jsonb) e mais nada estruturado. Consequencias medidas em
--   producao em 09/08/2026, sobre 2.995 linhas:
--
--   1. NAO SE SABE O QUE MUDOU. 624 registros de SALVAR_PREVISAO_ESCALA nao guardam o estado
--      anterior. Para escala isso passa - a grade e planejamento. Para FOLHA DE PONTO e CADASTRO
--      DE SERVIDOR, o valor anterior e o que da sentido a auditoria: sem ele nao ha como mostrar
--      que a entrada do dia 12 era 08:03 e virou 08:00.
--
--   2. NAO SE SABE SOBRE O QUE. Nao existe campo de entidade nem de id. Achar "tudo que
--      aconteceu com o servidor X" exige varrer `detalhes` com jsonb e torcer para a chave ter
--      sido gravada com o mesmo nome nos 7 lugares que escrevem log.
--
--   3. NAO SE DISTINGUE ROTINA DE FALHA. 403 das 2.995 linhas estao sem user_id. A maioria e
--      rotina automatica (403 = 269 folhas + 134 escalas fechadas por prazo), o que e correto -
--      nao ha autor humano. Mas sem um campo de origem, "rotina" e "falhou ao capturar o autor"
--      sao indistinguiveis, e a auditoria nao pode confiar na ausencia de autor.
--
-- O QUE ESTA MIGRATION FAZ
--   So amplia a tabela. Nenhuma escrita existente quebra: as colunas novas sao opcionais e
--   `detalhes` continua onde esta. Os 7 pontos de escrita atuais seguem funcionando sem alteracao
--   ate serem migrados para o helper.
--
-- O QUE ELA NAO FAZ
--   Nao expurga nada. O estudo mediu 18,3 MB no sistema INTEIRO e ~14 MB/ano de crescimento de
--   logs - apagar registro para economizar isso seria trocar rastreabilidade por nada. O que
--   cresce de verdade (marcacoes_ponto, 36 MB/ano) e registro de ponto, nao log, e nao pode ser
--   apagado.


-- ============================================================================
-- 1. COLUNAS NOVAS
-- ============================================================================

ALTER TABLE public.logs_sistema
    ADD COLUMN IF NOT EXISTS entidade    text,
    ADD COLUMN IF NOT EXISTS entidade_id text,
    ADD COLUMN IF NOT EXISTS origem      text NOT NULL DEFAULT 'humano',
    ADD COLUMN IF NOT EXISTS alteracoes  jsonb;

COMMENT ON COLUMN public.logs_sistema.entidade IS
    'Sobre o que e a acao: servidor, profile, folha_ponto, configuracao, competencia, unidade...';
COMMENT ON COLUMN public.logs_sistema.entidade_id IS
    'Identificador do alvo. TEXT e nao UUID de proposito: competencia e "8/2026", configuracao e a chave.';
COMMENT ON COLUMN public.logs_sistema.origem IS
    'humano | rotina | portal. Distingue rotina automatica de falha ao capturar o autor - sem isto '
    'a ausencia de user_id e ambigua.';
COMMENT ON COLUMN public.logs_sistema.alteracoes IS
    'Apenas os campos QUE MUDARAM: {"campo": {"de": <antes>, "para": <depois>}}. Guardar a linha '
    'inteira inflaria o log e esconderia a mudanca no meio do que ficou igual.';

DO $chk$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_logs_sistema_origem') THEN
        ALTER TABLE public.logs_sistema
            ADD CONSTRAINT chk_logs_sistema_origem
            CHECK (origem IN ('humano', 'rotina', 'portal'));
    END IF;
END
$chk$;

-- As linhas historicas sem autor sao, comprovadamente, as rotinas de fechamento por prazo.
-- Marca-las agora evita que a ambiguidade do passado contamine a leitura do futuro.
UPDATE public.logs_sistema
   SET origem = 'rotina'
 WHERE user_id IS NULL
   AND origem = 'humano'
   AND acao IN ('Folha de Ponto Fechada Automaticamente (Prazo Expirado)',
                'Escala Fechada Automaticamente (Prazo Expirado)');


-- ============================================================================
-- 2. INDICES DE CONSULTA
-- ============================================================================
-- A pergunta que a auditoria faz e "tudo que aconteceu com ESTE alvo" e "tudo que ESTE usuario
-- fez". Sem indice, ambas viram varredura completa - hoje toleravel com 3 mil linhas, nao com
-- 5 anos de retencao.

CREATE INDEX IF NOT EXISTS idx_logs_sistema_entidade
    ON public.logs_sistema (entidade, entidade_id, created_at DESC)
 WHERE entidade IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_logs_sistema_autor
    ON public.logs_sistema (user_id, created_at DESC)
 WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_logs_sistema_acao
    ON public.logs_sistema (acao, created_at DESC);


-- ============================================================================
-- 3. CONSULTA DE TRILHA POR ALVO
-- ============================================================================
-- Existe para a tela nao remontar o join de autor em cada aba, e para que "o historico deste
-- servidor" tenha UMA definicao. SECURITY DEFINER porque logs_sistema tem RLS e a pergunta e
-- legitima para quem ja passou pela checagem de papel na aplicacao.

CREATE OR REPLACE FUNCTION public.fn_trilha_auditoria(
    p_entidade    text,
    p_entidade_id text,
    p_limite      integer DEFAULT 100
)
RETURNS TABLE (
    id          uuid,
    created_at  timestamptz,
    acao        text,
    origem      text,
    autor_nome  text,
    autor_id    uuid,
    alteracoes  jsonb,
    detalhes    jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT l.id, l.created_at, l.acao, l.origem,
           COALESCE(p.full_name, CASE WHEN l.origem = 'rotina' THEN 'Rotina automática' END),
           l.user_id, l.alteracoes, l.detalhes
      FROM public.logs_sistema l
      LEFT JOIN public.profiles p ON p.id = l.user_id
     WHERE l.entidade = p_entidade
       AND l.entidade_id = p_entidade_id
     ORDER BY l.created_at DESC
     LIMIT GREATEST(COALESCE(p_limite, 100), 1)
$fn$;

COMMENT ON FUNCTION public.fn_trilha_auditoria(text, text, integer) IS
    'Historico de um alvo (servidor, folha, competencia...). Fonte unica da pergunta "o que '
    'aconteceu com isto".';

GRANT EXECUTE ON FUNCTION public.fn_trilha_auditoria(text, text, integer) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. Colunas criadas e nenhuma escrita antiga quebrada (esperado: 2.995 linhas intactas):
--
--      SELECT count(*) FROM logs_sistema;
--      SELECT origem, count(*) FROM logs_sistema GROUP BY 1;
--      -- esperado: humano ~2592, rotina ~403
--
--   2. Nenhuma linha ficou com autor ausente E origem humano sem explicacao:
--
--      SELECT acao, count(*) FROM logs_sistema
--       WHERE user_id IS NULL AND origem = 'humano' GROUP BY 1;
--
--   3. A trilha responde (vazia por enquanto - nada foi instrumentado ainda):
--
--      SELECT * FROM public.fn_trilha_auditoria('servidor', '<uuid>');
