-- ============================================================================
-- Indices para a Cobertura de Ponto parar de estourar o statement_timeout (08/09/2026)
-- ============================================================================
--
-- SINTOMA RELATADO: perfil de RH abre /marcacoes > "Cobertura de Ponto" e recebe
-- "canceling statement due to statement timeout", com "Nenhum relogio de ponto no seu escopo"
-- logo abaixo. A segunda mensagem e CONSEQUENCIA da primeira (a consulta morreu, a lista veio
-- vazia) e e conselho errado: o escopo do RH esta correto.
--
-- MEDIDO EM PRODUCAO EM 08/09/2026 (service_role, cache quente):
--   fn_cobertura_ponto_resumo (31 relogios) ....... 4,6s a 6,6s por execucao
--   duas execucoes em paralelo .................... 5,7s e 6,6s
--   fn_cobertura_ponto_dispositivo, cache frio .... 8,0s SO no REP-iDClass-HMM-04
-- O statement_timeout do papel 'authenticated' e de 8s. Ou seja: a consulta ja vivia no fio da
-- navalha para TODO MUNDO - quem passa, passa por pouco. Nao ha nada no escopo do RH que a torne
-- mais cara: RH Geral tem acesso_todas_unidades = true e ve os mesmos 31 relogios do
-- Administrador Geral; RH da Unidade ve 3 (HMI) ou 5 (HMM), que sao justamente os mais pesados.
-- O que empurra por cima do limite e a contencao entre execucoes simultaneas.
--
-- ONDE ESTA O CUSTO: fn_cobertura_ponto_dispositivo materializa uma linha por PESSOA de cada
-- relogio (615 no HMM, 508 no HMI, ~5.200 pares pessoa/relogio no parque) e, para cada linha,
-- faz quatro buscas correlacionadas. Nenhuma tinha indice pelo caminho que realmente usa:
--
--   busca da funcao                                    indice que existia
--   -------------------------------------------------  ----------------------------------------
--   rep_usuarios_dispositivo por (dispositivo, SERVIDOR)  so (dispositivo, identificador_afd)
--   rep_vinculos_servidor    por (dispositivo, SERVIDOR)  so (dispositivo, identificador_afd)
--   rep_cadastros_fila       por (dispositivo, servidor)  so o parcial WHERE status = 'pendente'
--   rep_afd_registros        por (dispositivo, ident.)    so (identificador_afd)
--
-- Medido: ~1,1 ms por par pessoa/relogio, praticamente todo ele nessas quatro buscas - tabelas de
-- 5 a 7 mil linhas varridas inteiras uma vez POR PESSOA, e 3,17 MILHOES de linhas em
-- rep_afd_registros filtradas por um indice que nao conhece nem o dispositivo nem a data.
--
-- NENHUMA FUNCAO E TOCADA AQUI (armadilha 1): so indices. A semantica nao muda, os numeros
-- exibidos sao exatamente os mesmos, e reverter e um DROP INDEX.
--
-- IDEMPOTENTE: CREATE INDEX IF NOT EXISTS em todos.
--
-- ATENCAO AO APLICAR: o indice de rep_afd_registros e criado sobre 3,17 milhoes de linhas e pega
-- ACCESS EXCLUSIVE na tabela por alguns segundos (sem CONCURRENTLY, que nao roda dentro de bloco
-- de transacao - e o editor SQL do Studio abre um). E seguro: lote do coletor que caia nessa
-- janela volta para a fila offline e e reenviado no ciclo seguinte, sem perda, porque o AFD
-- permanece no equipamento. Ainda assim, prefira aplicar fora do pico de batida.


-- ============================================================================
-- 1. rep_usuarios_dispositivo: o snapshot e casado por SERVIDOR, nao por identificador
-- ============================================================================
-- O LATERAL principal da funcao (quem esta no relogio) e o EXISTS de coberto_em (quem bate em
-- OUTRO relogio da mesma unidade) buscam por servidor_id. O unico indice era
-- uq_usuario_dispositivo (dispositivo_id, identificador_afd), que nao serve para nenhum dos dois.
-- tem_biometria entra porque o LATERAL ordena por ela e o EXISTS de coberto_em a exige.

CREATE INDEX IF NOT EXISTS idx_usuario_dispositivo_servidor
    ON public.rep_usuarios_dispositivo (dispositivo_id, servidor_id, tem_biometria);

CREATE INDEX IF NOT EXISTS idx_usuario_dispositivo_servidor_bio
    ON public.rep_usuarios_dispositivo (servidor_id)
    WHERE tem_biometria;


-- ============================================================================
-- 2. rep_vinculos_servidor: vinculo VIGENTE por (dispositivo, servidor)
-- ============================================================================
-- idx_vinculo_servidor (servidor_id) existe e ajuda pela metade; idx_vinculo_resolucao e
-- uq_vinculo_vigente sao por identificador_afd, que nao e o caminho usado aqui.

CREATE INDEX IF NOT EXISTS idx_vinculo_dispositivo_servidor_vigente
    ON public.rep_vinculos_servidor (dispositivo_id, servidor_id, tem_biometria)
    WHERE vigente_ate IS NULL;


-- ============================================================================
-- 3. rep_cadastros_fila: as colunas fila_status/fila_erro leem QUALQUER status
-- ============================================================================
-- uq_cadastro_fila_pendente cobre so WHERE status = 'pendente'; o LATERAL da tela ordena
-- "pendente primeiro, depois o mais recente" sobre todo o historico do par - e esse historico e
-- grande de proposito (7.628 linhas em 08/09/2026, com o mesmo par repetido dezenas de vezes).

CREATE INDEX IF NOT EXISTS idx_cadastro_fila_dispositivo_servidor
    ON public.rep_cadastros_fila (dispositivo_id, servidor_id, created_at DESC);


-- ============================================================================
-- 4. rep_afd_registros: batidas perdidas dos ultimos 30 dias, POR DISPOSITIVO
-- ============================================================================
-- idx_afd_identificador (identificador_afd) WHERE tipo_registro = '3' traz todas as batidas
-- daquela pessoa em TODOS os relogios e em TODO o historico (a base tem AFD desde 2019) para so
-- entao filtrar dispositivo e a janela de 30 dias - uma vez por pessoa, por relogio.
-- Este indice responde a pergunta inteira, e a data ordenada corta a janela no proprio indice.
-- NAO substitui o antigo: fn_reparse_afd_dispositivo e as sondas de auditoria buscam por
-- identificador SEM dispositivo, e continuam precisando dele.

CREATE INDEX IF NOT EXISTS idx_afd_marcacao_por_dispositivo
    ON public.rep_afd_registros (dispositivo_id, identificador_afd, ocorrido_em DESC)
    WHERE tipo_registro = '3';


-- ============================================================================
-- 5. VERIFICACAO - aborta se algum indice nao existir ao fim da migration
-- ============================================================================
-- CREATE INDEX IF NOT EXISTS emite NOTICE e segue quando ja existe algo com aquele NOME, mesmo
-- que a definicao seja outra - o mesmo modo de falha silencioso do REVOKE da armadilha 24.

DO $verifica$
DECLARE
    v_faltando text;
BEGIN
    SELECT string_agg(i.nome, ', ')
      INTO v_faltando
      FROM (VALUES
            ('idx_usuario_dispositivo_servidor'),
            ('idx_usuario_dispositivo_servidor_bio'),
            ('idx_vinculo_dispositivo_servidor_vigente'),
            ('idx_cadastro_fila_dispositivo_servidor'),
            ('idx_afd_marcacao_por_dispositivo')
           ) AS i(nome)
     WHERE NOT EXISTS (
            SELECT 1 FROM pg_indexes p
             WHERE p.schemaname = 'public' AND p.indexname = i.nome
           );

    IF v_faltando IS NOT NULL THEN
        RAISE EXCEPTION 'Indices nao criados: %. Banco: %, usuario: %.',
            v_faltando, current_database(), current_user;
    END IF;

    RAISE NOTICE 'Cobertura de Ponto: 5 indices no lugar.';
END
$verifica$;


-- ============================================================================
-- CONFERENCIA (rodar a mao depois de aplicar)
-- ============================================================================
-- 1) O tempo caiu? Antes: 4,6s a 6,6s no parque inteiro.
--    EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM public.fn_cobertura_ponto_resumo(9, 2026);
--
-- 2) Os numeros continuam os MESMOS? Indice nao pode mudar resultado - se mudou, e outra coisa.
--    SELECT dispositivo_nome, total_pessoas, nao_conseguem_bater, batidas_perdidas
--      FROM public.fn_cobertura_ponto_resumo(9, 2026) ORDER BY dispositivo_nome;
--
-- 3) Os indices estao sendo usados de fato (idx_scan > 0 depois de algumas aberturas da tela):
--    SELECT relname, indexrelname, idx_scan
--      FROM pg_stat_user_indexes
--     WHERE indexrelname IN ('idx_usuario_dispositivo_servidor',
--                            'idx_usuario_dispositivo_servidor_bio',
--                            'idx_vinculo_dispositivo_servidor_vigente',
--                            'idx_cadastro_fila_dispositivo_servidor',
--                            'idx_afd_marcacao_por_dispositivo');
