-- ============================================================================
-- O servidor troca o proprio PIN no Portal, e PIN NOVO passa a exigir 6 digitos
-- ============================================================================
-- 30/08/2026 - decisao do usuario.
--
-- POR QUE
--   Hoje o PIN e' GERADO pelo coordenador e TRANSMITIDO por WhatsApp ou e-mail. Duas pessoas
--   conhecem cada PIN, e ele passou por um canal. PIN definido pela propria pessoa e' conhecido
--   so' por ela - a diferenca entre segredo compartilhado e credencial pessoal.
--
--   E' tambem a saida para a decisao de 30/08/2026 de NAO forcar rotacao dos PINs de 4 digitos
--   ja' emitidos: eles rodam sozinhos, por vontade de quem usa.
--
-- 🚨 ESTE PIN NAO E' SO' DO PORTAL - E' A CREDENCIAL DO TERMINAL DE PONTO.
--   `fn_confirmar_presenca` -> `verify_pin` usa a mesma coluna. Quem troca o PIN a noite e tenta
--   bater o ponto de manha com o antigo LEVA RECUSA - e, pela conformidade da v1.22.0,
--   matricula/PIN invalidos e' a UNICA coisa que ainda recusa batida: vira linha em
--   `logs_tentativas_presenca` e some da folha. A tela do Portal tem de dizer isso em letra
--   grande. Nao e' motivo para nao fazer; e' motivo para avisar.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O TAMANHO MINIMO VALE NA ESCRITA, NUNCA NA LEITURA - e e' isso que preserva os antigos
-- ────────────────────────────────────────────────────────────────────────────
-- O login (`fn_validar_pin_portal` -> `verify_pin`) so' COMPARA HASH: ele nao sabe, nem precisa
-- saber, quantos digitos o PIN tem. Entao PIN de 4 digitos ja' emitido continua entrando para
-- sempre, sem excecao e sem prazo. A regra nova alcanca EXCLUSIVAMENTE quem DEFINE um PIN novo.
--
-- ⚠️ Se algum dia alguem quiser "forcar a troca", isso e' uma decisao NOVA e separada: seria
-- barrar no LOGIN, e ai' sim tira gente do ar. Nao confunda os dois lugares.
--
-- Medido em producao em 30/08/2026: 1.392 servidores ativos, 826 com PIN (todos bcrypt, ZERO em
-- texto plano) e 566 sem PIN. Os 566 recebem PIN novo pelo criterio novo desde ja'.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ONDE A REGRA MORA: no TRIGGER, nao so' na RPC
-- ────────────────────────────────────────────────────────────────────────────
-- `trigger_hash_servidor_pin` (20260523000000) ja' e' o funil por onde TODO PIN passa antes de
-- virar hash - as duas telas do coordenador e a RPC nova caem nele. Validar ali e' o mesmo
-- padrao da armadilha 23: trigger como rede de seguranca, RPC como caminho que carrega a
-- mensagem legivel. Sem o trigger, cada caminho de escrita novo teria de lembrar da regra, e a
-- armadilha 14 e a 23 documentam duas vezes o que acontece quando alguem esquece.
--
-- ⚠️ ARMADILHA 1: `hash_servidor_pin` e' recriada aqui por inteiro. O guard que impede aplicar
-- hash sobre hash (`NOT LIKE '$2a$%'`) TEM de continuar - sem ele, todo UPDATE em `servidores`
-- rehasheia o hash e TODO MUNDO perde o acesso ao portal e ao terminal de uma vez.
--
-- IDEMPOTENTE: CREATE OR REPLACE, CREATE TABLE IF NOT EXISTS, INSERT ... WHERE NOT EXISTS.
-- ============================================================================


-- ============================================================================
-- PARTE A - piso de digitos configuravel
-- ============================================================================
-- Em configuracoes_globais para poder ser afrouxado sem deploy, mesmo motivo do
-- `coletor_auto_update`. Chave ausente = 6.
--
-- ⚠️ NAO carrega credencial, entao continua legivel por conta logada - `fn_config_e_sensivel`
-- (20260830100000) so' fecha o que casa com o predicado de segredo. Conferido: 'pin_min_digitos'
-- nao casa com 'unidade_comunicacao_%' nem com os padroes de segredo.
INSERT INTO public.configuracoes_globais (chave, valor, descricao)
SELECT 'pin_min_digitos', '6'::jsonb,
       'Numero minimo de digitos exigido de um PIN NOVO. Nao afeta PINs ja emitidos - o login so compara hash.'
 WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes_globais WHERE chave = 'pin_min_digitos');


-- ============================================================================
-- PARTE B - "e' uma sequencia?"
-- ============================================================================
-- 123456 e 654321 sao os dois PINs que todo mundo escolhe depois de 000000. Em vez de uma lista
-- de proibidos (que envelhece e depende do tamanho), a checagem e' estrutural: todo par de
-- digitos vizinhos difere de exatamente +1, ou de exatamente -1.
CREATE OR REPLACE FUNCTION public.fn_pin_e_sequencia(p_pin text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
    v_i        integer;
    v_passo    integer;
    v_cresce   boolean := true;
    v_decresce boolean := true;
BEGIN
    IF p_pin IS NULL OR length(p_pin) < 2 THEN
        RETURN false;
    END IF;

    FOR v_i IN 1 .. length(p_pin) - 1 LOOP
        v_passo := ascii(substr(p_pin, v_i + 1, 1)) - ascii(substr(p_pin, v_i, 1));
        IF v_passo <>  1 THEN v_cresce   := false; END IF;
        IF v_passo <> -1 THEN v_decresce := false; END IF;
    END LOOP;

    RETURN v_cresce OR v_decresce;
END
$fn$;

COMMENT ON FUNCTION public.fn_pin_e_sequencia(text) IS
    'true quando o PIN e uma sequencia estritamente crescente ou decrescente (123456, 654321). '
    'Checagem estrutural em vez de lista de proibidos - nao envelhece nem depende do tamanho.';


-- ============================================================================
-- PARTE C - FONTE UNICA da regra de PIN novo
-- ============================================================================
-- Devolve jsonb ESTRUTURADO (`motivo` como codigo, nunca a frase pronta). Os textos em portugues
-- vivem no TypeScript - mesma escolha de `fn_validar_pin_portal`, para nao ter copy duplicada em
-- dois lugares que divergem com o tempo.
--
-- ⚠️ `p_matricula` e' opcional de proposito: o trigger conhece a matricula da propria linha, mas
-- um chamador futuro pode nao ter. Sem ela, apenas a checagem "PIN = matricula" e' pulada.
CREATE OR REPLACE FUNCTION public.fn_validar_pin_novo(
    p_pin       text,
    p_matricula text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
    c_max_digitos constant integer := 8;
    v_min         integer;
BEGIN
    v_min := COALESCE(
        (SELECT NULLIF(valor #>> '{}', '')::integer
           FROM public.configuracoes_globais
          WHERE chave = 'pin_min_digitos'),
        6
    );

    IF p_pin IS NULL OR btrim(p_pin) = '' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'vazio');
    END IF;

    IF p_pin !~ '^[0-9]+$' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nao_numerico');
    END IF;

    IF length(p_pin) < v_min THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'curto', 'minimo', v_min);
    END IF;

    IF length(p_pin) > c_max_digitos THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'longo', 'maximo', c_max_digitos);
    END IF;

    -- Todos os digitos iguais (000000, 111111...).
    IF p_pin ~ ('^(.)\1{' || (length(p_pin) - 1)::text || '}$') THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'repetido');
    END IF;

    IF public.fn_pin_e_sequencia(p_pin) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'sequencia');
    END IF;

    -- A matricula esta impressa no cracha e aparece em toda tela do sistema: como PIN ela nao e
    -- segredo nenhum. `regexp_replace` porque matricula temporaria tem o prefixo 'T'.
    IF p_matricula IS NOT NULL
       AND p_pin = regexp_replace(p_matricula, '[^0-9]', '', 'g')
    THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'igual_matricula');
    END IF;

    RETURN jsonb_build_object('ok', true, 'minimo', v_min);
END
$fn$;

COMMENT ON FUNCTION public.fn_validar_pin_novo(text, text) IS
    'FONTE UNICA da regra de PIN NOVO: so digitos, entre pin_min_digitos (6) e 8, nao todo igual, '
    'nao sequencia, nao igual a matricula. Vale so na ESCRITA - o login compara hash e nao olha '
    'tamanho, entao PIN de 4 digitos ja emitido continua valendo indefinidamente.';


-- ============================================================================
-- PARTE D - o trigger de hash passa a recusar PIN novo fora da regra
-- ============================================================================
-- ⚠️ ARMADILHA 1: corpo recriado por inteiro. O que NAO pode sair daqui:
--   1. o guard `NOT LIKE '$2a$%' / '$2b$%'` - sem ele, todo UPDATE em `servidores` aplicaria
--      hash sobre o hash e o parque inteiro perderia acesso ao portal E ao terminal;
--   2. a condicao `IS DISTINCT FROM OLD.pin_acesso` - e' ela que faz um UPDATE que nao mexe no
--      PIN passar direto. Sem ela, a validacao nova reprovaria os 4 digitos LEGADOS em qualquer
--      edicao de cadastro, e o coordenador nao conseguiria mais salvar a ficha de ninguem.
CREATE OR REPLACE FUNCTION public.hash_servidor_pin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_check jsonb;
BEGIN
    IF NEW.pin_acesso IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.pin_acesso IS DISTINCT FROM OLD.pin_acesso) THEN
        -- Nunca aplicar hash sobre algo que ja e' hash bcrypt.
        IF NEW.pin_acesso NOT LIKE '$2a$%' AND NEW.pin_acesso NOT LIKE '$2b$%' THEN

            -- Regra de PIN NOVO. So chega aqui valor em texto claro, ou seja, alguem definindo
            -- um PIN - nunca uma linha antiga sendo reescrita com o hash que ja tinha.
            v_check := public.fn_validar_pin_novo(NEW.pin_acesso, NEW.matricula);
            IF NOT (v_check ->> 'ok')::boolean THEN
                RAISE EXCEPTION
                    'PIN recusado (%): use % a 8 digitos, sem repetir o mesmo digito, sem sequencia e diferente da matricula.',
                    v_check ->> 'motivo',
                    COALESCE(v_check ->> 'minimo', '6')
                    USING ERRCODE = 'check_violation';
            END IF;

            NEW.pin_acesso := crypt(NEW.pin_acesso, gen_salt('bf', 8));
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.hash_servidor_pin() IS
    'Aplica bcrypt ao PIN em texto claro e, desde 30/08/2026, RECUSA PIN novo fora de '
    'fn_validar_pin_novo. Rede de seguranca do banco: alcanca as duas telas do coordenador e a '
    'RPC do portal sem que nenhuma precise lembrar da regra. NAO alcanca PIN ja emitido - o guard '
    'IS DISTINCT FROM deixa passar UPDATE que nao mexe no PIN.';


-- ============================================================================
-- PARTE E - log de troca de PIN
-- ============================================================================
-- PIN e' credencial de ponto: troca de credencial precisa ser auditavel. Guarda QUEM, QUANDO e
-- DE ONDE. ⚠️ Nunca o valor, nem o antigo nem o novo - nem o hash.
CREATE TABLE IF NOT EXISTS public.logs_troca_pin (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id         uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    -- 'portal'      = o proprio servidor trocou (fn_trocar_pin_portal)
    -- 'coordenador' = redefinido pela tela de cadastro/edicao
    origem              text NOT NULL,
    -- Preenchido so quando a troca vem da retaguarda. NULL no portal: la nao ha conta de sistema.
    alterado_por        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ip_origem           text,
    user_agent          text,
    trocado_em          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_logs_troca_pin_origem CHECK (origem IN ('portal', 'coordenador'))
);

CREATE INDEX IF NOT EXISTS idx_logs_troca_pin_servidor
    ON public.logs_troca_pin (servidor_id, trocado_em DESC);

ALTER TABLE public.logs_troca_pin ENABLE ROW LEVEL SECURITY;

-- Leitura so' para quem audita. A escrita e' exclusivamente por SECURITY DEFINER, entao nao ha
-- policy de INSERT - e nao ter e' o certo: sem policy, ninguem escreve direto pelo PostgREST.
DROP POLICY IF EXISTS "Leitura de logs_troca_pin por quem audita" ON public.logs_troca_pin;
CREATE POLICY "Leitura de logs_troca_pin por quem audita"
    ON public.logs_troca_pin FOR SELECT
    TO authenticated
    USING (public.get_my_role() IN ('super_admin', 'admin', 'rh'));

COMMENT ON TABLE public.logs_troca_pin IS
    'Auditoria de troca de PIN (quem, quando, de onde). NUNCA guarda o valor do PIN nem o hash. '
    'Escrita exclusivamente por funcao SECURITY DEFINER - a tabela nao tem policy de INSERT de '
    'proposito.';


-- ============================================================================
-- PARTE F - a troca em si
-- ============================================================================
-- Recebe `p_servidor_id`, e ele vem da SESSAO ASSINADA do portal (src/utils/portalSession.ts),
-- nunca do corpo da requisicao - armadilha 32: DERIVAR em vez de COMPARAR.
--
-- ⚠️ EXIGE O PIN ATUAL, e isso nao e' redundancia com a sessao. O cookie do portal dura horas e o
-- Portal e' aberto em computador compartilhado de unidade; sessao aberta prova que ALGUEM entrou,
-- nao que quem esta na frente da tela agora e' a mesma pessoa.
--
-- ⚠️ E REUSA O MESMO CONTADOR DE TENTATIVAS DO LOGIN. Sem isso, a troca vira um oraculo para
-- adivinhar o PIN atual sem nenhum bloqueio - exatamente o furo que a 20260830110000 fechou no
-- login, reaberto por uma porta ao lado.
CREATE OR REPLACE FUNCTION public.fn_trocar_pin_portal(
    p_servidor_id uuid,
    p_pin_atual   text,
    p_pin_novo    text,
    p_ip          text DEFAULT NULL,
    p_user_agent  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
    c_max_tentativas constant integer := 5;
    c_cooldown_min   constant integer := 15;

    v_id         uuid;
    v_matricula  text;
    v_hash       text;
    v_tentativas integer;
    v_ultima     timestamptz;
    v_minutos    numeric;
    v_novas      integer;
    v_check      jsonb;
BEGIN
    SELECT id, matricula, pin_acesso, COALESCE(pin_failed_attempts, 0), last_pin_attempt
      INTO v_id, v_matricula, v_hash, v_tentativas, v_ultima
      FROM public.servidores
     WHERE id = p_servidor_id
       AND status = 'Ativo'
     FOR UPDATE;   -- serializa tentativas concorrentes do mesmo servidor

    IF v_id IS NULL THEN
        RETURN jsonb_build_object('resultado', 'nao_encontrado');
    END IF;

    IF v_hash IS NULL THEN
        RETURN jsonb_build_object('resultado', 'sem_pin');
    END IF;

    -- Mesmo bloqueio do login, lido da mesma coluna.
    IF v_ultima IS NOT NULL THEN
        v_minutos := EXTRACT(EPOCH FROM (now() - v_ultima)) / 60.0;

        IF v_minutos >= c_cooldown_min THEN
            UPDATE public.servidores SET pin_failed_attempts = 0 WHERE id = v_id;
            v_tentativas := 0;

        ELSIF v_tentativas >= c_max_tentativas THEN
            RETURN jsonb_build_object(
                'resultado', 'bloqueado',
                'minutos_restantes', CEIL(c_cooldown_min - v_minutos)::integer
            );
        END IF;
    END IF;

    -- 1) O PIN ATUAL confere?
    IF v_hash <> crypt(p_pin_atual, v_hash) THEN
        UPDATE public.servidores
           SET pin_failed_attempts = COALESCE(pin_failed_attempts, 0) + 1,
               last_pin_attempt    = now()
         WHERE id = v_id
        RETURNING pin_failed_attempts INTO v_novas;

        RETURN jsonb_build_object(
            'resultado', 'pin_atual_invalido',
            'tentativas_restantes', GREATEST(c_max_tentativas - v_novas, 0)
        );
    END IF;

    -- 2) O PIN NOVO passa na regra?
    --    ⚠️ Depois de conferir o atual, de proposito: quem nao provou ser o dono da conta nao
    --    deve receber nem a informacao de qual e a regra.
    v_check := public.fn_validar_pin_novo(p_pin_novo, v_matricula);
    IF NOT (v_check ->> 'ok')::boolean THEN
        RETURN jsonb_build_object(
            'resultado', 'pin_novo_recusado',
            'motivo',    v_check ->> 'motivo',
            'minimo',    COALESCE((v_check ->> 'minimo')::integer, 6),
            'maximo',    COALESCE((v_check ->> 'maximo')::integer, 8)
        );
    END IF;

    -- 3) Trocar por um igual e' no-op disfarcado de sucesso - a pessoa sairia achando que trocou.
    IF v_hash = crypt(p_pin_novo, v_hash) THEN
        RETURN jsonb_build_object('resultado', 'pin_novo_igual_ao_atual');
    END IF;

    -- Grava em texto claro; `trigger_hash_servidor_pin` aplica o bcrypt (e revalida a regra).
    UPDATE public.servidores
       SET pin_acesso          = p_pin_novo,
           pin_failed_attempts = 0,
           last_pin_attempt    = now()
     WHERE id = v_id;

    INSERT INTO public.logs_troca_pin (servidor_id, origem, ip_origem, user_agent)
    VALUES (v_id, 'portal', p_ip, p_user_agent);

    RETURN jsonb_build_object('resultado', 'ok');
END
$fn$;

COMMENT ON FUNCTION public.fn_trocar_pin_portal(uuid, text, text, text, text) IS
    'Troca do PIN pelo proprio servidor no Portal. Exige o PIN ATUAL (a sessao dura horas e o '
    'Portal roda em maquina compartilhada) e reusa o bloqueio de 5 tentativas / 15 minutos do '
    'login - sem isso a troca seria um oraculo de forca bruta sem trava. p_servidor_id vem da '
    'sessao assinada, nunca do cliente. So service_role executa.';

REVOKE EXECUTE ON FUNCTION public.fn_trocar_pin_portal(uuid, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_trocar_pin_portal(uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_trocar_pin_portal(uuid, text, text, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_trocar_pin_portal(uuid, text, text, text, text) TO service_role;

-- `fn_validar_pin_novo` e `fn_pin_e_sequencia` ficam legiveis por conta LOGADA: as telas do
-- coordenador precisam avisar antes de salvar, e elas nao revelam nada (a regra e' publica por
-- desenho; nao ha PIN de ninguem envolvido). Fechadas para `anon` pela armadilha 24.
REVOKE EXECUTE ON FUNCTION public.fn_validar_pin_novo(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_validar_pin_novo(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_validar_pin_novo(text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_pin_e_sequencia(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_pin_e_sequencia(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_pin_e_sequencia(text) TO authenticated, service_role;


-- ============================================================================
-- VERIFICACAO - aborta se o resultado divergir
-- ============================================================================
-- ⚠️ "Aplicou sem erro" nao e' prova (armadilha 24) e "a funcao existe" tambem nao (armadilha
-- 42): plpgsql so' resolve nome de coluna e de funcao na EXECUCAO. Aqui as funcoes sao
-- EXECUTADAS, com valores que nao escrevem nada.
DO $verificacao$
DECLARE
    v_min       integer;
    v_r         jsonb;
    v_pendentes text;
BEGIN
    ------------------------------------------------------------------
    -- 1) A regra do PIN novo, exercitada de verdade
    ------------------------------------------------------------------
    v_min := COALESCE((SELECT NULLIF(valor #>> '{}', '')::integer
                         FROM public.configuracoes_globais WHERE chave = 'pin_min_digitos'), 6);
    IF v_min <> 6 THEN
        RAISE EXCEPTION 'ABORTADO: pin_min_digitos = %, esperado 6.', v_min;
    END IF;

    v_r := public.fn_validar_pin_novo('1234', '12345');
    IF (v_r ->> 'ok')::boolean OR v_r ->> 'motivo' <> 'curto' THEN
        RAISE EXCEPTION 'ABORTADO: PIN de 4 digitos deveria ser recusado como "curto", veio %.', v_r;
    END IF;

    v_r := public.fn_validar_pin_novo('000000', '12345');
    IF (v_r ->> 'ok')::boolean OR v_r ->> 'motivo' <> 'repetido' THEN
        RAISE EXCEPTION 'ABORTADO: 000000 deveria ser "repetido", veio %.', v_r;
    END IF;

    v_r := public.fn_validar_pin_novo('123456', '12345');
    IF (v_r ->> 'ok')::boolean OR v_r ->> 'motivo' <> 'sequencia' THEN
        RAISE EXCEPTION 'ABORTADO: 123456 deveria ser "sequencia", veio %.', v_r;
    END IF;

    v_r := public.fn_validar_pin_novo('654321', '12345');
    IF (v_r ->> 'ok')::boolean OR v_r ->> 'motivo' <> 'sequencia' THEN
        RAISE EXCEPTION 'ABORTADO: 654321 deveria ser "sequencia", veio %.', v_r;
    END IF;

    v_r := public.fn_validar_pin_novo('123456', 'T1234567');
    IF v_r ->> 'motivo' <> 'sequencia' THEN
        RAISE EXCEPTION 'ABORTADO: matricula temporaria nao deveria mudar o veredito, veio %.', v_r;
    END IF;

    v_r := public.fn_validar_pin_novo('205205', '205205');
    IF (v_r ->> 'ok')::boolean OR v_r ->> 'motivo' <> 'igual_matricula' THEN
        RAISE EXCEPTION 'ABORTADO: PIN igual a matricula deveria ser recusado, veio %.', v_r;
    END IF;

    v_r := public.fn_validar_pin_novo('12a456', '12345');
    IF (v_r ->> 'ok')::boolean OR v_r ->> 'motivo' <> 'nao_numerico' THEN
        RAISE EXCEPTION 'ABORTADO: PIN com letra deveria ser recusado, veio %.', v_r;
    END IF;

    v_r := public.fn_validar_pin_novo('123456789', '12345');
    IF (v_r ->> 'ok')::boolean OR v_r ->> 'motivo' <> 'longo' THEN
        RAISE EXCEPTION 'ABORTADO: PIN de 9 digitos deveria ser "longo", veio %.', v_r;
    END IF;

    -- E um PIN bom tem de PASSAR. Testar so as recusas deixaria passar uma regra que recusa tudo.
    v_r := public.fn_validar_pin_novo('483920', '12345');
    IF NOT (v_r ->> 'ok')::boolean THEN
        RAISE EXCEPTION 'ABORTADO: 483920 e um PIN valido e foi recusado (%).', v_r;
    END IF;

    ------------------------------------------------------------------
    -- 2) O que a regra NAO pode alcancar: PIN de 4 digitos JA EMITIDO
    ------------------------------------------------------------------
    -- O login compara hash e nao olha tamanho. Se isto quebrar, 826 pessoas perdem o portal E o
    -- terminal de ponto de uma vez.
    PERFORM 1 FROM public.servidores
     WHERE pin_acesso IS NOT NULL
       AND pin_acesso NOT LIKE '$2a$%'
       AND pin_acesso NOT LIKE '$2b$%'
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'ABORTADO: existe PIN em texto plano em servidores - o trigger de hash nao esta valendo.';
    END IF;

    -- 🚨 A ASSERCAO QUE PROTEGE OS 826: o caminho de LOGIN nao pode conhecer a regra de tamanho.
    -- Se um dia alguem "uniformizar" chamando fn_validar_pin_novo de dentro de
    -- fn_validar_pin_portal, todo PIN de 4 digitos para de entrar no Portal E no terminal de
    -- ponto no mesmo instante - e o sintoma seria "ninguem consegue bater o ponto hoje".
    -- Barrar no login e' uma decisao NOVA; enquanto nao for tomada, isto aborta.
    IF EXISTS (
        SELECT 1 FROM pg_proc
         WHERE oid = 'public.fn_validar_pin_portal(text, text)'::regprocedure
           AND prosrc ILIKE '%fn_validar_pin_novo%'
    ) THEN
        RAISE EXCEPTION
            'ABORTADO: fn_validar_pin_portal passou a chamar fn_validar_pin_novo. A regra de '
            'tamanho vale na ESCRITA, nunca no LOGIN - isso tiraria do ar todo PIN de 4 digitos '
            'ja emitido, no Portal e no terminal de ponto.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc
         WHERE oid = 'public.verify_pin(uuid, text)'::regprocedure
           AND (prosrc ILIKE '%length%' OR prosrc ILIKE '%fn_validar_pin_novo%')
    ) THEN
        RAISE EXCEPTION 'ABORTADO: verify_pin passou a olhar o tamanho do PIN - ver acima.';
    END IF;

    ------------------------------------------------------------------
    -- 3) Privilegios, nos DOIS sentidos (licao da 20260827050000)
    ------------------------------------------------------------------
    SELECT string_agg(f.fn || '/' || f.papel, ', ')
      INTO v_pendentes
      FROM (
        SELECT 'fn_trocar_pin_portal' AS fn, p AS papel
          FROM unnest(ARRAY['anon','authenticated','public']) p
         WHERE has_function_privilege(p, 'public.fn_trocar_pin_portal(uuid, text, text, text, text)', 'EXECUTE')
        UNION ALL
        SELECT 'fn_validar_pin_novo', p FROM unnest(ARRAY['anon','public']) p
         WHERE has_function_privilege(p, 'public.fn_validar_pin_novo(text, text)', 'EXECUTE')
      ) f;

    IF v_pendentes IS NOT NULL THEN
        RAISE EXCEPTION
            'ABORTADO: ainda executavel por %. Banco=%, usuario=%. REVOKE de quem nao e dono so emite WARNING.',
            v_pendentes, current_database(), current_user;
    END IF;

    IF NOT has_function_privilege('service_role', 'public.fn_trocar_pin_portal(uuid, text, text, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: service_role sem EXECUTE em fn_trocar_pin_portal - a troca no portal nao funciona.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_validar_pin_novo(text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated perdeu EXECUTE em fn_validar_pin_novo - a tela do coordenador para de avisar antes de salvar.';
    END IF;

    RAISE NOTICE 'OK: fn_validar_pin_novo, fn_trocar_pin_portal e logs_troca_pin criadas; piso de % digitos vale so para PIN NOVO.', v_min;
END
$verificacao$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) O QUE MAIS IMPORTA: login de quem tem PIN de 4 digitos continua funcionando.
--    Entrar em /consultar-escala com uma matricula cujo PIN tenha 4 digitos. Tem de entrar.
--    E bater o ponto em /presenca com a mesma matricula + PIN. Tem de aceitar.
--
-- 2) Trocar o PIN no Portal (Meu Acesso -> Trocar PIN):
--      - PIN atual errado  -> recusa e consome tentativa (pin_failed_attempts sobe)
--      - PIN novo '1234'   -> recusado por tamanho
--      - PIN novo '123456' -> recusado por sequencia
--      - PIN novo valido   -> troca, e o PIN ANTIGO deixa de entrar no portal E no terminal
--      - logs_troca_pin ganha uma linha com origem='portal'
--
-- 3) Tela do coordenador: "Gerar PIN" tem de produzir 6 digitos, e digitar 4 na mao tem de ser
--    recusado ao salvar, com mensagem legivel (nao o texto cru do Postgres).
--
-- 4) Editar a ficha de um servidor SEM tocar no PIN tem de continuar salvando normalmente -
--    inclusive de quem tem PIN legado de 4 digitos. E' o guard IS DISTINCT FROM.
--
-- 5) fn_trocar_pin_portal nao pode aparecer para a chave anon:
--      GET /rest/v1/  (apikey: <ANON>)  -> sem /rpc/fn_trocar_pin_portal
