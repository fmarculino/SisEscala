-- Horas normais da folha deixam de contar o intervalo, e o cadastro de 3 jornadas e corrigido.
--
-- CONTEXTO — questionamento do RH em 04/09/2026
--   A folha mostrava 210h onde o RH esperava ~160h. O RH estava certo: `jornadas.horas_totais` e
--   o VAO DO RELOGIO ("08H AS 18H" = 10h), nao o tempo de trabalho, e a folha somava esse campo
--   por dia escalado. O intervalo de 2h entrava como jornada.
--
--   Medido em producao (competencia 08/2026, 415 folhas): 65.170h somadas contra 55.953h de
--   trabalho real — 9.217h de intervalo lancadas como jornada normal, 14,1% do total.
--   Nos 19 dias completos da folha citada, a servidora trabalhou em media 8h07/dia.
--
-- BASE LEGAL
--   Portaria 382/2019-GAB-MAB/SMS, Art. 3, I: "jornada de 8 (oito) horas, com intervalo de 2
--     horas" — a norma do proprio ponto eletronico separa as duas coisas na mesma frase.
--   Lei 17.331/2008 (RJU de Maraba), Art. 17: teto DIARIO de 8h para quem cumpre 40h semanais.
--   CLT, Art. 71 §2: "Os intervalos de descanso nao serao computados na duracao do trabalho."
--
-- ⚠️ VALE A PARTIR DE 09/2026 (decisao do usuario). Competencia anterior e documento ASSINADO e
--   continua somando o vao. O corte vive no codigo (COMPETENCIA_HORAS_LIQUIDAS_PADRAO, em
--   src/utils/folha/calculoDia.ts); a chave abaixo so serve para move-lo sem deploy.

INSERT INTO public.configuracoes_globais (chave, valor, descricao, created_at, updated_at)
VALUES (
    'horas_normais_liquidas_desde',
    '"2026-09"'::jsonb,
    'Competencia (YYYY-MM) a partir da qual as horas normais da folha descontam o intervalo intrajornada. Competencia anterior continua somando o vao da jornada. Ausente = 2026-09 (padrao do codigo).',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
)
ON CONFLICT (chave) DO NOTHING;

-- =========================================================================
-- CADASTRO: tres jornadas com `horas_totais` divergente do proprio nome
-- =========================================================================
-- A convencao do catalogo e `horas_totais` = VAO (23 das 26 jornadas seguem). Estas tres nao:
--
--   08H AS 17H  horas_totais=8   vao=9h  -> guardava o LIQUIDO (9 - 1h de intervalo)
--   09H AS 18H  horas_totais=12  vao=9h  -> 3h a mais por dia
--   10H AS 19H  horas_totais=12  vao=9h  -> 3h a mais por dia
--
-- 🚨 A PRIMEIRA E A MAIS PERIGOSA, e e por isso que esta migration acompanha a mudanca de codigo:
--   `08H AS 17H` guardava 8h, que por acaso E o trabalho liquido correto. Descontar o intervalo
--   de um valor que ja era liquido daria 7h/dia — a correcao pioraria o numero de 42 servidores.
--   Uniformizar o cadastro no VAO e o que torna o desconto correto para todas.
--
-- ⚠️ Nao ha UPDATE em folha nenhuma. Competencia fechada so muda se alguem REABRIR e salvar, e
--   08/2026 esta toda em "Revisada".
--
-- 🚨 EFEITO MEDIDO EM 04/09/2026, e ele importa mais agora que o RH tambem reabre folha:
--   `09H AS 18H` e `10H AS 19H` -> **0 folhas de 08/2026** usam essas jornadas. Corrigi-las nao
--     toca em nada fechado; so acerta 09/2026 em diante.
--   `08H AS 17H`  -> **32 folhas de 08/2026** (44 contando o fallback da jornada da escala). Se
--     uma delas for reaberta e salva, os dias passam de 8h para 9h.
--
--   Foi escolha consciente corrigir mesmo assim, por dois motivos: sem isso, 09/2026 contaria
--   **7h/dia** para esses servidores (descontar 1h de um valor que ja era liquido); e 9h e o que
--   deixa 08/2026 INTERNAMENTE COERENTE — naquela competencia toda jornada conta o vao
--   (`08H AS 18H` conta 10h), e essas 32 folhas eram a excecao que contava o liquido.
--
--   Preferiu-se a mudanca visivel a congelar o total das folhas antigas: total que nao acompanha
--   a edicao e defeito silencioso, e defeito silencioso e pior que numero que muda e se explica.

UPDATE public.jornadas SET horas_totais = 9, updated_at = timezone('utc'::text, now())
 WHERE nome = '08H ÀS 17H' AND horas_totais = 8;

UPDATE public.jornadas SET horas_totais = 9, updated_at = timezone('utc'::text, now())
 WHERE nome IN ('09H ÀS 18H', '10H ÀS 19H') AND horas_totais = 12;

-- =========================================================================
-- CONFERENCIA
-- =========================================================================
-- 1. As tres passaram a ter vao 9h e trabalho liquido 8h?
--    SELECT nome, horas_totais, intervalo_minutos,
--           horas_totais - intervalo_minutos/60.0 AS trabalho_liquido
--      FROM public.jornadas
--     WHERE nome IN ('08H ÀS 17H', '09H ÀS 18H', '10H ÀS 19H');
--    -> esperado: horas_totais = 9 e trabalho_liquido = 8 nas tres
--
-- 2. Nenhuma outra jornada ficou com horas_totais divergente do vao do nome? (conferencia por
--    fora, que le o nome): node scratchpad/an_horas_normais_intervalo.mjs
--
-- 3. Nenhuma folha mudou de total com a migration (ela nao toca em folha_ponto):
--    SELECT mes, ano, count(*) AS folhas, sum(total_horas_normais) AS normais
--      FROM public.folha_ponto WHERE ano = 2026 GROUP BY mes, ano ORDER BY mes;
--    -> rodar ANTES e DEPOIS: os numeros tem de ser identicos.
