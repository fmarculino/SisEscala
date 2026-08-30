-- ============================================================================
-- Fila do REP: o item confirmado tem que pertencer ao DISPOSITIVO autenticado
-- ============================================================================
-- 30/08/2026 - item 10 da auditoria de 30/08/2026.
--
-- O PROBLEMA
--   /api/rep/v1/pendencias e /api/rep/v1/remocoes autenticam o relogio por HMAC e ja tem o
--   `dispositivoId` em maos - mas NUNCA o usavam. O `fila_id` vinha do corpo da requisicao e era
--   repassado cru para a RPC, que tambem nao conferia nada: ela le o `dispositivo_id` DA LINHA da
--   fila e trabalha com ele.
--
--   Resultado: um relogio legitimo (ou alguem de posse do token de um relogio) confirmava item da
--   fila de OUTRO equipamento. No caminho do cadastro isso cria `rep_vinculos_servidor` no
--   dispositivo errado - e vinculo errado significa batida atribuida a quem nao bateu, meses
--   depois, sem nada no log. Silencioso dos dois lados.
--
--   Nao e alcancavel de fora: exige token de dispositivo valido. Por isso e media, nao critica.
--
-- ⚠️ POR QUE O PARAMETRO NOVO TEM DEFAULT NULL - e isso NAO e descuido
--   Sem default, a assinatura muda e a ordem migration/deploy passa a quebrar nos DOIS sentidos.
--   E medido que essa janela custa caro: quando a confirmacao de cadastro falha, o usuario JA FOI
--   CRIADO no relogio (ciclo.go:415 so registra um aviso), o item fica 'pendente', e no ciclo
--   seguinte o coletor tenta criar de novo -> o equipamento recusa por duplicidade
--   ('PIS ja cadastrado') -> fn_confirmar_cadastro_rep trata recusa como DEFINITIVA e o item vai
--   para 'falhou', exigindo reenfileiramento manual.
--
--   Com DEFAULT NULL, as duas ordens funcionam: o chamador antigo (que nao passa o parametro)
--   segue sem checagem, e o novo passa o dispositivo e a divergencia e RECUSADA.
--
--   ⚠️ O preco: a checagem so vale se quem chama PASSAR o parametro. Por isso existe o portao
--   scratchpad/sim_rep_fila_dono.js, que reprova rota de /api/rep/v1/ que consuma fila sem
--   repassar o dispositivo autenticado. Sem esse portao, a proxima rota esquece e ninguem ve.
--
-- COMO ESTE ARQUIVO FOI GERADO
--   scratchpad/gen_fila_dono.js - copia MECANICA das duas funcoes a partir do arquivo vigente
--   (armadilha 1), com o parametro e o guard inseridos por substituicao contada. O gerador ABORTA
--   se o corpo resultante divergir do original em qualquer coisa que nao seja o guard.
--     fn_confirmar_cadastro_rep                -> 20260817180000
--     fn_confirmar_remocao_usuario_dispositivo -> 20260812040000
--
-- 🚨 GRANTS NAO SAO HERDADOS. CREATE OR REPLACE com assinatura DIFERENTE cria um objeto NOVO, e
--   objeto novo nasce com EXECUTE para PUBLIC (armadilha 24). Os GRANT/REVOKE no fim deste arquivo
--   nao sao decorativos: sem eles, estas duas funcoes - que escrevem vinculo de servidor e apagam
--   cadastro de relogio - ficariam chamaveis por anon.
--
-- IDEMPOTENTE: DROP IF EXISTS da assinatura antiga + CREATE. Seguro rodar nos dois ambientes.
-- ============================================================================

-- A assinatura ANTIGA precisa sair: se as duas coexistirem, o PostgREST nao consegue escolher e
-- devolve PGRST203 ("could not choose the best candidate") - foi exatamente o que aconteceu com
-- fn_reparse_afd_dispositivo em 22/08/2026, quando uma sobrecarga antiga ficou viva.
DROP FUNCTION IF EXISTS public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean);
DROP FUNCTION IF EXISTS public.fn_confirmar_remocao_usuario_dispositivo(uuid, boolean, text);


-- de supabase\migrations\20260817180000_fila_cadastro_retry_e_identificador_do_device.sql
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
    -- Teto de tentativas para falha transitoria. Sem teto, um relogio removido da unidade
    -- deixaria itens em 'pendente' para sempre e ninguem olharia a tela de erro.
    c_max_tentativas constant integer := 5;
BEGIN
    SELECT dispositivo_id, servidor_id, tentativas
      INTO v_dispositivo_id, v_servidor_id, v_tentativas
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
        -- RECUSA do equipamento (ou teto de tentativas atingido) e' definitiva: insistir a cada
        -- ciclo repetiria o mesmo erro contra o relogio e encheria o log. Vai para 'falhou', que
        -- e' visivel na tela de Cobertura da Escala (coluna fila_erro).
        IF NOT p_transitorio OR v_tentativas + 1 >= c_max_tentativas THEN
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
               proxima_tentativa_em = now() + (interval '5 minutes' * (tentativas + 1))
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

-- de supabase\migrations\20260812040000_add_rep_higiene_cadastros_dispositivo.sql
CREATE OR REPLACE FUNCTION public.fn_confirmar_remocao_usuario_dispositivo(
    p_fila_id uuid,
    p_sucesso boolean,
    p_erro    text DEFAULT NULL,
    -- O dispositivo que a rota AUTENTICOU por HMAC. Ver o guard no corpo.
    p_dispositivo_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_dispositivo_id  uuid;
    v_identificador   text;
BEGIN
    SELECT dispositivo_id, identificador_afd INTO v_dispositivo_id, v_identificador
      FROM public.rep_remocoes_fila WHERE id = p_fila_id AND status = 'pendente';

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
        UPDATE public.rep_remocoes_fila
           SET status = 'falhou', erro = p_erro, tentativas = tentativas + 1, processado_em = now()
         WHERE id = p_fila_id;
        RETURN;
    END IF;

    UPDATE public.rep_remocoes_fila
       SET status = 'removido', processado_em = now()
     WHERE id = p_fila_id;

    -- Removido de verdade do equipamento - tira tambem do snapshot (nao esta mais la) e fecha
    -- qualquer vinculo que por acaso existisse (defensivo: o guard em
    -- fn_enfileirar_remocao_usuarios_dispositivo ja deveria ter impedido chegar aqui com vinculo
    -- ativo, mas o servidor pode ter sido desativado depois do enfileiramento e antes da remocao).
    DELETE FROM public.rep_usuarios_dispositivo
     WHERE dispositivo_id = v_dispositivo_id AND identificador_afd = v_identificador;

    UPDATE public.rep_vinculos_servidor
       SET vigente_ate = now()
     WHERE dispositivo_id = v_dispositivo_id AND identificador_afd = v_identificador AND vigente_ate IS NULL;
END;
$fn$;

-- ============================================================================
-- PRIVILEGIOS - assinatura nova e objeto novo, entao os GRANTs sao reescritos
-- ============================================================================
REVOKE ALL ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean, uuid)
    TO service_role;

REVOKE ALL ON FUNCTION public.fn_confirmar_remocao_usuario_dispositivo(uuid, boolean, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_remocao_usuario_dispositivo(uuid, boolean, text, uuid)
    TO service_role;


-- ============================================================================
-- VERIFICACAO - aborta se o resultado divergir
-- ============================================================================
DO $verifica$
DECLARE
    v_sobra   text;
    v_abertas text;
BEGIN
    -- 1) a assinatura ANTIGA nao pode ter sobrevivido (PGRST203)
    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_sobra
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('fn_confirmar_cadastro_rep', 'fn_confirmar_remocao_usuario_dispositivo')
       AND p.pronargs < CASE p.proname
                          WHEN 'fn_confirmar_cadastro_rep' THEN 7
                          ELSE 4
                        END;

    IF v_sobra IS NOT NULL THEN
        RAISE EXCEPTION
            'ABORTADO: assinatura antiga sobreviveu (%). Com duas sobrecargas o PostgREST '
            'devolve PGRST203 e o coletor para de confirmar fila.', v_sobra;
    END IF;

    -- 2) as novas nao podem estar abertas a anon/PUBLIC (grants nao sao herdados)
    SELECT string_agg(DISTINCT p.proname, ', ') INTO v_abertas
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('fn_confirmar_cadastro_rep', 'fn_confirmar_remocao_usuario_dispositivo')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

    IF v_abertas IS NOT NULL THEN
        RAISE EXCEPTION
            'ABORTADO: % executavel por anon/authenticated. Assinatura nova nasce aberta a '
            'PUBLIC (armadilha 24) - o REVOKE deste arquivo nao pegou.', v_abertas;
    END IF;

    -- 3) service_role PRECISA continuar executando: e o cliente que as rotas usam
    IF NOT has_function_privilege('service_role',
           'public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean, uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role',
           'public.fn_confirmar_remocao_usuario_dispositivo(uuid, boolean, text, uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: service_role perdeu EXECUTE - o coletor para de confirmar fila.';
    END IF;

    RAISE NOTICE 'OK: fila do REP confere o dispositivo dono; assinatura antiga removida; grants reescritos.';
END
$verifica$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) Existe UMA assinatura de cada (duas quebrariam o PostgREST):
--
--      SELECT oid::regprocedure FROM pg_proc
--       WHERE proname IN ('fn_confirmar_cadastro_rep','fn_confirmar_remocao_usuario_dispositivo');
--
-- 2) O guard recusa fila de outro dispositivo (usar dois dispositivos reais):
--
--      SELECT public.fn_confirmar_cadastro_rep('<fila_de_A>', true, NULL, NULL, NULL, false, '<id_de_B>');
--      -- esperado: ERRO 42501 'Item de fila ... nao pertence ao dispositivo autenticado.'
--
--      SELECT public.fn_confirmar_cadastro_rep('<fila_de_A>', true, NULL, NULL, NULL, false, '<id_de_A>');
--      -- esperado: sucesso
--
-- 3) O COLETOR continua funcionando (o que importa de verdade): numa unidade com relogio online,
--    enfileirar um cadastro em /marcacoes -> "Sincronizar cadastros" e conferir que o item sai de
--    'pendente' no ciclo seguinte (ate 5 min).
