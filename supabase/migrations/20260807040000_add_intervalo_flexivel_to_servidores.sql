-- Migration: Permite intervalo flexivel por servidor, mesmo em unidade de intervalo rigido
-- Data: 2026-08-07
--
-- CONTEXTO
--   Hoje o modo de intervalo e definido pela UNIDADE (unidades.tipo_intervalo = 'rigido'
--   ou 'flexivel'). No modo rigido, o servidor precisa sair e voltar em horarios fixos,
--   resolvidos em cascata: personalizado do servidor -> padrao da jornada -> calculo automatico.
--
--   Existem servidores que, dentro de uma unidade rigida, precisam de liberdade de horario:
--   podem sair as 11h e voltar as 13h, ou sair as 14h e voltar as 16h, desde que cumpram a
--   carga horaria liquida do dia.
--
-- ESTA COLUNA
--   servidores.intervalo_flexivel = true libera esse comportamento para o servidor especifico,
--   independentemente de a unidade estar em modo rigido.
--
--   Quando true, os campos intervalo_inicio_personalizado / intervalo_fim_personalizado deixam
--   de ser horarios obrigatorios e passam a valer apenas como referencia de DURACAO prevista
--   do intervalo (usada para calcular a hora de saida).
--
-- REGRA DE SAIDA (implementada em 20260807050000)
--   saida_esperada = fim previsto da jornada + (intervalo real - intervalo previsto)
--   Ou seja, o excedente adia a saida e o deficit antecipa, mantendo a carga liquida.
--     08h-18h, previsto 2h, sai 14h volta 17h (3h) -> saida 19h
--     08h-18h, previsto 2h, sai 12h volta 12h30 (30min) -> saida 16h30
--   Sem nenhuma marcacao de intervalo no dia, a saida permanece no horario previsto e o
--   registro e sinalizado com intervalo_nao_usufruido.

ALTER TABLE public.servidores
    ADD COLUMN IF NOT EXISTS intervalo_flexivel BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.servidores.intervalo_flexivel IS
    'Quando true, o servidor pode gozar o intervalo em qualquer horario (mesmo em unidade de intervalo rigido), desde que cumpra a carga horaria liquida. Os campos intervalo_*_personalizado passam a valer apenas como duracao prevista.';
