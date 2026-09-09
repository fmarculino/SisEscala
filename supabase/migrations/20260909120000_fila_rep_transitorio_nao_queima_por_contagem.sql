-- ============================================================================
-- Falha transitoria deixa de queimar o cadastro por CONTAGEM de tentativas (09/09/2026)
--
-- Terceira e ultima peca da correcao do HMM-04. As outras duas:
--   - coletor v0.17.0: ehFalhaDeTransporte reconhece o erro pela ESTRUTURA (errors.As sobre
--     *net.OpError / *url.Error), nao pelo idioma da mensagem do Windows - antes o `connectex`
--     nao casava com marca nenhuma e TODA queda de rede virava recusa definitiva;
--   - 20260909110000: falha de transporte JA GRAVADA deixa de reprovar o reenfileiramento.
--
-- 🚨 SEM ESTA AQUI, AS OUTRAS DUAS NAO RESOLVEM O CASO. fn_confirmar_cadastro_rep tinha
--
--     c_max_tentativas constant integer := 5;
--     IF NOT p_transitorio OR v_tentativas + 1 >= c_max_tentativas THEN  -> 'falhou'
--
-- e a espera entre tentativas e' de 5 min * (tentativas + 1): 10 + 15 + 20 + 25 = ~70 minutos.
-- Ou seja: um relogio sem responder por mais de ~1h10 queimava o cadastro DO MESMO JEITO, mesmo
-- com o coletor classificando corretamente a falha como transitoria. O HMM-04 ficou ~2h fora do
-- ar em 08/09/2026 - os mesmos 301 cadastros teriam sido perdidos.
--
-- ⚠️ O teto existe pelo motivo certo e NAO pode simplesmente sair: um relogio removido da unidade
-- deixaria itens em 'pendente' para sempre, invisiveis na tela de erro. O que estava errado era a
-- GRANDEZA medida. Contagem de tentativas nao diz nada sobre o equipamento: cinco tentativas sao
-- 70 minutos de blecaute, uma tarde de manutencao de rede ou um fim de semana com a maquina
-- desligada - todos indistinguiveis de "este relogio nao existe mais".
--
-- O criterio passa a ser TEMPO NA FILA (7 dias). Enquanto o item e novo, insista: falta de
-- energia, troca de switch, maquina desligada de sexta a segunda - o equipamento volta e o
-- cadastro entra sozinho. Passada uma semana sem nunca conseguir, ai sim vira 'falhou' e aparece
-- para uma pessoa, que e o comportamento que o teto original queria.
--
-- E a espera entre tentativas ganha teto de 60 min: sem ele, um item com 20 tentativas esperaria
-- 1h45 entre uma e outra, e o relogio poderia voltar sem ninguem tentar durante horas.
--
-- ⚠️ Isto NAO afrouxa nada do lado da recusa. `p_transitorio = false` (o equipamento respondeu e
-- recusou: "PIS ja cadastrado", "Matricula ja cadastrada", "nenhum formato de add_users.fcgi
-- funcionou") continua indo direto para 'falhou' no primeiro erro, como sempre foi - insistir
-- contra uma recusa repete o mesmo erro a cada 5 minutos e consome a vaga de quem e novo, no teto
-- de 20 cadastros por ciclo.
--
-- ⚠️ ESTE ARQUIVO E' GERADO. Nao edite a mao: rode
--     node scratchpad/gen_transitorio_por_tempo.js
-- O gerador copia a funcao da migration VIGENTE (20260830130000) e aborta se qualquer
-- substituicao nao bater na contagem. Ele confere, em particular, que o guard de dono da fila
-- (item 10 da auditoria, 30/08/2026) sobreviveu a copia - armadilha 1.
--
-- Assinatura inalterada: CREATE OR REPLACE puro, sem DROP e sem risco de PGRST203 (armadilha 41).
-- ============================================================================


CREATE OR REPLACE FUNCTION public.fn_confirmar_cadastro_rep(
    p_fila_id        uuid,
    p_sucesso        boolean,
    p_device_user_id bigint DEFAULT NULL,
    p_erro           text DEFAULT NULL,
    -- O identificador que o EQUIPAMENTO reportou depois de criar o usuario, lido de volta por
    -- relistagem. NULL cai no calculo antigo a partir do CPF, que continua correto para os
    -- relogios cadastrados por CPF.
    p_identificador_afd text DEFAULT NULL,
    -- true = nao consegui FALAR com o relogio (rede, timeout, equipamento desligado). false =
    -- o relogio respondeu e RECUSOU. Sao dois problemas diferentes e tem destinos diferentes.
    p_transitorio    boolean DEFAULT false,
    -- O dispositivo que a rota AUTENTICOU por HMAC. Ver o guard no corpo.
    p_dispositivo_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_dispositivo_id uuid;
    v_servidor_id    uuid;
    v_tentativas     integer;
    v_ident          text;
    v_criado_em      timestamptz;
    -- Teto para falha transitoria. Ele existe pelo motivo certo (relogio REMOVIDO da unidade
    -- nao pode deixar item em 'pendente' para sempre, invisivel na tela de erro), mas contar
    -- TENTATIVAS mede a coisa errada: com a espera crescente de 5 min, cinco tentativas sao
    -- ~70 minutos. Um relogio sem energia por uma tarde, um fim de semana ou uma troca de
    -- switch queimava o cadastro do mesmo jeito - e depois de 'falhou' a pessoa ainda ficava
    -- ate 30 dias fora por fn_cadastro_rep_reprovado.
    --
    -- Medido no HMM em 08/09/2026: o REP-iDClass-HMM-04 ficou ~2h sem responder e 301 cadastros
    -- foram queimados. Com o coletor v0.17.0 corrigido (que passa a marcar isso como
    -- transitorio) o teto de 5 tentativas AINDA teria queimado os mesmos 301.
    --
    -- O criterio certo e TEMPO NA FILA: enquanto o item e novo, insista - equipamento volta.
    -- Passada uma semana sem nunca conseguir, ai sim e sinal de que aquele relogio nao volta
    -- sozinho, e o caso precisa aparecer para uma pessoa.
    c_max_dias_transitorio constant integer := 7;
    -- Teto da espera entre tentativas: sem ele, item antigo esperaria horas entre retentativas
    -- e o relogio poderia voltar sem ninguem tentar.
    c_espera_maxima constant interval := interval '60 minutes';
BEGIN
    SELECT dispositivo_id, servidor_id, tentativas, created_at
      INTO v_dispositivo_id, v_servidor_id, v_tentativas, v_criado_em
      FROM public.rep_cadastros_fila WHERE id = p_fila_id AND status = 'pendente';

    IF v_dispositivo_id IS NULL THEN
        RETURN; -- ja processado ou id invalido - idempotente, sem erro (reenvio seguro)
    END IF;

    -- ⚠️ ITEM 10 DA AUDITORIA (30/08/2026): a fila pertence a ESTE dispositivo?
    -- O device ja se autenticou por HMAC quando chegou aqui, mas ate 30/08/2026 o `fila_id` nao
    -- era conferido contra ele: um relogio legitimo podia confirmar item da fila de OUTRO,
    -- criando vinculo de servidor no equipamento errado. Silencioso dos dois lados.
    -- NULL = chamador antigo, que nao passa o parametro (ver gen_fila_dono.js) — segue sem checar.
    IF p_dispositivo_id IS NOT NULL AND v_dispositivo_id IS DISTINCT FROM p_dispositivo_id THEN
        RAISE EXCEPTION 'Item de fila % nao pertence ao dispositivo autenticado.', p_fila_id
            USING ERRCODE = '42501';
    END IF;

    IF NOT p_sucesso THEN
        -- RECUSA do equipamento (ou item velho demais na fila) e' definitiva: insistir a cada
        -- ciclo repetiria o mesmo erro contra o relogio e encheria o log. Vai para 'falhou', que
        -- e' visivel na tela de Cobertura da Escala (coluna fila_erro).
        IF NOT p_transitorio
           OR COALESCE(v_criado_em, now()) < now() - (c_max_dias_transitorio * interval '1 day') THEN
            UPDATE public.rep_cadastros_fila
               SET status = 'falhou', erro = p_erro, tentativas = tentativas + 1,
                   processado_em = now(), proxima_tentativa_em = NULL
             WHERE id = p_fila_id;
            RETURN;
        END IF;

        -- Falha de TRANSPORTE: o cadastro daquela pessoa nao pode ser queimado porque o relogio
        -- estava desligado no minuto do ciclo. Continua 'pendente', com espera crescente.
        -- Antes desta migration TODA falha era terminal, e o ciclo automatico transformaria um
        -- blecaute de 1 minuto em servidor que nunca consegue bater ponto, sem alarme nenhum.
        UPDATE public.rep_cadastros_fila
           SET erro = p_erro,
               tentativas = tentativas + 1,
               proxima_tentativa_em = now()
                 + LEAST(interval '5 minutes' * (tentativas + 1), c_espera_maxima)
         WHERE id = p_fila_id;
        RETURN;
    END IF;

    UPDATE public.rep_cadastros_fila
       SET status = 'enviado', device_user_id = p_device_user_id, processado_em = now(),
           proxima_tentativa_em = NULL
     WHERE id = p_fila_id;

    -- Fecha qualquer vinculo vigente anterior deste servidor neste dispositivo antes de abrir um
    -- novo - mesma disciplina de vigencia que ja protege o sentido AFD->servidor (comentario na
    -- criacao de rep_vinculos_servidor: sem isso, uma correcao faria batida antiga resolver
    -- errado retroativamente).
    UPDATE public.rep_vinculos_servidor
       SET vigente_ate = now()
     WHERE dispositivo_id = v_dispositivo_id AND servidor_id = v_servidor_id AND vigente_ate IS NULL;

    -- O identificador do vinculo e' o que o EQUIPAMENTO reportou, nao o que o CPF produziria.
    -- Isso e' o conserto do modo de falha silencioso descoberto em 17/08/2026 na SMS: naquele
    -- relogio (cadastrado por PIS pelo sistema anterior) o calculo por CPF criaria um vinculo com
    -- identificador que NUNCA casa com as linhas do AFD - e nada reclamaria, as batidas so
    -- continuariam orfas. Se um modelo de relogio guardar o cadastro sob outro numero que o que
    -- mandamos, e' ele quem esta certo: e' o numero dele que aparece na marcacao.
    --
    -- Normaliza para as 12 posicoes do AFD sem nunca cortar digito pela esquerda (armadilha 10):
    -- pega os digitos, mantem os 12 ultimos e completa com zero a esquerda.
    v_ident := NULLIF(regexp_replace(COALESCE(p_identificador_afd, ''), '\D', '', 'g'), '');
    IF v_ident IS NOT NULL THEN
        v_ident := lpad(right(v_ident, 12), 12, '0');
    END IF;

    INSERT INTO public.rep_vinculos_servidor
           (dispositivo_id, identificador_afd, matricula_device, nome_device, servidor_id, device_user_id, tem_biometria)
    SELECT v_dispositivo_id,
           COALESCE(v_ident, lpad(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 12, '0')),
           s.matricula, s.nome, s.id, p_device_user_id, false
      FROM public.servidores s WHERE s.id = v_servidor_id;
END;
$fn$;

-- Assinatura inalterada, entao CREATE OR REPLACE preserva os privilegios. Reafirmados mesmo assim:
-- em migration de funcao, o que vale e o que esta escrito aqui (armadilha 24). Esta funcao e'
-- chamada por rota de MAQUINA (o coletor, autenticado por HMAC em /api/rep/v1/pendencias), entao
-- so service_role.
REVOKE EXECUTE ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean, uuid) TO service_role;


-- ============================================================================
-- CONFERENCIA - EXECUTA a funcao contra um cenario sintetico e desfaz o que criou (armadilha 42:
-- conferir que a funcao EXISTE nao serve; a versao quebrada de fn_avisos_ponto_pendentes existia).
-- Aborta a transacao inteira se qualquer sentido falhar.
-- ============================================================================
DO $conf$
DECLARE
    v_disp    uuid;
    v_serv    uuid;
    v_fila    uuid;
    v_status  text;
    v_tent    integer;
    v_prox    timestamptz;
BEGIN
    SELECT id INTO v_disp FROM public.dispositivos_rep ORDER BY created_at LIMIT 1;
    SELECT id INTO v_serv FROM public.servidores      ORDER BY created_at LIMIT 1;
    IF v_disp IS NULL OR v_serv IS NULL THEN
        RAISE NOTICE 'fn_confirmar_cadastro_rep: sem dispositivo/servidor para o ensaio - conferencia pulada.';
        RETURN;
    END IF;

    -- (A) Falha TRANSITORIA em item NOVO com muitas tentativas: tem que continuar 'pendente'.
    -- E' exatamente o caso do HMM-04, onde o teto antigo de 5 tentativas queimava o cadastro.
    INSERT INTO public.rep_cadastros_fila (dispositivo_id, servidor_id, status, tentativas, created_at)
         VALUES (v_disp, v_serv, 'pendente', 12, now() - interval '2 hours')
      RETURNING id INTO v_fila;
    PERFORM public.fn_confirmar_cadastro_rep(
        v_fila, false, NULL,
        'Post "https://10.110.4.19:443/login.fcgi": dial tcp: connectex: A connection attempt failed',
        '', true, v_disp);
    SELECT status, tentativas, proxima_tentativa_em INTO v_status, v_tent, v_prox
      FROM public.rep_cadastros_fila WHERE id = v_fila;
    IF v_status IS DISTINCT FROM 'pendente' THEN
        RAISE EXCEPTION 'ABORTADO: falha transitoria em item novo virou "%" - o teto de contagem continua queimando cadastro.', v_status;
    END IF;
    IF v_tent IS DISTINCT FROM 13 THEN
        RAISE EXCEPTION 'ABORTADO: contador de tentativas nao avancou (%).', v_tent;
    END IF;
    -- (A2) A espera tem teto: 13 tentativas nao podem virar horas de silencio.
    IF v_prox IS NULL OR v_prox > now() + interval '61 minutes' THEN
        RAISE EXCEPTION 'ABORTADO: proxima tentativa em % - o teto de espera nao foi aplicado.', v_prox;
    END IF;

    -- (B) Falha TRANSITORIA em item VELHO (na fila ha mais de 7 dias): tem que virar 'falhou',
    -- senao relogio removido da unidade fica pendente para sempre e ninguem ve.
    UPDATE public.rep_cadastros_fila
       SET status = 'pendente', created_at = now() - interval '30 days', proxima_tentativa_em = NULL
     WHERE id = v_fila;
    PERFORM public.fn_confirmar_cadastro_rep(v_fila, false, NULL, 'dial tcp: connectex: timeout', '', true, v_disp);
    SELECT status INTO v_status FROM public.rep_cadastros_fila WHERE id = v_fila;
    IF v_status IS DISTINCT FROM 'falhou' THEN
        RAISE EXCEPTION 'ABORTADO: item transitorio com 30 dias de fila ficou "%" - o teto de tempo nao existe.', v_status;
    END IF;

    -- (C) RECUSA do equipamento: continua definitiva no PRIMEIRO erro. Afrouxar aqui recria o
    -- laco que 20260905110000 fechou - entrada condenada consumindo a vaga de quem e novo.
    UPDATE public.rep_cadastros_fila
       SET status = 'pendente', tentativas = 0, created_at = now(), proxima_tentativa_em = NULL
     WHERE id = v_fila;
    PERFORM public.fn_confirmar_cadastro_rep(
        v_fila, false, NULL, 'add_users.fcgi recusou (formato users:[{pis}]): PIS ja cadastrado: 1', '', false, v_disp);
    SELECT status INTO v_status FROM public.rep_cadastros_fila WHERE id = v_fila;
    IF v_status IS DISTINCT FROM 'falhou' THEN
        RAISE EXCEPTION 'ABORTADO: recusa do equipamento ficou "%" em vez de falhou.', v_status;
    END IF;

    -- (D) O guard de dono da fila (item 10 da auditoria, 30/08/2026) sobreviveu a copia?
    UPDATE public.rep_cadastros_fila SET status = 'pendente' WHERE id = v_fila;
    BEGIN
        PERFORM public.fn_confirmar_cadastro_rep(
            v_fila, true, NULL, '', '', false,
            '00000000-0000-0000-0000-000000000000'::uuid);
        RAISE EXCEPTION 'ABORTADO: item confirmado por dispositivo que nao e o dono - o guard se perdeu.';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL; -- esperado
    END;

    DELETE FROM public.rep_cadastros_fila WHERE id = v_fila;
    RAISE NOTICE 'fn_confirmar_cadastro_rep: conferencia ok (transitorio novo persiste, transitorio velho falha, recusa e definitiva, guard de dono intacto).';
END
$conf$;


-- ============================================================================
-- CONFERENCIA MANUAL (rodar depois de aplicar)
-- ============================================================================
-- 1. Itens esperando retentativa (nenhum deve ter espera acima de 1h):
--
--    SELECT d.nome, count(*) AS pendentes,
--           count(*) FILTER (WHERE f.proxima_tentativa_em > now()) AS esperando,
--           max(f.proxima_tentativa_em - now())                    AS maior_espera
--      FROM public.rep_cadastros_fila f
--      JOIN public.dispositivos_rep d ON d.id = f.dispositivo_id
--     WHERE f.status = 'pendente'
--     GROUP BY d.nome ORDER BY 2 DESC;
--
-- 2. Depois do proximo blecaute de relogio, nenhuma falha de rede NOVA deve aparecer:
--
--    SELECT d.nome, count(*)
--      FROM public.rep_cadastros_fila f
--      JOIN public.dispositivos_rep d ON d.id = f.dispositivo_id
--     WHERE f.status = 'falhou'
--       AND public.fn_falha_rep_de_transporte(f.erro)
--       AND COALESCE(f.processado_em, f.created_at) > now() - interval '1 day'
--     GROUP BY d.nome;
