-- Competencia a partir da qual a regra de atraso/compensacao da folha de ponto vale.
--
-- CONTEXTO
--   Em 04/09/2026 a folha passou a medir atraso e a oferecer a decisao de compensacao
--   (Portaria 382/2019-GAB-MAB/SMS, Art. 7 §1/§2). Decisao do usuario na mesma data: a regra vale
--   "a partir do mes 09/2026", e 08/2026 "fica como esta" — inclusive as 473h de hora extra que
--   nasceram sem a autorizacao previa do Art. 8.
--
-- POR QUE UM CORTE, E POR QUE ELE ESCONDE ATE OS INDICADORES
--   A folha e documento ASSINADO. Reimprimir uma competencia fechada mostrando campos que nao
--   existiam quando o servidor assinou muda o documento depois da assinatura. Antes do corte, o
--   rodape continua com as 4 caixas de sempre — so que ja em HH:MM, que e o mesmo numero escrito
--   de forma legivel, nao conteudo novo.
--
--   Medido em 04/09/2026: sem o corte, reabrir as folhas de 08/2026 jogaria 756 dias em 170
--   folhas na fila de decisao — trabalho que o usuario decidiu explicitamente nao fazer.
--
-- ⚠️ ESTA MIGRATION E CONVENIENCIA, NAO PRE-REQUISITO.
--   O padrao (2026-09) vive no codigo, em COMPETENCIA_COMPENSACAO_PADRAO
--   (src/utils/folha/calculoDia.ts), e chave ausente OU malformada cai nele. Esta chave existe
--   para mover o corte sem deploy — por exemplo, para 2026-10, se a entrada oficial em producao
--   (01/10/2026) recomendar comecar junto com ela.
--
-- ⚠️ NAO use esta chave para "ligar a regra para tras". Competencia encerrada esta congelada para
--   auditoria, e folha assinada nao ganha campo novo depois da assinatura.

INSERT INTO public.configuracoes_globais (chave, valor, descricao, created_at, updated_at)
VALUES (
    'compensacao_atraso_vigente_desde',
    '"2026-09"'::jsonb,
    'Competencia (YYYY-MM) a partir da qual a folha mede atraso e oferece a decisao de compensacao. Competencia anterior mantem o rodape antigo. Ausente = 2026-09 (padrao do codigo).',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
)
ON CONFLICT (chave) DO NOTHING;

-- =========================================================================
-- CONFERENCIA
-- =========================================================================
-- 1. A chave existe e esta no formato esperado?
--    SELECT chave, valor FROM public.configuracoes_globais
--     WHERE chave = 'compensacao_atraso_vigente_desde';
--    -> esperado: "2026-09"
--
-- 2. Nenhuma folha anterior ao corte deve mudar de total. Rodar ANTES e DEPOIS e comparar:
--    SELECT mes, ano, count(*) AS folhas,
--           sum(total_horas_extras_50)  AS extra50,
--           sum(total_horas_extras_100) AS extra100,
--           sum(total_faltas)           AS faltas
--      FROM public.folha_ponto
--     WHERE ano = 2026 AND mes <= 8
--     GROUP BY mes, ano ORDER BY ano, mes;
--
-- 3. Conferencia por fora, sobre os registros (nao depende desta chave):
--    node scratchpad/an_confere_totais_novos.mjs
