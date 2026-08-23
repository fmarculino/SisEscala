-- ============================================================================
-- Migration: tolerancia de variacao de horario no registro de ponto (CLT Art. 58 §1º)
-- Data: 2026-08-23
--
-- BASE LEGAL
--   CLT Art. 58 §1º: "Nao serao descontadas nem computadas como jornada extraordinaria as
--   variacoes de horario no registro de ponto nao excedentes de cinco minutos, observado o
--   limite maximo de dez minutos diarios."
--
-- ⚠️ E UM LIMIAR, NAO UMA FRANQUIA.
--   Sumula 366 do TST: ultrapassado o limite, "como extra sera considerada a TOTALIDADE do tempo
--   que exceder a jornada normal". Nao se desconta os 10 minutos e paga-se o resto:
--
--     saiu 4 min depois  -> 0 de hora extra
--     saiu 12 min depois -> 12 min de hora extra (NAO 2)
--
--   Medido sobre 08/2026 (1.192 dias com extra, 485h11): como limiar deixa de pagar 18h24; como
--   franquia deixaria de pagar 120h55. A diferenca de 102h31 e o tamanho do erro de leitura.
--
-- POR QUE CONFIGURAVEL
--   O regime dos servidores de Maraba e a Lei 17.331/2008 (RJU), que nao disciplina a tolerancia;
--   a CLT vale subsidiariamente, como ja acontece com o intervalo intrajornada (armadilha 9). Se
--   um regulamento municipal futuro fixar outro numero, muda-se aqui, sem tocar em codigo.
--
--   ZERO NOS DOIS DESLIGA a tolerancia por inteiro — e o comportamento anterior a esta data, em
--   que cada minuto alem do fim da jornada virava hora extra.
--
-- A APLICACAO E EM 6 SITIOS DE CODIGO, com fonte unica em src/utils/folha/toleranciaExtra.ts:
--   geracao (4 copias: executeGerarFolhaPonto, sincronizarFolhaPonto, gerarFolhaPontoServidor,
--   sincronizarFolhaPontoServidor), auto-correcao (normalizarRegistrosFolha) e a tela
--   (FolhaPontoEditor.recalculateOvertimeForDay). A tela PRECISA usar a mesma conta: se divergir,
--   o valor da folha muda so por alguem tocar na celula — o defeito corrigido em 21/08/2026.
-- ============================================================================

INSERT INTO public.configuracoes_globais (chave, valor, descricao)
VALUES
  ('tolerancia_extra_minutos_por_marcacao', '5'::jsonb,
   'Tolerancia, em minutos, de CADA variacao isolada de horario no registro de ponto (CLT Art. 58 '
   'paragrafo 1o). Dentro do limite nao ha hora extra; fora dele computa-se a TOTALIDADE do '
   'excedente (Sumula 366 do TST), nunca so a diferenca. Zero desliga.'),
  ('tolerancia_extra_minutos_diaria', '10'::jsonb,
   'Tolerancia diaria, em minutos, para a SOMA das variacoes de horario do dia (CLT Art. 58 '
   'paragrafo 1o). Vale junto com o limite por marcacao: os dois precisam ser respeitados para '
   'que o dia nao gere hora extra. Zero desliga.')
ON CONFLICT (chave) DO NOTHING;


-- ============================================================================
-- CONFERENCIA (nao escreve)
-- ============================================================================
--
-- 1) As duas chaves existem com o padrao da CLT:
--
--    SELECT chave, valor, descricao
--      FROM public.configuracoes_globais
--     WHERE chave LIKE 'tolerancia_extra_%'
--     ORDER BY chave;
--
--    Esperado: por_marcacao = 5, diaria = 10.
--
-- 2) ON CONFLICT DO NOTHING de proposito: reaplicar a migration NAO devolve o valor ao padrao
--    depois de alguem ajustar a tolerancia na tela de Configuracoes.
--
-- 3) Efeito medido antes de aplicar (scratchpad/mede_tolerancia_extra.js), sobre 08/2026:
--
--    faixa do excedente      dias      horas
--       1-5   min             558      22h12   <- passam a nao gerar hora extra
--       6-10  min             158      19h23   <- continuam gerando (estouram os 5 por marcacao)
--      11-30  min             222      67h58
--      31-60  min             108      84h46
--        >60  min             146     290h52
--
--    Total hoje: 485h11. Com a tolerancia: 466h47 (deixa de pagar 18h24, ~4%).
--    A folha NAO e recalculada por esta migration — o efeito aparece na proxima geracao,
--    sincronizacao ou auto-correcao de cada folha.
-- ============================================================================
