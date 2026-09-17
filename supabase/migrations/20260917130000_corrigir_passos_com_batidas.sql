-- Migration: correcao declarativa dos passos de um dia a partir das batidas REAIS
-- Data: 2026-09-17
-- Plano: docs/planos/2026-09-17-correcao-de-batida-real-pelo-rh-e-falta-em-plantao.md (Fase 1)
--
-- O QUE ISTO SUBSTITUI
--   Hoje, trocar a batida de um passo e o par "reverter + revalidar":
--     1. fn_reverter_presenca_manual zera o passo -- SEM justificativa nenhuma, o unico ato do
--        sistema que nao pede motivo, num projeto em que trocar turno e apagar vigencia pedem;
--     2. fn_aceitar_marcacao_pendente grava a nova -- mas com COALESCE, entao ela NUNCA
--        sobrescreve passo preenchido: sem o passo 1 ela simplesmente nao faz nada.
--   Dois atos, um deles mudo, e o resultado so durava ate a proxima reconciliacao daquele dia.
--
-- O QUE ESTA FUNCAO FAZ DIFERENTE
--   Recebe o CONJUNTO FINAL dos passos do dia e resolve tudo numa transacao:
--     - grava 'reclassificar_passo' para cada batida designada -> a alocacao passa a fixa-la
--       (20260917120000), e a correcao sobrevive a reconciliacao;
--     - grava 'desconsiderar' para cada batida retirada de circulacao;
--     - aplica os passos em escala_diaria SEM COALESCE.
--
--   A marcacao NUNCA e alterada nem apagada: marcacoes_ponto e INSERT-only e e o artefato legal.
--   O que se grava e o JUIZO sobre ela, append-only, com autor e motivo -- que e exatamente o
--   tratamento previsto no Art. 82, paragrafo unico, da Portaria 671/2021.
--
-- ⚠️ ELA NAO DIGITA HORARIO. Declarar um horario onde ha batida real continua sendo caminho
--    separado (fn_registrar_presenca_informada) e ato exclusivo do Administrador. Aqui so se
--    rearranja o que o relogio gravou -- e e isso que torna seguro abrir a operacao ao RH.


-- ============================================================================
-- 1. QUEM PODE O QUE -- espelho de src/utils/folha/correcaoBatidaReal.ts
-- ============================================================================
-- ⚠️ As duas camadas precisam concordar. O caminho real do app passa pelo TypeScript; esta
--    funcao existe porque a RPC e GRANTada a `authenticated` e alcancavel direto (armadilha 12).

CREATE OR REPLACE FUNCTION public.fn_pode_corrigir_batida_real(p_acao text, p_role text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
    SELECT CASE COALESCE(p_role, public.get_my_role()::text)
        WHEN 'super_admin' THEN p_acao IN ('preencher_vazio', 'rearranjar', 'digitar_sobre_real')
        WHEN 'admin'       THEN p_acao IN ('preencher_vazio', 'rearranjar', 'digitar_sobre_real')
        WHEN 'rh'          THEN p_acao IN ('preencher_vazio', 'rearranjar')
        WHEN 'rh_unidade'  THEN p_acao IN ('preencher_vazio', 'rearranjar')
        WHEN 'coordenador' THEN p_acao IN ('preencher_vazio')
        WHEN 'ass_adm'     THEN p_acao IN ('preencher_vazio')
        ELSE false
    END;
$fn$;

COMMENT ON FUNCTION public.fn_pode_corrigir_batida_real(text, text) IS
    'Matriz de quem rearranja batida real, quem so valida passo vazio e quem digita por cima de '
    'batida. Espelho de src/utils/folha/correcaoBatidaReal.ts -- ao mudar uma ponta, mude a outra.';

REVOKE ALL ON FUNCTION public.fn_pode_corrigir_batida_real(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pode_corrigir_batida_real(text, text) TO authenticated, service_role;


-- ============================================================================
-- 2. A CORRECAO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_corrigir_passos_com_batidas(
    p_servidor_id   uuid,
    p_data          date,
    p_atribuicoes   jsonb,     -- [{escala_diaria_id, passo, marcacao_id}]
    p_desconsiderar jsonb,     -- ["<marcacao_id>", ...] batidas que saem de circulacao
    p_justificativa text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_validador   uuid := auth.uid();
    v_role        text := public.get_my_role()::text;
    v_timezone    text;
    v_ini         timestamptz;
    v_fim         timestamptz;
    v_linhas      uuid[] := '{}';
    v_unidades    uuid[] := '{}';
    v_marc_usadas uuid[] := '{}';
    v_desc_ids    uuid[] := '{}';
    v_antes       uuid[] := '{}';
    v_soltas      uuid[] := '{}';
    v_aplicadas   integer := 0;
    v_retiradas   integer := 0;
    r             record;
    v_ant         timestamptz;
    v_ts          timestamptz;
    v_passo       text;
    v_marc        uuid;
    v_id          uuid;
BEGIN
    -- ---- porta ------------------------------------------------------------
    IF v_validador IS NULL THEN
        RAISE EXCEPTION 'Sessao nao identificada.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- ⚠️ NOT IN com NULL devolve NULL, e um IF sobre NULL NAO dispara: o guard nao recusaria
    --    nada (armadilha 70). Aqui a funcao devolve boolean e o COALESCE fecha explicitamente.
    IF NOT COALESCE(public.fn_pode_corrigir_batida_real('rearranjar', v_role), false) THEN
        RAISE EXCEPTION 'Seu perfil nao pode remanejar batidas registradas em terminal ou relogio.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_justificativa IS NULL OR length(btrim(p_justificativa)) < 10 THEN
        RAISE EXCEPTION 'A justificativa da correcao deve ter ao menos 10 caracteres.';
    END IF;

    -- ---- as linhas do dia, e o escopo --------------------------------------
    SELECT array_agg(ed.id), array_agg(DISTINCT em.unidade_id)
      INTO v_linhas, v_unidades
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE em.servidor_id = p_servidor_id
       AND em.mes = extract(month from p_data)::integer
       AND em.ano = extract(year  from p_data)::integer
       AND ed.dia = extract(day   from p_data)::integer
       AND ed.categoria::text <> 'Sobreaviso';

    IF v_linhas IS NULL OR array_length(v_linhas, 1) IS NULL THEN
        RAISE EXCEPTION 'Nao ha escala deste servidor em % para corrigir.', to_char(p_data, 'DD/MM/YYYY');
    END IF;

    -- Escopo: mesma dupla de fn_blocos_previstos_dia. fn_unidade_no_escopo sozinha nao basta --
    -- quem tem acesso so por profile_setores passaria por ela e falharia na chamada real.
    FOR v_id IN SELECT unnest(v_unidades) LOOP
        IF NOT (public.fn_unidade_no_escopo(v_id)
                OR public.fn_unidade_alcancavel_por_setor(v_id)) THEN
            RAISE EXCEPTION 'Sem permissao para corrigir a presenca desta unidade.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END LOOP;

    IF public.fn_competencia_encerrada(
           extract(month from p_data)::integer, extract(year from p_data)::integer) THEN
        RAISE EXCEPTION 'Competencia % esta encerrada. Reabra antes de corrigir.',
            to_char(p_data, 'MM/YYYY');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.escala_diaria ed
          JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
         WHERE ed.id = ANY(v_linhas) AND em.status = 'Fechada') THEN
        RAISE EXCEPTION 'Ha escala Fechada neste dia. Reabra a escala antes de corrigir.';
    END IF;

    -- ---- janela valida das batidas -----------------------------------------
    -- [D-1, D+1] no fuso configurado: um turno que atravessa a meia-noite tem metade das batidas
    -- no dia seguinte, e a saida de um turno da vespera cai no dia civil de hoje.
    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    v_ini := ((p_data - 1)::text || ' 00:00:00')::timestamp AT TIME ZONE v_timezone;
    v_fim := ((p_data + 2)::text || ' 00:00:00')::timestamp AT TIME ZONE v_timezone;

    -- ---- valida as atribuicoes ANTES de escrever qualquer coisa -------------
    FOR r IN
        SELECT (a->>'escala_diaria_id')::uuid AS linha,
               a->>'passo'                    AS passo,
               NULLIF(a->>'marcacao_id', '')::uuid AS marcacao
          FROM jsonb_array_elements(COALESCE(p_atribuicoes, '[]'::jsonb)) a
    LOOP
        IF r.passo NOT IN ('entrada', 'intervalo_saida', 'intervalo_retorno', 'saida') THEN
            RAISE EXCEPTION 'Passo invalido: %', COALESCE(r.passo, '(nulo)');
        END IF;

        IF NOT (r.linha = ANY(v_linhas)) THEN
            RAISE EXCEPTION 'A linha de escala informada nao e deste servidor neste dia.';
        END IF;

        CONTINUE WHEN r.marcacao IS NULL;   -- passo que fica vazio

        -- A mesma batida nao pode ocupar dois passos: um evento fisico, um passo.
        IF r.marcacao = ANY(v_marc_usadas) THEN
            RAISE EXCEPTION 'A mesma batida foi designada para mais de um passo.';
        END IF;
        v_marc_usadas := v_marc_usadas || r.marcacao;

        SELECT m.ocorrido_em INTO v_ts
          FROM public.marcacoes_ponto m
         WHERE m.id = r.marcacao AND m.servidor_id = p_servidor_id;

        IF v_ts IS NULL THEN
            RAISE EXCEPTION 'Batida nao encontrada, ou e de outro servidor.';
        END IF;

        IF v_ts < v_ini OR v_ts >= v_fim THEN
            RAISE EXCEPTION 'A batida de % nao pertence ao dia %.',
                to_char(v_ts AT TIME ZONE v_timezone, 'DD/MM/YYYY HH24:MI'),
                to_char(p_data, 'DD/MM/YYYY');
        END IF;
    END LOOP;

    -- ---- ordem cronologica, POR LINHA e pelos INSTANTES REAIS ---------------
    -- ⚠️ Nunca por HH:MM: num turno que cruza a meia-noite a saida e MENOR que a entrada, e
    --    comparar texto recusaria todo plantao noturno (armadilha 45). Onde ha instante real,
    --    ele manda.
    FOR v_id IN SELECT DISTINCT unnest(v_linhas) LOOP
        v_ant := NULL;
        FOR r IN
            SELECT p.passo, m.ocorrido_em
              FROM (VALUES ('entrada', 1), ('intervalo_saida', 2),
                           ('intervalo_retorno', 3), ('saida', 4)) AS p(passo, ordem)
              JOIN jsonb_array_elements(COALESCE(p_atribuicoes, '[]'::jsonb)) a
                ON a->>'passo' = p.passo AND (a->>'escala_diaria_id')::uuid = v_id
              JOIN public.marcacoes_ponto m ON m.id = NULLIF(a->>'marcacao_id', '')::uuid
             ORDER BY p.ordem
        LOOP
            IF v_ant IS NOT NULL AND r.ocorrido_em <= v_ant THEN
                RAISE EXCEPTION 'As batidas escolhidas ficam fora de ordem: % nao pode vir depois de %. Confira a DATA de cada uma.',
                    to_char(r.ocorrido_em AT TIME ZONE v_timezone, 'DD/MM HH24:MI'),
                    to_char(v_ant         AT TIME ZONE v_timezone, 'DD/MM HH24:MI');
            END IF;
            v_ant := r.ocorrido_em;
        END LOOP;
    END LOOP;

    -- ========================================================================
    -- A PARTIR DAQUI SE ESCREVE. Qualquer RAISE desfaz tudo -- meia correcao e
    -- pior que nenhuma (mesma disciplina de fn_validar_presenca_manual).
    -- ========================================================================

    -- O que estava nos passos ANTES. Serve para o relato final dizer quais batidas sairam dos
    -- passos sem ganhar destino nem sair de circulacao -- essas voltam no proximo alinhamento,
    -- e quem corrigiu precisa saber disso ANTES de fechar a tela achando que resolveu.
    SELECT array_agg(DISTINCT x) INTO v_antes
      FROM public.escala_diaria ed,
           LATERAL (VALUES (ed.presenca_entrada_marcacao_id),
                           (ed.presenca_intervalo_saida_marcacao_id),
                           (ed.presenca_intervalo_retorno_marcacao_id),
                           (ed.presenca_saida_marcacao_id)) AS v(x)
     WHERE ed.id = ANY(v_linhas) AND x IS NOT NULL;

    -- O trigger de sincronizacao criaria marcacoes a partir do que vamos gravar em
    -- escala_diaria, e o fato ja existe. Mesmo guard de fn_aceitar_marcacao_pendente.
    --
    -- ⚠️ Isso tambem deixa INERTE o 'desconsiderar' automatico que o trigger grava ao ver um
    --    passo zerado -- e e assim que tem de ser: aqui quem decide o que sai de circulacao e a
    --    lista EXPLICITA de p_desconsiderar, nunca um efeito colateral de limpar um campo.
    PERFORM set_config('sisescala.reconciliacao', 'on', true);

    -- ---- 1) batidas retiradas de circulacao --------------------------------
    FOR v_marc IN
        SELECT DISTINCT (x)::uuid
          FROM jsonb_array_elements_text(COALESCE(p_desconsiderar, '[]'::jsonb)) x
    LOOP
        IF NOT EXISTS (SELECT 1 FROM public.marcacoes_ponto m
                        WHERE m.id = v_marc AND m.servidor_id = p_servidor_id) THEN
            RAISE EXCEPTION 'Batida a desconsiderar nao encontrada, ou e de outro servidor.';
        END IF;

        IF v_marc = ANY(v_marc_usadas) THEN
            RAISE EXCEPTION 'A mesma batida foi designada para um passo E marcada para sair. Escolha uma das duas.';
        END IF;

        INSERT INTO public.marcacoes_tratamentos
            (marcacao_id, tipo, justificativa, registrado_por_id)
        VALUES (v_marc, 'desconsiderar', p_justificativa, v_validador);
        v_desc_ids := v_desc_ids || v_marc;
        v_retiradas := v_retiradas + 1;
    END LOOP;

    -- ---- 2) batidas designadas a um passo ----------------------------------
    FOR r IN
        SELECT (a->>'escala_diaria_id')::uuid AS linha,
               a->>'passo'                    AS passo,
               NULLIF(a->>'marcacao_id', '')::uuid AS marcacao
          FROM jsonb_array_elements(COALESCE(p_atribuicoes, '[]'::jsonb)) a
         WHERE NULLIF(a->>'marcacao_id', '') IS NOT NULL
    LOOP
        -- 'restaurar' primeiro: a batida pode ter sido desconsiderada antes e estar voltando
        -- agora para um passo. Sem isto, a fixacao seria ignorada pela alocacao, que trata
        -- desconsiderar como palavra final.
        IF public.fn_marcacao_desconsiderada(r.marcacao) THEN
            INSERT INTO public.marcacoes_tratamentos
                (marcacao_id, tipo, justificativa, registrado_por_id)
            VALUES (r.marcacao, 'restaurar', p_justificativa, v_validador);
        END IF;

        INSERT INTO public.marcacoes_tratamentos
            (marcacao_id, tipo, passo_forcado, escala_diaria_id, justificativa, registrado_por_id)
        VALUES (r.marcacao, 'reclassificar_passo', r.passo, r.linha, p_justificativa, v_validador);
        v_aplicadas := v_aplicadas + 1;
    END LOOP;

    -- ---- 3) aplica o conjunto final em escala_diaria ------------------------
    -- SEM COALESCE, de proposito: e uma declaracao sobre o estado final do passo, nao um
    -- preenchimento do que faltava. Passo ausente de p_atribuicoes NAO e tocado; passo presente
    -- com marcacao_id nulo e ZERADO.
    FOR r IN
        SELECT (a->>'escala_diaria_id')::uuid AS linha,
               a->>'passo'                    AS passo,
               NULLIF(a->>'marcacao_id', '')::uuid AS marcacao,
               m.ocorrido_em,
               m.origem
          FROM jsonb_array_elements(COALESCE(p_atribuicoes, '[]'::jsonb)) a
          LEFT JOIN public.marcacoes_ponto m ON m.id = NULLIF(a->>'marcacao_id', '')::uuid
    LOOP
        IF r.passo = 'entrada' THEN
            UPDATE public.escala_diaria
               SET presenca_entrada_em = r.ocorrido_em,
                   presenca_entrada_origem = r.origem,
                   presenca_entrada_marcacao_id = r.marcacao,
                   presenca_entrada_manual = false,
                   confirmado_por_id = v_validador,
                   justificativa_manual = p_justificativa,
                   confirmacao_manual = true
             WHERE id = r.linha;
        ELSIF r.passo = 'intervalo_saida' THEN
            UPDATE public.escala_diaria
               SET presenca_intervalo_saida_em = r.ocorrido_em,
                   presenca_intervalo_saida_origem = r.origem,
                   presenca_intervalo_saida_marcacao_id = r.marcacao,
                   presenca_intervalo_saida_manual = false,
                   confirmado_por_id = v_validador,
                   justificativa_manual = p_justificativa,
                   confirmacao_manual = true
             WHERE id = r.linha;
        ELSIF r.passo = 'intervalo_retorno' THEN
            UPDATE public.escala_diaria
               SET presenca_intervalo_retorno_em = r.ocorrido_em,
                   presenca_intervalo_retorno_origem = r.origem,
                   presenca_intervalo_retorno_marcacao_id = r.marcacao,
                   presenca_intervalo_retorno_manual = false,
                   confirmado_por_id = v_validador,
                   justificativa_manual = p_justificativa,
                   confirmacao_manual = true
             WHERE id = r.linha;
        ELSE
            UPDATE public.escala_diaria
               SET presenca_saida_em = r.ocorrido_em,
                   presenca_saida_origem = r.origem,
                   presenca_saida_marcacao_id = r.marcacao,
                   presenca_saida_manual = false,
                   confirmado_por_id = v_validador,
                   justificativa_manual = p_justificativa,
                   confirmacao_manual = true
             WHERE id = r.linha;
        END IF;
    END LOOP;

    -- presenca_confirmada acompanha o que sobrou: dia que ficou sem passo nenhum deixa de estar
    -- confirmado, senao a linha continuaria afirmando presenca que ninguem sustenta.
    UPDATE public.escala_diaria ed
       SET presenca_confirmada = (ed.presenca_entrada_em IS NOT NULL
                               OR ed.presenca_intervalo_saida_em IS NOT NULL
                               OR ed.presenca_intervalo_retorno_em IS NOT NULL
                               OR ed.presenca_saida_em IS NOT NULL)
     WHERE ed.id = ANY(v_linhas);

    -- Batidas que sairam dos passos e nao ganharam destino nem sairam de circulacao. Nao e erro
    -- (pode ser deliberado), mas e o unico jeito de a tela nao afirmar "corrigido" sobre algo
    -- que o proximo alinhamento vai desfazer -- relatar o que MUDOU, e nao o que se tentou.
    SELECT COALESCE(array_agg(x), '{}') INTO v_soltas
      FROM unnest(COALESCE(v_antes, '{}')) AS t(x)
     WHERE NOT (x = ANY(v_marc_usadas)) AND NOT (x = ANY(v_desc_ids));

    RETURN jsonb_build_object(
        'success', true,
        'passos_aplicados', v_aplicadas,
        'batidas_retiradas', v_retiradas,
        'batidas_soltas', to_jsonb(v_soltas),
        'message', 'Correcao aplicada. As batidas continuam registradas: o que foi gravado e o '
                || 'juizo sobre elas, e ele sobrevive a reconciliacao.');
END;
$fn$;

COMMENT ON FUNCTION public.fn_corrigir_passos_com_batidas(uuid, date, jsonb, jsonb, text) IS
    'Correcao declarativa dos passos de um dia a partir das batidas reais. Grava tratamentos '
    '(reclassificar_passo / desconsiderar) para a correcao sobreviver a reconciliacao, e aplica '
    'o conjunto final em escala_diaria. Nunca digita horario: isso continua com o Administrador.';

REVOKE ALL ON FUNCTION public.fn_corrigir_passos_com_batidas(uuid, date, jsonb, jsonb, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_corrigir_passos_com_batidas(uuid, date, jsonb, jsonb, text)
    TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA -- EXECUTA as duas funcoes (armadilha 42)
-- ============================================================================
-- Confere os DOIS sentidos da matriz de papeis: afrouxar so um lado abriria a digitacao sobre
-- batida real ao RH, e fechar demais deixaria o coordenador sem a validacao que ele sempre teve.

DO $conf$
DECLARE
    v_ok boolean;
BEGIN
    -- rearranjar: RH sim, coordenador nao
    IF NOT public.fn_pode_corrigir_batida_real('rearranjar', 'rh') THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: RH Geral deveria poder rearranjar batida real';
    END IF;
    IF NOT public.fn_pode_corrigir_batida_real('rearranjar', 'rh_unidade') THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: RH da Unidade deveria poder rearranjar batida real';
    END IF;
    IF public.fn_pode_corrigir_batida_real('rearranjar', 'coordenador') THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: coordenador NAO pode rearranjar batida real';
    END IF;

    -- digitar sobre real: so Administrador
    IF public.fn_pode_corrigir_batida_real('digitar_sobre_real', 'rh') THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: RH nao pode DIGITAR horario sobre batida real';
    END IF;
    IF NOT public.fn_pode_corrigir_batida_real('digitar_sobre_real', 'super_admin') THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: super_admin deveria poder digitar sobre batida real';
    END IF;

    -- passo vazio: continua aberto a quem sempre validou
    IF NOT public.fn_pode_corrigir_batida_real('preencher_vazio', 'coordenador') THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: coordenador perdeu a validacao de passo vazio';
    END IF;
    IF NOT public.fn_pode_corrigir_batida_real('preencher_vazio', 'ass_adm') THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: ass_adm perdeu a validacao de passo vazio';
    END IF;

    -- papel do Portal nunca entra
    IF public.fn_pode_corrigir_batida_real('preencher_vazio', 'servidor') THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: papel do Portal nao pode validar presenca';
    END IF;

    -- papel desconhecido / NULL fecha (o default de uma funcao de seguranca e negar)
    IF COALESCE(public.fn_pode_corrigir_batida_real('rearranjar', 'papel_que_nao_existe'), true) THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: papel desconhecido deveria ser recusado';
    END IF;

    -- e a RPC recusa sessao anonima, mesmo com argumentos validos
    BEGIN
        PERFORM public.fn_corrigir_passos_com_batidas(
            gen_random_uuid(), current_date, '[]'::jsonb, '[]'::jsonb, 'conferencia da migration');
        RAISE EXCEPTION 'CONFERENCIA FALHOU: a RPC aceitou chamada sem sessao';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;  -- esperado: auth.uid() e NULL nesta sessao
    END;

    RAISE NOTICE 'CONFERENCIA 20260917130000: OK (9 asercoes).';
END;
$conf$;
