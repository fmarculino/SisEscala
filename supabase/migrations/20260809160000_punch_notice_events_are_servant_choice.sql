-- Migration: A unidade decide SE envia; o servidor decide O QUE recebe
-- Data: 2026-08-09
--
-- O PROBLEMA
--   unidades.aviso_ponto_eventos (20260809120000) e servidores.aviso_ponto_modo (20260809140000)
--   respondiam a MESMA pergunta - "quais batidas geram mensagem" - de dois lugares. No gatilho
--   eram dois IF consecutivos, e o da unidade rodava PRIMEIRO.
--
--   Dois danos concretos:
--
--   1. O servidor escolhia "todas as batidas" e recebia so duas, porque a unidade tinha desmarcado
--      os passos de intervalo. Nada na tela dele explicava - o sistema prometia uma coisa e a
--      unidade sobrepunha em silencio.
--
--   2. 'fora_janela' estava na lista da unidade e podia ser DESMARCADO. Isso quebraria a unica
--      garantia que vale em todos os modos: a batida fora do previsto sempre avisa. E justamente
--      o caso em que o silencio prejudica quem bateu - a tela do terminal some em 6 segundos.
--
--   Duas fontes para a mesma regra e como o modulo de marcacoes acabou com tres regras de
--   intervalo divergentes (CLAUDE.md, armadilha 9).
--
-- A DECISAO
--   A unidade (ou o setor) decide SE o recurso esta disponivel ali. O servidor decide O QUE
--   recebe, no Portal - e o consentimento e dele, entao a frequencia tambem deve ser.
--
--   A coluna e REMOVIDA, nao apenas ignorada. Coluna que ninguem le e ninguem mostra e como
--   unidades.configuracoes_comunicacao: fica anos parecendo que configura algo.
--
-- ESTE ARQUIVO E GERADO
--   scratchpad/gen_sem_eventos.js copia o corpo vigente de 20260809150000 e remove apenas o
--   filtro de eventos. Nao editar a mao.


-- ============================================================================
-- 1. GATILHO SEM O FILTRO DA UNIDADE
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
    -- A unidade decide SE envia; o servidor decide O QUE recebe. Ate 09/08/2026 a unidade
    -- tambem escolhia os eventos (unidades.aviso_ponto_eventos) e o filtro dela rodava ANTES
    -- deste - entao quem escolhesse "todas as batidas" recebia so duas se a unidade tivesse
    -- desmarcado o intervalo, sem nada explicando. Pior: fora_janela estava na lista da
    -- unidade e podia ser desmarcado, quebrando a unica garantia valida em todos os modos.
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
-- 2. A COLUNA SAI
-- ============================================================================
-- Depois da funcao, nunca antes: enquanto a versao anterior do gatilho estiver ativa ela ainda
-- le a coluna, e derruba-la primeiro quebraria toda batida ate o CREATE OR REPLACE terminar.

ALTER TABLE public.unidades DROP COLUMN IF EXISTS aviso_ponto_eventos;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. A coluna sumiu (esperado: 0 linhas):
--
--      SELECT column_name FROM information_schema.columns
--       WHERE table_name = 'unidades' AND column_name = 'aviso_ponto_eventos';
--
--   2. O gatilho continua existindo e nenhuma funcao referencia a coluna (esperado: 0):
--
--      SELECT count(*) FROM pg_proc
--       WHERE prosrc LIKE '%aviso_ponto_eventos%';
--
--   3. O que continua valendo por servidor:
--
--      SELECT aviso_ponto_modo, count(*) FROM servidores GROUP BY 1;
