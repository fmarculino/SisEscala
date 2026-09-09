-- ============================================================================
-- Falha de TRANSPORTE nao reprova o cadastro (09/09/2026)
--
-- SINTOMA: o REP-iDClass-HMM-04 nao alcanca a mesma cobertura dos irmaos HMM-01/02/03, que
-- atendem os MESMOS 160 setores, estao na MESMA maquina (RH04, 10.110.4.123) e recebem o mesmo
-- enfileiramento diario. A tela mostrava 287 escalados "fora do relogio" no 04 contra 10 no 01,
-- e clicar em "Sincronizar cadastros" nao mudava nada - para sempre.
--
-- CAUSA: em 08/09/2026, das 06h as 08h UTC (03h as 05h locais), SO o HMM-04 (10.110.4.19) ficou
-- sem responder. O coletor tentou gravar os cadastros nessa janela e levou 301 erros de conexao.
-- Todos foram gravados como status 'falhou', que e DEFINITIVO - e desde 20260905110000 a fila
-- respeita isso e nao reenfileira quem falhou.
--
-- O coletor JA distingue as duas coisas (`transitorio` devolve o item para 'pendente'), mas
-- ciclo.ehFalhaDeTransporte reconhecia transporte por trecho de TEXTO:
--
--     "timeout", "deadline exceeded", "connection refused", "no such host",
--     "network is unreachable", "connection reset", "i/o timeout", "eof", "tls"
--
-- e a mensagem real do Windows nao casa com nenhuma delas:
--
--     Post "https://10.110.4.19:443/login.fcgi": dial tcp 10.110.4.19:443: connectex:
--     A connection attempt failed because the connected party did not properly respond
--     after a period of time, or established connection failed because connected host
--     has failed to respond.
--
-- Como o coletor SO roda no Windows, na pratica TODA queda de rede queimava o cadastro da pessoa.
--
-- MEDIDO EM PRODUCAO EM 09/09/2026, chamando fn_cadastro_rep_reprovado par a par (armadilha:
-- MEDIR EXECUTANDO, NUNCA ESTIMANDO):
--
--     553 pares (dispositivo, servidor) com alguma falha
--     324 reprovados hoje
--     290 deles por falha de TRANSPORTE   <- o defeito (275 no HMM-04, 5 em cada irmao)
--      34 recusa legitima do equipamento  <- CONTINUAM reprovados, e devem continuar
--
-- E as 387 falhas de rede da fila inteira do parque tem so tres formas, todas inequivocas:
--
--     368  connectex: A connection attempt failed because the connected party...
--      18  connectex: No connection could be made because the target machine actively refused it
--       1  wsarecv: An existing connection was forcibly closed by the remote host
--
-- Nenhuma delas contem "recusou", que e a marca das mensagens que o proprio equipamento devolveu.
--
-- A CORRECAO E' DUPLA, e as duas metades ficam:
--   (a) coletor v0.17.0: ehFalhaDeTransporte passa a reconhecer o erro pela ESTRUTURA (errors.As
--       sobre *net.OpError / net.Error), nao pelo idioma da mensagem do sistema operacional;
--   (b) esta migration: o banco deixa de reprovar por falha de transporte JA GRAVADA. Sem ela,
--       os 290 continuariam presos mesmo com o coletor novo - e ha coletor antigo em campo, cuja
--       atualizacao automatica tem atraso sorteado de ate 4h e depende da maquina estar ligada.
--
-- ⚠️ Isto NAO afrouxa a trava de 20260905110000. Recusa do equipamento ("PIS ja cadastrado",
-- "Matricula ja cadastrada", "nenhum formato de add_users.fcgi funcionou") continua sendo
-- definitiva: entrada condenada nao pode consumir a vaga de quem e novo, no teto de 20 cadastros
-- por ciclo. A conferencia abaixo confere OS DOIS SENTIDOS e aborta se qualquer um quebrar.
--
-- ⚠️ ESTE ARQUIVO E' GERADO. Nao edite a mao: rode
--     node scratchpad/gen_falha_transporte.js
-- O gerador copia a funcao da migration VIGENTE (20260907100000) e aborta se qualquer
-- substituicao nao bater na contagem.
--
-- Assinatura inalterada: CREATE OR REPLACE puro, sem DROP e sem risco de PGRST203 (armadilha 41).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- fn_falha_rep_de_transporte: fonte unica do criterio, para a funcao e para a conferencia
-- usarem a MESMA regra. Se as duas divergissem, a conferencia nao valeria nada (armadilha 34).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_falha_rep_de_transporte(p_erro text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $tr$
    SELECT p_erro IS NOT NULL
       -- "recusou" e a marca das mensagens que o EQUIPAMENTO devolveu (aplicarCadastro, em
       -- rep/client.go). Vem primeiro de proposito: na duvida, NAO e transporte - o erro na
       -- direcao contraria (achar que uma recusa e transitoria) faz o ciclo automatico bater no
       -- mesmo erro a cada 5 minutos, para sempre.
       AND p_erro NOT ILIKE '%recusou%'
       AND (
             -- Assinatura de *url.Error do Go: o http.Client nao chegou a ter resposta. Cobre as
             -- tres formas medidas em producao e as que ainda nao apareceram.
             p_erro LIKE 'Post "http%'
          OR p_erro LIKE 'Get "http%'
             -- Marcas genericas, para o caso de a mensagem chegar embrulhada de outro jeito.
          OR p_erro ILIKE '%connectex%'
          OR p_erro ILIKE '%dial tcp%'
          OR p_erro ILIKE '%read tcp%'
          OR p_erro ILIKE '%wsarecv%'
          OR p_erro ILIKE '%wsasend%'
          OR p_erro ILIKE '%i/o timeout%'
          OR p_erro ILIKE '%deadline exceeded%'
          OR p_erro ILIKE '%client.timeout%'
          OR p_erro ILIKE '%connection reset%'
          OR p_erro ILIKE '%connection refused%'
          OR p_erro ILIKE '%no such host%'
          OR p_erro ILIKE '%network is unreachable%'
       );
$tr$;

REVOKE EXECUTE ON FUNCTION public.fn_falha_rep_de_transporte(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_falha_rep_de_transporte(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_falha_rep_de_transporte(text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_cadastro_rep_reprovado(
    p_dispositivo_id uuid,
    p_servidor_id    uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT EXISTS (
        SELECT 1
          FROM public.rep_cadastros_fila f
          JOIN public.servidores s ON s.id = f.servidor_id
         WHERE f.dispositivo_id = p_dispositivo_id
           AND f.servidor_id    = p_servidor_id
           AND f.status = 'falhou'
           -- Teto de 30 dias: quem pode ter mudado e o OUTRO lado (firmware, coletor novo com
           -- outro formato de add_users.fcgi). Sem ele, um equipamento consertado nunca voltaria
           -- a receber essas pessoas sem alguem editar cada cadastro na mao.
           AND COALESCE(f.processado_em, f.created_at) > now() - interval '30 days'
           -- O criterio principal: a falha e' mais nova que a ultima alteracao do cadastro, ou
           -- seja NADA mudou do nosso lado desde que o relogio recusou. Corrigir o CPF/PIS da
           -- pessoa move updated_at e libera a retentativa imediatamente.
           AND COALESCE(f.processado_em, f.created_at) >= COALESCE(s.updated_at, '-infinity'::timestamptz)
           -- (1) Falha SUPERADA nao e a ultima palavra. O EXISTS original olhava so as linhas
           -- 'falhou' e ignorava um 'enviado' POSTERIOR do mesmo par - entao quem falhou algumas
           -- vezes e depois ENTROU no relogio ficava marcado como recusado por ate 30 dias.
           -- Inerte enquanto a pessoa esta no equipamento; morde quando o cadastro precisa ser
           -- refeito (troca de aparelho, higiene, vinculo encerrado). Caso real: CAF-02, 07/09.
           AND NOT EXISTS (
                 SELECT 1
                   FROM public.rep_cadastros_fila f2
                  WHERE f2.dispositivo_id = f.dispositivo_id
                    AND f2.servidor_id    = f.servidor_id
                    AND f2.status = 'enviado'
                    AND COALESCE(f2.processado_em, f2.created_at)
                      > COALESCE(f.processado_em, f.created_at))
           -- (2) Recusa de um equipamento SUBSTITUIDO nao vale para o que esta no lugar dele. E
           -- o caso extremo do que o teto de 30 dias ja admitia ("quem mudou foi o outro lado"):
           -- aqui o outro lado e outro aparelho fisico. Sem isso, toda troca de relogio herda a
           -- lista de recusados do anterior, e ninguem ve - fn_registrar_substituicao_dispositivo
           -- nao toca na fila de proposito (nao deve escrever em tabela de outro assunto).
           AND COALESCE(f.processado_em, f.created_at) >= COALESCE(
                 (SELECT MAX(sb.created_at)
                    FROM public.dispositivos_rep_substituicoes sb
                   WHERE sb.dispositivo_id = f.dispositivo_id),
                 '-infinity'::timestamptz)
           -- (3) Falha de TRANSPORTE nao e recusa. O coletor so devolve `transitorio` para o
           -- que ele RECONHECE como transporte (ciclo.ehFalhaDeTransporte), e ate a v0.17.0 a
           -- lista de marcas nao cobria o erro mais comum que existe em campo: o `connectex`
           -- do Windows, que e o unico SO onde o coletor roda. Consequencia medida no HMM em
           -- 08/09/2026: o relogio HMM-04 ficou sem responder das 03h as 05h, 301 cadastros
           -- foram gravados como `falhou`, e 277 pessoas ficaram permanentemente fora daquele
           -- equipamento - o cron enfileira, esta funcao descarta, e ninguem ve.
           --
           -- Esta clausula fecha isso pelo lado do banco, e por isso NAO sai quando o coletor
           -- for corrigido: ha coletor antigo instalado em campo (a atualizacao e automatica
           -- mas tem atraso sorteado de ate 4h e depende da maquina estar ligada), e a fila ja
           -- carrega 387 falhas gravadas por versoes que nao sabiam distinguir as duas coisas.
           AND NOT public.fn_falha_rep_de_transporte(f.erro)
    );
$fn$;

-- Assinatura inalterada, entao CREATE OR REPLACE preserva os privilegios. Reafirmados mesmo assim:
-- em migration de funcao, o que vale e o que esta escrito aqui (armadilha 24).
REVOKE EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA - EXECUTA a funcao (armadilha 42: conferir que ela EXISTE nao serve) e confere
-- OS DOIS SENTIDOS. Aborta a transacao inteira se qualquer um quebrar.
-- ============================================================================
DO $conf$
DECLARE
    v_presos_por_transporte integer;
    v_legitimos_perdidos    integer;
    v_liberados             integer;
BEGIN
    -- Sanidade do criterio, sobre as mensagens reais que existem na fila hoje. Se a funcao nova
    -- classificasse "recusou" como transporte, a trava de 20260905110000 cairia inteira.
    IF public.fn_falha_rep_de_transporte(
         'Post "https://10.110.4.19:443/login.fcgi": dial tcp 10.110.4.19:443: connectex: '
      || 'A connection attempt failed because the connected party did not properly respond.') IS NOT TRUE THEN
        RAISE EXCEPTION 'ABORTADO: o connectex do Windows nao foi reconhecido como transporte - a correcao nao faz nada.';
    END IF;
    IF public.fn_falha_rep_de_transporte('add_users.fcgi recusou (formato users:[{pis}]): PIS ja cadastrado: 123') IS NOT FALSE THEN
        RAISE EXCEPTION 'ABORTADO: recusa do equipamento classificada como transporte - a trava de 20260905110000 cairia.';
    END IF;
    IF public.fn_falha_rep_de_transporte(
         'nenhum formato de add_users.fcgi funcionou neste equipamento; tentativas: users:[{cpf}] -> '
      || 'add_users.fcgi recusou (formato users:[{cpf}]): CPF ja cadastrado') IS NOT FALSE THEN
        RAISE EXCEPTION 'ABORTADO: "nenhum formato funcionou" classificado como transporte.';
    END IF;
    IF public.fn_falha_rep_de_transporte(NULL) IS NOT FALSE THEN
        RAISE EXCEPTION 'ABORTADO: erro nulo classificado como transporte.';
    END IF;

    -- (A) O defeito: par cujas falhas sao TODAS de transporte nao pode continuar reprovado.
    SELECT count(*) INTO v_presos_por_transporte
      FROM (
        SELECT f.dispositivo_id, f.servidor_id
          FROM public.rep_cadastros_fila f
         WHERE f.status = 'falhou'
         GROUP BY f.dispositivo_id, f.servidor_id
        HAVING bool_and(public.fn_falha_rep_de_transporte(f.erro))
      ) p
     WHERE public.fn_cadastro_rep_reprovado(p.dispositivo_id, p.servidor_id);

    IF v_presos_por_transporte > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % par(es) continuam reprovados tendo SO falha de transporte.', v_presos_por_transporte;
    END IF;

    -- (B) O sentido inverso, que e o mais facil de quebrar sem perceber: uma recusa LEGITIMA e
    -- recente (nada mudou no cadastro, nenhum envio deu certo depois, aparelho nao substituido)
    -- tem que CONTINUAR reprovada. Sao 34 em producao em 09/09/2026, quase todas matricula/PIS
    -- ja ocupados no proprio equipamento por cadastro do sistema anterior - o conserto delas e
    -- achar o cadastro antigo, nao insistir na fila.
    SELECT count(*) INTO v_legitimos_perdidos
      FROM (
        SELECT f.dispositivo_id, f.servidor_id,
               max(COALESCE(f.processado_em, f.created_at))
                 FILTER (WHERE f.status = 'falhou'
                           AND NOT public.fn_falha_rep_de_transporte(f.erro)) AS ult_recusa,
               max(COALESCE(f.processado_em, f.created_at))
                 FILTER (WHERE f.status = 'enviado')                          AS ult_ok
          FROM public.rep_cadastros_fila f
         GROUP BY f.dispositivo_id, f.servidor_id
      ) p
      JOIN public.servidores s ON s.id = p.servidor_id
     WHERE p.ult_recusa IS NOT NULL
       AND (p.ult_ok IS NULL OR p.ult_ok < p.ult_recusa)
       AND p.ult_recusa > now() - interval '30 days'
       AND p.ult_recusa >= COALESCE(s.updated_at, '-infinity'::timestamptz)
       AND p.ult_recusa >= COALESCE(
             (SELECT max(sb.created_at) FROM public.dispositivos_rep_substituicoes sb
               WHERE sb.dispositivo_id = p.dispositivo_id), '-infinity'::timestamptz)
       AND NOT public.fn_cadastro_rep_reprovado(p.dispositivo_id, p.servidor_id);

    IF v_legitimos_perdidos > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % recusa(s) legitima(s) deixaram de reprovar - a funcao afrouxou demais.', v_legitimos_perdidos;
    END IF;

    SELECT count(*) INTO v_liberados
      FROM (SELECT DISTINCT dispositivo_id, servidor_id
              FROM public.rep_cadastros_fila WHERE status = 'falhou') p
     WHERE NOT public.fn_cadastro_rep_reprovado(p.dispositivo_id, p.servidor_id);

    RAISE NOTICE 'fn_cadastro_rep_reprovado: conferencia ok. % par(es) com falha nao estao reprovados.', v_liberados;
END
$conf$;


-- ============================================================================
-- CONFERENCIA MANUAL (rodar depois de aplicar)
-- ============================================================================
-- 1. Quantos continuam reprovados, por relogio (esperado: nenhum do HMM-04):
--
--    SELECT d.nome AS relogio, count(*) AS reprovados
--      FROM (SELECT DISTINCT dispositivo_id, servidor_id FROM public.rep_cadastros_fila
--             WHERE status = 'falhou') p
--      JOIN public.dispositivos_rep d ON d.id = p.dispositivo_id
--     WHERE public.fn_cadastro_rep_reprovado(p.dispositivo_id, p.servidor_id)
--     GROUP BY d.nome ORDER BY 2 DESC;
--
-- 2. Reenfileirar de fato o HMM-04 (o botao "Sincronizar cadastros" da tela faz o mesmo; o cron
--    diario tambem, mas ele so roda de madrugada). As duas RPCs, porque a por lotacao nao alcanca
--    quem esta escalado ali e lotado noutro lugar:
--
--    SELECT public.fn_enfileirar_cadastros_rep(
--             (SELECT id FROM public.dispositivos_rep WHERE nome = 'REP-iDClass-HMM-04'));
--    SELECT public.fn_enfileirar_cadastros_por_escala(
--             (SELECT id FROM public.dispositivos_rep WHERE nome = 'REP-iDClass-HMM-04'));
--
-- ⚠️ O coletor grava no maximo 20 cadastros por ciclo (5 min), entao ~280 pessoas levam cerca de
--    24 ciclos = ~2h com a maquina RH04 ligada. Nada disso anda com o coletor parado: em
--    09/09/2026 os quatro relogios do HMM estavam sem contato desde 08/09 as 19:31 locais.
