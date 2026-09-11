-- Migration: Confirmacao do aviso de ponto por E-MAIL, e o par canal/destino da fila
-- Data: 2026-09-11
--
-- Diario: docs/evolucao/2026-09-11-aviso-de-ponto-confirmacao-por-email.md
--
-- ============================================================================
-- POR QUE
-- ============================================================================
--
-- PROBLEMA A - o par canal/destino nascia QUEBRADO  [medido em producao]
--   fn_solicitar_aviso_ponto inseria na fila SEM preencher canal e destino. O canal caia no
--   DEFAULT da coluna ('whatsapp') e o destino ficava NULL. No despacho,
--   fn_avisos_ponto_pendentes resolve os dois com COALESCE INDEPENDENTE:
--
--       COALESCE(c.canal, k.canal)      -> 'whatsapp'  (a coluna ja tinha valor)
--       COALESCE(c.destino, k.destino)  -> o E-MAIL    (k = fn_canal_aviso_ponto, pref=email)
--
--   Resultado: WhatsApp enviado para um endereco de e-mail. Confirmado em 11/09/2026 em duas
--   linhas reais (LENISE mat 69366 e EMILLY mat 69026), que esgotaram as 3 tentativas com
--   "Erro ao conectar na API AstraCalls: Tempo limite" - cada uma queimando o timeout da API
--   que tambem serve o acionamento de sobreaviso.
--
--   O COALESCE campo a campo NAO e corrigido aqui, de proposito: ele e a compatibilidade das
--   linhas antigas, e passa a nunca ser exercitado porque quem insere agora grava OS DOIS
--   LADOS JUNTOS. Par que nasce completo nao tem como se separar depois.
--
-- PROBLEMA B - expirar o pedido deixava a linha da fila orfa
--   fn_expirar_optin_aviso_ponto devolvia o servidor para 'inativo' e NAO tocava na fila. A
--   linha continuava 'pendente' e seria despachada depois - mandando "responda SIM" para quem
--   ja teve o pedido cancelado por decurso de prazo. Medido: 11 linhas nessa condicao, todas
--   acumuladas no periodo em que o despachador esteve parado (30/08 a 11/09/2026).
--
-- PROBLEMA C - so dava para ATIVAR pelo WhatsApp
--   O double opt-in exigia telefone valido e exclusivo e mandava "responda SIM"; a confirmacao
--   so entrava por /api/avisos-ponto/webhook, que le resposta de WhatsApp. Mas o canal PADRAO
--   do aviso e e-mail desde 30/08/2026 - entao 27 dos 29 ativos recebem por e-mail e TODOS
--   foram obrigados a passar pelo WhatsApp so para ligar. Some-se que o numero da Secretaria
--   ja foi restringido pela Meta duas vezes, e que 1.757 dos 2.647 servidores ativos tem
--   e-mail cadastrado (medido em 11/09/2026) contra 890 sem.
--
--   A confirmacao passa a sair pelo canal PREFERIDO:
--     - whatsapp  -> "responda SIM" (inalterado, e continua exigindo telefone EXCLUSIVO)
--     - email     -> link de uso unico, valido pelo mesmo prazo
--
--   O link nao e mais fraco que o SIM: os dois provam posse do endereco pelo qual o aviso sera
--   entregue, que e exatamente o que o double opt-in existe para provar. O SIM tem um ganho a
--   mais (transforma o numero em interlocutor, sinal antibanimento do WhatsApp) - e por isso
--   ele NAO foi substituido, so deixou de ser o unico caminho.
--
-- ============================================================================
-- O QUE NAO PODE SER DESFEITO
-- ============================================================================
--   1. O guard de LOTACAO HABILITADA continua ANTES de tudo (migration 20260809170000): sem
--      ele, quem esta fora do escopo dispara mensagem no numero que serve o sobreaviso.
--   2. Confirmacao por WhatsApp continua exigindo fn_telefone_aviso_ponto (valido E EXCLUSIVO).
--      fn_canal_aviso_ponto so checa "nao vazio" - se ela bastasse, um telefone repetido em
--      dois cadastros ativaria o aviso da pessoa errada, que e o caso que
--      fn_confirmar_aviso_ponto recusa explicitamente.
--   3. Um pedido pendente NAO e reenviado. Insistir e o que gera bloqueio.
--   4. Desativar e PARAR continuam incondicionais.


-- ============================================================================
-- 1. A FILA PASSA A ACEITAR ITEM SEM TELEFONE
-- ============================================================================
-- `telefone` era NOT NULL porque no comeco o WhatsApp era o unico canal. Item de e-mail nao tem
-- telefone para gravar, e inventar um seria pior.
--
-- A coluna NAO e derrubada: ela e o historico de envio das ~440 linhas ja despachadas por
-- WhatsApp. O CHECK novo garante o que importa - nenhuma linha sem NENHUM endereco.

ALTER TABLE public.avisos_ponto_fila ALTER COLUMN telefone DROP NOT NULL;

ALTER TABLE public.avisos_ponto_fila DROP CONSTRAINT IF EXISTS chk_avisos_ponto_fila_tem_destino;
ALTER TABLE public.avisos_ponto_fila
    ADD CONSTRAINT chk_avisos_ponto_fila_tem_destino
    CHECK (telefone IS NOT NULL OR destino IS NOT NULL);


-- ============================================================================
-- 2. TOKENS DO PORTAL - FONTE UNICA
-- ============================================================================
-- Serve a confirmacao do aviso de ponto E a redefinicao de PIN (migration 20260911150000).
-- Duas implementacoes do mesmo mecanismo divergiriam no detalhe que importa: prazo, uso unico e
-- invalidacao do anterior.
--
-- O token CRU nunca e gravado - so o sha256, no mesmo esquema de dispositivos_rep e
-- terminais_locais. Quem emite recebe o valor uma vez e nao ha como recupera-lo depois.

CREATE TABLE IF NOT EXISTS public.tokens_portal (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id    uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    finalidade     text NOT NULL
                   CHECK (finalidade IN ('confirmar_aviso_ponto', 'redefinir_pin')),
    token_hash     text NOT NULL,
    expira_em      timestamptz NOT NULL,
    usado_em       timestamptz,
    substituido_em timestamptz,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    ip_origem      text,
    user_agent     text
);

COMMENT ON TABLE public.tokens_portal IS
    'Tokens de uso unico do Portal do Servidor (confirmar aviso de ponto, redefinir PIN). '
    'Guarda apenas o sha256 - o valor cru so existe no e-mail enviado.';

-- Um token ATIVO por (servidor, finalidade). Pedido novo aposenta o anterior; sem isso, dois
-- links validos ao mesmo tempo fazem o mais antigo continuar servindo depois de a pessoa ter
-- pedido outro - que e justamente o que ela faz quando desconfia do primeiro.
CREATE UNIQUE INDEX IF NOT EXISTS uq_token_portal_ativo
    ON public.tokens_portal (servidor_id, finalidade)
 WHERE usado_em IS NULL AND substituido_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_token_portal_hash ON public.tokens_portal (token_hash);

ALTER TABLE public.tokens_portal ENABLE ROW LEVEL SECURITY;
-- Sem policy, de proposito: nenhum papel le nem escreve direto. So as funcoes SECURITY DEFINER
-- abaixo tocam nesta tabela - e o Portal autentica por PIN, nao por sessao do Supabase Auth.


CREATE OR REPLACE FUNCTION public.fn_emitir_token_portal(
    p_servidor_id   uuid,
    p_finalidade    text,
    p_prazo_minutos integer,
    p_ip            text DEFAULT NULL,
    p_user_agent    text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_token text;
BEGIN
    IF p_servidor_id IS NULL THEN
        RAISE EXCEPTION 'fn_emitir_token_portal: servidor_id obrigatorio.';
    END IF;

    -- 64 hex a partir de dois uuid v4 - mesmo padrao de fn_gerar_token_dispositivo_rep. Evita
    -- depender de gen_random_bytes (pgcrypto), que pode nao estar habilitada nos dois bancos
    -- (CLAUDE.md armadilha 3).
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

    -- Aposenta o anterior ANTES de inserir, senao o indice unico parcial recusa o novo.
    UPDATE public.tokens_portal
       SET substituido_em = now()
     WHERE servidor_id = p_servidor_id
       AND finalidade  = p_finalidade
       AND usado_em IS NULL
       AND substituido_em IS NULL;

    INSERT INTO public.tokens_portal
        (servidor_id, finalidade, token_hash, expira_em, ip_origem, user_agent)
    VALUES
        (p_servidor_id, p_finalidade,
         encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
         now() + make_interval(mins => GREATEST(COALESCE(p_prazo_minutos, 30), 1)),
         p_ip, p_user_agent);

    RETURN v_token;
END;
$fn$;

COMMENT ON FUNCTION public.fn_emitir_token_portal(uuid, text, integer, text, text) IS
    'Emite token de uso unico do Portal e devolve o valor CRU (uma unica vez). Aposenta o token '
    'ativo anterior da mesma finalidade.';

REVOKE ALL ON FUNCTION public.fn_emitir_token_portal(uuid, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_emitir_token_portal(uuid, text, integer, text, text) TO service_role;


CREATE OR REPLACE FUNCTION public.fn_consumir_token_portal(
    p_token      text,
    p_finalidade text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_hash text;
    v_row  record;
BEGIN
    v_hash := encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex');

    SELECT * INTO v_row
      FROM public.tokens_portal t
     WHERE t.token_hash = v_hash
       AND t.finalidade = p_finalidade
     FOR UPDATE;   -- serializa dois cliques no mesmo link

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'motivo', 'invalido');
    END IF;

    -- Os motivos sao separados de proposito: "ja usado" e "expirado" pedem acoes diferentes de
    -- quem recebeu o link, e uma mensagem unica mandaria a pessoa tentar o que nao resolve.
    -- Distinguir nao vaza nada: quem chega aqui ja tem o token em maos.
    IF v_row.usado_em IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'motivo', 'ja_usado');
    END IF;
    IF v_row.substituido_em IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'motivo', 'substituido');
    END IF;
    IF v_row.expira_em < now() THEN
        RETURN jsonb_build_object('success', false, 'motivo', 'expirado');
    END IF;

    UPDATE public.tokens_portal SET usado_em = now() WHERE id = v_row.id;

    RETURN jsonb_build_object('success', true, 'servidor_id', v_row.servidor_id);
END;
$fn$;

COMMENT ON FUNCTION public.fn_consumir_token_portal(text, text) IS
    'Valida e QUEIMA o token (uso unico). Devolve servidor_id ou o motivo da recusa.';

REVOKE ALL ON FUNCTION public.fn_consumir_token_portal(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_consumir_token_portal(text, text) TO service_role;


-- ============================================================================
-- 3. O OPT-IN PASSA A SAIR PELO CANAL PREFERIDO, COM O PAR COMPLETO
-- ============================================================================
-- Base: a versao vigente de 20260809170000. Os guards dela estao todos preservados, na mesma
-- ordem. O que muda e a resolucao do canal, a mensagem e o INSERT na fila.
--
-- O marcador {{URL}} e substituido pelo despachador (/api/avisos-ponto/despachar), que resolve
-- a origem por src/utils/urlPublica.ts. A URL publica e propriedade da INSTALACAO e vive no
-- ambiente (armadilha 40); duplica-la em configuracoes_globais criaria uma segunda verdade que
-- envelhece sozinha. Se a origem nao estiver disponivel, o despachador FALHA o item em vez de
-- mandar link quebrado.

CREATE OR REPLACE FUNCTION public.fn_solicitar_aviso_ponto(
    p_servidor_id  uuid,
    p_termo_texto  text,
    p_termo_versao text,
    p_prazo_horas  integer DEFAULT 48
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_servidor record;
    v_canal    text;
    v_destino  text;
    v_telefone text;
    v_token    text;
    v_prazo    integer;
    v_mensagem text;
BEGIN
    IF p_termo_texto IS NULL OR btrim(p_termo_texto) = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'O termo de ciência não pode ser vazio.');
    END IF;

    SELECT s.id, s.nome, s.telefone, s.email, s.aviso_ponto_status, s.unidade_id, s.setor_id
      INTO v_servidor
      FROM public.servidores s
     WHERE s.id = p_servidor_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Servidor não encontrado.');
    END IF;

    IF v_servidor.aviso_ponto_status = 'ativo' THEN
        RETURN jsonb_build_object('success', true, 'status', 'ativo',
            'message', 'O aviso já está ativo.');
    END IF;

    -- LOTACAO HABILITADA? Sem isto, quem esta em setor desabilitado clicava em Ativar e o
    -- sistema MANDAVA a mensagem de confirmacao - furando o portao de rollout, e no mesmo numero
    -- que serve o acionamento de sobreaviso. O dano nao era ele nao receber depois; era a
    -- mensagem que ja tinha saido.
    --
    -- Vem ANTES do canal de proposito: quem esta fora do escopo esta bloqueado de qualquer
    -- forma, e mandar corrigir o cadastro o faria consertar a coisa errada.
    IF NOT public.fn_aviso_ponto_habilitado(v_servidor.unidade_id, v_servidor.setor_id) THEN
        RETURN jsonb_build_object('success', false, 'status', 'indisponivel',
            'message', 'O aviso de ponto ainda não está disponível na sua lotação. '
                    || 'Fale com seu coordenador.');
    END IF;

    -- CANAL: a MESMA fonte que o despacho usa. Reimplementar a preferencia aqui faria o pedido
    -- sair por um canal e o aviso por outro, em silencio.
    SELECT k.canal, k.destino INTO v_canal, v_destino
      FROM public.fn_canal_aviso_ponto(p_servidor_id) k;

    IF v_canal IS NULL THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Não há e-mail nem telefone no seu cadastro. '
                    || 'Procure seu coordenador para atualizar antes de ativar o aviso.');
    END IF;

    -- WhatsApp exige telefone VALIDO E EXCLUSIVO, nao so preenchido: a confirmacao chega por
    -- resposta, e fn_confirmar_aviso_ponto casa pelo sufixo do numero. Telefone repetido em dois
    -- cadastros ativaria o aviso da pessoa errada - e aquela funcao, corretamente, recusa o caso
    -- ambiguo, o que deixaria a pessoa esperando para sempre.
    IF v_canal = 'whatsapp' THEN
        v_telefone := public.fn_telefone_aviso_ponto(p_servidor_id);
        IF v_telefone IS NULL THEN
            RETURN jsonb_build_object('success', false,
                'message', 'Não há um telefone válido e exclusivo no seu cadastro. '
                        || 'Procure seu coordenador para atualizar antes de ativar o aviso.');
        END IF;
        v_destino := v_telefone;
    END IF;

    -- Ja existe pedido pendente? Nao reenvia. Insistir e o comportamento que gera bloqueio, e o
    -- indice parcial idx_aviso_confirmacao_unica_por_servidor tambem barraria.
    IF EXISTS (SELECT 1 FROM public.avisos_ponto_fila f
                WHERE f.servidor_id = p_servidor_id
                  AND f.tipo = 'confirmacao_optin'
                  AND f.status = 'pendente') THEN
        RETURN jsonb_build_object('success', true, 'status', 'pendente_confirmacao',
            'canal', v_canal,
            'message', CASE WHEN v_canal = 'email'
                THEN 'Já enviamos o link de confirmação para o seu e-mail. '
                  || 'Abra a mensagem e clique no link para ativar.'
                ELSE 'Já enviamos a mensagem de confirmação para o seu WhatsApp. '
                  || 'Responda SIM naquela conversa para ativar.' END);
    END IF;

    v_prazo := GREATEST(COALESCE(p_prazo_horas, 48), 1);

    UPDATE public.servidores
       SET aviso_ponto_status  = 'pendente_confirmacao',
           aviso_ponto_definido_em = now(),
           aviso_ponto_expira_em   = now() + make_interval(hours => v_prazo)
     WHERE id = p_servidor_id;

    INSERT INTO public.logs_preferencia_aviso_ponto
        (servidor_id, acao, termo_texto, termo_versao, telefone_na_epoca, origem)
    VALUES
        (p_servidor_id, 'solicitou', p_termo_texto, p_termo_versao, v_servidor.telefone, 'portal');

    IF v_canal = 'email' THEN
        -- O token vale o MESMO prazo do pedido. Prazos diferentes produziriam um link que ainda
        -- abre depois de o pedido ter expirado - e a confirmacao morreria no guard de status,
        -- sem a pessoa entender por que.
        v_token := public.fn_emitir_token_portal(
            p_servidor_id, 'confirmar_aviso_ponto', v_prazo * 60);

        v_mensagem :=
            'Olá, ' || COALESCE(v_servidor.nome, 'servidor(a)') || '.' || E'\n\n' ||
            'Você pediu, no Portal do Servidor, para receber por e-mail um resumo dos seus '
            || 'registros de ponto.' || E'\n\n' ||
            'Para confirmar, clique no endereço abaixo:' || E'\n' ||
            '{{URL}}/consultar-escala/confirmar-aviso/' || v_token || E'\n\n' ||
            'O link vale por ' || v_prazo || ' horas e pode ser usado uma única vez.' || E'\n\n' ||
            'Se não foi você, ignore esta mensagem — sem a confirmação nada é enviado, e não '
            || 'insistiremos.' || E'\n\n' ||
            'O aviso é informativo e não é o Comprovante de Registro de Ponto. Ativar ou não '
            || 'ativar não altera em nada o registro do seu ponto.' || E'\n' ||
            'Secretaria Municipal de Saúde de Marabá';
    ELSE
        v_mensagem :=
            '🔐 *SisEscala — confirmação de cadastro*' || E'\n\n' ||
            'Olá, ' || COALESCE(v_servidor.nome, 'servidor(a)') || '.' || E'\n' ||
            'Você pediu, no Portal do Servidor, para receber neste WhatsApp um resumo dos seus '
            || 'registros de ponto.' || E'\n\n' ||
            '*Responda SIM nesta conversa para confirmar.*' || E'\n\n' ||
            'Se não foi você, ignore esta mensagem — sem a sua resposta nada é enviado, e não '
            || 'insistiremos.' || E'\n\n' ||
            '_O aviso é informativo e não é o Comprovante de Registro de Ponto. Ativar ou não '
            || 'ativar não altera em nada o registro do seu ponto._' || E'\n' ||
            'Secretaria Municipal de Saúde de Marabá';
    END IF;

    -- CANAL E DESTINO GRAVADOS JUNTOS. E o coracao desta migration: o despacho resolve cada um
    -- com um COALESCE proprio, entao gravar so metade do par e o que produzia "WhatsApp para
    -- endereco de e-mail". `telefone` vai preenchido apenas no caminho de WhatsApp - no de
    -- e-mail nao ha telefone a registrar, e inventar um seria pior que deixar nulo.
    INSERT INTO public.avisos_ponto_fila
        (tipo, servidor_id, unidade_id, telefone, mensagem, canal, destino)
    VALUES
        ('confirmacao_optin', p_servidor_id, v_servidor.unidade_id,
         v_telefone, v_mensagem, v_canal, v_destino);

    RETURN jsonb_build_object('success', true, 'status', 'pendente_confirmacao',
        'canal', v_canal,
        'message', CASE WHEN v_canal = 'email'
            THEN 'Enviamos um link de confirmação para ' || v_destino || '. '
              || 'Abra a mensagem e clique no link para ativar o aviso.'
            ELSE 'Enviamos uma mensagem para o seu WhatsApp. Responda SIM naquela conversa '
              || 'para ativar o aviso.' END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_solicitar_aviso_ponto(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_solicitar_aviso_ponto(uuid, text, text, integer) TO service_role;


-- ============================================================================
-- 4. EXPIRAR O PEDIDO ENCERRA A LINHA DA FILA JUNTO
-- ============================================================================
-- Base: 20260809120000. Unica mudanca: o UPDATE da fila. Sem ele a linha fica orfa e e
-- despachada depois, pedindo confirmacao de um pedido que ja nao existe.
--
-- O token tambem e aposentado: o link de um pedido expirado nao pode continuar ativando nada.

CREATE OR REPLACE FUNCTION public.fn_expirar_optin_aviso_ponto()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_qtd integer := 0;
    v_row record;
BEGIN
    FOR v_row IN
        SELECT id, telefone FROM public.servidores
         WHERE aviso_ponto_status = 'pendente_confirmacao'
           AND aviso_ponto_expira_em IS NOT NULL
           AND aviso_ponto_expira_em < now()
    LOOP
        UPDATE public.servidores
           SET aviso_ponto_status = 'inativo', aviso_ponto_expira_em = NULL
         WHERE id = v_row.id;

        -- A linha da fila morre junto, com motivo legivel. Mesmo espirito do ramo PARAR de
        -- fn_confirmar_aviso_ponto, que ja fazia isto.
        UPDATE public.avisos_ponto_fila
           SET status = 'falha',
               motivo_falha = 'Pedido de confirmação expirou antes de ser enviado.',
               processado_em = now()
         WHERE servidor_id = v_row.id
           AND tipo = 'confirmacao_optin'
           AND status = 'pendente';

        UPDATE public.tokens_portal
           SET substituido_em = now()
         WHERE servidor_id = v_row.id
           AND finalidade = 'confirmar_aviso_ponto'
           AND usado_em IS NULL
           AND substituido_em IS NULL;

        INSERT INTO public.logs_preferencia_aviso_ponto
            (servidor_id, acao, telefone_na_epoca, origem)
        VALUES (v_row.id, 'expirou', v_row.telefone, 'sistema');

        v_qtd := v_qtd + 1;
    END LOOP;

    RETURN v_qtd;
END;
$fn$;

COMMENT ON FUNCTION public.fn_expirar_optin_aviso_ponto() IS
    'Devolve a inativo quem nao respondeu no prazo, e encerra a linha da fila e o token junto. '
    'Sem reenvio: silencio e resposta.';

REVOKE ALL ON FUNCTION public.fn_expirar_optin_aviso_ponto() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_expirar_optin_aviso_ponto() TO service_role;


-- ============================================================================
-- 5. CONFIRMACAO PELO LINK DO E-MAIL
-- ============================================================================
-- Espelha os guards do ramo SIM de fn_confirmar_aviso_ponto: so vale para quem tem pedido
-- pendente e dentro do prazo. O que muda e a prova de posse - la e a resposta no numero, aqui e
-- a posse do token que so chegou naquele endereco.

CREATE OR REPLACE FUNCTION public.fn_confirmar_aviso_ponto_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_res      jsonb;
    v_servidor record;
BEGIN
    v_res := public.fn_consumir_token_portal(p_token, 'confirmar_aviso_ponto');

    IF NOT (v_res->>'success')::boolean THEN
        RETURN jsonb_build_object('success', false, 'motivo', v_res->>'motivo');
    END IF;

    SELECT s.id, s.nome, s.telefone, s.email, s.aviso_ponto_status, s.aviso_ponto_expira_em
      INTO v_servidor
      FROM public.servidores s
     WHERE s.id = (v_res->>'servidor_id')::uuid
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'motivo', 'invalido');
    END IF;

    IF v_servidor.aviso_ponto_status = 'ativo' THEN
        -- Segundo clique no mesmo link nao e erro para quem clicou; o resultado que ela queria
        -- ja aconteceu. Dizer "invalido" aqui mandaria a pessoa pedir de novo sem necessidade.
        RETURN jsonb_build_object('success', true, 'ja_estava_ativo', true,
            'nome', v_servidor.nome);
    END IF;

    IF v_servidor.aviso_ponto_status <> 'pendente_confirmacao' THEN
        RETURN jsonb_build_object('success', false, 'motivo', 'sem_pedido');
    END IF;

    IF v_servidor.aviso_ponto_expira_em IS NOT NULL
       AND v_servidor.aviso_ponto_expira_em < now() THEN
        RETURN jsonb_build_object('success', false, 'motivo', 'expirado');
    END IF;

    UPDATE public.servidores
       SET aviso_ponto_status        = 'ativo',
           aviso_ponto_confirmado_em = now(),
           aviso_ponto_expira_em     = NULL
     WHERE id = v_servidor.id;

    INSERT INTO public.logs_preferencia_aviso_ponto
        (servidor_id, acao, telefone_na_epoca, origem)
    VALUES (v_servidor.id, 'confirmou', v_servidor.telefone, 'portal_email');

    RETURN jsonb_build_object('success', true, 'nome', v_servidor.nome,
        'email', v_servidor.email);
END;
$fn$;

COMMENT ON FUNCTION public.fn_confirmar_aviso_ponto_token(text) IS
    'Passo 2 do double opt-in por e-mail: queima o token e ativa o aviso. Espelha os guards do '
    'ramo SIM de fn_confirmar_aviso_ponto.';

REVOKE ALL ON FUNCTION public.fn_confirmar_aviso_ponto_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_aviso_ponto_token(text) TO service_role;


-- ============================================================================
-- VERIFICACAO - EXECUTA as funcoes (armadilha 42)
-- ============================================================================
-- Conferir que a funcao EXISTE nao serve: plpgsql so resolve nome de coluna, de funcao e de
-- operador na EXECUCAO. Todo o cenario roda dentro de um bloco que e revertido ao final por
-- RAISE EXCEPTION proposital - nenhuma linha fica.

DO $verifica$
DECLARE
    v_serv    uuid;
    v_token   text;
    v_res     jsonb;
    v_fila    record;
BEGIN
    BEGIN
        SELECT id INTO v_serv FROM public.servidores WHERE status = 'Ativo' LIMIT 1;
        IF v_serv IS NULL THEN
            RAISE NOTICE 'OK (parcial): sem servidor ativo para o ensaio.';
            RETURN;
        END IF;

        -- --- token: emitir, consumir, e o uso unico ---------------------------------------
        v_token := public.fn_emitir_token_portal(v_serv, 'redefinir_pin', 30);
        IF v_token IS NULL OR length(v_token) <> 64 THEN
            RAISE EXCEPTION 'ABORTADO: fn_emitir_token_portal nao devolveu token de 64 hex.';
        END IF;

        v_res := public.fn_consumir_token_portal(v_token, 'redefinir_pin');
        IF NOT (v_res->>'success')::boolean THEN
            RAISE EXCEPTION 'ABORTADO: token recem-emitido foi recusado (%).', v_res->>'motivo';
        END IF;

        v_res := public.fn_consumir_token_portal(v_token, 'redefinir_pin');
        IF (v_res->>'success')::boolean OR v_res->>'motivo' <> 'ja_usado' THEN
            RAISE EXCEPTION 'ABORTADO: token aceitou SEGUNDO uso (%).', v_res::text;
        END IF;

        -- Finalidade errada nao pode abrir a porta de outra.
        v_token := public.fn_emitir_token_portal(v_serv, 'redefinir_pin', 30);
        v_res := public.fn_consumir_token_portal(v_token, 'confirmar_aviso_ponto');
        IF (v_res->>'success')::boolean THEN
            RAISE EXCEPTION 'ABORTADO: token de redefinir_pin foi aceito como confirmar_aviso_ponto.';
        END IF;

        -- --- a fila aceita item sem telefone, mas nao sem NENHUM endereco -----------------
        BEGIN
            INSERT INTO public.avisos_ponto_fila
                (tipo, servidor_id, telefone, mensagem, canal, destino)
            VALUES ('confirmacao_optin', v_serv, NULL, 'ensaio', NULL, NULL);
            RAISE EXCEPTION 'ABORTADO: a fila aceitou linha sem telefone E sem destino.';
        EXCEPTION
            WHEN check_violation THEN NULL;   -- esperado
        END;

        INSERT INTO public.avisos_ponto_fila
            (tipo, servidor_id, telefone, mensagem, canal, destino)
        VALUES ('confirmacao_optin', v_serv, NULL, 'ensaio', 'email', 'ensaio@exemplo.test');

        -- --- privilegios: nada disto pode ficar aberto ------------------------------------
        IF has_function_privilege('anon', 'public.fn_emitir_token_portal(uuid, text, integer, text, text)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.fn_consumir_token_portal(text, text)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.fn_confirmar_aviso_ponto_token(text)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.fn_solicitar_aviso_ponto(uuid, text, text, integer)', 'EXECUTE') THEN
            RAISE EXCEPTION 'ABORTADO: funcao do opt-in executavel por anon.';
        END IF;

        RAISE EXCEPTION 'ENSAIO_OK';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM = 'ENSAIO_OK' THEN
                RAISE NOTICE 'OK: token de uso unico, isolamento por finalidade, CHECK de destino e privilegios conferidos (ensaio revertido).';
            ELSE
                RAISE;
            END IF;
    END;
END
$verifica$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve)
-- ============================================================================
--
-- 1) Nenhuma linha pendente pode mandar WhatsApp para endereco de e-mail:
--
--      SELECT count(*) FROM avisos_ponto_fila
--       WHERE status = 'pendente' AND canal = 'whatsapp' AND destino LIKE '%@%';
--      -- esperado: 0
--
-- 2) Opt-in novo nasce com o par completo:
--
--      SELECT tipo, canal, destino, telefone FROM avisos_ponto_fila
--       WHERE tipo = 'confirmacao_optin' ORDER BY criado_em DESC LIMIT 5;
--      -- canal='email'    -> destino com @, telefone NULL
--      -- canal='whatsapp' -> destino so digitos, telefone preenchido
--
-- 3) Expirar nao deixa linha orfa:
--
--      SELECT s.aviso_ponto_status, f.status, count(*)
--        FROM avisos_ponto_fila f JOIN servidores s ON s.id = f.servidor_id
--       WHERE f.tipo = 'confirmacao_optin' GROUP BY 1, 2;
--      -- nao pode existir (inativo, pendente)
