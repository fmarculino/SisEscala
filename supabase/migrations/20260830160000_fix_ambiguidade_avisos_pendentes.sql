-- ============================================================================
-- CORRECAO URGENTE: fn_avisos_ponto_pendentes estava quebrada (42702)
-- ============================================================================
-- 30/08/2026 - conserta a 20260830150000, aplicada minutos antes.
--
-- 🚨 O SINTOMA
--   POST /rest/v1/rpc/fn_avisos_ponto_pendentes  ->  HTTP 400
--     {"code":"42702","message":"...","details":"It could refer to either a PL/pgSQL variable
--      or a table column."}
--
--   Como a 20260830150000 fez DROP da assinatura antiga, a UNICA versao existente era a
--   quebrada: **o despacho do aviso de ponto parou por completo** entre as duas migrations.
--
-- A CAUSA
--   `RETURNS TABLE (... canal text, destino text, tentativas integer ...)` declara parametros de
--   SAIDA com esses nomes. Dentro do corpo, `UPDATE public.avisos_ponto_fila f SET tentativas =
--   ..., canal = ..., destino = ...` referencia colunas com os MESMOS nomes — e o alvo de um
--   `SET` nao pode ser qualificado (`SET f.canal` e' erro de sintaxe). O plpgsql nao tem como
--   decidir, e recusa.
--
-- ⚠️ POR QUE `tsc`, `lint` E `build` NAO PEGARAM
--   Nenhum deles executa SQL. plpgsql resolve nome de coluna e de variavel so' na EXECUCAO do
--   statement (armadilha 1 do CLAUDE.md) — a funcao foi criada sem reclamar. Foi a sonda de
--   conferencia por fora que pegou, o que e' exatamente para isso que ela existe.
--
-- A CORRECAO
--   `#variable_conflict use_column`: diante de um nome ambiguo, o plpgsql passa a resolver para a
--   COLUNA. E' o que se quer em toda esta funcao — os parametros de saida nunca sao LIDOS como
--   variavel aqui (o retorno e' por `RETURN QUERY`), entao nao ha caso em que a variavel fosse a
--   escolha certa. As variaveis de trabalho sao todas `v_*`/`p_*` e nao colidem com coluna
--   nenhuma.
--
--   ⚠️ Corpo IDENTICO ao da 20260830150000, com UMA linha acrescentada logo apos o BEGIN.
--   Nada mais foi tocado.
--
-- IDEMPOTENTE: CREATE OR REPLACE com a MESMA assinatura (integer, integer). Sem DROP.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_avisos_ponto_pendentes(
    p_limite          integer DEFAULT 20,
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
-- 🚨 ESTA LINHA E' A CORRECAO. Sem ela, `SET tentativas = ...`, `SET canal = ...` e
-- `SET destino = ...` sao ambiguos contra os parametros de saida de mesmo nome, e a funcao
-- estoura 42702 em tempo de execucao. NAO REMOVER ao regerar esta funcao.
#variable_conflict use_column
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

    -- A janela CRUZA A MEIA-NOITE (21h→6h): das 21h em diante OU ate as 6h. Tratar como
    -- `hora BETWEEN ini AND fim` daria uma janela vazia.
    v_silencio := CASE WHEN v_sil_ini > v_sil_fim
                       THEN (v_hora >= v_sil_ini OR v_hora < v_sil_fim)
                       ELSE (v_hora >= v_sil_ini AND v_hora < v_sil_fim) END;

    -- ── saldo de WhatsApp na hora e no dia ────────────────────────────────────────────────────
    SELECT COALESCE((SELECT (valor#>>'{}')::integer FROM public.configuracoes_globais
                      WHERE chave = 'aviso_ponto_whatsapp_max_hora'), 20) INTO v_max_hora;
    SELECT COALESCE((SELECT (valor#>>'{}')::integer FROM public.configuracoes_globais
                      WHERE chave = 'aviso_ponto_whatsapp_max_dia'), 150) INTO v_max_dia;

    SELECT count(*) INTO v_usadas_hora FROM public.avisos_ponto_fila f2
     WHERE f2.canal = 'whatsapp' AND f2.status = 'enviado'
       AND f2.processado_em > now() - interval '1 hour';

    SELECT count(*) INTO v_usadas_dia FROM public.avisos_ponto_fila f2
     WHERE f2.canal = 'whatsapp' AND f2.status = 'enviado'
       AND (f2.processado_em AT TIME ZONE v_tz)::date = (now() AT TIME ZONE v_tz)::date;

    v_saldo_zap := LEAST(v_max_hora - v_usadas_hora, v_max_dia - v_usadas_dia);
    IF p_limite_whatsapp IS NOT NULL THEN
        v_saldo_zap := LEAST(v_saldo_zap, p_limite_whatsapp);
    END IF;
    IF v_silencio THEN v_saldo_zap := 0; END IF;
    IF v_saldo_zap < 0 THEN v_saldo_zap := 0; END IF;

    -- ── reserva do lote ───────────────────────────────────────────────────────────────────────
    -- O canal e' resolvido DENTRO do UPDATE e GRAVADO na linha: a fila e' o registro do que foi
    -- feito, e uma linha sem canal nao diz por onde a mensagem saiu.
    RETURN QUERY
    WITH candidatos AS (
        SELECT c.id AS fila_id,
               COALESCE(c.canal, k.canal)     AS canal_res,
               COALESCE(c.destino, k.destino) AS destino_res,
               c.criado_em,
               c.tipo AS fila_tipo
          FROM public.avisos_ponto_fila c
          LEFT JOIN LATERAL public.fn_canal_aviso_ponto(c.servidor_id) k ON true
         WHERE c.status = 'pendente' AND c.tentativas < 3
    ),
    elegiveis AS (
        SELECT ca.fila_id, ca.canal_res, ca.destino_res, ca.criado_em, ca.fila_tipo,
               -- Numera os de WhatsApp para cortar no saldo. E-mail nao entra na conta.
               CASE WHEN ca.canal_res = 'whatsapp'
                    THEN row_number() OVER (PARTITION BY ca.canal_res ORDER BY ca.criado_em)
                    ELSE 0 END AS pos_zap
          FROM candidatos ca
         WHERE ca.canal_res IS NOT NULL AND ca.destino_res IS NOT NULL
    ),
    escolhidos AS (
        SELECT e.fila_id, e.canal_res, e.destino_res
          FROM elegiveis e
         WHERE e.canal_res = 'email' OR e.pos_zap <= v_saldo_zap
         -- Confirmacao de opt-in na frente: e' a mensagem que a pessoa esta esperando na tela.
         ORDER BY (e.fila_tipo = 'confirmacao_optin') DESC, e.criado_em
         LIMIT v_limite
    )
    UPDATE public.avisos_ponto_fila f
       SET tentativas = f.tentativas + 1,
           canal      = e.canal_res,
           destino    = e.destino_res
      FROM escolhidos e
     WHERE f.id = e.fila_id
       AND f.status = 'pendente'
    RETURNING f.id, f.tipo, f.servidor_id, f.unidade_id, f.telefone, f.mensagem, f.evento,
              f.tentativas, f.canal, f.destino;

    -- ── quem nao tem canal nenhum sai da fila, com motivo legivel ─────────────────────────────
    -- Sem isto o item fica sendo tentado ate a 3a vez contra um destino que NAO EXISTE, e o
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
    'por hora/dia e janela de silencio valem SO para o WhatsApp. p_limite_whatsapp e o teto DESTA '
    'rodada, decidido pela rota. ⚠️ #variable_conflict use_column no corpo e OBRIGATORIO: sem ele '
    'os SET de canal/destino/tentativas sao ambiguos contra os parametros de saida (erro 42702).';

REVOKE ALL ON FUNCTION public.fn_avisos_ponto_pendentes(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_avisos_ponto_pendentes(integer, integer) TO service_role;


-- ============================================================================
-- VERIFICACAO - executa a funcao de verdade
-- ============================================================================
-- ⚠️ Conferir que a funcao EXISTE nao serve aqui: ela existia e estava quebrada. 42702 so'
-- aparece na EXECUCAO. Entao a verificacao EXECUTA - com p_limite_whatsapp = 0 e p_limite = 1,
-- o que so' alcanca item de e-mail e nao dispara envio nenhum (quem envia e' a rota).
DO $verifica$
DECLARE
    v_n integer;
BEGIN
    BEGIN
        SELECT count(*) INTO v_n FROM public.fn_avisos_ponto_pendentes(1, 0);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'ABORTADO: fn_avisos_ponto_pendentes ainda estoura ao executar: % (%)',
            SQLERRM, SQLSTATE;
    END;

    IF has_function_privilege('anon', 'public.fn_avisos_ponto_pendentes(integer, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: fn_avisos_ponto_pendentes executavel por anon.';
    END IF;

    RAISE NOTICE 'OK: fn_avisos_ponto_pendentes executa sem ambiguidade (reservou % item(ns) nesta chamada).', v_n;
END
$verifica$;
