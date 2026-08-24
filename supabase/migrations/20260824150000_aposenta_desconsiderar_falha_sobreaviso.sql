-- Migration: aposenta a configuracao sobreaviso_desconsiderar_falha
-- Data: 2026-08-24
-- Plano: docs/planos/2026-08-23-desfecho-de-plantao-e-sobreaviso.md (secao 5.2, fase 3)
--
-- POR QUE ELA SAI
--   Decisao do usuario em 23/08/2026: sobreaviso acionado que falha em QUALQUER estagio - nao
--   aceitou, aceitou e nao compareceu, ou os dois - e FALTA, e a unica forma de desfazer isso e
--   o coordenador validar na fila de justificativas.
--
--   `sobreaviso_desconsiderar_falha` esta LIGADA em producao (valor jsonb `true`) e contradiz
--   essa regra por construcao. Hoje ela nao faz quase nada - o unico efeito e um sufixo no
--   tooltip da grade ("(Desconsiderado da carga horária)"), lido em ScaleGrid.tsx:363; a chave
--   nem aparece na tela de Configuracoes. Mantida, viraria um interruptor global capaz de
--   anular a falta de sobreaviso na rede inteira, sem log, sem autor e sem justificativa -
--   exatamente o contrario do que o desfecho existe para garantir.
--
--   A porta para desfazer uma falta passa a ser uma so: `justificativas_eventos.resultado`, que
--   grava quem decidiu, quando e por que, com trilha append-only em
--   justificativas_eventos_desfecho_historico.
--
-- CUSTO DE REVERSAO: ZERO
--   O caminho da falha nunca rodou em producao. Medido em 24/08/2026: das 526 linhas de
--   logs_sobreaviso, os status existentes sao apenas `Chegou` (522) e `Cancelado` (4) - nenhuma
--   `Falhou`, e `motivo_falha` nulo em todas. Nunca houve uma falha para esta chave
--   desconsiderar.
--
-- ⚠️ A chave e REMOVIDA, nao apenas ignorada pelo codigo. Configuracao orfa que ninguem le e
--   pior do que nenhuma: alguem a encontra depois, liga, e conclui que ligou alguma coisa.

BEGIN;

DELETE FROM public.configuracoes_globais
 WHERE chave = 'sobreaviso_desconsiderar_falha';

COMMIT;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar; nao faz parte da migration)
-- ============================================================================
--
-- 1. A chave sumiu, e as que continuam valendo seguem la:
--
--    SELECT chave, valor FROM public.configuracoes_globais
--     WHERE chave LIKE 'sobreaviso_%' ORDER BY chave;
--    -- esperado: sobreaviso_exigir_localizacao, sobreaviso_permitir_validacao_manual,
--    --           sobreaviso_tempo_aceite_minutos (30), sobreaviso_tempo_chegada_minutos (90)
--    --           e NAO deve aparecer sobreaviso_desconsiderar_falha
--
-- 2. Nada em producao muda de estado por causa disto:
--
--    SELECT status, count(*) FROM public.logs_sobreaviso GROUP BY status;
--    -- esperado: Chegou 522, Cancelado 4 (nenhuma falha existente para desconsiderar)
