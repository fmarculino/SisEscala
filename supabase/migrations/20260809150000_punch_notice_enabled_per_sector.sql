-- Migration: Aviso de ponto habilitado por SETOR, com heranca da unidade
-- Data: 2026-08-09
--
-- MOTIVACAO
--   O toggle nasceu por UNIDADE. Para o piloto isso e grosso demais: a TI da SMS tem 6 servidores,
--   mas ligar a unidade SMS habilitaria os 78 da secretaria inteira - 13x o escopo pretendido.
--   O double opt-in impede que alguem receba sem pedir, mas TORNA A OPCAO VISIVEL a 78 pessoas
--   quando a intencao e 6, e adesao fora do grupo desmonta a leitura do piloto.
--
--   O projeto ja tem esse padrao: geolocalizacao e cadastrada no setor e cai para a unidade quando
--   ausente (v1.7.0). Mesma forma aqui.
--
-- PRECEDENCIA
--   setores.aviso_ponto_whatsapp:
--     NULL  -> herda a unidade  (padrao de todos os setores existentes)
--     true  -> liga  este setor, mesmo com a unidade desligada
--     false -> desliga este setor, mesmo com a unidade ligada
--
--   A resolucao vive em UM lugar so - fn_aviso_ponto_habilitado. Reimplementar a precedencia em
--   cada chamador e como o modulo de marcacoes acabou com tres regras de intervalo divergentes.
--
-- ESTE ARQUIVO E GERADO
--   scratchpad/gen_setor.js copia as duas funcoes vigentes de 20260809140000 e aplica
--   substituicoes pontuais, abortando se qualquer contagem ou guard divergir. Nao editar a mao.


-- ============================================================================
-- 1. COLUNA NO SETOR
-- ============================================================================

ALTER TABLE public.setores
    ADD COLUMN IF NOT EXISTS aviso_ponto_whatsapp boolean;

COMMENT ON COLUMN public.setores.aviso_ponto_whatsapp IS
    'NULL herda a unidade; true/false sobrepoe. Ver fn_aviso_ponto_habilitado.';


-- ============================================================================
-- 2. FONTE UNICA DA PRECEDENCIA
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_aviso_ponto_habilitado(
    p_unidade_id uuid,
    p_setor_id   uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT COALESCE(
        (SELECT st.aviso_ponto_whatsapp FROM public.setores  st WHERE st.id = p_setor_id),
        (SELECT u.aviso_ponto_whatsapp  FROM public.unidades u  WHERE u.id  = p_unidade_id),
        false)
$fn$;

COMMENT ON FUNCTION public.fn_aviso_ponto_habilitado(uuid, uuid) IS
    'Aviso de ponto vale para este setor? Setor sobrepoe unidade; NULL herda; sem nada, false.';

GRANT EXECUTE ON FUNCTION public.fn_aviso_ponto_habilitado(uuid, uuid) TO authenticated, service_role;


-- ============================================================================
-- 3. GATILHO - copia mecanica de 20260809140000, so a checagem da unidade mudou
-- ============================================================================

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

    SELECT u.id, u.nome, u.aviso_ponto_eventos
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
-- 4. RESUMOS - copia mecanica, so os filtros de habilitacao mudaram
-- ============================================================================

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
           AND public.fn_aviso_ponto_habilitado(em.unidade_id, em.setor_id)
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
               AND public.fn_aviso_ponto_habilitado(s.unidade_id, s.setor_id)
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

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. Ninguem foi ligado por engano (esperado: 0 linhas):
--
--      SELECT id FROM setores WHERE aviso_ponto_whatsapp IS NOT NULL;
--
--   2. A precedencia responde (esperado: false em tudo, nada ligado ainda):
--
--      SELECT u.nome, public.fn_aviso_ponto_habilitado(s.unidade_id, s.id)
--        FROM setores s JOIN unidades u ON u.id = s.unidade_id LIMIT 5;
--
--   3. Ligar o PILOTO - so a TI da SMS, sem tocar na unidade:
--
--      UPDATE setores SET aviso_ponto_whatsapp = true
--       WHERE id IN (SELECT s.id FROM setores s
--                      JOIN dicionario_setores d ON d.id = s.dicionario_setor_id
--                      JOIN unidades u ON u.id = s.unidade_id
--                     WHERE d.nome = 'TECNOLOGIA DA INFORMAÇÃO'
--                       AND u.nome LIKE 'SMS%');
--
--   4. Conferir que so a TI ficou habilitada (esperado: 6 servidores):
--
--      SELECT count(*) FROM servidores s
--       WHERE public.fn_aviso_ponto_habilitado(s.unidade_id, s.setor_id);
