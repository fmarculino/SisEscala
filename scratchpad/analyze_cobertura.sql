-- Rodar no SQL do Supabase de PRODUCAO. Nao e DDL, nao muda dado nenhum: so recalcula as
-- estatisticas que o planner usa para escolher plano. Leva segundos e nao bloqueia leitura.
--
-- POR QUE: o REP-iDClass-HMM-04 nasceu em 07/09, 371 servidores foram criados em 24h e os cinco
-- indices sao de hoje. Quando o planner erra por estatistica velha, o mesmo SELECT alterna entre
-- ~200 ms e >8 s - que e exatamente o que a funcao de detalhe faz hoje SO nesse relogio.

ANALYZE public.rep_usuarios_dispositivo;
ANALYZE public.rep_vinculos_servidor;
ANALYZE public.rep_cadastros_fila;
ANALYZE public.rep_afd_registros;
ANALYZE public.dispositivos_rep;
ANALYZE public.servidores;
ANALYZE public.escala_mensal;
ANALYZE public.escala_diaria;

-- Depois disso, me diga: eu remeco a funcao do HMM-04 por fora e comparo.
-- Se AINDA estourar, o proximo passo e este (uma linha, reversivel, e o motivo esta no comentario):
--
--   -- forca replanejar a cada chamada em vez de reusar plano generico ruim; o custo e de
--   -- milissegundos de planejamento contra 8s de timeout.
--   ALTER FUNCTION public.fn_cobertura_ponto_dispositivo(uuid, integer, integer)
--       SET plan_cache_mode = 'force_custom_plan';
