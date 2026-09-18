-- Migration: devolver a circulacao as batidas que uma reversao tirou
-- Data: 2026-09-17
-- Plano: docs/planos/2026-09-17-batida-que-nao-alcanca-a-escala-certa.md (defeito D2, saida B2)
--
-- DEPENDE DE 20260917140000 (fn_batida_fisica, fn_batidas_retidas_dia).
--
-- POR QUE EXISTE
--   A 20260917150000 faz a reversao PERGUNTAR a intencao, e resolve daqui para a frente. Ela
--   nao desfaz o que ja foi criado: medido em producao em 17/09/2026, 173 batidas FISICAS
--   estao fora de circulacao, 20 dias tem escala com passo vazio e em 16 deles o
--   "Preencher pelas Batidas" nao consegue fazer nada. So em 17/09 foram 47 batidas rep.
--
--   O conserto existia -- fn_corrigir_passos_com_batidas (v2.72.0) grava 'restaurar' -- mas e
--   de RH/admin e exige montar o dia inteiro passo a passo. Quem criou o problema foi o
--   coordenador, revertendo para corrigir a escala; ele precisa conseguir desfazer.
--
-- 🚨 TRES LIMITES QUE NAO PODEM SAIR
--
--   1. SO A BATIDA FISICA volta. Horario DECLARADO (ajuste_coordenador / ajuste_servidor) e
--      FABRICADO (terminal sintetica, de fn_salvar_saida_bloco) ficam fora: quem reverteu uma
--      declaracao estava desfazendo a propria declaracao, e repor horario inventado em
--      circulacao o faria voltar a folha como se fosse fato. Vem de fn_batidas_retidas_dia.
--
--   2. SO O QUE A REVERSAO AUTOMATICA TIROU volta. A batida desconsiderada por DECISAO -- a
--      batida de teste, a da pessoa errada, a indevida -- foi retirada por alguem que olhou
--      para ela, e nao pode ser reposta por um botao de coordenador. O criterio e a
--      justificativa exata que o trigger de sincronizacao grava; qualquer outra exige a
--      correcao de batida real (fn_corrigir_passos_com_batidas), que e de RH/admin.
--      Medido em 17/09/2026: das 1.166 desconsideradas vigentes, 1.092 sao da reversao
--      automatica e 74 vieram da limpeza de sobreposicao entre setores -- estas ultimas NAO
--      devem voltar (20260826210000 as tirou de proposito).
--
--   3. RESTAURAR NAO APLICA NADA. A batida volta a ser candidata; quem a poe no passo continua
--      sendo a reconciliacao, pelo "Preencher pelas Batidas", com a previa na frente. Juntar
--      as duas coisas num clique so faria a correcao entrar sem ninguem ver o que entrou.
--
-- ⚠️ A JANELA E D-1..D+2, a mesma de fn_batidas_retidas_dia e da previa: turno que atravessa a
--    meia-noite tem batida nos dois dias civis. Como isso pode alcancar batida de um dia
--    vizinho, a funcao DEVOLVE a lista do que restaurou, com data e hora de cada uma -- a tela
--    mostra, e nada volta em silencio.


-- ============================================================================
-- 1. A RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_restaurar_batidas_dia(
    p_servidor_id   uuid,
    p_data          date,
    p_justificativa text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_mes        integer := extract(month from p_data)::integer;
    v_ano        integer := extract(year  from p_data)::integer;
    v_escalas    integer;
    v_sem_acesso integer;
    v_fechadas   integer;
    v_autor      uuid;
    v_restauradas integer := 0;
    v_lista      jsonb;
    -- Texto EXATO gravado por fn_sincronizar_marcacoes_escala_diaria. Se ele mudar la, este
    -- criterio para de casar e a funcao passa a nao restaurar NADA -- falha fechada, que e o
    -- lado seguro. A conferencia abaixo executa o caminho para isso nao passar despercebido.
    c_just_reversao constant text := 'Presenca revertida em escala_diaria (sincronizacao automatica).';
BEGIN
    IF p_justificativa IS NULL OR length(btrim(p_justificativa)) < 5 THEN
        RETURN jsonb_build_object('status','sem_justificativa','restauradas',0,
            'motivo','Escreva o motivo da restauracao (ao menos 5 caracteres).');
    END IF;

    v_autor := auth.uid();
    IF v_autor IS NULL THEN
        -- marcacoes_tratamentos.registrado_por_id e NOT NULL, e um ato sem autor nao e ato.
        -- Rota de maquina nao tem o que restaurar: quem restaura decide.
        RETURN jsonb_build_object('status','sem_sessao','restauradas',0,
            'motivo','Sessao nao identificada.');
    END IF;

    -- Mesmo escopo do "Preencher pelas Batidas": restaurar so faz sentido para quem pode
    -- aplicar o resultado, e o dia pode ter escala em mais de um setor.
    SELECT count(*), count(*) FILTER (WHERE NOT public.fn_pode_reconciliar_presenca(em.unidade_id))
      INTO v_escalas, v_sem_acesso
      FROM public.escala_mensal em
     WHERE em.servidor_id = p_servidor_id AND em.mes = v_mes AND em.ano = v_ano;

    IF COALESCE(v_escalas,0) = 0 THEN
        RETURN jsonb_build_object('status','sem_escala','restauradas',0,
            'motivo','Este servidor nao tem escala nesta competencia.');
    END IF;

    IF COALESCE(v_sem_acesso,0) > 0 THEN
        RETURN jsonb_build_object('status','acesso_negado','restauradas',0,
            'motivo','Voce nao tem acesso a todas as escalas deste servidor neste mes.');
    END IF;

    IF public.fn_competencia_encerrada(v_mes, v_ano) THEN
        RETURN jsonb_build_object('status','competencia_encerrada','restauradas',0,
            'motivo','Competencia encerrada: reabra em Configuracoes.');
    END IF;

    SELECT count(*) INTO v_fechadas
      FROM public.escala_mensal em
     WHERE em.servidor_id = p_servidor_id AND em.mes = v_mes AND em.ano = v_ano
       AND em.status = 'Fechada';

    IF COALESCE(v_fechadas,0) > 0 THEN
        RETURN jsonb_build_object('status','escala_fechada','restauradas',0,
            'motivo','A escala esta Fechada: reabra antes de restaurar.');
    END IF;

    -- Alvos: batidas fisicas retidas do dia CUJO ULTIMO desconsiderar veio da reversao
    -- automatica. O tratamento e append-only, entao "voltar" e gravar um 'restaurar' novo.
    WITH alvo AS (
        SELECT r.marcacao_id, r.origem, r.ocorrido_em
          FROM public.fn_batidas_retidas_dia(p_servidor_id, p_data) r
         WHERE EXISTS (
             SELECT 1
               FROM public.marcacoes_tratamentos t
              WHERE t.marcacao_id = r.marcacao_id
                AND t.tipo = 'desconsiderar'
                AND t.justificativa = c_just_reversao
                AND t.created_at = (
                    SELECT max(t2.created_at)
                      FROM public.marcacoes_tratamentos t2
                     WHERE t2.marcacao_id = r.marcacao_id
                       AND t2.tipo IN ('desconsiderar','restaurar')))
    ), ins AS (
        INSERT INTO public.marcacoes_tratamentos
            (marcacao_id, tipo, justificativa, registrado_por_id)
        SELECT a.marcacao_id, 'restaurar', p_justificativa, v_autor
          FROM alvo a
        RETURNING marcacao_id
    )
    SELECT count(*)::integer,
           COALESCE(jsonb_agg(jsonb_build_object(
               'marcacao_id', a.marcacao_id,
               'origem',      a.origem,
               'ocorrido_em', a.ocorrido_em) ORDER BY a.ocorrido_em), '[]'::jsonb)
      INTO v_restauradas, v_lista
      FROM alvo a
     WHERE a.marcacao_id IN (SELECT marcacao_id FROM ins);

    -- RELATA O QUE MUDOU, nunca o que foi encontrado (armadilha 22). "encontradas" ao lado
    -- torna visivel o caso de achar muito e restaurar pouco, em vez de sumir na diferenca.
    RETURN jsonb_build_object(
        'status', CASE WHEN v_restauradas > 0 THEN 'ok' ELSE 'nada_a_restaurar' END,
        'restauradas', v_restauradas,
        'encontradas', (SELECT count(*)::integer FROM public.fn_batidas_retidas_dia(p_servidor_id, p_data)),
        'batidas', v_lista,
        'motivo', CASE WHEN v_restauradas > 0
                       THEN 'As batidas voltaram a circular. Use "Preencher pelas Batidas" para aplica-las.'
                       ELSE 'Nenhuma batida deste dia foi tirada de circulacao por uma reversao. '
                         || 'Se ha batida desconsiderada por decisao, ela so volta pela correcao de batida real.'
                   END);
END;
$fn$;

COMMENT ON FUNCTION public.fn_restaurar_batidas_dia(uuid, date, text) IS
    'Devolve a circulacao as batidas FISICAS do dia que a reversao AUTOMATICA tirou. Nao aplica '
    'nada em escala_diaria: quem poe a batida no passo continua sendo o "Preencher pelas '
    'Batidas". Batida desconsiderada por DECISAO (justificativa diferente da do trigger) fica '
    'fora -- essa so volta pela correcao de batida real, que e de RH/admin.';

REVOKE ALL ON FUNCTION public.fn_restaurar_batidas_dia(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_restaurar_batidas_dia(uuid, date, text) TO authenticated, service_role;


-- ============================================================================
-- 2. CONFERENCIA -- EXECUTA a funcao (armadilha 42), ensaio revertido
-- ============================================================================
-- Confere os DOIS SENTIDOS. Afrouxar um lado aqui e caro nos dois:
--   restaurar demais -> batida indevida, tirada por decisao, volta para a folha;
--   restaurar de menos -> os 16 dias medidos continuam presos.

DO $conf$
DECLARE
    v_prof   uuid;
    v_ed     record;
    v_marc_a uuid;   -- retirada pela reversao automatica  -> DEVE voltar
    v_marc_b uuid;   -- retirada por decisao               -> NAO deve voltar
    v_marc_c uuid;   -- sintetica, retirada pela reversao  -> NAO deve voltar
    v_r      jsonb;
BEGIN
    -- 2.1 anon nao executa; authenticated executa (a grade chama com sessao de coordenador)
    IF has_function_privilege('anon', 'public.fn_restaurar_batidas_dia(uuid, date, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon executa fn_restaurar_batidas_dia -- ela ESCREVE tratamento.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_restaurar_batidas_dia(uuid, date, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated nao executa fn_restaurar_batidas_dia -- o botao nasce morto.';
    END IF;

    SELECT id INTO v_prof FROM public.profiles WHERE role = 'super_admin' LIMIT 1;
    IF v_prof IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 20260917160000: sem profile super_admin; ensaio pulado.';
        RETURN;
    END IF;

    -- SESSAO SIMULADA: sem JWT, auth.uid() e NULL e a funcao devolve 'sem_sessao' -- o ensaio
    -- "passaria" exercitando o caminho errado.
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_prof::text, 'role', 'authenticated')::text, true);

    SELECT ed.id, ed.dia, em.servidor_id, em.unidade_id, make_date(em.ano, em.mes, ed.dia) AS data
      INTO v_ed
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.categoria::text <> 'Sobreaviso'
       AND em.status <> 'Fechada'
       AND NOT public.fn_competencia_encerrada(em.mes, em.ano)
     LIMIT 1;

    IF v_ed.id IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 20260917160000: sem escala aberta; ensaio pulado.';
        RETURN;
    END IF;

    -- (a) batida fisica tirada pela REVERSAO AUTOMATICA
    INSERT INTO public.marcacoes_ponto (servidor_id, origem, ocorrido_em, unidade_id, sintetica, observacao)
    VALUES (v_ed.servidor_id, 'terminal', (v_ed.data::timestamp + time '08:01')::timestamptz,
            v_ed.unidade_id, false, 'CONFERENCIA 20260917160000 a')
    RETURNING id INTO v_marc_a;
    INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)
    VALUES (v_marc_a, 'desconsiderar',
            'Presenca revertida em escala_diaria (sincronizacao automatica).', v_prof);

    -- (b) batida fisica tirada por DECISAO (justificativa propria)
    INSERT INTO public.marcacoes_ponto (servidor_id, origem, ocorrido_em, unidade_id, sintetica, observacao)
    VALUES (v_ed.servidor_id, 'terminal', (v_ed.data::timestamp + time '08:02')::timestamptz,
            v_ed.unidade_id, false, 'CONFERENCIA 20260917160000 b')
    RETURNING id INTO v_marc_b;
    INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)
    VALUES (v_marc_b, 'desconsiderar', 'Batida de teste do administrador do parque.', v_prof);

    -- (c) horario FABRICADO tirado pela reversao automatica
    INSERT INTO public.marcacoes_ponto (servidor_id, origem, ocorrido_em, unidade_id, sintetica, observacao)
    VALUES (v_ed.servidor_id, 'terminal', (v_ed.data::timestamp + time '08:03')::timestamptz,
            v_ed.unidade_id, true, 'CONFERENCIA 20260917160000 c')
    RETURNING id INTO v_marc_c;
    INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)
    VALUES (v_marc_c, 'desconsiderar',
            'Presenca revertida em escala_diaria (sincronizacao automatica).', v_prof);

    -- Justificativa curta e recusada ANTES de escrever qualquer coisa
    v_r := public.fn_restaurar_batidas_dia(v_ed.servidor_id, v_ed.data, 'oi');
    IF v_r->>'status' <> 'sem_justificativa' THEN
        RAISE EXCEPTION 'ABORTADO: justificativa de 2 caracteres foi aceita (status %).', v_r->>'status';
    END IF;
    IF public.fn_marcacao_desconsiderada(v_marc_a) IS FALSE THEN
        RAISE EXCEPTION 'ABORTADO: a recusa por justificativa curta escreveu mesmo assim.';
    END IF;

    v_r := public.fn_restaurar_batidas_dia(v_ed.servidor_id, v_ed.data,
        'CONFERENCIA: escala estava errada, dia relancado');

    IF (v_r->>'restauradas')::integer <> 1 THEN
        RAISE EXCEPTION 'ABORTADO: restauradas = % (esperado exatamente 1: so a fisica da reversao automatica). motivo=%',
            v_r->>'restauradas', v_r->>'motivo';
    END IF;

    IF public.fn_marcacao_desconsiderada(v_marc_a) THEN
        RAISE EXCEPTION 'ABORTADO(a): a batida fisica da reversao automatica NAO voltou a circular.';
    END IF;
    IF NOT public.fn_marcacao_desconsiderada(v_marc_b) THEN
        RAISE EXCEPTION 'ABORTADO(b): batida tirada por DECISAO voltou a circular -- isso desfaz ato de RH.';
    END IF;
    IF NOT public.fn_marcacao_desconsiderada(v_marc_c) THEN
        RAISE EXCEPTION 'ABORTADO(c): horario FABRICADO voltou a circular -- ele nao e batida.';
    END IF;

    -- Idempotencia: rodar de novo nao acha mais nada e nao mente sobre isso.
    v_r := public.fn_restaurar_batidas_dia(v_ed.servidor_id, v_ed.data,
        'CONFERENCIA: segunda passagem');
    IF (v_r->>'restauradas')::integer <> 0 OR v_r->>'status' <> 'nada_a_restaurar' THEN
        RAISE EXCEPTION 'ABORTADO: a segunda passagem restaurou % (esperado 0).', v_r->>'restauradas';
    END IF;

    RAISE EXCEPTION 'CONFERENCIA_OK_ROLLBACK';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'CONFERENCIA_OK_ROLLBACK' THEN
            RAISE NOTICE 'CONFERENCIA 20260917160000: OK nos quatro sentidos (ensaio revertido).';
        ELSE
            RAISE;
        END IF;
END;
$conf$;
