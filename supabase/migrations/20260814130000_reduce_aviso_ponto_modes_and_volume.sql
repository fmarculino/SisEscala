-- Migration: Reduz modos de aviso de ponto e remove o aviso individual de "fora da janela"
-- Data: 2026-08-14
--
-- POR QUE
--   O numero de WhatsApp usado pelo aviso de ponto foi restringido pela Meta por volume de
--   mensagem. Os dois modos mais caros ("entrada_saida", ate 44/mes, e "todas", ate 88/mes) saem
--   de circulacao — so ficam resumo_diario (~22/mes, ja o padrao) e resumo_semanal (~4/mes).
--
--   O aviso individual de 'fora_janela' tambem sai. Ate aqui ele furava qualquer modo escolhido
--   (unica excecao no gatilho, ver 20260809140000/20260809160000) porque era o caso em que o
--   silencio prejudicava mais: a tela do terminal some em 6 segundos. Mas com so' resumo_diario/
--   resumo_semanal restando, a batida fora da janela continua aparecendo no resumo do dia (o
--   agregado em fn_gerar_resumos_aviso_ponto nao distingue fora_janela de dentro da janela, so'
--   mostra os horarios) — a pessoa nao fica sem registro, so' deixa de receber na hora.
--
-- ORDEM: funcao primeiro (o gatilho nao pode ficar, nem por um instante, exigindo um modo que a
-- constraint ainda proibiria de setar); dados depois; constraint por ultimo, so' depois que
-- nenhuma linha tem mais um valor que ela vai passar a proibir.


-- ============================================================================
-- 1. GATILHO SEM O DESVIO DE 'fora_janela'
-- ============================================================================
-- Corpo identico ao vigente (20260809160000), com UM bloco alterado: o "IF v_evento <>
-- 'fora_janela' THEN" que envolvia a checagem de modo foi removido — a checagem passa a valer
-- para QUALQUER evento, fora_janela incluido. Resto do arquivo, byte a byte igual.

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
    IF NEW.origem NOT IN ('terminal', 'rep') THEN
        RETURN NULL;
    END IF;

    IF COALESCE(NEW.sintetica, false) THEN
        RETURN NULL;
    END IF;

    IF NEW.ocorrido_em < now() - interval '10 minutes' THEN
        RETURN NULL;
    END IF;

    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    SELECT u.id, u.nome
      INTO v_unidade
      FROM public.unidades u
     WHERE u.id = NEW.unidade_id;

    -- Habilitacao resolvida pelo SETOR, com heranca da unidade. Fonte unica em
    -- fn_aviso_ponto_habilitado - a precedencia nao pode ser reimplementada em cada chamador.
    IF NOT FOUND OR NOT public.fn_aviso_ponto_habilitado(NEW.unidade_id, NEW.setor_id) THEN
        RETURN NULL;
    END IF;

    SELECT s.id, s.nome, s.aviso_ponto_status, s.aviso_ponto_modo
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

    IF v_evento IS NULL THEN
        v_evento := 'fora_janela';
    END IF;

    -- ---- Quais registros avisam: decisao do SERVIDOR, e so dele ------------
    -- Ate 14/08/2026 'fora_janela' furava qualquer modo (era a unica garantia valida em todos
    -- os modos - ver 20260809160000). Removido: com so' resumo_diario/resumo_semanal restando
    -- como modo (20260814130000), a batida fora da janela continua aparecendo no resumo do dia
    -- - so' deixa de gerar mensagem individual na hora. Motivo: volume de mensagem restringiu o
    -- numero pela Meta/WhatsApp.
    IF v_servidor.aviso_ponto_modo IN ('resumo_diario', 'resumo_semanal') THEN
        RETURN NULL;
    END IF;
    IF v_servidor.aviso_ponto_modo = 'entrada_saida'
       AND v_evento NOT IN ('entrada', 'saida') THEN
        RETURN NULL;
    END IF;

    v_local := NEW.ocorrido_em AT TIME ZONE v_timezone;

    IF v_evento = 'fora_janela' THEN
        v_situacao := '*Registrado fora do horário previsto.* A marcação é válida e foi enviada '
                   || 'para revisão do seu coordenador. Você não precisa bater de novo.';
    ELSE
        v_situacao := 'Registrado dentro do horário previsto.';
    END IF;

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
    RAISE WARNING 'fn_enfileirar_aviso_ponto falhou para marcacao %: %', NEW.id, SQLERRM;
    RETURN NULL;
END;
$fn$;


-- ============================================================================
-- 2. MIGRA QUEM ESTAVA EM 'todas'/'entrada_saida' PARA 'resumo_diario'
-- ============================================================================
-- Por criterio, nao por id explicito: e preferencia de notificacao, nao dado de ponto/folha -
-- risco e reversibilidade nao comparam com horario de presenca. resumo_diario e o default e o
-- modo recomendado (20260809140000), destino natural para quem perde a opcao escolhida.

UPDATE public.servidores
   SET aviso_ponto_modo = 'resumo_diario'
 WHERE aviso_ponto_modo IN ('todas', 'entrada_saida');


-- ============================================================================
-- 3. CONSTRAINT E RPC SO AAEITAM OS DOIS MODOS RESTANTES
-- ============================================================================
-- Depois da UPDATE acima, para a constraint nao rejeitar linha nenhuma ao trocar.

ALTER TABLE public.servidores DROP CONSTRAINT IF EXISTS chk_aviso_ponto_modo;
ALTER TABLE public.servidores
    ADD CONSTRAINT chk_aviso_ponto_modo CHECK (aviso_ponto_modo IN ('resumo_diario', 'resumo_semanal'));

COMMENT ON COLUMN public.servidores.aviso_ponto_modo IS
    'resumo_diario (default) | resumo_semanal. "todas" e "entrada_saida" foram desativados em '
    '14/08/2026 por volume de mensagem (numero restringido pela Meta/WhatsApp).';

CREATE OR REPLACE FUNCTION public.fn_definir_modo_aviso_ponto(
    p_servidor_id uuid,
    p_modo        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    IF p_modo NOT IN ('resumo_diario', 'resumo_semanal') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Modo inválido.');
    END IF;

    UPDATE public.servidores SET aviso_ponto_modo = p_modo WHERE id = p_servidor_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Servidor não encontrado.');
    END IF;

    RETURN jsonb_build_object('success', true, 'modo', p_modo,
        'message', 'Preferência de frequência salva.');
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_definir_modo_aviso_ponto(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_definir_modo_aviso_ponto(uuid, text) TO service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. Ninguem ficou em 'todas'/'entrada_saida' (esperado: 0 linhas):
--
--      SELECT count(*) FROM servidores WHERE aviso_ponto_modo IN ('todas', 'entrada_saida');
--
--   2. Distribuicao atual (so' resumo_diario/resumo_semanal deveriam aparecer):
--
--      SELECT aviso_ponto_modo, count(*) FROM servidores GROUP BY 1;
--
--   3. Tentar setar um modo removido falha:
--
--      SELECT fn_definir_modo_aviso_ponto('<algum servidor_id>', 'todas');
--      -- esperado: {"success": false, "message": "Modo inválido."}
--
--   4. O gatilho nao referencia mais 'fora_janela' fora do bloco de mensagem (so' na montagem do
--      texto e no fallback do evento, nunca mais como excecao de modo):
--
--      SELECT prosrc FROM pg_proc WHERE proname = 'fn_enfileirar_aviso_ponto';
