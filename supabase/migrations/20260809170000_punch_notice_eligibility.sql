-- Migration: Elegibilidade do aviso de ponto - lotacao habilitada e estado efetivo
-- Data: 2026-08-09
--
-- Plano: docs/planos/2026-08-09-escopo-e-elegibilidade-do-aviso-de-ponto.md
--
-- Resolve dois dos tres problemas levantados em 09/08/2026. O terceiro (a tela da unidade nao
-- avisar que setores podem sobrepo-la) e so frontend.
--
-- PROBLEMA A - opt-in sem habilitacao disparava WhatsApp  [o grave]
--   fn_solicitar_aviso_ponto validava termo, servidor, telefone e pedido pendente, e NUNCA
--   consultava fn_aviso_ponto_habilitado. Entao alguem de setor desabilitado clicava em Ativar,
--   o sistema MANDAVA a mensagem de confirmacao, ele respondia SIM e ficava 'ativo' - sem nunca
--   receber aviso de ponto, porque o gatilho barra corretamente.
--
--   O dano nao era o passo final. Era a mensagem enviada por uma lotacao que a coordenacao nao
--   liberou, NO MESMO NUMERO que serve o acionamento de sobreaviso. Durante o piloto da TI,
--   qualquer pessoa da CAF, DMAC ou ALMOXARIFADO que achasse a aba furava o portao de rollout.
--
-- PROBLEMA B - status 'ativo' nao refletia a realidade apos transferencia
--   O gatilho resolve a habilitacao no INSTANTE DA BATIDA, pela lotacao da propria marcacao -
--   entao transferencia para setor desabilitado nunca gerou envio indevido. O defeito era de
--   DADO: "SELECT count(*) ... WHERE aviso_ponto_status = 'ativo'" passava a contar quem nao
--   recebe nada, e essa e justamente a consulta de uma auditoria de consentimento.
--
--   NAO se desativa o servidor na transferencia. Consentimento e sobre a pessoa e o canal;
--   lotacao e sobre disponibilidade. Transferir e ato administrativo - gravar como desativacao
--   atribuiria a ele uma decisao que nao foi dele, no mesmo log que serve de prova. E voltando ao
--   setor de origem ele refaria o double opt-in inteiro, incluindo mais UMA mensagem no numero
--   que estamos protegendo de banimento.
--
--   Em vez disso, separa-se CONSENTIMENTO (aviso_ponto_status, do servidor) de EFETIVIDADE
--   (fn_aviso_ponto_efetivo, que e o que relatorios consultam).
--
-- O QUE CONTINUA INCONDICIONAL
--   Desativar pelo Portal e responder PARAR no WhatsApp NAO dependem de habilitacao nenhuma.
--   Amarrar a saida a configuracao prenderia a pessoa numa preferencia que ela nao pode mudar, e
--   ignorar PARAR e o caminho mais curto para denuncia e banimento.
--
-- ESTE ARQUIVO E GERADO
--   scratchpad/gen_elegibilidade.js copia o corpo vigente de fn_solicitar_aviso_ponto e insere a
--   checagem. Nao editar a mao.


-- ============================================================================
-- 1. ESTADO EFETIVO
-- ============================================================================
-- Consentiu E a lotacao atual esta habilitada. E o que qualquer relatorio de "quem recebe" deve
-- consultar - aviso_ponto_status sozinho responde pelo consentimento, nao pela entrega.

CREATE OR REPLACE FUNCTION public.fn_aviso_ponto_efetivo(p_servidor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT COALESCE(
        (SELECT s.aviso_ponto_status = 'ativo'
              AND public.fn_aviso_ponto_habilitado(s.unidade_id, s.setor_id)
           FROM public.servidores s
          WHERE s.id = p_servidor_id),
        false)
$fn$;

COMMENT ON FUNCTION public.fn_aviso_ponto_efetivo(uuid) IS
    'O servidor recebe aviso de ponto AGORA? Consentimento + lotacao habilitada. Use esta, e nao '
    'aviso_ponto_status sozinho, para contar quem recebe - depois de uma transferencia os dois '
    'divergem de proposito: o consentimento dele nao e apagado por ato administrativo.';

GRANT EXECUTE ON FUNCTION public.fn_aviso_ponto_efetivo(uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. OPT-IN EXIGE LOTACAO HABILITADA
-- ============================================================================

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

    SELECT s.id, s.nome, s.telefone, s.aviso_ponto_status, s.unidade_id, s.setor_id
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
    -- Vem ANTES do telefone de proposito: quem esta fora do escopo esta bloqueado de qualquer
    -- forma, e mandar corrigir o cadastro o faria consertar a coisa errada.
    IF NOT public.fn_aviso_ponto_habilitado(v_servidor.unidade_id, v_servidor.setor_id) THEN
        RETURN jsonb_build_object('success', false, 'status', 'indisponivel',
            'message', 'O aviso de ponto ainda não está disponível na sua lotação. '
                    || 'Fale com seu coordenador.');
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


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. Consentimento x efetividade lado a lado (divergem apos transferencia, e isso e correto):
--
--      SELECT s.nome, s.aviso_ponto_status,
--             public.fn_aviso_ponto_habilitado(s.unidade_id, s.setor_id) AS lotacao_ok,
--             public.fn_aviso_ponto_efetivo(s.id)                        AS recebe_agora
--        FROM servidores s
--       WHERE s.aviso_ponto_status <> 'inativo';
--
--   2. Quem REALMENTE recebe (a consulta que os relatorios devem usar):
--
--      SELECT count(*) FROM servidores s WHERE public.fn_aviso_ponto_efetivo(s.id);
--
--   3. O opt-in agora recusa fora do escopo. Com nenhuma unidade/setor habilitado, esperado
--      status 'indisponivel':
--
--      SELECT public.fn_solicitar_aviso_ponto(
--               (SELECT id FROM servidores WHERE aviso_ponto_status = 'inativo' LIMIT 1),
--               'teste', '0');
--
--   4. Setores que sobrepoem a unidade (o que a tela da unidade passa a exibir):
--
--      SELECT u.nome AS unidade, d.nome AS setor, s.aviso_ponto_whatsapp
--        FROM setores s
--        JOIN unidades u ON u.id = s.unidade_id
--        JOIN dicionario_setores d ON d.id = s.dicionario_setor_id
--       WHERE s.aviso_ponto_whatsapp IS NOT NULL;
