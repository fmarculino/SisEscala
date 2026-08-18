-- ============================================================================
-- Migration: Correção de Identidade REP (Duplo Vínculo e Ingestão Direta) e Auto-Reconciliação
-- Data: 2026-08-18
-- Motivos:
-- 1. Em fn_ingerir_afd, a resolução de servidor consultava apenas rep_vinculos_servidor.
--    Servidores cadastrados no REP por CPF ou PIS sem vínculo explícito prévio eram
--    gravados como batidas órfãs (servidor_id = NULL) e nunca entravam na escala/folha.
-- 2. Em fn_servidor_por_identificador_afd, servidores com duplo vínculo (ex: médicos
--    com duas matrículas na rede municipal) retornavam NULL por causa de v_n_cpf > 1.
--    Agora desempata pela unidade do dispositivo REP e existência de escala no mês.
-- 3. Executa reprocessamento de todas as batidas órfãs de Agosto/2026 e auto-reconcilia
--    automaticamente na grade de escala_diaria e folha_ponto.
-- ============================================================================

-- 1. Atualizar fn_servidor_por_identificador_afd com desempate por unidade do REP
CREATE OR REPLACE FUNCTION public.fn_servidor_por_identificador_afd(
    p_dispositivo_id uuid,
    p_identificador  text
)
RETURNS TABLE (servidor_id uuid, origem_match text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_chave       text;
    v_vinculo     uuid;
    v_por_cpf     uuid;
    v_por_pis     uuid;
    v_n_cpf       integer;
    v_n_pis       integer;
    v_unidade_dev uuid;
BEGIN
    -- Limpa pontuação e pega os últimos 11 dígitos
    v_chave := right(regexp_replace(COALESCE(p_identificador, ''), '\D', '', 'g'), 11);
    IF length(v_chave) < 11 THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text;
        RETURN;
    END IF;

    SELECT unidade_id INTO v_unidade_dev FROM public.dispositivos_rep WHERE id = p_dispositivo_id;

    -- 1) Vínculo vigente tem prioridade máxima (decisão registrada para este dispositivo)
    SELECT v.servidor_id INTO v_vinculo
      FROM public.rep_vinculos_servidor v
     WHERE v.dispositivo_id = p_dispositivo_id
       AND right(regexp_replace(v.identificador_afd, '\D', '', 'g'), 11) = v_chave
       AND v.vigente_ate IS NULL
     ORDER BY v.vigente_de DESC
     LIMIT 1;

    IF v_vinculo IS NOT NULL THEN
        RETURN QUERY SELECT v_vinculo, 'vinculo'::text;
        RETURN;
    END IF;

    -- 2) Match por CPF
    SELECT count(*), (array_agg(s.id))[1] INTO v_n_cpf, v_por_cpf
      FROM public.servidores s
     WHERE s.status = 'Ativo'
       AND right(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 11) = v_chave
       AND length(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g')) >= 11;

    -- Se houver mais de um servidor Ativo com o mesmo CPF no município (ex: duplo vínculo),
    -- prioriza o servidor lotado na unidade do dispositivo REP:
    IF v_n_cpf > 1 AND v_unidade_dev IS NOT NULL THEN
        SELECT count(*), (array_agg(s.id))[1] INTO v_n_cpf, v_por_cpf
          FROM public.servidores s
         WHERE s.status = 'Ativo'
           AND s.unidade_id = v_unidade_dev
           AND right(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 11) = v_chave
           AND length(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g')) >= 11;

        -- Se ainda houver mais de um na unidade, desempata por quem tem escala no mês/ano atual:
        IF v_n_cpf > 1 THEN
            SELECT count(*), (array_agg(s.id))[1] INTO v_n_cpf, v_por_cpf
              FROM public.servidores s
             WHERE s.status = 'Ativo'
               AND s.unidade_id = v_unidade_dev
               AND right(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 11) = v_chave
               AND EXISTS (
                   SELECT 1 FROM public.escala_mensal em
                    WHERE em.servidor_id = s.id
                      AND em.unidade_id = v_unidade_dev
                      AND em.mes = extract(month from now())::integer
                      AND em.ano = extract(year from now())::integer
               );
        END IF;
    END IF;

    -- 3) Match por PIS/NIS (legado)
    SELECT count(*), (array_agg(s.id))[1] INTO v_n_pis, v_por_pis
      FROM public.servidores s
     WHERE s.status = 'Ativo'
       AND right(regexp_replace(COALESCE(s.pis_pasep, ''), '\D', '', 'g'), 11) = v_chave
       AND length(regexp_replace(COALESCE(s.pis_pasep, ''), '\D', '', 'g')) >= 11;

    IF v_n_pis > 1 AND v_unidade_dev IS NOT NULL THEN
        SELECT count(*), (array_agg(s.id))[1] INTO v_n_pis, v_por_pis
          FROM public.servidores s
         WHERE s.status = 'Ativo'
           AND s.unidade_id = v_unidade_dev
           AND right(regexp_replace(COALESCE(s.pis_pasep, ''), '\D', '', 'g'), 11) = v_chave
           AND length(regexp_replace(COALESCE(s.pis_pasep, ''), '\D', '', 'g')) >= 11;

        IF v_n_pis > 1 THEN
            SELECT count(*), (array_agg(s.id))[1] INTO v_n_pis, v_por_pis
              FROM public.servidores s
             WHERE s.status = 'Ativo'
               AND s.unidade_id = v_unidade_dev
               AND right(regexp_replace(COALESCE(s.pis_pasep, ''), '\D', '', 'g'), 11) = v_chave
               AND EXISTS (
                   SELECT 1 FROM public.escala_mensal em
                    WHERE em.servidor_id = s.id
                      AND em.unidade_id = v_unidade_dev
                      AND em.mes = extract(month from now())::integer
                      AND em.ano = extract(year from now())::integer
               );
        END IF;
    END IF;

    -- Ambiguidade irresolvível devolve NULL (nunca chute)
    IF v_n_cpf > 1 OR v_n_pis > 1 THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text;
        RETURN;
    END IF;

    IF v_por_cpf IS NOT NULL AND v_por_pis IS NOT NULL AND v_por_cpf <> v_por_pis THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text;
        RETURN;
    END IF;

    IF v_por_cpf IS NOT NULL THEN
        RETURN QUERY SELECT v_por_cpf, 'cpf'::text;
    ELSIF v_por_pis IS NOT NULL THEN
        RETURN QUERY SELECT v_por_pis, 'pis'::text;
    ELSE
        RETURN QUERY SELECT NULL::uuid, NULL::text;
    END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text) TO authenticated, service_role;


-- 2. Atualizar fn_ingerir_afd para usar fn_servidor_por_identificador_afd diretamente na ingestão
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

    SELECT unidade_id INTO v_unidade_id
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % nao cadastrado.', p_dispositivo_id;
    END IF;

    SELECT count(*) INTO v_n_setores
      FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id;
    IF v_n_setores = 1 THEN
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
            dispositivo_id, nsr, tipo_registro, linha_bruta, linha_sha256,
            ocorrido_em, identificador_afd, parse_versao, parse_ok, parse_erro,
            hash_anterior, hash_encadeado, sincronizacao_id)
        VALUES (
            p_dispositivo_id, v_p.nsr, COALESCE(v_p.tipo, '?'), v_linha, v_sha,
            v_p.ocorrido_em, v_p.identificador, 1, v_p.ok, v_p.erro,
            v_hash_ant,
            encode(sha256(convert_to(COALESCE(v_hash_ant, '') || v_sha, 'UTF8')), 'hex'),
            v_sinc_id)
        ON CONFLICT (dispositivo_id, nsr) DO NOTHING
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
              FROM public.fn_servidor_por_identificador_afd(p_dispositivo_id, v_p.identificador);

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
                PERFORM public.fn_reconciliar_marcacoes_dia(r.servidor_id, r.data_batida);
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

REVOKE ALL ON FUNCTION public.fn_ingerir_afd FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ingerir_afd TO service_role;


-- 3. Atualizar fn_reparse_afd_dispositivo para auto-reconciliar retroativamente
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
               COALESCE(m.identificador_bruto, a.identificador_afd) AS identificador
          FROM public.marcacoes_ponto m
          LEFT JOIN public.rep_afd_registros a ON a.id = m.afd_registro_id
         WHERE m.servidor_id IS NULL
           AND m.origem = 'rep'
           AND m.ocorrido_em >= v_desde
           AND (p_dispositivo_id IS NULL OR m.dispositivo_id = p_dispositivo_id)
    LOOP
        SELECT servidor_id INTO v_servidor_id
          FROM public.fn_servidor_por_identificador_afd(r.dispositivo_id, r.identificador);

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
        END IF;
    END LOOP;

    -- Auto-reconcilia todos os servidores que tiveram marcações desde v_desde
    IF v_atualizados > 0 THEN
        FOR r_rec IN
            SELECT DISTINCT m.servidor_id, (m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data_batida
              FROM public.marcacoes_ponto m
             WHERE m.ocorrido_em >= v_desde
               AND m.servidor_id IS NOT NULL
               AND (p_dispositivo_id IS NULL OR m.dispositivo_id = p_dispositivo_id)
        LOOP
            BEGIN
                PERFORM public.fn_reconciliar_marcacoes_dia(r_rec.servidor_id, r_rec.data_batida);
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


-- 4. Auto-executar o reparse das batidas órfãs de Agosto de 2026
DO $$
BEGIN
    PERFORM public.fn_reparse_afd_dispositivo(NULL, date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo');
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Aviso na auto-execucao de fn_reparse_afd_dispositivo: %', SQLERRM;
END $$;
