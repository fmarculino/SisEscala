-- =========================================================================
-- Autorizacao previa de hora extra (Art. 8) - chave de vigencia
-- =========================================================================
-- 06/09/2026. Decisao do usuario: o gate vale sobre a hora extra APURADA na folha (o excedente
-- da saida), nao sobre o lancamento de turno Extra na grade. E' de la que vem o volume: 473h em
-- 08/2026 nasceram sem ninguem autorizar nada.
--
-- BASE LEGAL: Portaria 382/2019-GAB-MAB/SMS, Art. 8 - a sobrejornada depende de autorizacao
-- previa da chefia imediata.
--
-- ⚠️ ESTA MIGRATION NAO MUDA NENHUM VALOR SOZINHA, e isso e o desenho, nao acaso.
--
--   O dia com hora extra apurada nasce `pendente`, e `pendente` deixa o total EXATAMENTE como
--   esta hoje. So a decisao explicita da chefia muda numero: `nao_autorizada` tira o excedente
--   da verba, `autorizada` o mantem com nome e data de quem autorizou.
--
--   E' a mesma decisao de desenho da compensacao de atraso (04/09/2026), pelo mesmo motivo:
--   "nao autorizada por padrao" apagaria hora extra de gente que trabalhou, numa folha que o
--   servidor assina; "autorizada por padrao" manteria o problema que o Art. 8 existe para
--   resolver. Entao ninguem decide pelo sistema - o sistema COBRA a decisao no fechamento.
--
-- ⚠️ 08/2026 fica de fora de proposito. Em 04/09/2026 o usuario decidiu explicitamente que "as
-- 473h daquele mes ficam como estao": sao folhas ja conferidas, e pedir autorizacao retroativa
-- sobre trabalho ja assinado e outra conversa, com o RH, nao um efeito colateral de migration.
--
-- ⚠️ O DEFAULT VIVE NO CODIGO (COMPETENCIA_AUTORIZACAO_EXTRA_PADRAO, em calculoDia.ts). Esta
-- chave apenas SOBRESCREVE. Falha ao ler cai no padrao - nunca em "liga para todo mundo".
--
-- ⚠️ Chave PROPRIA, e nao a mesma da compensacao. Sao perguntas diferentes sobre o mesmo dia:
-- "esse excedente repoe um atraso?" (Art. 7) e "esse excedente foi autorizado?" (Art. 8). O RH
-- pode precisar mover uma sem a outra.
-- =========================================================================

INSERT INTO public.configuracoes_globais (chave, valor, descricao, created_at, updated_at)
VALUES (
    'autorizacao_extra_vigente_desde',
    '"2026-09"'::jsonb,
    'Competencia (YYYY-MM) a partir da qual a hora extra apurada exige autorizacao da chefia (Art. 8 da Portaria 382/2019). Antes do corte a folha segue como hoje. Ausente = 2026-09 (padrao do codigo).',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
)
ON CONFLICT (chave) DO NOTHING;

-- =========================================================================
-- CONFERENCIA
-- =========================================================================
-- 1. A chave existe e esta no formato esperado?
--    SELECT chave, valor FROM public.configuracoes_globais
--     WHERE chave = 'autorizacao_extra_vigente_desde';
--    -> esperado: "2026-09"
--
-- 2. NENHUMA folha pode mudar de total so por aplicar isto. Rodar ANTES e DEPOIS e comparar -
--    os numeros tem que ser identicos, porque todo dia nasce `pendente`:
--    SELECT mes, ano, count(*) AS folhas,
--           sum(total_horas_extras_50)  AS extra50,
--           sum(total_horas_extras_100) AS extra100
--      FROM public.folha_ponto
--     WHERE ano = 2026 GROUP BY mes, ano ORDER BY ano, mes;
--
-- 3. Tamanho da fila que a chefia vai encontrar em 09/2026 (quantos dias por folha, e quantas
--    folhas). Se este numero for grande demais para o fechamento do mes, a saida NAO e mudar o
--    default do codigo - e mover ESTA chave para 2026-10 e avisar o RH:
--    SELECT count(*) FILTER (WHERE d.extra > 0) AS dias_com_extra,
--           count(DISTINCT f.id)                AS folhas_afetadas
--      FROM public.folha_ponto f
--      CROSS JOIN LATERAL jsonb_array_elements(f.registros) AS r(reg)
--      CROSS JOIN LATERAL (SELECT COALESCE((r.reg->>'hora_extra_minutos')::int, 0) AS extra) d
--     WHERE f.ano = 2026 AND f.mes = 9;
--
-- 4. Para adiar sem mexer em codigo:
--    UPDATE public.configuracoes_globais SET valor = '"2026-10"'::jsonb, updated_at = now()
--     WHERE chave = 'autorizacao_extra_vigente_desde';
