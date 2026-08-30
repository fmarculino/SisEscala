-- ============================================================================
-- verify_pin sai do alcance de `anon`, e o bloqueio de 5 tentativas passa a viver NO BANCO
-- ============================================================================
-- 30/08/2026 - achado da analise da auditoria (nao estava no relatorio original).
--
-- O PROBLEMA, MEDIDO EM PRODUCAO EM 30/08/2026
--   POST /rest/v1/rpc/verify_pin  com a chave ANON  ->  HTTP 200
--
--   `verify_pin` foi criada em 20260523000000 e NUNCA foi revogada de PUBLIC. Pela armadilha 24
--   do CLAUDE.md, `CREATE FUNCTION` ja' concede EXECUTE a PUBLIC — entao ela sempre esteve
--   chamavel por `anon`, cuja chave vai no bundle do navegador. As tres migrations 20260827*
--   fecharam fn_registrar_ponto, fn_confirmar_presenca e companhia; esta passou batido.
--
--   E o bloqueio de 5 tentativas NAO esta dentro da funcao: ele vive em `validatePin`
--   (src/app/consultar-escala/actions.ts), em TypeScript. A funcao SQL so' faz
--   `v_hash = crypt(p_pin, v_hash)` e devolve boolean, sem contar nada.
--
--   Somando: o PIN gerado pela tela de cadastro tem 4 DIGITOS
--   (`Math.floor(1000 + Math.random() * 9000)`), ou seja 9.000 possibilidades. Quem tivesse o
--   UUID de um servidor percorria o espaco inteiro em segundos, direto no PostgREST, sem passar
--   por nenhum controle da aplicacao e sem deixar rastro em `pin_failed_attempts`.
--
-- POR QUE FECHAR MESMO DEPOIS DA CORRECAO DO PORTAL
--   A correcao de 30/08/2026 tirou o UUID de `findServidorByMatricula`, e a RLS ja' impedia
--   `anon` de LISTAR servidores (conferido: HTTP 200 com array vazio). Isso encarece o ataque,
--   mas nao o fecha: UUID vaza por link compartilhado, print, chamado de suporte, export. Com
--   9.000 possibilidades, um unico UUID vazado e' a conta inteira.
--
-- POR QUE A REVOGACAO NAO QUEBRA NADA (conferido antes de escrever)
--   - Chamador na aplicacao: UM so', `validatePin`, e ele usa `createAdminClient()`
--     (service_role), que continua com GRANT.
--   - Chamadores em SQL: `fn_confirmar_presenca` e as demais funcoes de presenca. Todas sao
--     SECURITY DEFINER, entao executam com os privilegios do DONO e nao dependem do GRANT de
--     quem chamou. Revogar de PUBLIC nao as afeta.
--
-- ⚠️ O QUE ESTA MIGRATION NAO FAZ
--   Nao troca os PINs de 4 digitos ja' emitidos (decisao do usuario em 30/08/2026: serao
--   trocados naturalmente com o tempo). E' por causa dessa decisao que fechar o caminho de
--   forca bruta importa mais, nao menos.
--   Nao mexe no gerador de PIN da tela de cadastro (isso e' frontend).
--
-- IDEMPOTENTE: REVOKE/GRANT e CREATE OR REPLACE. Seguro rodar nos dois ambientes.
-- ============================================================================


-- ============================================================================
-- PARTE A - tirar verify_pin de PUBLIC/anon/authenticated
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.verify_pin(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_pin(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.verify_pin(uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_pin(uuid, text) TO service_role;

COMMENT ON FUNCTION public.verify_pin(uuid, text) IS
    'Compara o PIN com o hash bcrypt. NAO conta tentativas e NAO bloqueia - quem faz isso e '
    'fn_validar_pin_portal. Executavel apenas por service_role e pelas funcoes SECURITY DEFINER '
    'que a chamam por dentro (fn_confirmar_presenca e afins). Ficou aberta a anon de 23/05/2026 '
    'a 30/08/2026.';


-- ============================================================================
-- PARTE B - o bloqueio de tentativas passa a ser propriedade do BANCO
-- ============================================================================
-- Ate aqui, a regra "5 erros bloqueiam por 15 minutos" so' existia no TypeScript. Duas
-- consequencias:
--   1. qualquer caminho que nao fosse `validatePin` ignorava o bloqueio por construcao;
--   2. mesmo por `validatePin`, havia CORRIDA: ler `pin_failed_attempts`, decidir e so' depois
--      gravar deixa N requisicoes simultaneas lerem todas o valor 0 e passarem juntas. Contra
--      forca bruta, que e' exatamente concorrente, o contador virava decorativo.
--
-- Aqui a leitura, a decisao e a gravacao acontecem na mesma transacao, e o UPDATE do contador e'
-- feito com `RETURNING` sobre a propria linha - sem janela entre ler e escrever.
--
-- Recebe MATRICULA, nao servidor_id: e' o mesmo motivo pelo qual `validatePin` passou a receber
-- matricula em 30/08/2026 — o identificador interno nao transita pelo cliente.
--
-- Devolve jsonb ESTRUTURADO (codigo + numeros), nunca a mensagem pronta: os textos em portugues
-- continuam no TypeScript, para nao duplicar copy em dois lugares.
CREATE OR REPLACE FUNCTION public.fn_validar_pin_portal(
    p_matricula text,
    p_pin       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
    c_max_tentativas  constant integer := 5;
    c_cooldown_min    constant integer := 15;

    v_id              uuid;
    v_nome            text;
    v_hash            text;
    v_tentativas      integer;
    v_ultima          timestamptz;
    v_minutos         numeric;
    v_ok              boolean;
    v_novas           integer;
BEGIN
    SELECT id, nome, pin_acesso, COALESCE(pin_failed_attempts, 0), last_pin_attempt
      INTO v_id, v_nome, v_hash, v_tentativas, v_ultima
      FROM public.servidores
     WHERE matricula = p_matricula
       AND status = 'Ativo'
     FOR UPDATE;   -- serializa tentativas concorrentes DA MESMA matricula

    IF v_id IS NULL THEN
        RETURN jsonb_build_object('resultado', 'nao_encontrado');
    END IF;

    -- Bloqueio / expiracao do bloqueio
    IF v_ultima IS NOT NULL THEN
        v_minutos := EXTRACT(EPOCH FROM (now() - v_ultima)) / 60.0;

        IF v_minutos >= c_cooldown_min THEN
            -- Passou o cooldown: zera o contador e da nova chance. Mesmo comportamento que o
            -- TypeScript tinha.
            UPDATE public.servidores SET pin_failed_attempts = 0 WHERE id = v_id;
            v_tentativas := 0;

        ELSIF v_tentativas >= c_max_tentativas THEN
            RETURN jsonb_build_object(
                'resultado', 'bloqueado',
                'minutos_restantes', CEIL(c_cooldown_min - v_minutos)::integer
            );
        END IF;
    END IF;

    IF v_hash IS NULL THEN
        RETURN jsonb_build_object('resultado', 'sem_pin');
    END IF;

    -- `crypt` SEM qualificar, resolvido pelo `SET search_path = public, extensions` do cabecalho
    -- desta funcao — exatamente como `verify_pin` faz desde 23/05/2026. Qualificar como
    -- `extensions.crypt` seria uma aposta no schema onde o pgcrypto esta instalado; herdar a
    -- resolucao que ja' funciona em producao nao e' aposta nenhuma.
    v_ok := (v_hash = crypt(p_pin, v_hash));

    IF NOT v_ok THEN
        UPDATE public.servidores
           SET pin_failed_attempts = COALESCE(pin_failed_attempts, 0) + 1,
               last_pin_attempt    = now()
         WHERE id = v_id
        RETURNING pin_failed_attempts INTO v_novas;

        RETURN jsonb_build_object(
            'resultado', 'pin_invalido',
            'tentativas_restantes', GREATEST(c_max_tentativas - v_novas, 0)
        );
    END IF;

    UPDATE public.servidores
       SET pin_failed_attempts = 0,
           last_pin_attempt    = now()
     WHERE id = v_id;

    -- O `servidor_id` volta para o SERVIDOR DE APLICACAO (que abre a sessao assinada com ele),
    -- nunca para o navegador. Ver src/utils/portalSession.ts.
    RETURN jsonb_build_object(
        'resultado',   'ok',
        'servidor_id', v_id,
        'nome',        v_nome
    );
END
$fn$;

COMMENT ON FUNCTION public.fn_validar_pin_portal(text, text) IS
    'Login do Portal do Servidor: resolve a matricula, aplica o bloqueio de 5 tentativas / 15 '
    'minutos e verifica o PIN, tudo na mesma transacao (FOR UPDATE serializa tentativas '
    'concorrentes da mesma matricula). Substitui a logica que vivia em validatePin, no '
    'TypeScript, onde era contornavel e sujeita a corrida. So service_role executa.';

-- Fecha de PUBLIC na MESMA migration - e' o unico momento em que somos comprovadamente o dono
-- (armadilha 24). Nao vai para authenticated: o unico chamador e a Server Action, com
-- createAdminClient().
REVOKE EXECUTE ON FUNCTION public.fn_validar_pin_portal(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_validar_pin_portal(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_validar_pin_portal(text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_validar_pin_portal(text, text) TO service_role;


-- ============================================================================
-- VERIFICACAO - aborta se o resultado divergir
-- ============================================================================
-- ⚠️ "Aplicou sem erro" NAO e' prova: `REVOKE` de quem nao e' o dono da funcao apenas emite
-- WARNING e segue. Foi assim que a 20260827030000 "aplicou com sucesso" sem mudar nada, e so'
-- se descobriu medindo por fora. Aqui a propria migration mede.
DO $verificacao$
DECLARE
    v_pendentes text;
    v_dono      text;
BEGIN
    -- 1) anon e authenticated NAO podem mais executar as duas funcoes
    SELECT string_agg(format('%s(%s)', f.fn, f.papel), ', ')
      INTO v_pendentes
      FROM (
        SELECT 'verify_pin' AS fn, p AS papel FROM unnest(ARRAY['anon','authenticated','public']) p
         WHERE has_function_privilege(p, 'public.verify_pin(uuid, text)', 'EXECUTE')
        UNION ALL
        SELECT 'fn_validar_pin_portal', p FROM unnest(ARRAY['anon','authenticated','public']) p
         WHERE has_function_privilege(p, 'public.fn_validar_pin_portal(text, text)', 'EXECUTE')
      ) f;

    IF v_pendentes IS NOT NULL THEN
        SELECT pg_get_userbyid(proowner) INTO v_dono
          FROM pg_proc WHERE oid = 'public.verify_pin(uuid, text)'::regprocedure;
        RAISE EXCEPTION
            'ABORTADO: ainda executavel por %. Banco=%, usuario=%, dono de verify_pin=%. '
            'REVOKE de quem nao e dono so emite WARNING - rode como o dono da funcao.',
            v_pendentes, current_database(), current_user, v_dono;
    END IF;

    -- 2) O outro sentido (licao da 20260827050000): revogar demais quebra em silencio.
    --    service_role PRECISA continuar executando as duas - e o cliente que a Server Action usa.
    IF NOT has_function_privilege('service_role', 'public.verify_pin(uuid, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: service_role perdeu EXECUTE em verify_pin - o login do portal para de funcionar.';
    END IF;
    IF NOT has_function_privilege('service_role', 'public.fn_validar_pin_portal(text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: service_role nao tem EXECUTE em fn_validar_pin_portal.';
    END IF;

    RAISE NOTICE 'OK: verify_pin fechada para anon/authenticated; fn_validar_pin_portal criada e restrita a service_role.';
END
$verificacao$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) O teste que vale e' pelo PostgREST, com a chave ANON. Antes desta migration devolvia
--    HTTP 200 e `false`; agora tem que recusar:
--
--      POST /rest/v1/rpc/verify_pin
--        apikey: <ANON>
--        {"p_servidor_id":"00000000-0000-0000-0000-000000000000","p_pin":"0000"}
--      -- esperado: 404 (funcao deixa de aparecer no schema exposto) ou 401/403
--      -- ANTES:    200 com body `false`
--
--    O mesmo para fn_validar_pin_portal com {"p_matricula":"0","p_pin":"0000"}.
--
-- 2) A funcao tem que sumir do OpenAPI que a chave anon enxerga:
--
--      GET /rest/v1/   (apikey: <ANON>)  -> nao pode listar /rpc/verify_pin
--      -- script pronto: node scratchpad/an_verify_pin_anon.mjs
--
-- 3) O login do portal continua funcionando (usa service_role): entrar em /consultar-escala com
--    uma matricula e o PIN certo. E o bloqueio: errar o PIN 5 vezes tem que bloquear por 15 min,
--    e `pin_failed_attempts` daquele servidor tem que chegar a 5.
--
-- 4) O terminal de ponto NAO pode ter sido afetado (fn_confirmar_presenca chama verify_pin por
--    dentro, como SECURITY DEFINER): bater ponto em /presenca com matricula + PIN.
