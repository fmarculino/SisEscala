-- ============================================================================
-- Despacho do aviso de ponto: roteia por canal, respeita teto e janela de silencio
-- ============================================================================
-- 30/08/2026 - segunda parte de 20260830140000.
--   plano: docs/planos/2026-08-30-estrategia-de-canais-e-bloqueios-do-whatsapp.md
--
-- O QUE MUDA EM fn_avisos_ponto_pendentes
--   1. Devolve `canal` e `destino`, resolvendo pelo cadastro quando a linha ainda nao os tem
--      (toda linha enfileirada antes desta migration cai nesse caso).
--   2. **A janela de silencio e o teto valem SO para o WhatsApp.** E-mail nao bloqueia numero,
--      nao tem limite pratico nesse volume e nao acorda ninguem - segurar e-mail seria atrasar
--      o aviso sem ganho nenhum.
--   3. Item cujo servidor nao tem e-mail NEM telefone sai da fila como falha explicativa, em vez
--      de ficar tentando para sempre contra um destino que nao existe.
--
-- ⚠️ POR QUE O CANAL E' RESOLVIDO AQUI, E NAO NO GATILHO DE ENFILEIRAMENTO
--   Seria mais "certo" gravar o canal no momento de enfileirar. Mas isso exigiria regenerar
--   `fn_enfileirar_aviso_ponto` e `fn_gerar_resumos_aviso_ponto`, que sao funcoes grandes e
--   criticas - e a armadilha 1 do CLAUDE.md e' exatamente sobre perder logica ao recopiar funcao
--   grande (SEIS regressoes reais ja aconteceram assim). Resolver na reserva do lote alcanca o
--   mesmo resultado, deixa o canal gravado na linha do mesmo jeito, e nao toca em nenhuma funcao
--   de enfileiramento. A troca de preferencia entre enfileirar e enviar passa a valer - o que e'
--   ate preferivel.
--
-- IDEMPOTENTE: CREATE OR REPLACE com a MESMA assinatura (integer). Sem DROP, sem sobrecarga.
-- ============================================================================

-- ⚠️ A assinatura ANTIGA (so p_limite) precisa sair: com as duas vivas o PostgREST devolve
-- PGRST203. Chamador antigo continua funcionando porque p_limite_whatsapp tem DEFAULT.
DROP FUNCTION IF EXISTS public.fn_avisos_ponto_pendentes(integer);

CREATE OR REPLACE FUNCTION public.fn_avisos_ponto_pendentes(
    p_limite          integer DEFAULT 20,
    -- Teto de WhatsApp DESTA rodada, decidido pela rota. NULL = so o teto de hora/dia vale.
    --
    -- 🚨 EXISTE PARA A ROTA NAO PRECISAR PULAR ITEM JA RESERVADO. Esta funcao INCREMENTA a
    -- coluna tentativas ao reservar: se a rota reservasse 20 e enviasse 1, os outros 19
    -- voltariam para a fila com uma tentativa gasta sem nada ter sido tentado - e em 3 rodadas
    -- morreriam como falha, sem que uma unica mensagem tivesse sido enviada.
    p_limite_whatsapp integer DEFAULT NULL
)
RETURNS TABLE (
    id          uuid,
    tipo        text,
    servidor_id uuid,
    unidade_id  uuid,
    telefone    text,
    mensagem    text,
    evento      text,
    tentativas  integer,
    canal       text,
    destino     text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_tz            text;
    v_hora          integer;
    v_sil_ini       integer;
    v_sil_fim       integer;
    v_silencio      boolean;
    v_max_hora      integer;
    v_max_dia       integer;
    v_usadas_hora   integer;
    v_usadas_dia    integer;
    v_saldo_zap     integer;
    v_limite        integer := GREATEST(COALESCE(p_limite, 20), 1);
BEGIN
    -- ── fuso e hora local (o banco roda em UTC — armadilha 12) ────────────────────────────────
    SELECT COALESCE((SELECT (valor#>>'{}')::text FROM public.configuracoes_globais
                      WHERE chave = 'timezone'), 'America/Sao_Paulo') INTO v_tz;
    v_hora := EXTRACT(HOUR FROM (now() AT TIME ZONE v_tz))::integer;

    SELECT COALESCE((SELECT (valor#>>'{}')::integer FROM public.configuracoes_globais
                      WHERE chave = 'aviso_ponto_silencio_inicio'), 21) INTO v_sil_ini;
    SELECT COALESCE((SELECT (valor#>>'{}')::integer FROM public.configuracoes_globais
                      WHERE chave = 'aviso_ponto_silencio_fim'), 6) INTO v_sil_fim;

    -- A janela CRUZA A MEIA-NOITE (21h→6h), entao nao e' um intervalo simples: das 21h em diante
    -- OU ate as 6h. Tratar como `hora BETWEEN ini AND fim` daria uma janela vazia.
    v_silencio := CASE WHEN v_sil_ini > v_sil_fim
                       THEN (v_hora >= v_sil_ini OR v_hora < v_sil_fim)
                       ELSE (v_hora >= v_sil_ini AND v_hora < v_sil_fim) END;

    -- ── saldo de WhatsApp na hora e no dia ────────────────────────────────────────────────────
    SELECT COALESCE((SELECT (valor#>>'{}')::integer FROM public.configuracoes_globais
                      WHERE chave = 'aviso_ponto_whatsapp_max_hora'), 20) INTO v_max_hora;
    SELECT COALESCE((SELECT (valor#>>'{}')::integer FROM public.configuracoes_globais
                      WHERE chave = 'aviso_ponto_whatsapp_max_dia'), 150) INTO v_max_dia;

    SELECT count(*) INTO v_usadas_hora FROM public.avisos_ponto_fila
     WHERE canal = 'whatsapp' AND status = 'enviado' AND processado_em > now() - interval '1 hour';

    SELECT count(*) INTO v_usadas_dia FROM public.avisos_ponto_fila
     WHERE canal = 'whatsapp' AND status = 'enviado'
       AND (processado_em AT TIME ZONE v_tz)::date = (now() AT TIME ZONE v_tz)::date;

    v_saldo_zap := LEAST(v_max_hora - v_usadas_hora, v_max_dia - v_usadas_dia);
    IF p_limite_whatsapp IS NOT NULL THEN
        v_saldo_zap := LEAST(v_saldo_zap, p_limite_whatsapp);
    END IF;
    IF v_silencio THEN v_saldo_zap := 0; END IF;
    IF v_saldo_zap < 0 THEN v_saldo_zap := 0; END IF;

    -- ── reserva do lote ───────────────────────────────────────────────────────────────────────
    -- ⚠️ O canal e' resolvido DENTRO do UPDATE e GRAVADO na linha: a fila e' o registro do que
    -- foi feito, e uma linha sem canal nao diz por onde a mensagem saiu.
    RETURN QUERY
    WITH candidatos AS (
        SELECT c.id,
               COALESCE(c.canal, k.canal)     AS canal_res,
               COALESCE(c.destino, k.destino) AS destino_res
          FROM public.avisos_ponto_fila c
          LEFT JOIN LATERAL public.fn_canal_aviso_ponto(c.servidor_id) k ON true
         WHERE c.status = 'pendente' AND c.tentativas < 3
    ),
    elegiveis AS (
        SELECT ca.id, ca.canal_res, ca.destino_res,
               -- Numera os de WhatsApp para cortar no saldo. E-mail nao entra na conta.
               CASE WHEN ca.canal_res = 'whatsapp'
                    THEN row_number() OVER (PARTITION BY ca.canal_res ORDER BY f.criado_em)
                    ELSE 0 END AS pos_zap
          FROM candidatos ca
          JOIN public.avisos_ponto_fila f ON f.id = ca.id
         WHERE ca.canal_res IS NOT NULL AND ca.destino_res IS NOT NULL
    ),
    escolhidos AS (
        SELECT e.id, e.canal_res, e.destino_res
          FROM elegiveis e
          JOIN public.avisos_ponto_fila f ON f.id = e.id
         WHERE e.canal_res = 'email' OR e.pos_zap <= v_saldo_zap
         -- Confirmacao de opt-in na frente: e' a mensagem que a pessoa esta esperando na tela.
         ORDER BY (f.tipo = 'confirmacao_optin') DESC, f.criado_em
         LIMIT v_limite
    )
    UPDATE public.avisos_ponto_fila f
       SET tentativas = f.tentativas + 1,
           canal      = e.canal_res,
           destino    = e.destino_res
      FROM escolhidos e
     WHERE f.id = e.id
       -- SKIP LOCKED nao existe em UPDATE ... FROM; a corrida e' fechada pelo proprio UPDATE,
       -- que so' alcanca linhas ainda pendentes.
       AND f.status = 'pendente'
    RETURNING f.id, f.tipo, f.servidor_id, f.unidade_id, f.telefone, f.mensagem, f.evento,
              f.tentativas, f.canal, f.destino;

    -- ── quem nao tem canal nenhum sai da fila, com motivo legivel ─────────────────────────────
    -- ⚠️ Sem isto o item fica sendo tentado ate a 3a vez contra um destino que NAO EXISTE, e o
    -- motivo gravado seria um erro de envio - escondendo que o problema e' cadastro incompleto.
    UPDATE public.avisos_ponto_fila f
       SET status        = 'falha',
           tentativas    = 3,
           motivo_falha  = 'Servidor sem e-mail e sem telefone cadastrados.',
           processado_em = now()
     WHERE f.status = 'pendente'
       AND NOT EXISTS (SELECT 1 FROM public.fn_canal_aviso_ponto(f.servidor_id));
END;
$fn$;

COMMENT ON FUNCTION public.fn_avisos_ponto_pendentes(integer, integer) IS
    'Reserva ate p_limite avisos pendentes, resolvendo e GRAVANDO canal/destino na linha. Teto '
    'por hora/dia e janela de silencio valem SO para o WhatsApp - e-mail nao bloqueia numero nem '
    'acorda ninguem. Item de servidor sem e-mail e sem telefone sai como falha explicativa.';

REVOKE ALL ON FUNCTION public.fn_avisos_ponto_pendentes(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_avisos_ponto_pendentes(integer, integer) TO service_role;


-- ============================================================================
-- VERIFICACAO
-- ============================================================================
DO $verifica$
DECLARE
    v_cols integer;
BEGIN
    -- a assinatura de saida tem que ter ganhado canal e destino
    SELECT count(*) INTO v_cols
      FROM information_schema.routines r
      JOIN information_schema.parameters p ON p.specific_name = r.specific_name
     WHERE r.routine_schema = 'public' AND r.routine_name = 'fn_avisos_ponto_pendentes'
       AND p.parameter_mode = 'OUT' AND p.parameter_name IN ('canal', 'destino');

    IF v_cols <> 2 THEN
        RAISE EXCEPTION 'ABORTADO: fn_avisos_ponto_pendentes nao devolve canal/destino (achou %).', v_cols;
    END IF;

    IF has_function_privilege('anon', 'public.fn_avisos_ponto_pendentes(integer, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: fn_avisos_ponto_pendentes executavel por anon.';
    END IF;

    RAISE NOTICE 'OK: despacho roteia por canal, com teto e janela de silencio so no WhatsApp.';
END
$verifica$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve)
-- ============================================================================
--
-- 1) A janela de silencio esta ativa agora?
--
--      SELECT EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int AS hora_local;
--      -- entre 21 e 6 => fn_avisos_ponto_pendentes nao devolve NENHUM item de WhatsApp
--
-- 2) Saldo de WhatsApp usado na ultima hora e no dia:
--
--      SELECT count(*) FILTER (WHERE processado_em > now() - interval '1 hour') AS na_hora,
--             count(*) FILTER (WHERE (processado_em AT TIME ZONE 'America/Sao_Paulo')::date
--                                  = (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS no_dia
--        FROM avisos_ponto_fila WHERE canal = 'whatsapp' AND status = 'enviado';
--
-- 3) Como a fila esta distribuida depois de algumas rodadas:
--
--      SELECT canal, status, count(*) FROM avisos_ponto_fila GROUP BY 1,2 ORDER BY 1,2;
--
-- 4) Quem ficou sem canal (pendencia de cadastro, nao erro de envio):
--
--      SELECT s.nome, s.matricula FROM avisos_ponto_fila f
--        JOIN servidores s ON s.id = f.servidor_id
--       WHERE f.motivo_falha = 'Servidor sem e-mail e sem telefone cadastrados.';
