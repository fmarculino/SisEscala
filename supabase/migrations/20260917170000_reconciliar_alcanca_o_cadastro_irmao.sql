-- Migration: a reconciliacao de maquina passa a alcancar o cadastro IRMAO
-- Data: 2026-09-17
-- Plano: docs/planos/2026-09-17-batida-que-nao-alcanca-a-escala-certa.md (defeito D1)
-- Gerada por scratchpad/gen_reconciliar_pessoa_dia.js a partir de TRES fontes:
--   fn_ingerir_afd               <- 20260915100000_abrangencia_do_relogio_estrutura.sql
--   fn_reparse_afd_dispositivo   <- 20260822210000_ponto_valido_desde_por_dispositivo.sql
--   fn_reconciliar_apos_marcacao <- 20260820020000_neutralize_direct_presence_write_in_rep_units.sql
--   NAO EDITAR A MAO: regenere pelo script, que aborta se qualquer fonte divergir.
--
-- O QUE ESTAVA ERRADO
--   fn_alocar_marcacoes_dia SABE do cadastro irmao desde 20260909130000: os passos do irmao
--   entram como SOMBRA e desqualificam candidata, para exatamente um dos dois ficar com a
--   batida. Mas ela e STABLE -- quem ESCREVE e fn_reconciliar_marcacoes_dia, chamada por
--   (servidor, dia). A leitura enxerga os dois lados; a escrita enxerga um so.
--
--   Resultado: a batida cai no cadastro do VINCULO, a escala esta na OUTRA matricula, e
--   ninguem escreve nela. E a mesma forma de "a alocacao roda por dia e um dia nao sabe do
--   outro" (20260819180000), agora entre vinculos.
--
--   Caso real medido em 17/09/2026 (RAIDANES, mesmo CPF em duas matriculas): o vinculo
--   vigente no REP-iDClass-CCE-01 aponta para a mat 53729 (com biometria), a batida das 17:18
--   nasceu nela -- e a mat 53729 estava de FOLGA naquele dia. A escala era da mat 68152, cuja
--   linha ficou com a saida vazia. O relogio nao distingue as duas matriculas da mesma pessoa
--   (o AFD tipo 3 carrega NSR + data/hora + identificador + CRC, e nada mais), e o equipamento
--   recusa o 2o cadastro do mesmo PIS/CPF: e da norma, nao do iDClass.
--
-- 🚨 RECONCILIAR O IRMAO INTEIRO SERIA PIOR QUE O DEFEITO, E ISSO FOI MEDIDO
--   fn_reconciliar_marcacoes_dia escreve presenca_* = projecao SEM COALESCE. Estende-la ao
--   irmao significa reconciliar automaticamente dias que hoje nunca sao tocados.
--   Classificacao dos 425 pares (irmao, dia) candidatos de 09/2026, por
--   fn_conferir_reconciliacao (que nao escreve nada):
--
--       so acrescimo (preenche campo vazio) ......  10 pares, 14 horarios
--       TROCA de horario ja gravado .............   13 pares
--       PERDA (a projecao nao reproduz o atual) ..    4 pares
--       sem mudanca .............................  398 pares
--
--   As trocas nao sao ruido: ha deslocamento de 285 e 301 minutos em passos de intervalo, e
--   uma saida indo de 19:00 para 16:10. Por isso o irmao so recebe ACRESCIMO PURO -- o mesmo
--   criterio que fn_reconciliar_dia_pendente aplica desde 20260908110000: o sistema preenche o
--   que esta vazio e devolve a validacao manual o dia que ele mudaria.
--
-- ⚠️ O QUE **NAO** MUDA
--   * O servidor da batida continua sendo reconciliado exatamente como hoje, sem criterio novo.
--     Estreitar tambem o dono seria mudar o comportamento de toda ingestao para resolver um
--     caso de 76 CPFs.
--   * A resolucao de identidade nao e tocada. A batida e da PESSOA (decisao de 09/09/2026);
--     que ela nasca no cadastro do vinculo esta certo -- marcacoes_ponto.servidor_id e imutavel
--     e quem decide ONDE APLICAR e a escala.
--   * fn_reconciliar_dia_pendente (o botao da grade) NAO passa a alcancar irmao: ela e por
--     ESCALA e o coordenador abre a grade de cada matricula. Misturar as duas faria um clique
--     numa grade escrever noutra, sem previa.
--
-- ⚠️ DUPLA CONTAGEM ESTA PROTEGIDA POR CONSTRUCAO. O desempate por servidor_id da
--    20260909130000 garante que exatamente UM dos dois cadastros fica com a batida, e os dois
--    lados decidem o oposto -- entao reconciliar os dois em sequencia nao grava a mesma batida
--    duas vezes, em qualquer ordem.


-- ============================================================================
-- 1. A FONTE UNICA: reconciliar a PESSOA, nao so o cadastro
-- ============================================================================
-- 🚨 CAMINHO DE MAQUINA. Nao confere papel, escopo nem escala Fechada, exatamente como
--    fn_reconciliar_marcacoes_dia -- quem a chama e a ingestao do AFD. Por isso e GRANTada
--    so a service_role. Expor reconciliacao a usuario logado exige envelope proprio, e ele ja
--    existe: fn_reconciliar_dia_pendente (20260908110000).

CREATE OR REPLACE FUNCTION public.fn_reconciliar_pessoa_dia(
    p_servidor_id         uuid,
    p_data                date,
    p_limpar_sem_marcacao boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_proprio   jsonb;
    v_irmaos    jsonb := '[]'::jsonb;
    v_irmao     record;
    v_ganhos    integer;
    v_conflitos integer;
    v_r         jsonb;
    v_linhas    integer;
BEGIN
    -- 1) O dono da batida: comportamento INALTERADO.
    v_proprio := public.fn_reconciliar_marcacoes_dia(p_servidor_id, p_data, p_limpar_sem_marcacao);

    -- 2) Cada cadastro irmao (mesmo CPF, Ativo, nao mesclado) que tenha linha de escala no dia.
    FOR v_irmao IN
        SELECT i.irmao_id, i.irmao_matricula
          FROM public.fn_cadastros_irmaos(ARRAY[p_servidor_id]) i
         WHERE EXISTS (
             SELECT 1
               FROM public.escala_diaria ed
               JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
              WHERE em.servidor_id = i.irmao_id
                AND em.mes = extract(month from p_data)::integer
                AND em.ano = extract(year  from p_data)::integer
                AND ed.dia = extract(day from p_data)::integer
                AND ed.categoria <> 'Sobreaviso')
    LOOP
        BEGIN
            -- ACRESCIMO PURO: so grava se NENHUM campo ja preenchido mudaria de valor. Mesmo
            -- criterio de fn_reconciliar_dia_pendente. Um dia que deixou de ser acrescimo volta
            -- para a validacao manual -- listado, com o motivo, nunca escondido.
            WITH proj AS (
                SELECT * FROM public.fn_projecao_marcacoes_dia(v_irmao.irmao_id, p_data) WHERE confirmada
            ), cmp AS (
                SELECT v.atual, v.projetado
                  FROM proj p
                  JOIN public.escala_diaria ed ON ed.id = p.escala_diaria_id
                  CROSS JOIN LATERAL (VALUES
                      (ed.presenca_entrada_em,           p.entrada_em),
                      (ed.presenca_intervalo_saida_em,   p.int_saida_em),
                      (ed.presenca_intervalo_retorno_em, p.int_ret_em),
                      (ed.presenca_saida_em,             p.saida_em)
                  ) AS v(atual, projetado)
                 WHERE v.projetado IS DISTINCT FROM v.atual
            )
            SELECT count(*) FILTER (WHERE atual IS NULL),
                   count(*) FILTER (WHERE atual IS NOT NULL)
              INTO v_ganhos, v_conflitos
              FROM cmp;

            IF COALESCE(v_conflitos,0) > 0 THEN
                v_irmaos := v_irmaos || jsonb_build_object(
                    'servidor_id', v_irmao.irmao_id, 'matricula', v_irmao.irmao_matricula,
                    'status', 'conflito', 'campos', 0, 'conflitos', v_conflitos);
            ELSIF COALESCE(v_ganhos,0) = 0 THEN
                v_irmaos := v_irmaos || jsonb_build_object(
                    'servidor_id', v_irmao.irmao_id, 'matricula', v_irmao.irmao_matricula,
                    'status', 'sem_mudanca', 'campos', 0);
            ELSE
                -- p_limpar_sem_marcacao fica FALSE para o irmao SEMPRE, mesmo quando o chamador
                -- pediu true: a limpeza apaga presenca de dia sem marcacao, e aqui estamos num
                -- dia que nao e o do chamador. Ela so pode ser ligada apos o corte por
                -- unidades.fonte_ponto_oficial (Fase 5), e mesmo entao por decisao propria.
                v_r := public.fn_reconciliar_marcacoes_dia(v_irmao.irmao_id, p_data, false);

                -- Conta o que de fato ficou gravado, nunca o que se tentou (armadilha 22).
                SELECT count(*) INTO v_linhas
                  FROM public.fn_projecao_marcacoes_dia(v_irmao.irmao_id, p_data) p
                  JOIN public.escala_diaria ed ON ed.id = p.escala_diaria_id
                  CROSS JOIN LATERAL (VALUES
                      (ed.presenca_entrada_em,           p.entrada_em),
                      (ed.presenca_intervalo_saida_em,   p.int_saida_em),
                      (ed.presenca_intervalo_retorno_em, p.int_ret_em),
                      (ed.presenca_saida_em,             p.saida_em)
                  ) AS v(atual, projetado)
                 WHERE p.confirmada
                   AND v.projetado IS NOT NULL
                   AND v.atual IS NOT DISTINCT FROM v.projetado;

                v_irmaos := v_irmaos || jsonb_build_object(
                    'servidor_id', v_irmao.irmao_id, 'matricula', v_irmao.irmao_matricula,
                    'status', 'ok', 'campos', LEAST(COALESCE(v_ganhos,0), COALESCE(v_linhas,0)),
                    'esperados', COALESCE(v_ganhos,0), 'retorno', v_r);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Falha no irmao NUNCA derruba a reconciliacao do dono nem a ingestao do lote.
            -- O aviso deixa rastro: o efeito (a celula do irmao continuar vazia) e invisivel.
            RAISE WARNING 'Falha ao reconciliar cadastro irmao % em %: %', v_irmao.irmao_id, p_data, SQLERRM;
            v_irmaos := v_irmaos || jsonb_build_object(
                'servidor_id', v_irmao.irmao_id, 'matricula', v_irmao.irmao_matricula,
                'status', 'erro', 'campos', 0, 'erro', SQLERRM);
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'servidor_id', p_servidor_id, 'data', p_data,
        'proprio', v_proprio,
        'irmaos', v_irmaos);
END;
$fn$;

COMMENT ON FUNCTION public.fn_reconciliar_pessoa_dia(uuid, date, boolean) IS
    'Reconcilia o dia do servidor (comportamento inalterado) e, para cada cadastro IRMAO da '
    'mesma pessoa com escala naquele dia, aplica SO SE for acrescimo puro. Caminho de MAQUINA: '
    'nao confere papel nem escopo. O envelope de usuario e fn_reconciliar_dia_pendente.';

REVOKE ALL ON FUNCTION public.fn_reconciliar_pessoa_dia(uuid, date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconciliar_pessoa_dia(uuid, date, boolean) TO service_role;


-- ============================================================================
-- 2. A INGESTAO DO AFD (copia mecanica; so a chamada mudou)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_ingerir_afd(
    p_dispositivo_id uuid,
    p_lote_id        uuid,
    p_linhas         jsonb,          -- array de strings, ja em UTF-8
    p_canal          text DEFAULT 'coletor_http',
    p_arquivo_sha256 text DEFAULT NULL,
    p_coletor_versao text DEFAULT NULL,
    p_coletor_host   text DEFAULT NULL,
    p_ip             inet DEFAULT NULL,
    p_importado_por  uuid DEFAULT NULL,
    p_assinatura_ok  boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_sinc_id     uuid;
    v_existente   public.rep_sincronizacoes%ROWTYPE;
    v_unidade_id  uuid;
    v_toda_uni    boolean;
    v_geracao     smallint;
    v_setor_id    uuid;
    v_n_setores   integer;
    v_hash_ant    text;
    v_linha       text;
    v_p           record;
    v_sha         text;
    v_afd_id      uuid;
    v_servidor_id uuid;
    v_recebidas   integer := 0;
    v_novas       integer := 0;
    v_dups        integer := 0;
    v_marc        integer := 0;
    v_orfas       integer := 0;
    v_nsr_min     bigint;
    v_nsr_max     bigint;
    r             record;
BEGIN
    -- 3.1 Idempotencia do lote
    SELECT * INTO v_existente
      FROM public.rep_sincronizacoes
     WHERE dispositivo_id = p_dispositivo_id AND lote_id = p_lote_id;

    IF FOUND AND v_existente.status = 'concluida' THEN
        RETURN jsonb_build_object(
            'reenvio', true, 'sincronizacao_id', v_existente.id,
            'recebidas', v_existente.linhas_recebidas, 'novas', v_existente.linhas_novas,
            'duplicadas', v_existente.linhas_duplicadas, 'marcacoes', v_existente.marcacoes_criadas,
            'orfas', v_existente.marcacoes_orfas, 'nsr_max_aceito', v_existente.nsr_final);
    END IF;

    SELECT unidade_id, geracao_atual, atende_toda_unidade
      INTO v_unidade_id, v_geracao, v_toda_uni
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % nao cadastrado.', p_dispositivo_id;
    END IF;

    SELECT count(*) INTO v_n_setores
      FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id;
    -- 15/09/2026: so deriva o setor quando o relogio atende EXCLUSIVAMENTE um setor.
    -- Antes bastava haver 1 linha em dispositivos_rep_setores. Com a abrangencia podendo
    -- somar setor de OUTRA unidade a um relogio que continua atendendo a unidade dona
    -- inteira, aquela unica linha passaria a carimbar o setor da outra unidade em TODA
    -- batida do equipamento - inclusive nas de quem e da unidade dona. NULL e o valor
    -- honesto quando o relogio atende mais de um lugar.
    IF v_n_setores = 1 AND NOT v_toda_uni THEN
        SELECT setor_id INTO v_setor_id
          FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id;
    ELSE
        v_setor_id := NULL;
    END IF;

    INSERT INTO public.rep_sincronizacoes (
        dispositivo_id, lote_id, canal, arquivo_sha256, assinatura_verificada,
        coletor_versao, coletor_hostname, ip_origem, importado_por_id)
    VALUES (p_dispositivo_id, p_lote_id, p_canal, p_arquivo_sha256, p_assinatura_ok,
            p_coletor_versao, p_coletor_host, p_ip, p_importado_por)
    RETURNING id INTO v_sinc_id;

    -- 3.2 Ultimo elo da cadeia de hash
    SELECT hash_encadeado INTO v_hash_ant
      FROM public.rep_afd_registros
     WHERE dispositivo_id = p_dispositivo_id
       AND geracao = v_geracao
     ORDER BY nsr DESC LIMIT 1;

    -- 3.3 Processa em ordem de NSR
    FOR v_linha IN
        SELECT x FROM jsonb_array_elements_text(p_linhas) AS x
         ORDER BY substring(x from 1 for 9)
    LOOP
        v_recebidas := v_recebidas + 1;
        SELECT * INTO v_p FROM public.fn_parse_linha_afd(v_linha);

        IF v_p.nsr IS NULL THEN
            CONTINUE;
        END IF;

        v_sha := encode(sha256(convert_to(v_linha, 'UTF8')), 'hex');

        INSERT INTO public.rep_afd_registros (
            dispositivo_id, geracao, nsr, tipo_registro, linha_bruta, linha_sha256,
            ocorrido_em, identificador_afd, parse_versao, parse_ok, parse_erro,
            hash_anterior, hash_encadeado, sincronizacao_id)
        VALUES (
            p_dispositivo_id, v_geracao, v_p.nsr, COALESCE(v_p.tipo, '?'), v_linha, v_sha,
            v_p.ocorrido_em, v_p.identificador, 1, v_p.ok, v_p.erro,
            v_hash_ant,
            encode(sha256(convert_to(COALESCE(v_hash_ant, '') || v_sha, 'UTF8')), 'hex'),
            v_sinc_id)
        ON CONFLICT (dispositivo_id, geracao, nsr) DO NOTHING
        RETURNING id INTO v_afd_id;

        IF v_afd_id IS NULL THEN
            v_dups := v_dups + 1;
            CONTINUE;
        END IF;

        v_novas    := v_novas + 1;
        v_hash_ant := encode(sha256(convert_to(COALESCE(v_hash_ant, '') || v_sha, 'UTF8')), 'hex');
        v_nsr_min  := LEAST(COALESCE(v_nsr_min, v_p.nsr), v_p.nsr);
        v_nsr_max  := GREATEST(COALESCE(v_nsr_max, v_p.nsr), v_p.nsr);

        -- 3.4 Marcacao de ponto: registro tipo 3
        IF v_p.tipo = '3' AND v_p.ocorrido_em IS NOT NULL THEN
            -- Resolução via fonte única (vínculo -> CPF com desempate -> PIS)
            SELECT servidor_id INTO v_servidor_id
              FROM public.fn_servidor_por_identificador_afd(p_dispositivo_id, v_p.identificador,
                                                            v_p.ocorrido_em);

            IF v_servidor_id IS NULL THEN
                v_orfas := v_orfas + 1;
            END IF;

            PERFORM public.fn_registrar_marcacao(
                v_servidor_id,
                'rep'::public.marcacao_origem,
                v_p.ocorrido_em,
                v_unidade_id, v_setor_id,
                NULL, NULL, NULL,
                false,
                (v_p.ocorrido_em < now() - interval '1 day'),
                p_dispositivo_id, v_p.nsr, v_afd_id, v_p.identificador,
                (p_canal = 'pendrive'),
                'AFD NSR ' || v_p.nsr::text);

            v_marc := v_marc + 1;
        END IF;
    END LOOP;

    -- 3.5 Fecha sincronização
    UPDATE public.rep_sincronizacoes
       SET concluida_em = now(), status = 'concluida',
           nsr_inicial = v_nsr_min, nsr_final = v_nsr_max,
           linhas_recebidas = v_recebidas, linhas_novas = v_novas,
           linhas_duplicadas = v_dups, marcacoes_criadas = v_marc, marcacoes_orfas = v_orfas
     WHERE id = v_sinc_id;

    UPDATE public.dispositivos_rep
       SET ultimo_nsr = GREATEST(COALESCE(ultimo_nsr, 0), COALESCE(v_nsr_max, 0)),
           updated_at = now()
     WHERE id = p_dispositivo_id;

    -- 3.6 Auto-reconciliação em escala_diaria e folha_ponto para os servidores afetados
    IF v_marc > 0 THEN
        FOR r IN
            SELECT DISTINCT m.servidor_id, (m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data_batida
              FROM public.marcacoes_ponto m
             WHERE m.afd_registro_id IN (
                 SELECT a.id FROM public.rep_afd_registros a WHERE a.sincronizacao_id = v_sinc_id
             )
             AND m.servidor_id IS NOT NULL
        LOOP
            BEGIN
                -- fn_reconciliar_pessoa_dia, nao fn_reconciliar_marcacoes_dia: a batida e da
                -- PESSOA, e o turno pode estar na OUTRA matricula dela. Ver 20260917170000.
                PERFORM public.fn_reconciliar_pessoa_dia(r.servidor_id, r.data_batida);
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'Falha ao auto-reconciliar servidor % na data %: %', r.servidor_id, r.data_batida, SQLERRM;
            END;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'reenvio', false, 'sincronizacao_id', v_sinc_id,
        'recebidas', v_recebidas, 'novas', v_novas, 'duplicadas', v_dups,
        'marcacoes', v_marc, 'orfas', v_orfas,
        'nsr_inicial', v_nsr_min, 'nsr_max_aceito', v_nsr_max);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    TO service_role;


-- ============================================================================
-- 3. O REPARSE (copia mecanica; so a chamada mudou)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_reparse_afd_dispositivo(
    p_dispositivo_id uuid DEFAULT NULL,
    p_desde          timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_desde       timestamptz;
    v_atualizados integer := 0;
    r             record;
    r_rec         record;
    v_servidor_id uuid;
    v_unidade_id  uuid;
    v_setor_id    uuid;
    v_pares       text[] := '{}';
BEGIN
    -- Declara sessao de reprocessamento autorizada
    PERFORM set_config('sisescala.reparse_afd', 'on', true);

    IF p_desde IS NULL THEN
        v_desde := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
    ELSE
        v_desde := p_desde;
    END IF;

    -- Atualiza marcacoes_ponto onde servidor_id IS NULL
    FOR r IN
        SELECT m.id AS marcacao_id,
               m.dispositivo_id,
               m.ocorrido_em,
               COALESCE(m.identificador_bruto, a.identificador_afd) AS identificador
          FROM public.marcacoes_ponto m
          LEFT JOIN public.rep_afd_registros a ON a.id = m.afd_registro_id
         WHERE m.servidor_id IS NULL
           AND m.origem = 'rep'
           AND m.ocorrido_em >= v_desde
           AND (p_dispositivo_id IS NULL OR m.dispositivo_id = p_dispositivo_id)
    LOOP
        SELECT servidor_id INTO v_servidor_id
          FROM public.fn_servidor_por_identificador_afd(r.dispositivo_id, r.identificador,
                                                        r.ocorrido_em);

        IF v_servidor_id IS NOT NULL THEN
            SELECT s.unidade_id, s.setor_id INTO v_unidade_id, v_setor_id
              FROM public.servidores s WHERE s.id = v_servidor_id;

            UPDATE public.marcacoes_ponto
               SET servidor_id = v_servidor_id,
                   unidade_id  = COALESCE(v_unidade_id, marcacoes_ponto.unidade_id),
                   setor_id    = COALESCE(v_setor_id, marcacoes_ponto.setor_id)
             WHERE id = r.marcacao_id
               AND servidor_id IS NULL;

            v_atualizados := v_atualizados + 1;

            -- So o que ACABOU de ganhar dono entra na reconciliacao (ver bloco abaixo).
            v_pares := v_pares || (
                v_servidor_id::text || '|' ||
                ((SELECT m2.ocorrido_em FROM public.marcacoes_ponto m2 WHERE m2.id = r.marcacao_id)
                   AT TIME ZONE 'America/Sao_Paulo')::date::text
            );
        END IF;
    END LOOP;

    -- Auto-reconcilia APENAS os pares (servidor, dia) que acabaram de ganhar dono.
    --
    -- A versao anterior reconciliava TODO servidor com marcacao no periodo daquele
    -- dispositivo. Isso transformava "criar um vinculo" em "reconciliar o mes inteiro
    -- da unidade" - e reconciliacao em massa nao e neutra: medido em producao em
    -- 19/08/2026, reprojetar 08/2026 corrigia 4 dias e PIORAVA 11 (a projecao aloca
    -- 3 batidas por proximidade e as vezes sacrifica a entrada). Reconciliar so o que
    -- mudou mantem o ganho e tira o efeito colateral.
    IF v_atualizados > 0 THEN
        FOR r_rec IN
            SELECT DISTINCT
                   split_part(p, '|', 1)::uuid AS servidor_id,
                   split_part(p, '|', 2)::date AS data_batida
              FROM unnest(v_pares) AS p
        LOOP
            BEGIN
                -- Ver 20260917170000: o reparse re-resolve autoria, e a autoria pode cair no
                -- cadastro irmao da mesma pessoa.
                PERFORM public.fn_reconciliar_pessoa_dia(r_rec.servidor_id, r_rec.data_batida);
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'Falha ao auto-reconciliar servidor % na data %: %', r_rec.servidor_id, r_rec.data_batida, SQLERRM;
            END;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'sucesso', true,
        'marcacoes_vinculadas', v_atualizados
    );
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) TO authenticated, service_role;


-- ============================================================================
-- 4. O TRIGGER DA FASE 5 (copia mecanica; so a chamada mudou)
-- ============================================================================
-- Inerte enquanto nenhuma unidade estiver em fonte_ponto_oficial = 'rep'. O trigger em si NAO
-- e recriado: a funcao e trocada por CREATE OR REPLACE e o trigger continua apontando para ela.

CREATE OR REPLACE FUNCTION public.fn_reconciliar_apos_marcacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fnm$
DECLARE
    r record;
BEGIN
    -- Nao reentrar durante a propria reconciliacao nem durante o reparse.
    IF COALESCE(current_setting('sisescala.reconciliacao', true), '') = 'on'
       OR COALESCE(current_setting('sisescala.reparse_afd', true), '') = 'on' THEN
        RETURN NULL;
    END IF;

    FOR r IN
        SELECT DISTINCT
               n.servidor_id,
               (n.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data_batida
          FROM novas n
          JOIN public.escala_mensal em
            ON em.servidor_id = n.servidor_id
           AND em.mes = extract(month from n.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::integer
           AND em.ano = extract(year  from n.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::integer
          JOIN public.unidades u ON u.id = em.unidade_id
         WHERE n.servidor_id IS NOT NULL
           AND n.origem <> 'rep'
           AND u.fonte_ponto_oficial = 'rep'
    LOOP
        BEGIN
            -- Ver 20260917170000. Este trigger e INERTE hoje (nenhuma unidade esta em
            -- fonte_ponto_oficial = 'rep'), mas vira o caminho principal quando a Fase 5
            -- ligar -- deixa-lo para tras recriaria o buraco justamente ali.
            PERFORM public.fn_reconciliar_pessoa_dia(r.servidor_id, r.data_batida);
        EXCEPTION WHEN OTHERS THEN
            -- Nunca derrubar a marcacao por falha na projecao: a marcacao e o fato.
            RAISE WARNING 'Falha ao reconciliar servidor % em % apos marcacao: %',
                          r.servidor_id, r.data_batida, SQLERRM;
        END;
    END LOOP;

    RETURN NULL;
END;
$fnm$;
REVOKE ALL ON FUNCTION public.fn_reconciliar_apos_marcacao() FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 5. CONFERENCIA -- EXECUTA as funcoes (armadilha 42)
-- ============================================================================
DO $conf$
DECLARE
    v_srv    uuid;
    v_r      jsonb;
    v_n      integer;
BEGIN
    -- 5.1 Uma unica assinatura de cada uma (sobrecarga = PGRST203)
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_reconciliar_pessoa_dia';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ABORTADO: ha % versao(oes) de fn_reconciliar_pessoa_dia (esperado 1).', v_n;
    END IF;

    -- 5.2 Privilegios: caminho de maquina. authenticated NAO pode executa-la -- ela escreve
    --     presenca sem conferir papel, escopo nem escala Fechada.
    IF has_function_privilege('anon', 'public.fn_reconciliar_pessoa_dia(uuid, date, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon executa fn_reconciliar_pessoa_dia.';
    END IF;
    IF has_function_privilege('authenticated', 'public.fn_reconciliar_pessoa_dia(uuid, date, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated executa fn_reconciliar_pessoa_dia -- ela nao confere papel nem escopo. O envelope de usuario e fn_reconciliar_dia_pendente.';
    END IF;
    IF NOT has_function_privilege('service_role', 'public.fn_reconciliar_pessoa_dia(uuid, date, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: service_role PERDEU fn_reconciliar_pessoa_dia -- a ingestao do AFD para.';
    END IF;

    -- 5.3 EXECUTA. Uma data sem escala nenhuma nao escreve nada, mas percorre todo o caminho:
    --     a reconciliacao propria, a busca de irmaos e o laco.
    SELECT id INTO v_srv FROM public.servidores WHERE status = 'Ativo' LIMIT 1;
    IF v_srv IS NOT NULL THEN
        v_r := public.fn_reconciliar_pessoa_dia(v_srv, '1900-01-01'::date);
        IF v_r IS NULL OR v_r->'proprio' IS NULL OR jsonb_typeof(v_r->'irmaos') <> 'array' THEN
            RAISE EXCEPTION 'ABORTADO: fn_reconciliar_pessoa_dia devolveu %', v_r;
        END IF;
        RAISE NOTICE 'sonda: proprio=% irmaos=%', v_r->'proprio'->>'status', jsonb_array_length(v_r->'irmaos');
    END IF;

    -- 5.4 Os TRES chamadores de maquina passaram a apontar para a funcao nova, e NENHUM
    --     chamador de usuario foi arrastado junto: fn_reconciliar_dia_pendente continua
    --     chamando fn_reconciliar_marcacoes_dia direto (ela e por ESCALA, com previa na tela).
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('fn_ingerir_afd','fn_reparse_afd_dispositivo','fn_reconciliar_apos_marcacao')
       AND p.prosrc LIKE '%fn_reconciliar_pessoa_dia%';
    IF v_n <> 3 THEN
        RAISE EXCEPTION 'ABORTADO: % de 3 chamadores de maquina apontam para fn_reconciliar_pessoa_dia.', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_reconciliar_dia_pendente'
       AND p.prosrc LIKE '%fn_reconciliar_pessoa_dia%';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'ABORTADO: fn_reconciliar_dia_pendente passou a alcancar irmao. Ela e por ESCALA: um clique numa grade escreveria noutra, sem previa.';
    END IF;

    RAISE NOTICE 'reconciliacao alcanca o cadastro irmao: ok.';
END;
$conf$;
