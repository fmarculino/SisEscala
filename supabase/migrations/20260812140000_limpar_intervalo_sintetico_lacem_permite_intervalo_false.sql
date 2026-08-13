-- Migration: Limpa marcacao de intervalo sintetica na LACEM (permite_marca_intervalo = false)
-- Data: 2026-08-12
--
-- CONTEXTO
--   CLAUDE.md registrava "103 marcacoes de intervalo existem em unidades com
--   permite_marca_intervalo = false (artefatos da regressao de 20260804080000). A
--   reconciliacao as apagaria - decisao explicita necessaria, nao pode ser efeito colateral."
--
--   Reconferido em 12/08/2026 antes de decidir: o numero atual em producao e 7, nao 103 - a
--   nota anterior estava desatualizada (a contagem provavelmente refletia um estado anterior a
--   alguma correcao ja aplicada). As 7 linhas sao todas da LACEM, todas em 08/2026, e todas tem
--   o padrao classico de horario SINTETICO (CLAUDE.md armadilha 5): os campos de intervalo
--   caem exatamente em :00:00, enquanto entrada/saida tem segundos reais de batida de terminal.
--   Confirmado como artefato de fn_confirmar_presenca_manual antes do guard de
--   fn_jornada_tem_intervalo (20260807050000/20260807080000), nao como intervalo de verdade
--   gozado pelo servidor - a LACEM nunca permitiu marcar intervalo.
--
-- DECISAO (usuario, 12/08/2026): limpar agora, antes de qualquer reconciliacao real rodar sobre
--   a LACEM. So os campos de intervalo sao zerados - entrada e saida (reais, com segundos) nao
--   sao tocados.
--
-- POR QUE POR ID EXPLICITO, NAO POR CRITERIO AMPLO
--   UPDATE ... WHERE permite_marca_intervalo = false pegaria qualquer linha que passe a
--   corresponder no futuro, inclusive dado legitimo que ainda nao existe hoje. Os 7 ids abaixo
--   sao exatamente as linhas conferidas nesta sessao (ver conferencia abaixo) - nada mais.
--
-- IDEMPOTENTE: WHERE id = ANY(...) sobre campos ja NULL nao e erro, so nao muda nada.

UPDATE public.escala_diaria
   SET presenca_intervalo_saida_em   = NULL,
       presenca_intervalo_retorno_em = NULL
 WHERE id = ANY(ARRAY[
    '2f3a74d0-db86-4c64-b8aa-e69a7019e863',
    '55ccf8c3-a6c6-47ba-b280-6592aba6a642',
    '69961ece-a835-45bb-8857-f77159aa1eeb',
    '49b90e1e-914d-4e35-ab30-c35388d780f5',
    '3fd074bb-a8e5-4a22-83ca-41f66e58b763',
    '3b9c0c08-3079-43da-a703-552e9f200f34',
    '58b1323f-634f-4ce1-a2c2-8d0e672f6723'
 ]::uuid[])
   -- so mexe se realmente ainda estiver preenchido - reaplicar esta migration nao gera diff.
   AND (presenca_intervalo_saida_em IS NOT NULL OR presenca_intervalo_retorno_em IS NOT NULL);


-- CONFERENCIA APOS APLICAR
--
--   1. As 7 linhas ficam sem intervalo, entrada/saida preservadas:
--
--      SELECT id, dia, categoria, presenca_entrada_em, presenca_intervalo_saida_em,
--             presenca_intervalo_retorno_em, presenca_saida_em
--        FROM public.escala_diaria
--       WHERE id = ANY(ARRAY[
--           '2f3a74d0-db86-4c64-b8aa-e69a7019e863', '55ccf8c3-a6c6-47ba-b280-6592aba6a642',
--           '69961ece-a835-45bb-8857-f77159aa1eeb', '49b90e1e-914d-4e35-ab30-c35388d780f5',
--           '3fd074bb-a8e5-4a22-83ca-41f66e58b763', '3b9c0c08-3079-43da-a703-552e9f200f34',
--           '58b1323f-634f-4ce1-a2c2-8d0e672f6723']::uuid[]);
--      -- esperado: presenca_intervalo_saida_em e presenca_intervalo_retorno_em NULL nas 7;
--      --           presenca_entrada_em/presenca_saida_em inalterados.
--
--   2. Zero linhas remanescentes na LACEM (nem em nenhuma outra unidade sem intervalo):
--
--      SELECT count(*)
--        FROM public.escala_diaria ed
--        JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--        JOIN public.unidades u ON u.id = em.unidade_id
--       WHERE COALESCE(u.permite_marca_intervalo, false) = false
--         AND (ed.presenca_intervalo_saida_em IS NOT NULL
--              OR ed.presenca_intervalo_retorno_em IS NOT NULL);
--      -- esperado: 0
