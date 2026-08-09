-- Migration: Aviso de registro de ponto por WhatsApp (double opt-in confirmado no proprio canal)
-- Data: 2026-08-09
--
-- Plano: docs/planos/2026-08-09-comprovante-de-ponto-por-whatsapp.md
--
-- O QUE ESTA FEATURE E, E O QUE ELA NAO E
--   Reclamacao de origem: quem bate no terminal nao leva nada embora - a tela some em 3 segundos
--   (6 no caso ambar) - enquanto quem bate no relogio REP-C sai com papel na mao.
--
--   O que esta migration entrega e um AVISO INFORMATIVO. NAO e o "Comprovante de Registro de
--   Ponto do Trabalhador" do Art. 79 da Portaria 671/2021, e a mensagem diz isso com todas as
--   letras. O Art. 79 exige nove campos, e quatro sao inatingiveis hoje:
--     II  - NSR                        (preenchido em 2 de 7.179 marcacoes - so as do relogio)
--     VII - numero de registro no INPI (o SisEscala nao tem)
--     VIII- hash SHA-256 da marcacao   (nao existe)
--     IX  - assinatura eletronica      (exige certificado ICP-Brasil, Art. 88)
--
--   Chamar um texto de WhatsApp de "Comprovante" criaria documento que PARECE oficial e nao e -
--   em disputa isso e pior que nao ter nada. O comprovante de verdade e o PDF no Portal, que
--   atende o Art. 80 (acesso eletronico apos cada marcacao) e fica para fase propria.
--
-- DOUBLE OPT-IN (decidido em 09/08/2026)
--   Nada e enviado sem DUAS confirmacoes do servidor, em canais diferentes:
--
--     1. no Portal do Servidor, autenticado por PIN, ele le o termo e aceita;
--     2. o sistema manda UMA mensagem no WhatsApp pedindo que ele responda;
--     3. so quando a resposta chega (webhook) o aviso passa a valer.
--
--   Nao e burocracia - resolve tres problemas de uma vez:
--
--   a) BANIMENTO. O sinal dominante de spam no WhatsApp e taxa de bloqueio/denuncia, e o padrao
--      que a dispara e conversa de MAO UNICA. A resposta do servidor transforma o numero em
--      interlocutor: mensagem recebida de volta e o sinal positivo mais forte que existe. E o
--      numero em uso e o MESMO do acionamento de sobreaviso - um banimento derrubaria o fluxo de
--      urgencia da rede junto.
--
--   b) POSSE DO NUMERO. O opt-in do Portal prova a identidade (PIN), mas nao prova que o telefone
--      do CADASTRO e daquela pessoa - pode estar desatualizado ou trocado. A resposta prova posse
--      do aparelho. Fecha o risco de aviso de ponto chegar na mao de terceiro melhor do que
--      qualquer checagem de exclusividade conseguiria.
--
--   c) LGPD. Consentimento confirmado no proprio canal do tratamento, com o texto integral do
--      termo e a resposta bruta guardados.
--
--   Pedido de confirmacao NAO respondido expira e NAO e reenviado. Silencio e resposta: quem nao
--   respondeu nao quer, e insistir e exatamente o comportamento que gera bloqueio.
--
-- NADA DISSO PODE ATRAPALHAR A BATIDA
--   Todo o corpo do gatilho esta sob EXCEPTION WHEN OTHERS, virando WARNING - mesma escolha de
--   20260808070000. Perder um aviso e infinitamente melhor que travar o terminal de uma unidade.
--   O envio acontece FORA da transacao, drenado por worker: nenhuma chamada HTTP entra no caminho
--   de quem esta batendo o ponto.


-- ============================================================================
-- 1. CONFIGURACAO POR UNIDADE
-- ============================================================================
-- Colunas reais, nao JSON em configuracoes_globais: o gatilho precisa ler isso em SQL a cada
-- marcacao. DEFAULT false fecha por padrao - aplicar esta migration NAO envia nada a ninguem.
-- Ligar uma unidade e ato deliberado da coordenacao, igual a sobreaviso_abrangencia.

ALTER TABLE public.unidades
    ADD COLUMN IF NOT EXISTS aviso_ponto_whatsapp boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS aviso_ponto_eventos  text[]  NOT NULL
        DEFAULT ARRAY['entrada', 'saida', 'fora_janela'];

COMMENT ON COLUMN public.unidades.aviso_ponto_whatsapp IS
    'Habilita o aviso de ponto por WhatsApp nesta unidade. Precisa TAMBEM do double opt-in do servidor.';
COMMENT ON COLUMN public.unidades.aviso_ponto_eventos IS
    'Quais passos geram aviso: entrada, saida, saida_intervalo, retorno_intervalo, fora_janela.';


-- ============================================================================
-- 2. ESTADO DO OPT-IN DO SERVIDOR
-- ============================================================================
-- Tres estados, nao um booleano. 'pendente_confirmacao' e um estado de verdade: o servidor ja
-- aceitou no Portal mas ainda nao respondeu no WhatsApp - e nesse intervalo NAO se envia aviso
-- nenhum, so o pedido de confirmacao.

ALTER TABLE public.servidores
    ADD COLUMN IF NOT EXISTS aviso_ponto_status text NOT NULL DEFAULT 'inativo',
    ADD COLUMN IF NOT EXISTS aviso_ponto_definido_em      timestamptz,
    ADD COLUMN IF NOT EXISTS aviso_ponto_confirmado_em    timestamptz,
    ADD COLUMN IF NOT EXISTS aviso_ponto_expira_em        timestamptz;

DO $chk$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aviso_ponto_status') THEN
        ALTER TABLE public.servidores
            ADD CONSTRAINT chk_aviso_ponto_status
            CHECK (aviso_ponto_status IN ('inativo', 'pendente_confirmacao', 'ativo'));
    END IF;
END
$chk$;

COMMENT ON COLUMN public.servidores.aviso_ponto_status IS
    'inativo (default) | pendente_confirmacao (aceitou no Portal, falta responder no WhatsApp) | ativo.';
COMMENT ON COLUMN public.servidores.aviso_ponto_expira_em IS
    'Prazo do pedido de confirmacao. Vencido sem resposta volta a inativo e NAO se reenvia.';


-- ============================================================================
-- 3. REGISTRO DO CONSENTIMENTO (APPEND-ONLY)
-- ============================================================================
-- O termo e gravado POR INTEIRO, nao por referencia a uma versao. Um termo que mude depois
-- deixaria o registro provando ciencia de um texto que a pessoa nunca leu - mesmo raciocinio
-- que faz escala_prevista_inicio de logs_tentativas_presenca ser historico e nao recalculado.
--
-- 'confirmou' guarda a resposta BRUTA vinda do webhook. E ela que prova a posse do numero, entao
-- guardar so "confirmou = true" perderia justamente a evidencia.

CREATE TABLE IF NOT EXISTS public.logs_preferencia_aviso_ponto (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id       uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    acao              text NOT NULL CHECK (acao IN
                        ('solicitou', 'confirmou', 'desativou', 'expirou', 'parou_pelo_whatsapp')),
    termo_texto       text,
    termo_versao      text,
    telefone_na_epoca text,
    resposta_bruta    jsonb,
    origem            text NOT NULL DEFAULT 'portal',
    registrado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_pref_aviso_servidor
    ON public.logs_preferencia_aviso_ponto (servidor_id, registrado_em DESC);

COMMENT ON TABLE public.logs_preferencia_aviso_ponto IS
    'Historico do consentimento do servidor para o aviso de ponto. Append-only: guarda o texto '
    'exato do termo que ele leu e a resposta bruta que ele mandou no WhatsApp.';

ALTER TABLE public.logs_preferencia_aviso_ponto ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.logs_preferencia_aviso_ponto FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.logs_preferencia_aviso_ponto TO authenticated;
GRANT ALL    ON public.logs_preferencia_aviso_ponto TO service_role;

DROP POLICY IF EXISTS "Consentimento visivel a quem administra" ON public.logs_preferencia_aviso_ponto;
CREATE POLICY "Consentimento visivel a quem administra"
    ON public.logs_preferencia_aviso_ponto FOR SELECT
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.role IN ('admin', 'super_admin', 'coordenador')
    ));


-- ============================================================================
-- 4. FILA DE ENVIOS
-- ============================================================================
-- A fila existe para tirar o HTTP do caminho da batida. O gatilho so enfileira (INSERT local,
-- microssegundos); quem fala com a API do WhatsApp e o worker, depois, fora da transacao.
--
-- Os dois tipos de mensagem passam pela MESMA fila de proposito: um so ponto de vazao, um so
-- throttle, um so lugar para observar a saude da sessao.

CREATE TABLE IF NOT EXISTS public.avisos_ponto_fila (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo          text NOT NULL DEFAULT 'registro'
                  CHECK (tipo IN ('registro', 'confirmacao_optin')),
    marcacao_id   uuid UNIQUE REFERENCES public.marcacoes_ponto(id) ON DELETE CASCADE,
    servidor_id   uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    unidade_id    uuid REFERENCES public.unidades(id),
    telefone      text NOT NULL,
    mensagem      text NOT NULL,
    evento        text,
    status        text NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'enviado', 'falha')),
    tentativas    integer NOT NULL DEFAULT 0,
    motivo_falha  text,
    criado_em     timestamptz NOT NULL DEFAULT now(),
    processado_em timestamptz,
    -- marcacao_id UNIQUE ja da idempotencia ao tipo 'registro'. Para o pedido de confirmacao,
    -- o que precisa ser unico e "um pendente por servidor" - insistir e o que gera bloqueio.
    CONSTRAINT chk_aviso_registro_tem_marcacao
        CHECK (tipo <> 'registro' OR marcacao_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_aviso_confirmacao_unica_por_servidor
    ON public.avisos_ponto_fila (servidor_id)
 WHERE tipo = 'confirmacao_optin' AND status = 'pendente';

CREATE INDEX IF NOT EXISTS idx_avisos_ponto_fila_pendentes
    ON public.avisos_ponto_fila (criado_em)
 WHERE status = 'pendente';

COMMENT ON TABLE public.avisos_ponto_fila IS
    'Fila de mensagens de ponto. Enfileirada por gatilho ou pelo opt-in, drenada por worker - o '
    'envio nunca entra na transacao de quem esta batendo o ponto.';

ALTER TABLE public.avisos_ponto_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avisos_ponto_fila FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.avisos_ponto_fila TO authenticated;
GRANT ALL    ON public.avisos_ponto_fila TO service_role;

DROP POLICY IF EXISTS "Fila visivel a quem administra" ON public.avisos_ponto_fila;
CREATE POLICY "Fila visivel a quem administra"
    ON public.avisos_ponto_fila FOR SELECT
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.role IN ('admin', 'super_admin', 'coordenador')
    ));


-- ============================================================================
-- 5. TELEFONE UTILIZAVEL
-- ============================================================================
-- Telefone compartilhado por dois servidores faria o aviso da batida de um chegar como se fosse
-- do outro. Em 09/08/2026 havia um caso (o cadastro duplicado da VIVIAN, resolvido em
-- 20260809110000), mas o indice unico por CPF nao elimina a hipotese: duas pessoas podem
-- legitimamente dividir um telefone de familia.
--
-- Na duvida, NAO ENVIA. Um aviso perdido e um incomodo; um aviso de ponto na mao de outra pessoa
-- e vazamento de dado pessoal.
--
-- Tambem e a funcao que casa o telefone que RESPONDEU o webhook com o servidor. Por isso o
-- retorno e normalizado, e o casamento no webhook usa os ultimos digitos (o WhatsApp entrega o
-- numero brasileiro ora com, ora sem o 9o digito - ver getWhatsAppPhoneVariants em
-- src/app/actions/communication.ts).

CREATE OR REPLACE FUNCTION public.fn_telefone_aviso_ponto(p_servidor_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT CASE
             WHEN length(tel) BETWEEN 10 AND 13
              AND (SELECT count(*) FROM public.servidores o
                    WHERE NULLIF(regexp_replace(COALESCE(o.telefone, ''), '[^0-9]', '', 'g'), '') = tel) = 1
             THEN tel
           END
      FROM (
        SELECT NULLIF(regexp_replace(COALESCE(s.telefone, ''), '[^0-9]', '', 'g'), '') AS tel
          FROM public.servidores s
         WHERE s.id = p_servidor_id
      ) x
$fn$;

COMMENT ON FUNCTION public.fn_telefone_aviso_ponto(uuid) IS
    'Telefone do servidor, apenas se for utilizavel E exclusivo dele. NULL se compartilhado com '
    'outro cadastro - nesse caso nao se envia, para nao entregar dado de ponto a terceiro.';


-- ============================================================================
-- 6. GATILHO DE ENFILEIRAMENTO DO AVISO
-- ============================================================================
-- COMO O PASSO E DESCOBERTO SEM INFERIR NADA
--   marcacoes_ponto nao tem coluna de passo, e adivinha-lo reintroduziria justamente a inferencia
--   que o modelo de marcacoes existe para eliminar (CLAUDE.md). Mas nao e preciso adivinhar:
--   trg_sincronizar_marcacoes (20260808070000) e AFTER INSERT OR UPDATE em escala_diaria e insere
--   a marcacao COMO PARTE daquele UPDATE. Quando este gatilho dispara, escala_diaria JA tem o
--   valor gravado - basta ler qual coluna casa com o timestamp. E leitura, nao re-derivacao.
--
--   O caminho ambar (fn_registrar_ponto, 20260808100000) NAO escreve em escala_diaria. Nenhuma
--   coluna casa, o passo sai NULL, e e exatamente assim que o evento 'fora_janela' se identifica.
--   Nenhuma funcao existente precisa ser alterada por esta migration.

CREATE OR REPLACE FUNCTION public.fn_enfileirar_aviso_ponto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_timezone   text;
    v_evento     text;
    v_unidade    record;
    v_servidor   record;
    v_telefone   text;
    v_local      timestamp;
    v_situacao   text;
    v_mensagem   text;
BEGIN
    -- ---- Filtros baratos primeiro -----------------------------------------
    -- Somente batida REAL de terminal ou relogio. 'ajuste_coordenador' e 'ajuste_servidor' sao
    -- declaracao, nao batida - avisar "voce bateu as 08:00" sobre horario que o sistema derivou
    -- seria a vedacao 2 da Portaria 671 pela porta da notificacao.
    IF NEW.origem NOT IN ('terminal', 'rep') THEN
        RETURN NULL;
    END IF;

    IF COALESCE(NEW.sintetica, false) THEN
        RETURN NULL;
    END IF;

    -- Backfill, sync historico e reprocessamento nao podem disparar 7.000 mensagens de uma vez.
    IF NEW.ocorrido_em < now() - interval '10 minutes' THEN
        RETURN NULL;
    END IF;

    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    -- ---- Unidade ligada? ---------------------------------------------------
    SELECT u.id, u.nome, u.aviso_ponto_whatsapp, u.aviso_ponto_eventos
      INTO v_unidade
      FROM public.unidades u
     WHERE u.id = NEW.unidade_id;

    IF NOT FOUND OR NOT v_unidade.aviso_ponto_whatsapp THEN
        RETURN NULL;
    END IF;

    -- ---- Servidor confirmou nos DOIS canais? ------------------------------
    -- 'pendente_confirmacao' nao envia: ele aceitou no Portal mas ainda nao respondeu no
    -- WhatsApp, e mandar antes disso e exatamente a mensagem nao solicitada que se quer evitar.
    SELECT s.id, s.nome, s.aviso_ponto_status
      INTO v_servidor
      FROM public.servidores s
     WHERE s.id = NEW.servidor_id;

    IF NOT FOUND OR v_servidor.aviso_ponto_status <> 'ativo' THEN
        RETURN NULL;
    END IF;

    v_telefone := public.fn_telefone_aviso_ponto(NEW.servidor_id);
    IF v_telefone IS NULL THEN
        RETURN NULL;
    END IF;

    -- ---- Qual passo? Leitura do que acabou de ser gravado ------------------
    SELECT CASE NEW.ocorrido_em
             WHEN ed.presenca_entrada_em           THEN 'entrada'
             WHEN ed.presenca_intervalo_saida_em   THEN 'saida_intervalo'
             WHEN ed.presenca_intervalo_retorno_em THEN 'retorno_intervalo'
             WHEN ed.presenca_saida_em             THEN 'saida'
           END
      INTO v_evento
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE em.servidor_id = NEW.servidor_id
       AND NEW.ocorrido_em IN (ed.presenca_entrada_em, ed.presenca_intervalo_saida_em,
                               ed.presenca_intervalo_retorno_em, ed.presenca_saida_em)
     LIMIT 1;

    -- Sem casamento = a marcacao nao virou presenca em escala_diaria = ficou pendente de revisao.
    IF v_evento IS NULL THEN
        v_evento := 'fora_janela';
    END IF;

    IF NOT (v_evento = ANY (v_unidade.aviso_ponto_eventos)) THEN
        RETURN NULL;
    END IF;

    -- ---- Mensagem ----------------------------------------------------------
    v_local := NEW.ocorrido_em AT TIME ZONE v_timezone;

    IF v_evento = 'fora_janela' THEN
        -- O caso que mais precisa do aviso: a tela do terminal some em 6 segundos e o servidor
        -- fica sem nada que prove que registrou. "Nao precisa bater de novo" existe pela mesma
        -- razao da cor ambar no terminal - evitar que o aviso seja lido como recusa.
        v_situacao := '*Registrado fora do horário previsto.* A marcação é válida e foi enviada '
                   || 'para revisão do seu coordenador. Você não precisa bater de novo.';
    ELSE
        v_situacao := 'Registrado dentro do horário previsto.';
    END IF;

    -- O passo (entrada/saida/intervalo) NAO aparece de proposito: ele pode mudar quando o
    -- coordenador revisa, e o aviso ja estara no celular da pessoa - a contradicao seria pior
    -- que a omissao. O Art. 79 VI pede "data e horario do respectivo registro", nada mais.
    v_mensagem :=
        '📌 *Aviso de Registro de Ponto*' || E'\n\n' ||
        'Olá, ' || COALESCE(v_servidor.nome, 'servidor(a)') || '.' || E'\n' ||
        'Seu ponto foi registrado em ' || to_char(v_local, 'DD/MM/YYYY') ||
        ' às ' || to_char(v_local, 'HH24:MI') || '.' || E'\n' ||
        'Local: ' || COALESCE(v_unidade.nome, 'não informado') || E'\n\n' ||
        'Situação: ' || v_situacao || E'\n\n' ||
        '_Este é um aviso informativo e não é o Comprovante de Registro de Ponto._' || E'\n' ||
        '_Seus registros ficam disponíveis no Portal do Servidor._' || E'\n' ||
        'SisEscala — Secretaria Municipal de Saúde de Marabá' || E'\n\n' ||
        '_Para parar de receber, responda PARAR._';

    INSERT INTO public.avisos_ponto_fila
        (tipo, marcacao_id, servidor_id, unidade_id, telefone, mensagem, evento)
    VALUES
        ('registro', NEW.id, NEW.servidor_id, NEW.unidade_id, v_telefone, v_mensagem, v_evento)
    ON CONFLICT (marcacao_id) DO NOTHING;

    RETURN NULL;

EXCEPTION WHEN OTHERS THEN
    -- O aviso NUNCA pode impedir alguem de bater o ponto. Mesma escolha de 20260808070000.
    RAISE WARNING 'fn_enfileirar_aviso_ponto falhou para marcacao %: %', NEW.id, SQLERRM;
    RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enfileirar_aviso_ponto ON public.marcacoes_ponto;

CREATE TRIGGER trg_enfileirar_aviso_ponto
    AFTER INSERT ON public.marcacoes_ponto
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_enfileirar_aviso_ponto();


-- ============================================================================
-- 7. PASSO 1 DO OPT-IN — ACEITE NO PORTAL
-- ============================================================================
-- service_role apenas, igual a fn_solicitar_ajuste_ponto (20260808130000): o Portal autentica
-- so por PIN e a server action e chamavel direto, entao a RPC nao pode estar exposta a
-- 'authenticated' nem a 'anon'. Quem valida a sessao e a action, antes de chamar.

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
    v_telefone text;
    v_mensagem text;
BEGIN
    IF p_termo_texto IS NULL OR btrim(p_termo_texto) = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'O termo de ciência não pode ser vazio.');
    END IF;

    SELECT s.id, s.nome, s.telefone, s.aviso_ponto_status
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

    v_telefone := public.fn_telefone_aviso_ponto(p_servidor_id);
    IF v_telefone IS NULL THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Não há um telefone válido e exclusivo no seu cadastro. '
                    || 'Procure seu coordenador para atualizar antes de ativar o aviso.');
    END IF;

    -- Ja existe pedido pendente? Nao reenvia. Insistir e o comportamento que gera bloqueio, e o
    -- indice parcial idx_aviso_confirmacao_unica_por_servidor tambem barraria.
    IF EXISTS (SELECT 1 FROM public.avisos_ponto_fila f
                WHERE f.servidor_id = p_servidor_id
                  AND f.tipo = 'confirmacao_optin'
                  AND f.status = 'pendente') THEN
        RETURN jsonb_build_object('success', true, 'status', 'pendente_confirmacao',
            'message', 'Já enviamos a mensagem de confirmação para o seu WhatsApp. '
                    || 'Responda SIM naquela conversa para ativar.');
    END IF;

    UPDATE public.servidores
       SET aviso_ponto_status  = 'pendente_confirmacao',
           aviso_ponto_definido_em = now(),
           aviso_ponto_expira_em   = now() + make_interval(hours => GREATEST(COALESCE(p_prazo_horas, 48), 1))
     WHERE id = p_servidor_id;

    INSERT INTO public.logs_preferencia_aviso_ponto
        (servidor_id, acao, termo_texto, termo_versao, telefone_na_epoca, origem)
    VALUES
        (p_servidor_id, 'solicitou', p_termo_texto, p_termo_versao, v_servidor.telefone, 'portal');

    v_mensagem :=
        '🔐 *SisEscala — confirmação de cadastro*' || E'\n\n' ||
        'Olá, ' || COALESCE(v_servidor.nome, 'servidor(a)') || '.' || E'\n' ||
        'Você pediu, no Portal do Servidor, para receber um aviso neste WhatsApp a cada vez que '
        || 'registrar seu ponto.' || E'\n\n' ||
        '*Responda SIM nesta conversa para confirmar.*' || E'\n\n' ||
        'Se não foi você, ignore esta mensagem — sem a sua resposta nada é enviado, e não '
        || 'insistiremos.' || E'\n\n' ||
        '_O aviso é informativo e não é o Comprovante de Registro de Ponto. Ativar ou não '
        || 'ativar não altera em nada o registro do seu ponto._' || E'\n' ||
        'Secretaria Municipal de Saúde de Marabá';

    INSERT INTO public.avisos_ponto_fila
        (tipo, servidor_id, unidade_id, telefone, mensagem)
    SELECT 'confirmacao_optin', p_servidor_id, s.unidade_id, v_telefone, v_mensagem
      FROM public.servidores s WHERE s.id = p_servidor_id;

    RETURN jsonb_build_object('success', true, 'status', 'pendente_confirmacao',
        'message', 'Enviamos uma mensagem para o seu WhatsApp. Responda SIM naquela conversa '
                || 'para ativar o aviso.');
END;
$fn$;

COMMENT ON FUNCTION public.fn_solicitar_aviso_ponto(uuid, text, text, integer) IS
    'Passo 1 do double opt-in: grava o aceite do Portal e enfileira o pedido de confirmacao no '
    'WhatsApp. NAO ativa - quem ativa e a resposta do servidor, via fn_confirmar_aviso_ponto.';

REVOKE ALL ON FUNCTION public.fn_solicitar_aviso_ponto(uuid, text, text, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_solicitar_aviso_ponto(uuid, text, text, integer) TO service_role;


-- ============================================================================
-- 8. PASSO 2 DO OPT-IN — RESPOSTA NO WHATSAPP (WEBHOOK)
-- ============================================================================
-- Recebe o telefone que respondeu e o texto. O casamento telefone -> servidor usa os ultimos 8
-- digitos: o WhatsApp devolve o numero brasileiro ora com, ora sem o 9o digito, e comparar
-- string inteira perderia metade das respostas (mesmo problema tratado em
-- getWhatsAppPhoneVariants, src/app/actions/communication.ts).
--
-- Oito digitos e o corpo do numero sem DDD nem o 9. Se dois servidores casarem, NAO decide -
-- confirmar o opt-in da pessoa errada colocaria o ponto de um no celular do outro.

CREATE OR REPLACE FUNCTION public.fn_confirmar_aviso_ponto(
    p_telefone text,
    p_texto    text,
    p_payload  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_tel       text;
    v_sufixo    text;
    v_servidor  record;
    v_quantos   integer;
    v_resposta  text;
BEGIN
    v_tel := NULLIF(regexp_replace(COALESCE(p_telefone, ''), '[^0-9]', '', 'g'), '');
    IF v_tel IS NULL OR length(v_tel) < 8 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Telefone ausente ou inválido.');
    END IF;
    v_sufixo := right(v_tel, 8);

    v_resposta := upper(btrim(translate(COALESCE(p_texto, ''),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
        'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')));

    SELECT count(*) INTO v_quantos
      FROM public.servidores s
     WHERE right(regexp_replace(COALESCE(s.telefone, ''), '[^0-9]', '', 'g'), 8) = v_sufixo;

    IF v_quantos = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nenhum servidor com este telefone.');
    END IF;
    IF v_quantos > 1 THEN
        -- Ambiguidade nao se resolve no chute: ativaria o aviso da pessoa errada.
        RETURN jsonb_build_object('success', false,
            'message', 'Telefone corresponde a mais de um cadastro; confirmação não aplicada.');
    END IF;

    SELECT s.id, s.nome, s.telefone, s.aviso_ponto_status, s.aviso_ponto_expira_em
      INTO v_servidor
      FROM public.servidores s
     WHERE right(regexp_replace(COALESCE(s.telefone, ''), '[^0-9]', '', 'g'), 8) = v_sufixo;

    -- ---- PARAR: honrado SEMPRE, em qualquer estado -------------------------
    -- Ignorar pedido de parada e o caminho mais curto para denuncia e banimento. Vale mesmo para
    -- quem nunca ativou - a resposta certa e sempre desligar.
    IF v_resposta IN ('PARAR', 'PARE', 'SAIR', 'STOP', 'CANCELAR', 'DESCADASTRAR') THEN
        UPDATE public.servidores
           SET aviso_ponto_status = 'inativo',
               aviso_ponto_expira_em = NULL
         WHERE id = v_servidor.id;

        UPDATE public.avisos_ponto_fila
           SET status = 'falha', motivo_falha = 'Servidor pediu PARAR', processado_em = now()
         WHERE servidor_id = v_servidor.id AND status = 'pendente';

        INSERT INTO public.logs_preferencia_aviso_ponto
            (servidor_id, acao, telefone_na_epoca, resposta_bruta, origem)
        VALUES (v_servidor.id, 'parou_pelo_whatsapp', v_servidor.telefone, p_payload, 'whatsapp');

        RETURN jsonb_build_object('success', true, 'acao', 'parou',
            'servidor_id', v_servidor.id,
            'resposta', 'Pronto, você não receberá mais avisos de ponto. '
                     || 'Seus registros continuam normais e disponíveis no Portal do Servidor.');
    END IF;

    -- ---- SIM: só vale para quem tem pedido pendente e no prazo --------------
    IF v_servidor.aviso_ponto_status <> 'pendente_confirmacao' THEN
        RETURN jsonb_build_object('success', false, 'acao', 'ignorado',
            'message', 'Não há confirmação pendente para este servidor.');
    END IF;

    IF v_servidor.aviso_ponto_expira_em IS NOT NULL
       AND v_servidor.aviso_ponto_expira_em < now() THEN
        RETURN jsonb_build_object('success', false, 'acao', 'expirado',
            'message', 'O prazo de confirmação expirou.');
    END IF;

    IF v_resposta NOT IN ('SIM', 'S', 'ACEITO', 'CONFIRMO', 'OK', 'CONCORDO') THEN
        RETURN jsonb_build_object('success', false, 'acao', 'nao_reconhecido',
            'message', 'Resposta não reconhecida como confirmação.');
    END IF;

    UPDATE public.servidores
       SET aviso_ponto_status    = 'ativo',
           aviso_ponto_confirmado_em = now(),
           aviso_ponto_expira_em = NULL
     WHERE id = v_servidor.id;

    INSERT INTO public.logs_preferencia_aviso_ponto
        (servidor_id, acao, telefone_na_epoca, resposta_bruta, origem)
    VALUES (v_servidor.id, 'confirmou', v_servidor.telefone, p_payload, 'whatsapp');

    RETURN jsonb_build_object('success', true, 'acao', 'confirmou',
        'servidor_id', v_servidor.id,
        'resposta', 'Confirmado! Você receberá um aviso aqui a cada registro de ponto. '
                 || 'Para parar a qualquer momento, responda PARAR.');
END;
$fn$;

COMMENT ON FUNCTION public.fn_confirmar_aviso_ponto(text, text, jsonb) IS
    'Passo 2 do double opt-in: processa a resposta vinda do webhook do WhatsApp. Honra PARAR em '
    'qualquer estado. Casa telefone pelos ultimos 8 digitos (9o digito e instavel) e recusa '
    'decidir quando o sufixo casa com mais de um cadastro.';

REVOKE ALL ON FUNCTION public.fn_confirmar_aviso_ponto(text, text, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_aviso_ponto(text, text, jsonb) TO service_role;


-- ============================================================================
-- 9. DESATIVACAO PELO PORTAL
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_desativar_aviso_ponto(
    p_servidor_id  uuid,
    p_termo_texto  text,
    p_termo_versao text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_telefone text;
BEGIN
    SELECT s.telefone INTO v_telefone FROM public.servidores s WHERE s.id = p_servidor_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Servidor não encontrado.');
    END IF;

    UPDATE public.servidores
       SET aviso_ponto_status = 'inativo',
           aviso_ponto_definido_em = now(),
           aviso_ponto_expira_em = NULL
     WHERE id = p_servidor_id;

    UPDATE public.avisos_ponto_fila
       SET status = 'falha', motivo_falha = 'Servidor desativou pelo Portal', processado_em = now()
     WHERE servidor_id = p_servidor_id AND status = 'pendente';

    INSERT INTO public.logs_preferencia_aviso_ponto
        (servidor_id, acao, termo_texto, termo_versao, telefone_na_epoca, origem)
    VALUES (p_servidor_id, 'desativou', p_termo_texto, p_termo_versao, v_telefone, 'portal');

    RETURN jsonb_build_object('success', true, 'status', 'inativo',
        'message', 'Aviso desativado. Você não receberá mais mensagens de registro de ponto.');
END;
$fn$;

COMMENT ON FUNCTION public.fn_desativar_aviso_ponto(uuid, text, text) IS
    'Desliga o aviso pelo Portal e cancela o que estiver pendente na fila.';

REVOKE ALL ON FUNCTION public.fn_desativar_aviso_ponto(uuid, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_desativar_aviso_ponto(uuid, text, text) TO service_role;


-- ============================================================================
-- 10. EXPIRACAO DOS PEDIDOS NAO RESPONDIDOS
-- ============================================================================
-- Silencio e resposta. Quem nao respondeu nao quer, e NAO se reenvia - insistir e exatamente o
-- comportamento que gera bloqueio e, por consequencia, banimento do numero.

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

        INSERT INTO public.logs_preferencia_aviso_ponto
            (servidor_id, acao, telefone_na_epoca, origem)
        VALUES (v_row.id, 'expirou', v_row.telefone, 'sistema');

        v_qtd := v_qtd + 1;
    END LOOP;

    RETURN v_qtd;
END;
$fn$;

COMMENT ON FUNCTION public.fn_expirar_optin_aviso_ponto() IS
    'Devolve a inativo quem nao respondeu no prazo. Sem reenvio: silencio e resposta.';

GRANT EXECUTE ON FUNCTION public.fn_expirar_optin_aviso_ponto() TO service_role;


-- ============================================================================
-- 11. INTERFACE DO WORKER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_avisos_ponto_pendentes(p_limite integer DEFAULT 20)
RETURNS TABLE (
    id          uuid,
    tipo        text,
    servidor_id uuid,
    unidade_id  uuid,
    telefone    text,
    mensagem    text,
    evento      text,
    tentativas  integer
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
    -- SKIP LOCKED: duas execucoes sobrepostas do cron nunca pegam o mesmo aviso.
    -- Confirmacao de opt-in na frente: e a mensagem que a pessoa esta esperando na tela.
    UPDATE public.avisos_ponto_fila f
       SET tentativas = f.tentativas + 1
     WHERE f.id IN (
        SELECT c.id FROM public.avisos_ponto_fila c
         WHERE c.status = 'pendente' AND c.tentativas < 3
         ORDER BY (c.tipo = 'confirmacao_optin') DESC, c.criado_em
         LIMIT GREATEST(COALESCE(p_limite, 20), 1)
         FOR UPDATE SKIP LOCKED
     )
    RETURNING f.id, f.tipo, f.servidor_id, f.unidade_id, f.telefone, f.mensagem, f.evento, f.tentativas
$fn$;

COMMENT ON FUNCTION public.fn_avisos_ponto_pendentes(integer) IS
    'Reserva ate p_limite mensagens pendentes e incrementa a tentativa. FOR UPDATE SKIP LOCKED '
    'para que execucoes sobrepostas do cron nao enviem a mesma mensagem duas vezes.';

GRANT EXECUTE ON FUNCTION public.fn_avisos_ponto_pendentes(integer) TO service_role;


CREATE OR REPLACE FUNCTION public.fn_concluir_aviso_ponto(
    p_id      uuid,
    p_sucesso boolean,
    p_motivo  text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
    UPDATE public.avisos_ponto_fila
       SET status = CASE WHEN p_sucesso THEN 'enviado'
                         WHEN tentativas >= 3 THEN 'falha'
                         ELSE 'pendente' END,
           motivo_falha  = CASE WHEN p_sucesso THEN NULL ELSE p_motivo END,
           processado_em = CASE WHEN p_sucesso OR tentativas >= 3 THEN now() END
     WHERE id = p_id
$fn$;

COMMENT ON FUNCTION public.fn_concluir_aviso_ponto(uuid, boolean, text) IS
    'Fecha o envio. Falha volta para pendente ate a 3a tentativa; depois vira falha definitiva '
    'com o motivo preservado.';

GRANT EXECUTE ON FUNCTION public.fn_concluir_aviso_ponto(uuid, boolean, text) TO service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. Nada foi ligado por engano (esperado: 0 e 0):
--
--      SELECT count(*) FROM unidades   WHERE aviso_ponto_whatsapp = true;
--      SELECT count(*) FROM servidores WHERE aviso_ponto_status <> 'inativo';
--
--   2. O gatilho existe e e AFTER INSERT:
--
--      SELECT tgname FROM pg_trigger
--       WHERE tgrelid = 'public.marcacoes_ponto'::regclass AND NOT tgisinternal;
--
--   3. Telefones que NAO servem para aviso (compartilhado ou invalido):
--
--      SELECT nome, matricula, telefone FROM servidores
--       WHERE public.fn_telefone_aviso_ponto(id) IS NULL;
--
--   4. Sufixos de 8 digitos ambiguos - nesses o webhook se recusa a decidir (esperado: 0):
--
--      SELECT right(regexp_replace(telefone, '[^0-9]', '', 'g'), 8) AS sufixo, count(*)
--        FROM servidores WHERE telefone IS NOT NULL
--       GROUP BY 1 HAVING count(*) > 1;
--
--   5. Piloto - ligar o HMM (4 servidores, pico de 4 batidas/dia):
--
--      UPDATE unidades SET aviso_ponto_whatsapp = true
--       WHERE nome = 'HMM - Hospital Municipal de Marabá';
--
--   6. Acompanhar durante o piloto:
--
--      SELECT tipo, status, evento, count(*) FROM avisos_ponto_fila GROUP BY 1, 2, 3;
--      SELECT acao, count(*) FROM logs_preferencia_aviso_ponto GROUP BY 1;
