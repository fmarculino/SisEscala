-- Migration: Granularidade do aviso de ponto - o servidor escolhe quanto quer ser incomodado
-- Data: 2026-08-09
--
-- OBJETIVO
--   O aviso por batida pode chegar a 88 mensagens/mes em unidade que marca intervalo. Isso cansa,
--   e mensagem cansativa e ignorada - o registro deixa de cumprir a funcao que motivou o recurso.
--   O servidor passa a escolher a frequencia, sem perder a garantia de ter seus registros.
--
-- O RESUMO DIARIO E O PADRAO, E NAO E SO "MODO ECONOMICO"
--   Uma mensagem com as quatro batidas do dia e evidencia MELHOR que quatro mensagens soltas:
--   e um registro unico, com carimbo de horario do WhatsApp, que a pessoa consegue achar depois.
--   Quatro fragmentos ao longo do dia ninguem recupera. Por isso 'resumo_diario' e o DEFAULT.
--
-- POR QUE OS RESUMOS NAO SAEM DO GATILHO
--   A ideia original era "resumo na ultima batida". O problema: no instante da batida o sistema
--   nao sabe que ela e a ultima - e nos dias em que a saida NAO e registrada (esquecimento, ou
--   batida fora da janela que virou pendencia) o resumo nunca sairia. Justamente o dia em que a
--   pessoa mais precisa do registro.
--
--   Entao os resumos sao produzidos por fn_gerar_resumos_aviso_ponto(), chamada pelo worker a
--   cada minuto. O dia "fecha" de dois jeitos: a saida foi registrada, OU o dia acabou. O
--   primeiro caso entrega em ate 1 minuto apos a ultima batida - na pratica e "na ultima batida".
--   O segundo e a rede de seguranca, e sai marcado como incompleto.
--
-- 'fora_janela' AVISA SEMPRE, EM QUALQUER MODO
--   E o caso em que o silencio prejudica: a tela do terminal some em 6 segundos e o servidor fica
--   sem nada que prove que registrou. Nao entra em resumo - vai na hora, individualmente.
--
-- RESUMO MENSAL FOI DESCARTADO
--   Resumo mensal e a folha de ponto, que ja existe no Portal, a qualquer momento e com muito
--   mais detalhe do que cabe numa mensagem. O resumo semanal leva o link do Portal no rodape;
--   e o beneficio de push sem transcrever documento que ja existe.


-- ============================================================================
-- 1. MODO ESCOLHIDO PELO SERVIDOR
-- ============================================================================

ALTER TABLE public.servidores
    ADD COLUMN IF NOT EXISTS aviso_ponto_modo text NOT NULL DEFAULT 'resumo_diario';

DO $chk$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aviso_ponto_modo') THEN
        ALTER TABLE public.servidores
            ADD CONSTRAINT chk_aviso_ponto_modo CHECK (aviso_ponto_modo IN
                ('todas', 'entrada_saida', 'resumo_diario', 'resumo_semanal'));
    END IF;
END
$chk$;

COMMENT ON COLUMN public.servidores.aviso_ponto_modo IS
    'todas | entrada_saida | resumo_diario (default) | resumo_semanal. fora_janela avisa sempre.';


-- ============================================================================
-- 2. A FILA PASSA A CARREGAR RESUMOS
-- ============================================================================

ALTER TABLE public.avisos_ponto_fila
    ADD COLUMN IF NOT EXISTS referencia date;

COMMENT ON COLUMN public.avisos_ponto_fila.referencia IS
    'Dia (resumo_diario) ou segunda-feira da semana (resumo_semanal) a que o resumo se refere.';

ALTER TABLE public.avisos_ponto_fila DROP CONSTRAINT IF EXISTS avisos_ponto_fila_tipo_check;
ALTER TABLE public.avisos_ponto_fila
    ADD CONSTRAINT avisos_ponto_fila_tipo_check CHECK (tipo IN
        ('registro', 'confirmacao_optin', 'resumo_diario', 'resumo_semanal'));

-- Idempotencia dos resumos. Sem isso o worker, rodando de minuto em minuto, reenviaria o mesmo
-- resumo indefinidamente - o pior comportamento possivel para quem escolheu ser pouco incomodado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_aviso_resumo_unico
    ON public.avisos_ponto_fila (servidor_id, tipo, referencia)
 WHERE tipo IN ('resumo_diario', 'resumo_semanal');

ALTER TABLE public.avisos_ponto_fila DROP CONSTRAINT IF EXISTS chk_aviso_registro_tem_marcacao;
ALTER TABLE public.avisos_ponto_fila
    ADD CONSTRAINT chk_aviso_registro_tem_marcacao
    CHECK (tipo <> 'registro' OR marcacao_id IS NOT NULL);

ALTER TABLE public.avisos_ponto_fila DROP CONSTRAINT IF EXISTS chk_aviso_resumo_tem_referencia;
ALTER TABLE public.avisos_ponto_fila
    ADD CONSTRAINT chk_aviso_resumo_tem_referencia
    CHECK (tipo NOT IN ('resumo_diario', 'resumo_semanal') OR referencia IS NOT NULL);


-- ============================================================================
-- 3. O GATILHO PASSA A RESPEITAR O MODO
-- ============================================================================
-- Copia da versao de 20260809120000 com UM bloco novo: a decisao por modo, logo depois de
-- descobrir o evento. Todo o resto - filtros de origem, sintetica, janela de 10 min, unidade,
-- status, telefone e a leitura do passo - fica byte a byte como estava.

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

    SELECT u.id, u.nome, u.aviso_ponto_whatsapp, u.aviso_ponto_eventos
      INTO v_unidade
      FROM public.unidades u
     WHERE u.id = NEW.unidade_id;

    IF NOT FOUND OR NOT v_unidade.aviso_ponto_whatsapp THEN
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

    IF NOT (v_evento = ANY (v_unidade.aviso_ponto_eventos)) THEN
        RETURN NULL;
    END IF;

    -- ---- NOVO: o modo escolhido pelo servidor -----------------------------
    -- 'fora_janela' passa em qualquer modo: e o caso em que o silencio prejudica quem bateu.
    -- Nos modos de resumo, a batida normal nao gera mensagem aqui - quem produz e
    -- fn_gerar_resumos_aviso_ponto(), chamada pelo worker.
    IF v_evento <> 'fora_janela' THEN
        IF v_servidor.aviso_ponto_modo IN ('resumo_diario', 'resumo_semanal') THEN
            RETURN NULL;
        END IF;
        IF v_servidor.aviso_ponto_modo = 'entrada_saida'
           AND v_evento NOT IN ('entrada', 'saida') THEN
            RETURN NULL;
        END IF;
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
-- 4. PRODUCAO DOS RESUMOS
-- ============================================================================
-- Chamada pelo worker a cada minuto. Idempotente pelo indice unico (servidor, tipo, referencia).
--
-- DIARIO - o dia entra na fila quando:
--   (a) a SAIDA foi registrada  -> entrega em ate 1 minuto, que na pratica e "na ultima batida";
--   (b) o dia JA PASSOU          -> rede de seguranca para quem esqueceu de bater a saida.
-- O caso (b) sai marcado como incompleto: e melhor avisar que faltou registro do que silenciar.
--
-- SEMANAL - segunda-feira a partir das 08:00 locais, cobrindo a semana anterior.

CREATE OR REPLACE FUNCTION public.fn_gerar_resumos_aviso_ponto()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_timezone  text;
    v_hoje      date;
    v_agora     timestamp;
    v_seg_ant   date;
    v_row       record;
    v_dia       record;
    v_linhas    text;
    v_msg       text;
    v_tel       text;
    v_qtd       integer := 0;
    v_incompleto boolean;
BEGIN
    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    v_agora := now() AT TIME ZONE v_timezone;
    v_hoje  := v_agora::date;

    -- ------------------------------------------------------------------ DIARIO
    -- AGREGADO POR (servidor, dia), nao por linha de escala_diaria: um servidor pode ter DUAS
    -- linhas no mesmo dia (Regular + Plantao, por exemplo). Percorrer linha a linha produziria um
    -- resumo com so um dos turnos - e o indice unico engoliria o outro em silencio, que e o pior
    -- resultado: mensagem entregue, incompleta, e sem rastro do que faltou.
    -- Primeira entrada e ultima saida do dia; o intervalo vem do turno em que foi marcado.
    FOR v_row IN
        SELECT s.id AS servidor_id, s.nome,
               min(u.id::text)::uuid AS unidade_id, min(u.nome) AS unidade_nome,
               (ed.presenca_entrada_em AT TIME ZONE v_timezone)::date AS dia,
               min(ed.presenca_entrada_em)           AS presenca_entrada_em,
               min(ed.presenca_intervalo_saida_em)   AS presenca_intervalo_saida_em,
               max(ed.presenca_intervalo_retorno_em) AS presenca_intervalo_retorno_em,
               max(ed.presenca_saida_em)             AS presenca_saida_em,
               bool_or(ed.presenca_saida_em IS NOT NULL) AS tem_saida
          FROM public.escala_diaria ed
          JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
          JOIN public.servidores    s  ON s.id  = em.servidor_id
          JOIN public.unidades      u  ON u.id  = em.unidade_id
         WHERE s.aviso_ponto_status = 'ativo'
           AND s.aviso_ponto_modo   = 'resumo_diario'
           AND u.aviso_ponto_whatsapp
           AND ed.presenca_entrada_em IS NOT NULL
           -- limite de retroatividade: ligar o recurso nao pode despejar meses de resumo
           AND ed.presenca_entrada_em > now() - interval '3 days'
         GROUP BY s.id, s.nome, 5
        HAVING
           -- fecha quando TODOS os turnos do dia tem saida, OU quando o dia ja passou. Exigir
           -- todos evita mandar resumo no fim do Regular de quem ainda vai emendar o plantao.
               (bool_and(ed.presenca_saida_em IS NOT NULL)
                OR (ed.presenca_entrada_em AT TIME ZONE v_timezone)::date < v_hoje)
           AND NOT EXISTS (
                SELECT 1 FROM public.avisos_ponto_fila f
                 WHERE f.servidor_id = s.id
                   AND f.tipo = 'resumo_diario'
                   AND f.referencia = (ed.presenca_entrada_em AT TIME ZONE v_timezone)::date)
    LOOP
        v_tel := public.fn_telefone_aviso_ponto(v_row.servidor_id);
        CONTINUE WHEN v_tel IS NULL;

        v_incompleto := NOT v_row.tem_saida OR v_row.presenca_saida_em IS NULL;

        v_linhas :=
            '• Entrada: ' || to_char(v_row.presenca_entrada_em AT TIME ZONE v_timezone, 'HH24:MI')
          || CASE WHEN v_row.presenca_intervalo_saida_em IS NOT NULL
                  THEN E'\n• Saída p/ intervalo: ' || to_char(v_row.presenca_intervalo_saida_em AT TIME ZONE v_timezone, 'HH24:MI')
                  ELSE '' END
          || CASE WHEN v_row.presenca_intervalo_retorno_em IS NOT NULL
                  THEN E'\n• Retorno do intervalo: ' || to_char(v_row.presenca_intervalo_retorno_em AT TIME ZONE v_timezone, 'HH24:MI')
                  ELSE '' END
          || CASE WHEN v_row.presenca_saida_em IS NOT NULL
                  THEN E'\n• Saída: ' || to_char(v_row.presenca_saida_em AT TIME ZONE v_timezone, 'HH24:MI')
                  ELSE E'\n• Saída: *não registrada*' END;

        v_msg :=
            '📋 *Resumo do seu ponto — ' || to_char(v_row.dia, 'DD/MM/YYYY') || '*' || E'\n\n' ||
            'Olá, ' || COALESCE(v_row.nome, 'servidor(a)') || '.' || E'\n' ||
            'Local: ' || COALESCE(v_row.unidade_nome, 'não informado') || E'\n\n' ||
            v_linhas || E'\n\n' ||
            CASE WHEN v_incompleto
                 THEN '⚠️ *A saída deste dia não foi registrada.* Procure seu coordenador para regularizar.' || E'\n\n'
                 ELSE '' END ||
            '_Aviso informativo, não é o Comprovante de Registro de Ponto._' || E'\n' ||
            '_Horários sujeitos a revisão do coordenador. Sua folha está no Portal do Servidor._' || E'\n' ||
            'SisEscala — Secretaria Municipal de Saúde de Marabá' || E'\n\n' ||
            '_Para parar de receber, responda PARAR._';

        INSERT INTO public.avisos_ponto_fila
            (tipo, servidor_id, unidade_id, telefone, mensagem, evento, referencia)
        VALUES
            ('resumo_diario', v_row.servidor_id, v_row.unidade_id, v_tel, v_msg,
             CASE WHEN v_incompleto THEN 'resumo_incompleto' ELSE 'resumo' END, v_row.dia)
        ON CONFLICT DO NOTHING;

        v_qtd := v_qtd + 1;
    END LOOP;

    -- ----------------------------------------------------------------- SEMANAL
    -- Segunda-feira (ISO 1) a partir das 08:00 locais, cobrindo a segunda anterior.
    IF extract(isodow from v_hoje) = 1 AND extract(hour from v_agora) >= 8 THEN
        v_seg_ant := v_hoje - 7;

        FOR v_row IN
            SELECT s.id AS servidor_id, s.nome, s.unidade_id
              FROM public.servidores s
              JOIN public.unidades   u ON u.id = s.unidade_id
             WHERE s.aviso_ponto_status = 'ativo'
               AND s.aviso_ponto_modo   = 'resumo_semanal'
               AND u.aviso_ponto_whatsapp
               AND NOT EXISTS (
                    SELECT 1 FROM public.avisos_ponto_fila f
                     WHERE f.servidor_id = s.id
                       AND f.tipo = 'resumo_semanal'
                       AND f.referencia = v_seg_ant)
        LOOP
            v_tel := public.fn_telefone_aviso_ponto(v_row.servidor_id);
            CONTINUE WHEN v_tel IS NULL;

            v_linhas := '';
            FOR v_dia IN
                SELECT (ed.presenca_entrada_em AT TIME ZONE v_timezone)::date AS dia,
                       ed.presenca_entrada_em, ed.presenca_saida_em
                  FROM public.escala_diaria ed
                  JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
                 WHERE em.servidor_id = v_row.servidor_id
                   AND ed.presenca_entrada_em IS NOT NULL
                   AND (ed.presenca_entrada_em AT TIME ZONE v_timezone)::date BETWEEN v_seg_ant AND v_seg_ant + 6
                 ORDER BY 1
            LOOP
                v_linhas := v_linhas || '• ' || to_char(v_dia.dia, 'DD/MM') || ': '
                  || to_char(v_dia.presenca_entrada_em AT TIME ZONE v_timezone, 'HH24:MI') || ' → '
                  || COALESCE(to_char(v_dia.presenca_saida_em AT TIME ZONE v_timezone, 'HH24:MI'),
                              '*sem saída*')
                  || E'\n';
            END LOOP;

            -- Semana sem nenhum registro nao gera mensagem: seria ruido puro.
            CONTINUE WHEN v_linhas = '';

            v_msg :=
                '📋 *Resumo semanal do seu ponto*' || E'\n' ||
                to_char(v_seg_ant, 'DD/MM') || ' a ' || to_char(v_seg_ant + 6, 'DD/MM/YYYY') || E'\n\n' ||
                'Olá, ' || COALESCE(v_row.nome, 'servidor(a)') || '.' || E'\n\n' ||
                v_linhas || E'\n' ||
                '_Aviso informativo, não é o Comprovante de Registro de Ponto._' || E'\n' ||
                '_Horários sujeitos a revisão. Sua folha completa está no Portal do Servidor:_' || E'\n' ||
                'https://sisescala.maraba.pa.gov.br/consultar-escala' || E'\n\n' ||
                '_Para parar de receber, responda PARAR._';

            INSERT INTO public.avisos_ponto_fila
                (tipo, servidor_id, unidade_id, telefone, mensagem, evento, referencia)
            VALUES
                ('resumo_semanal', v_row.servidor_id, v_row.unidade_id, v_tel, v_msg,
                 'resumo', v_seg_ant)
            ON CONFLICT DO NOTHING;

            v_qtd := v_qtd + 1;
        END LOOP;
    END IF;

    RETURN v_qtd;

EXCEPTION WHEN OTHERS THEN
    -- Nao pode derrubar o worker: despachar o que ja esta na fila e mais importante que gerar
    -- resumo novo.
    RAISE WARNING 'fn_gerar_resumos_aviso_ponto falhou: %', SQLERRM;
    RETURN 0;
END;
$fn$;

COMMENT ON FUNCTION public.fn_gerar_resumos_aviso_ponto() IS
    'Enfileira resumos diarios e semanais. Idempotente por (servidor, tipo, referencia). O diario '
    'fecha na saida registrada ou na virada do dia - este segundo caso sai marcado como incompleto.';

GRANT EXECUTE ON FUNCTION public.fn_gerar_resumos_aviso_ponto() TO service_role;


-- ============================================================================
-- 5. O MODO ENTRA NA RPC DO PORTAL
-- ============================================================================

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
    IF p_modo NOT IN ('todas', 'entrada_saida', 'resumo_diario', 'resumo_semanal') THEN
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

COMMENT ON FUNCTION public.fn_definir_modo_aviso_ponto(uuid, text) IS
    'Frequencia do aviso escolhida pelo servidor. Nao mexe no consentimento - so na frequencia.';

REVOKE ALL ON FUNCTION public.fn_definir_modo_aviso_ponto(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_definir_modo_aviso_ponto(uuid, text) TO service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. Todo mundo no padrao, e nada ligado (esperado: todos 'resumo_diario' e 'inativo'):
--
--      SELECT aviso_ponto_modo, aviso_ponto_status, count(*) FROM servidores GROUP BY 1, 2;
--
--   2. A geracao roda sem erro e nao produz nada (nenhuma unidade ligada ainda):
--
--      SELECT public.fn_gerar_resumos_aviso_ponto();   -- esperado: 0
--
--   3. Simular um dia fechado, DEPOIS de ligar a unidade e ter opt-in ativo:
--
--      SELECT tipo, referencia, evento, left(mensagem, 60)
--        FROM avisos_ponto_fila WHERE tipo LIKE 'resumo%' ORDER BY criado_em DESC;
--
--   4. Conferir que o resumo nao repete (rodar duas vezes seguidas deve dar o mesmo total):
--
--      SELECT count(*) FROM avisos_ponto_fila WHERE tipo = 'resumo_diario';
