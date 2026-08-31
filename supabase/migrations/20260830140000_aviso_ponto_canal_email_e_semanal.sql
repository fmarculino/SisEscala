-- ============================================================================
-- Aviso de ponto: e-mail vira o canal PADRAO e resumo_semanal vira a frequencia padrao
-- ============================================================================
-- 30/08/2026 - plano em docs/planos/2026-08-30-estrategia-de-canais-e-bloqueios-do-whatsapp.md
--
-- POR QUE
--   O numero de WhatsApp foi restringido pela Meta OUTRA VEZ. A 20260814130000 ja tinha cortado
--   os modos caros por esse mesmo motivo - e o bloqueio voltou com apenas 25 servidores ATIVOS e
--   ~440 mensagens no total.
--
--   🚨 Isso mata a hipotese de volume. Nesse patamar nenhum limite de envio explicaria bloqueio.
--   O que explica e' a API nao oficial em si: a deteccao da Meta nao depende do conteudo nem da
--   cadencia. Reduzir volume compra tempo; nao elimina o problema. A solucao real e' a Cloud API
--   oficial, hoje fora de alcance por depender de licitacao (decisao do usuario, 30/08/2026).
--
--   ⚠️ ENTAO O OBJETIVO DESTA MIGRATION NAO E' "PARAR DE SER BLOQUEADO". E' garantir que, QUANDO
--   o bloqueio vier, ele alcance o aviso INFORMATIVO e nao o ACIONAMENTO DE SOBREAVISO - que sai
--   pelo mesmo numero e serve para chamar alguem para uma emergencia. Medido: 440 mensagens de
--   aviso contra 5 de sobreaviso. 99% do trafego e' a mensagem de menor valor, e e' ela que
--   queima o canal de que a de maior valor depende.
--
-- O QUE MUDA
--   1. `servidores.aviso_ponto_canal` (email | whatsapp), DEFAULT 'email'.
--   2. `aviso_ponto_modo` passa a ter DEFAULT 'resumo_semanal', e os existentes sao MIGRADOS.
--   3. `avisos_ponto_fila` ganha `canal` e `destino` - hoje so' existe `telefone`.
--   4. Teto por hora, teto por dia e janela de silencio em configuracoes_globais.
--
-- ⚠️ COBERTURA MEDIDA, e ela e' o motivo do fallback: 870 servidores tem telefone e apenas 634
--   tem e-mail. E-mail alcanca MENOS gente. Por isso o canal e' resolvido por DISPONIBILIDADE,
--   nao por decreto - quem nao tem e-mail continua recebendo por WhatsApp, e ninguem fica sem
--   aviso por causa desta mudanca.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS / DROP+ADD CONSTRAINT / UPDATE convergente.
-- ============================================================================


-- ============================================================================
-- 1. CANAL DE PREFERENCIA DO SERVIDOR
-- ============================================================================
ALTER TABLE public.servidores
    ADD COLUMN IF NOT EXISTS aviso_ponto_canal text NOT NULL DEFAULT 'email';

ALTER TABLE public.servidores DROP CONSTRAINT IF EXISTS chk_aviso_ponto_canal;
ALTER TABLE public.servidores
    ADD CONSTRAINT chk_aviso_ponto_canal CHECK (aviso_ponto_canal IN ('email', 'whatsapp'));

COMMENT ON COLUMN public.servidores.aviso_ponto_canal IS
    'Canal PREFERIDO do aviso de ponto: email (padrao) | whatsapp. E preferencia, nao garantia: '
    'fn_canal_aviso_ponto cai para o outro canal quando o preferido nao tem endereco cadastrado. '
    'O servidor troca no Portal (fn_definir_canal_aviso_ponto).';


-- ============================================================================
-- 2. FREQUENCIA PADRAO PASSA A SER SEMANAL, E OS EXISTENTES MIGRAM
-- ============================================================================
-- Os 999 servidores em 'resumo_diario' estao nele por OMISSAO, nao por escolha: em todo o
-- cadastro apenas 1 pessoa escolheu algo diferente do padrao. Migrar todos e' respeitar o que
-- ninguem decidiu, e quem quiser diario troca no Portal - a tela ja existe.
ALTER TABLE public.servidores ALTER COLUMN aviso_ponto_modo SET DEFAULT 'resumo_semanal';

UPDATE public.servidores
   SET aviso_ponto_modo = 'resumo_semanal'
 WHERE aviso_ponto_modo = 'resumo_diario';


-- ============================================================================
-- 3. A FILA PASSA A CARREGAR CANAL E DESTINO
-- ============================================================================
-- `telefone` continua existindo e nao e' derrubada: a fila e' historico de envio, e apagar a
-- coluna reescreveria o que ja aconteceu. Novos itens preenchem `canal` e `destino`; os antigos
-- ficam com canal 'whatsapp' (era o unico que existia) e destino = telefone.
ALTER TABLE public.avisos_ponto_fila
    ADD COLUMN IF NOT EXISTS canal   text,
    ADD COLUMN IF NOT EXISTS destino text;

UPDATE public.avisos_ponto_fila
   SET canal = 'whatsapp', destino = telefone
 WHERE canal IS NULL;

ALTER TABLE public.avisos_ponto_fila ALTER COLUMN canal SET DEFAULT 'whatsapp';

ALTER TABLE public.avisos_ponto_fila DROP CONSTRAINT IF EXISTS chk_avisos_ponto_fila_canal;
ALTER TABLE public.avisos_ponto_fila
    ADD CONSTRAINT chk_avisos_ponto_fila_canal CHECK (canal IS NULL OR canal IN ('email', 'whatsapp'));

COMMENT ON COLUMN public.avisos_ponto_fila.canal IS
    'Canal RESOLVIDO no enfileiramento (email | whatsapp). Fica gravado na linha de proposito: '
    'se a preferencia do servidor mudar depois, o item ja enfileirado nao muda de canal no meio '
    'do caminho.';
COMMENT ON COLUMN public.avisos_ponto_fila.destino IS
    'Endereco resolvido: o e-mail ou o telefone, conforme `canal`. Guardado junto para o despacho '
    'nao precisar reconsultar o cadastro - que pode ter mudado entre enfileirar e enviar.';


-- ============================================================================
-- 4. RESOLUCAO DO CANAL - FONTE UNICA
-- ============================================================================
-- ⚠️ Fonte unica de proposito: enfileiramento e qualquer tela futura precisam responder a mesma
-- pergunta ("por onde este servidor recebe?") do mesmo jeito. Duas copias divergiriam, e a
-- divergencia aqui e' silenciosa - o aviso sai pelo canal errado e ninguem ve.
CREATE OR REPLACE FUNCTION public.fn_canal_aviso_ponto(p_servidor_id uuid)
RETURNS TABLE (canal text, destino text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_pref     text;
    v_email    text;
    v_telefone text;
BEGIN
    SELECT s.aviso_ponto_canal,
           NULLIF(btrim(s.email), ''),
           NULLIF(btrim(s.telefone), '')
      INTO v_pref, v_email, v_telefone
      FROM public.servidores s
     WHERE s.id = p_servidor_id;

    IF v_pref IS NULL THEN
        RETURN;  -- servidor inexistente: sem canal, sem linha
    END IF;

    -- A preferencia vale quando ha endereco para ela.
    IF v_pref = 'email' AND v_email IS NOT NULL THEN
        RETURN QUERY SELECT 'email'::text, v_email; RETURN;
    END IF;
    IF v_pref = 'whatsapp' AND v_telefone IS NOT NULL THEN
        RETURN QUERY SELECT 'whatsapp'::text, v_telefone; RETURN;
    END IF;

    -- Preferencia sem endereco: cai para o outro canal, se houver.
    -- ⚠️ Isto NAO e' desrespeitar a escolha - e' a diferenca entre avisar pelo canal secundario e
    -- nao avisar. Medido: 870 tem telefone e so' 634 tem e-mail, entao o fallback e' o caso comum,
    -- nao a excecao.
    IF v_email IS NOT NULL THEN
        RETURN QUERY SELECT 'email'::text, v_email; RETURN;
    END IF;
    IF v_telefone IS NOT NULL THEN
        RETURN QUERY SELECT 'whatsapp'::text, v_telefone; RETURN;
    END IF;

    -- Sem e-mail e sem telefone: nao devolve linha nenhuma. Quem chama trata como
    -- "sem canal" e o servidor aparece como pendencia de cadastro - nunca como envio silencioso.
    RETURN;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_canal_aviso_ponto(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_canal_aviso_ponto(uuid) TO service_role;


-- ============================================================================
-- 5. O SERVIDOR TROCA O CANAL NO PORTAL
-- ============================================================================
-- Espelha fn_definir_modo_aviso_ponto, inclusive nos privilegios (so service_role: quem chama e'
-- a Server Action do portal, com createAdminClient, depois de validar a sessao assinada).
CREATE OR REPLACE FUNCTION public.fn_definir_canal_aviso_ponto(
    p_servidor_id uuid,
    p_canal       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_email    text;
    v_telefone text;
BEGIN
    IF p_canal NOT IN ('email', 'whatsapp') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Canal inválido.');
    END IF;

    SELECT NULLIF(btrim(email), ''), NULLIF(btrim(telefone), '')
      INTO v_email, v_telefone
      FROM public.servidores WHERE id = p_servidor_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Servidor não encontrado.');
    END IF;

    -- ⚠️ Recusa escolher um canal sem endereco, com mensagem que diz o que fazer. Aceitar em
    -- silencio produziria o pior resultado possivel: o servidor acha que trocou, e o aviso passa
    -- a sair pelo outro canal por causa do fallback - sem nada na tela explicando.
    IF p_canal = 'email' AND v_email IS NULL THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Você não tem e-mail cadastrado. Peça ao seu coordenador para cadastrar antes de escolher este canal.');
    END IF;
    IF p_canal = 'whatsapp' AND v_telefone IS NULL THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Você não tem telefone cadastrado. Peça ao seu coordenador para cadastrar antes de escolher este canal.');
    END IF;

    UPDATE public.servidores SET aviso_ponto_canal = p_canal WHERE id = p_servidor_id;

    RETURN jsonb_build_object('success', true, 'canal', p_canal,
        'message', CASE p_canal
            WHEN 'email' THEN 'Pronto: seus avisos passam a chegar por e-mail.'
            ELSE 'Pronto: seus avisos passam a chegar por WhatsApp.'
        END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_definir_canal_aviso_ponto(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_definir_canal_aviso_ponto(uuid, text) TO service_role;


-- ============================================================================
-- 6. TETO DE ENVIO E JANELA DE SILENCIO (so' o WhatsApp precisa)
-- ============================================================================
-- Chave ausente = valor abaixo. Ficam em configuracoes_globais para poderem ser afrouxadas sem
-- deploy - o mesmo motivo do `coletor_auto_update` (kill switch para parque remoto).
INSERT INTO public.configuracoes_globais (chave, valor)
SELECT 'aviso_ponto_whatsapp_max_hora', '20'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes_globais WHERE chave = 'aviso_ponto_whatsapp_max_hora');

INSERT INTO public.configuracoes_globais (chave, valor)
SELECT 'aviso_ponto_whatsapp_max_dia', '150'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes_globais WHERE chave = 'aviso_ponto_whatsapp_max_dia');

INSERT INTO public.configuracoes_globais (chave, valor)
SELECT 'aviso_ponto_silencio_inicio', '21'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes_globais WHERE chave = 'aviso_ponto_silencio_inicio');

INSERT INTO public.configuracoes_globais (chave, valor)
SELECT 'aviso_ponto_silencio_fim', '6'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes_globais WHERE chave = 'aviso_ponto_silencio_fim');

-- ⚠️ Estas quatro chaves NAO carregam credencial, entao ficam legiveis por conta logada - a
-- policy de 20260830100000 so' fecha o que casa com o predicado de segredo. Conferido.


-- ============================================================================
-- VERIFICACAO - aborta se o resultado divergir
-- ============================================================================
DO $verifica$
DECLARE
    v_diario     integer;
    v_sem_canal  integer;
    v_fila_nula  integer;
    v_default    text;
BEGIN
    -- 1) ninguem pode ter ficado em resumo_diario
    SELECT count(*) INTO v_diario FROM public.servidores WHERE aviso_ponto_modo = 'resumo_diario';
    IF v_diario > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % servidor(es) ainda em resumo_diario apos a migracao.', v_diario;
    END IF;

    -- 2) o DEFAULT da coluna tem que ter mudado (senao o proximo cadastro nasce no modo antigo)
    SELECT column_default INTO v_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'servidores' AND column_name = 'aviso_ponto_modo';
    IF v_default IS NULL OR v_default NOT LIKE '%resumo_semanal%' THEN
        RAISE EXCEPTION 'ABORTADO: default de aviso_ponto_modo nao virou resumo_semanal (esta: %).', v_default;
    END IF;

    -- 3) nenhuma linha antiga da fila pode ter ficado sem canal
    SELECT count(*) INTO v_fila_nula FROM public.avisos_ponto_fila WHERE canal IS NULL;
    IF v_fila_nula > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % linha(s) de avisos_ponto_fila sem canal.', v_fila_nula;
    END IF;

    -- 4) INFORMATIVO, nao aborta: quem ativou o aviso e nao tem canal nenhum. Sao pendencia de
    --    cadastro, nao erro de migration - e' util saber o numero na hora de aplicar.
    SELECT count(*) INTO v_sem_canal
      FROM public.servidores s
     WHERE s.aviso_ponto_status = 'ativo'
       AND NULLIF(btrim(s.email), '') IS NULL
       AND NULLIF(btrim(s.telefone), '') IS NULL;

    RAISE NOTICE 'OK: modo semanal aplicado, canal criado (default email), fila com canal.';
    RAISE NOTICE 'Servidores com aviso ATIVO e sem e-mail nem telefone (pendencia de cadastro): %', v_sem_canal;
END
$verifica$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) Distribuicao de modo e canal:
--
--      SELECT aviso_ponto_modo, aviso_ponto_canal, count(*)
--        FROM public.servidores WHERE status = 'Ativo'
--       GROUP BY 1, 2 ORDER BY 3 DESC;
--      -- esperado: tudo em resumo_semanal; canal majoritariamente 'email'
--
-- 2) Por onde cada servidor ATIVO vai receber de fato (ja com o fallback aplicado):
--
--      SELECT c.canal, count(*)
--        FROM public.servidores s
--        LEFT JOIN LATERAL public.fn_canal_aviso_ponto(s.id) c ON true
--       WHERE s.aviso_ponto_status = 'ativo'
--       GROUP BY 1;
--      -- canal NULL = sem e-mail e sem telefone: pendencia de cadastro
--
-- 3) Quanto trafego sai do WhatsApp (a medida que importa):
--
--      SELECT count(*) FILTER (WHERE c.canal = 'email')    AS por_email,
--             count(*) FILTER (WHERE c.canal = 'whatsapp') AS por_whatsapp
--        FROM public.servidores s
--        LEFT JOIN LATERAL public.fn_canal_aviso_ponto(s.id) c ON true
--       WHERE s.status = 'Ativo' AND (s.email IS NOT NULL OR s.telefone IS NOT NULL);
--      -- esperado pela medicao de 30/08: ~634 por e-mail, ~236 por WhatsApp
