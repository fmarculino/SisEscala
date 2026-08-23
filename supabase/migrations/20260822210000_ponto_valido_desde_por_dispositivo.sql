-- ============================================================================
-- O relogio lembra de 2019; o ponto do SisEscala comeca quando ele assume (22/08/2026)
-- ============================================================================
-- ARQUIVO GERADO por scratchpad/gen_ponto_valido_desde.js. Nao editar a mao - regerar.
-- As quatro funcoes sao copia mecanica do corpo vigente (20260820030000, 20260818200000,
-- 20260820010000 e 20260822200000) com substituicoes pontuais; o script aborta se qualquer
-- invariante divergir (CLAUDE.md armadilha 1).
--
-- O PROBLEMA, medido no parque inteiro em 22/08/2026
--
--   A resolucao de identidade nao tem vigencia. fn_servidor_por_identificador_afd cai para CPF e
--   depois PIS (20260818200000, que resolveu a SMS) SEM olhar a data da batida - p_vigente_de so
--   protege o caminho do VINCULO, e a armadilha 10 do CLAUDE.md fala dele como se fosse a unica
--   porta. Entao um relogio reaproveitado tem o AFD inteiro do sistema anterior transformado em
--   ponto atribuido ja na ingestao:
--
--     HMM-01           3.714 marcacoes com dono, a mais antiga de 2021
--     USF-LARANJEIRAS  2.362                                      2019
--     HMI-01           1.366                                      2021
--     USF-HIROSHI      1.222                                      2023
--     USF-DAA            373                                      2024
--     USF-PC             306                                      2022
--     USF-JPA            285                                      2021
--     ------------------------------------------------------------------
--     total            9.626 anteriores a 07/2026 (legado de outro sistema)
--
--   Sao exatamente os sete relogios instalados nos ultimos tres dias - nao e residuo de uma
--   instalacao infeliz, e o comportamento padrao de toda instalacao nova, no meio de uma rampa.
--
--   Nada disso projetou em folha, e isso e SORTE DE CALENDARIO, nao desenho: a escala mais
--   antiga do SisEscala e de 07/2026 e nenhuma dessas marcacoes e de 2026. O proximo relogio
--   reaproveitado pode chegar com batida do mes passado - de um sistema que a unidade usava ate
--   semana passada - e ai projeta na competencia aberta, sem ninguem perceber.
--
--   (As 6 marcacoes de 2026 anteriores ao cadastro do proprio relogio sao testes de instalacao,
--   todas no dia do cadastro, em Reg/TI, SMS e USF-DAA. Esse caso ja e o da armadilha 13, com
--   rep_excecoes_ponto - nao e o que esta migration trata.)
--
-- A CORRECAO: um corte por dispositivo, aplicado num lugar so
--
--   dispositivos_rep.ponto_valido_desde (date) e o dia em que o SisEscala assumiu o ponto
--   daquele relogio. A resolucao de identidade passa a receber o instante da batida e devolve
--   NULL abaixo do corte - antes das tres portas (vinculo, CPF, PIS), porque nem vinculo
--   explicito deve fazer o SisEscala assumir ponto de outro sistema.
--
--   Relogio novo nasce protegido: DEFAULT = hoje no fuso configurado. Quem ja usava o SisEscala
--   pelo terminal antes de ganhar o REP pode recuar a data na tela do dispositivo.
--
-- O QUE **NAO** MUDA, e e deliberado
--
--   * A batida continua sendo gravada em rep_afd_registros (artefato legal, cadeia de hash) E
--     continua virando marcacoes_ponto - so que ORFA. "Nunca descartar batida" segue valendo.
--   * Isso e o que torna o corte REVERSIVEL: data errada se conserta mudando a data e rodando
--     fn_reparse_afd_dispositivo, que so mexe em orfa. Se a ingestao deixasse de criar a
--     marcacao, nao haveria o que reprocessar - por isso o corte age na ATRIBUICAO, nao na
--     ingestao. O preco e volume (o HMM-01 sozinho tem 69.619 marcacoes, quase todas orfas);
--     e o mesmo preco que a SMS ja paga desde 08/2026, com ~250 mil.
--   * As 9.626 ja atribuidas continuam atribuidas. marcacoes_ponto e INSERT-only e o unico
--     UPDATE que o trigger libera e orfa -> com dono (20260818001000) - nao existe, e nao deve
--     existir, caminho para tirar o dono. A porta para isso e marcacoes_tratamentos com
--     tipo = 'desconsiderar', que a alocacao ja honra. Nao e feito aqui: elas sao inertes (nao
--     ha escala antes de 07/2026) e 9.626 tratamentos comprariam aparencia de limpeza, nao
--     seguranca.
--
-- ⚠️ A ASSINATURA DE 2 ARGUMENTOS E DERRUBADA. p_ocorrido_em NAO tem DEFAULT: com DEFAULT, as
--    duas assinaturas conviveriam e qualquer chamada de 2 args pularia o corte em silencio - o
--    modo de falha que a propria 20260817180000 ja mandou conferir ("a assinatura antiga NAO
--    pode ter sobrado"). Os quatro callers estao todos nesta migration.
--
-- IDEMPOTENTE: CREATE OR REPLACE nas funcoes, ADD COLUMN IF NOT EXISTS, DROP FUNCTION IF EXISTS.
-- Reaplicar e seguro - o backfill da coluna so alcanca quem estiver NULL.
-- ============================================================================


-- ============================================================================
-- 1. QUE DIA E HOJE, no fuso configurado
-- ============================================================================
-- Existe porque DEFAULT de coluna nao aceita subconsulta, e o fuso mora em configuracoes_globais
-- (chave/valor). CURRENT_DATE nao serve: o processo e o banco rodam em UTC, entao nas ultimas 3
-- horas de todo dia ele ja e amanha (armadilha 12) - e um corte um dia adiantado orfanaria as
-- batidas do proprio dia da instalacao, em silencio.
--
-- As funcoes que ja resolvem o fuso inline (fn_confirmar_presenca e companhia) NAO foram
-- convertidas: trocar a forma em ~10 funcoes de presenca para ganhar estilo nao se paga.

CREATE OR REPLACE FUNCTION public.fn_data_local()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT (now() AT TIME ZONE COALESCE(
               (SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
               'America/Sao_Paulo'))::date
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_data_local() TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_data_local() IS
    'Data de hoje no fuso de configuracoes_globais (fallback America/Sao_Paulo). Existe para uso '
    'em DEFAULT de coluna, onde subconsulta nao e permitida - CURRENT_DATE erraria por um dia nas '
    'ultimas 3 horas, porque o banco roda em UTC.';


-- ============================================================================
-- 2. A COLUNA DE CORTE
-- ============================================================================

ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS ponto_valido_desde date;

-- Backfill: a data de cadastro do dispositivo, no fuso local. E a mesma referencia que o
-- CLAUDE.md ja manda usar para p_vigente_de ao criar vinculo ("nunca a primeira batida do AFD").
UPDATE public.dispositivos_rep d
   SET ponto_valido_desde = (d.created_at AT TIME ZONE COALESCE(
           (SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
           'America/Sao_Paulo'))::date
 WHERE d.ponto_valido_desde IS NULL;

ALTER TABLE public.dispositivos_rep
    ALTER COLUMN ponto_valido_desde SET DEFAULT public.fn_data_local();

ALTER TABLE public.dispositivos_rep
    ALTER COLUMN ponto_valido_desde SET NOT NULL;

COMMENT ON COLUMN public.dispositivos_rep.ponto_valido_desde IS
    'Dia em que o SisEscala assumiu o ponto deste relogio. Batida anterior a isto continua '
    'gravada (AFD e marcacoes_ponto) mas NAO ganha dono - e assim que o historico de um '
    'equipamento reaproveitado deixa de virar ponto daqui. DEFAULT = hoje no fuso configurado, '
    'entao relogio novo nasce protegido; recue a data na tela quando a unidade ja registrava '
    'ponto no SisEscala por outro caminho antes de ganhar o REP.';


-- ============================================================================
-- 3. RESOLUCAO DE IDENTIDADE - agora com a data da batida
-- ============================================================================
-- A assinatura antiga cai: ver o aviso no cabecalho. Se este DROP falhar por dependencia, existe
-- um caller em funcao LANGUAGE sql (que cria dependencia real, ao contrario de plpgsql) - ache-o
-- antes de seguir, nao troque por CASCADE.

DROP FUNCTION IF EXISTS public.fn_servidor_por_identificador_afd(uuid, text);

CREATE OR REPLACE FUNCTION public.fn_servidor_por_identificador_afd(
    p_dispositivo_id uuid,
    p_identificador  text,
    -- Quando da batida. NAO tem DEFAULT de proposito: a assinatura de 2 argumentos e
    -- DERRUBADA nesta migration, entao todo caller e obrigado a dizer de que instante esta
    -- falando - ou passar NULL explicitamente, o que significa "isto nao e uma batida"
    -- (o snapshot de cadastro e o unico caso). DEFAULT deixaria as duas assinaturas
    -- convivendo e qualquer chamada de 2 args passaria a pular o corte em silencio.
    p_ocorrido_em    timestamptz
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
    v_corte       date;
    v_tz          text;
BEGIN
    -- Limpa pontuação e pega os últimos 11 dígitos
    v_chave := right(regexp_replace(COALESCE(p_identificador, ''), '\D', '', 'g'), 11);
    IF length(v_chave) < 11 THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text;
        RETURN;
    END IF;

    SELECT unidade_id, ponto_valido_desde INTO v_unidade_dev, v_corte
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;

    -- CORTE POR DISPOSITIVO: batida anterior ao dia em que o SisEscala assumiu o ponto
    -- daquele relogio NAO ganha dono. Vem ANTES das tres portas de resolucao de proposito -
    -- e o portao mais forte, e nem o vinculo explicito o vence.
    --
    -- POR QUE ISTO PRECISOU EXISTIR (medido em producao em 22/08/2026): relogio
    -- reaproveitado chega com o AFD inteiro do sistema anterior, e a resolucao por CPF/PIS
    -- (20260818200000) nao olhava data nenhuma - p_vigente_de so protege o caminho do
    -- VINCULO. Resultado: 9.626 marcacoes de 2019 a 2025, de sete relogios, com dono no
    -- SisEscala. Nao projetaram em folha por sorte de calendario (a escala mais antiga e de
    -- 07/2026); o proximo relogio pode chegar com historico do mes passado.
    --
    -- A BATIDA NAO E DESCARTADA: continua em rep_afd_registros (o artefato legal, com a
    -- cadeia de hash) e continua virando marcacoes_ponto, so que ORFA. Isso e deliberado e
    -- e o que torna o corte REVERSIVEL: se a data for posta errada, basta corrigi-la e
    -- rodar fn_reparse_afd_dispositivo, que so mexe em orfa. Se a ingestao deixasse de
    -- criar a marcacao, nao haveria o que reprocessar depois.
    --
    -- p_ocorrido_em NULL = "isto nao e uma batida" (resolucao de CADASTRO, vinda do
    -- snapshot do relogio). Nao ha instante para comparar e o corte nao se aplica.
    IF p_ocorrido_em IS NOT NULL AND v_corte IS NOT NULL THEN
        -- configuracoes_globais e CHAVE/VALOR (valor jsonb): 'SELECT timezone FROM ...' morre
        -- com 'column "timezone" does not exist', e so em RUNTIME (armadilha 1). Esta e a
        -- forma usada por fn_confirmar_presenca e companhia. Sem o fuso, uma batida das 21h
        -- do dia do corte cairia no dia seguinte (o processo e o banco rodam em UTC).
        SELECT (valor#>>'{}')::text INTO v_tz
          FROM public.configuracoes_globais WHERE chave = 'timezone';
        v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

        IF (p_ocorrido_em AT TIME ZONE v_tz)::date < v_corte THEN
            RETURN QUERY SELECT NULL::uuid, NULL::text;
            RETURN;
        END IF;
    END IF;

    -- 1) Vínculo vigente tem prioridade máxima (decisão registrada para este dispositivo)
    SELECT v.servidor_id INTO v_vinculo
      FROM public.rep_vinculos_servidor v
     WHERE v.dispositivo_id = p_dispositivo_id
       AND right(regexp_replace(v.identificador_afd, '\D', '', 'g'), 11) = v_chave
       AND v.vigente_ate IS NULL
     ORDER BY v.vigente_de DESC
     LIMIT 1;

    -- Excecao de ponto: administrador cadastrado no equipamento para configura-lo
    -- nao registra ponto nele. A batida continua no AFD e em marcacoes_ponto
    -- (regra "nunca descartar batida"); ela so deixa de ter dono.
    IF v_vinculo IS NOT NULL AND public.fn_ponto_excecao(v_vinculo, p_dispositivo_id) THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text;
        RETURN;
    END IF;

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

    -- Excecao de ponto tambem no caminho CPF/PIS: sem isto, quem administra varios
    -- relogios tem cada teste de biometria virando ponto (caso real medido em
    -- 19/08/2026: teste no CEI virou a entrada de um Plantao na folha).
    IF v_por_cpf IS NOT NULL AND public.fn_ponto_excecao(v_por_cpf, p_dispositivo_id) THEN
        v_por_cpf := NULL; v_n_cpf := 0;
    END IF;
    IF v_por_pis IS NOT NULL AND public.fn_ponto_excecao(v_por_pis, p_dispositivo_id) THEN
        v_por_pis := NULL; v_n_pis := 0;
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
REVOKE ALL ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text, timestamptz) IS
    'De quem e esta batida, neste dispositivo. Aplica primeiro o corte '
    'dispositivos_rep.ponto_valido_desde (historico anterior a assuncao do relogio nao ganha '
    'dono) e so entao tenta vinculo vigente, CPF e PIS, recusando ambiguidade em vez de chutar. '
    'p_ocorrido_em NULL significa "isto e cadastro, nao batida" - unico caller assim e o snapshot '
    'de usuarios do relogio. FONTE UNICA: nao replicar esta regra em outra funcao nem no frontend.';


-- ============================================================================
-- 4. INGESTAO DO AFD - passa o instante da batida
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
-- Assinatura conferida contra pg_proc, nao chutada: duas migrations anteriores escreveram
-- fn_ingerir_afd(uuid, text, text, text, integer), que nunca existiu.
REVOKE ALL ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    TO service_role;


-- ============================================================================
-- 5. REPARSE - idem, lendo o instante da propria marcacao orfa
-- ============================================================================
-- ⚠️ A SOBRECARGA DE 1 ARGUMENTO PRECISA MORRER JUNTO. fn_reparse_afd_dispositivo(uuid) nasceu em
-- 20260811190000 e nunca foi derrubada quando 20260818001000 criou a de 2 argumentos - as duas
-- estao vivas em producao HOJE. Duas consequencias, e a segunda e nova:
--
--   * PostgREST ja nao consegue escolher entre elas: chamar a RPC so com p_dispositivo_id devolve
--     PGRST203 ("could not choose the best candidate"). Conferido em producao em 22/08/2026.
--   * A partir desta migration ela seria uma MINA: o corpo dela chama
--     fn_servidor_por_identificador_afd com 2 argumentos, assinatura que esta sendo derrubada
--     aqui - qualquer execucao morreria com "function does not exist", e so em runtime.
--
-- Nenhum caller vivo usa 1 argumento: o unico que existiu estava no bloco DO da propria
-- 20260811190000, que ja rodou. Os de hoje passam sempre (dispositivo, desde).

DROP FUNCTION IF EXISTS public.fn_reparse_afd_dispositivo(uuid);

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


-- ============================================================================
-- 6. SNAPSHOT DE CADASTRO - passa NULL, porque cadastro nao e batida
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(
    p_dispositivo_id uuid,
    p_usuarios       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_total integer := 0;
    v_sem_match integer := 0;
    v_encerrados integer := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.dispositivos_rep WHERE id = p_dispositivo_id) THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    DELETE FROM public.rep_usuarios_dispositivo WHERE dispositivo_id = p_dispositivo_id;

    WITH bruto AS (
        SELECT
            btrim(u->>'identificador_afd')                         AS identificador_afd,
            NULLIF(btrim(u->>'registration_bruto'), '')             AS registration_bruto,
            NULLIF(btrim(u->>'nome'), '')                           AS nome,
            COALESCE((u->>'tem_biometria')::boolean, false)         AS tem_biometria
          FROM jsonb_array_elements(COALESCE(p_usuarios, '[]'::jsonb)) AS u
         WHERE btrim(COALESCE(u->>'identificador_afd', '')) <> ''
    ),
    entrada AS (
        -- Dedup: um device reaproveitado pode ter o mesmo identificador_afd cadastrado mais de
        -- uma vez. Mantem o registro com biometria quando algum dos duplicados tiver.
        SELECT DISTINCT ON (identificador_afd)
               identificador_afd, registration_bruto, nome, tem_biometria
          FROM bruto
         ORDER BY identificador_afd, tem_biometria DESC, nome NULLS LAST
    ),
    resolvido AS (
        -- FONTE UNICA de identidade: fn_servidor_por_identificador_afd tenta vinculo, CPF e PIS,
        -- nesta ordem, e RECUSA quando CPF e PIS apontam para pessoas diferentes. Antes daqui
        -- havia um LEFT JOIN casando SO por CPF - foi isso que fez o relogio da SMS (cadastrado
        -- por PIS pelo sistema anterior) resolver ZERO dos 323 usuarios.
        --
        -- LATERAL em vez de LEFT JOIN tambem elimina um risco latente: dois servidores Ativos com
        -- o mesmo CPF multiplicavam a linha e estouravam uq_usuario_dispositivo no INSERT, dando
        -- rollback no snapshot inteiro (o mesmo modo de falha que esta migration de origem
        -- corrigiu para identificador duplicado, pela outra ponta).
        SELECT e.*, r.servidor_id, r.origem_match
          FROM entrada e
          -- NULL no instante = "isto e cadastro, nao batida": nao ha o que comparar com
          -- dispositivos_rep.ponto_valido_desde, e quem esta cadastrado no relogio HOJE
          -- continua sendo reconhecido independente de quando o equipamento foi assumido.
          LEFT JOIN LATERAL public.fn_servidor_por_identificador_afd(
                       p_dispositivo_id, e.identificador_afd, NULL::timestamptz) r ON true
    ),
    inseridos AS (
        INSERT INTO public.rep_usuarios_dispositivo
               (dispositivo_id, identificador_afd, registration_bruto, nome_no_device,
                tem_biometria, servidor_id, origem_match)
        SELECT p_dispositivo_id, identificador_afd, registration_bruto, nome,
               tem_biometria, servidor_id, origem_match
          FROM resolvido
        RETURNING servidor_id
    )
    SELECT count(*), count(*) FILTER (WHERE servidor_id IS NULL)
      INTO v_total, v_sem_match
      FROM inseridos;

    -- RECONCILIACAO DO VINCULO COM O QUE O RELOGIO REALMENTE TEM (22/08/2026)
    --
    -- O snapshot sempre foi substituido por inteiro, mas NADA olhava para rep_vinculos_servidor:
    -- quem sumia do equipamento ficava com vinculo vigente para sempre. Medido em producao no
    -- HMM-01, depois da higiene do relogio: 53 vinculos vigentes de gente que nao esta mais no
    -- equipamento. A tela "Cobertura da Escala" lia esse vinculo e dizia 'ok' + "com biometria"
    -- para 3 servidores escalados que NAO ESTAO no relogio, e fn_enfileirar_cadastros_rep pula
    -- quem tem vinculo vigente - ou seja, eles nunca mais seriam reenviados. Os dois lados
    -- silenciosos, exatamente o modo de falha da secao "Cobertura de ponto" do CLAUDE.md.
    --
    -- Encerrar vinculo NAO mexe em ponto passado: quem reprocessa autoria (fn_reparse_afd_
    -- dispositivo) le o vinculo vigente NA DATA da batida, e vigente_ate = now() so fecha dali
    -- para frente. E e reversivel: reenviar o cadastro abre um vinculo novo
    -- (fn_confirmar_cadastro_rep ja fecha o anterior antes de inserir).
    --
    -- DUAS GUARDAS QUE NAO PODEM SAIR DAQUI:
    --
    --   1. Lista VAZIA nunca reconcilia. Payload vazio e indistinguivel de leitura que falhou
    --      (a rota /api/rep/v1/usuarios-dispositivo cai para [] quando o corpo vem malformado)
    --      - e encerrar todos os vinculos de uma unidade por causa de um POST torto e muito
    --      pior que o bug que esta funcao conserta.
    --   2. Vinculo criado ha menos de 15 minutos e poupado. O coletor le o relogio inteiro
    --      (paginado de 100 em 100) e so depois publica o snapshot; um push de cadastro que
    --      acontecesse entre a leitura e a publicacao criaria um vinculo legitimo que nao esta
    --      naquela lista. A proxima leitura reconcilia, se for para reconciliar mesmo.
    IF v_total > 0 THEN
        WITH encerrados AS (
            UPDATE public.rep_vinculos_servidor v
               SET vigente_ate = now()
             WHERE v.dispositivo_id = p_dispositivo_id
               AND v.vigente_ate IS NULL
               AND v.created_at < now() - interval '15 minutes'
               AND NOT EXISTS (
                     SELECT 1
                       FROM public.rep_usuarios_dispositivo u
                      WHERE u.dispositivo_id = p_dispositivo_id
                        -- right(...,11) dos dois lados: o mesmo numero convive com zero a
                        -- esquerda de tamanhos diferentes (armadilha 10). ltrim(...,'0') aqui
                        -- comeria um digito de CPF que comeca com zero - 37% da base.
                        AND right(regexp_replace(u.identificador_afd, '\D', '', 'g'), 11)
                          = right(regexp_replace(v.identificador_afd, '\D', '', 'g'), 11))
            RETURNING 1
        )
        SELECT count(*) INTO v_encerrados FROM encerrados;
    END IF;

    RETURN jsonb_build_object('total', v_total, 'sem_correspondencia', v_sem_match,
                              'vinculos_encerrados', v_encerrados);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) TO service_role;


-- ============================================================================
-- CONFERENCIA - OBRIGATORIA, E NESTA ORDEM
-- ============================================================================
-- HOMOLOGACAO PRIMEIRO. plpgsql resolve nome de coluna, existencia e ARIDADE de funcao so na
-- EXECUCAO (armadilha 1): trocar a assinatura e exatamente o tipo de mudanca que o CREATE aceita
-- feliz e que so estoura quando alguem bate o ponto.
--
-- 0. A assinatura antiga NAO pode ter sobrado - com as duas vivas, quem chamar com 2 args pula
--    o corte e ninguem descobre:
--
-- SELECT count(*) AS versoes, string_agg(pg_get_function_identity_arguments(oid), ' | ')
--   FROM pg_proc WHERE proname = 'fn_servidor_por_identificador_afd';
--   -- esperado: versoes = 1, argumentos "uuid, text, timestamptz"
--
-- 1. TESTE DE FUMACA - EXECUTAR as quatro, nao so criar:
--
-- SELECT * FROM public.fn_servidor_por_identificador_afd(gen_random_uuid(), '000000000191', now());
-- SELECT * FROM public.fn_servidor_por_identificador_afd(gen_random_uuid(), '000000000191', NULL);
-- SELECT public.fn_registrar_snapshot_usuarios_dispositivo(
--          (SELECT id FROM public.dispositivos_rep LIMIT 1), '[]'::jsonb);
--   -- ATENCAO: a linha acima APAGA o snapshot daquele dispositivo (a funcao sempre substituiu
--   -- por inteiro). Em homologacao, tudo bem; em producao, rode a higiene depois.
-- SELECT public.fn_reparse_afd_dispositivo(gen_random_uuid(), now());
--
-- 2. O PORTAO. Uma batida REAL anterior ao corte tem que deixar de resolver, e a MESMA batida
--    depois do corte tem que continuar resolvendo. Troque o uuid por um dispositivo de verdade:
--
-- WITH d AS (SELECT id, ponto_valido_desde FROM public.dispositivos_rep WHERE nome LIKE '%HMM%')
-- SELECT (SELECT servidor_id FROM public.fn_servidor_por_identificador_afd(
--            d.id, '053638930459', (d.ponto_valido_desde - 1)::timestamptz)) AS antes_do_corte,
--        (SELECT servidor_id FROM public.fn_servidor_por_identificador_afd(
--            d.id, '053638930459', (d.ponto_valido_desde + 1)::timestamptz)) AS depois_do_corte
--   FROM d;
--   -- esperado: antes_do_corte NULO, depois_do_corte com o uuid do servidor.
--
-- 3. Quanto historico alheio cada relogio traz, e quanto dele ja esta atribuido. E esta consulta
--    que se roda a cada instalacao nova para conferir se a data do corte esta certa:
--
-- SELECT d.nome, d.ponto_valido_desde,
--        count(*) FILTER (WHERE m.ocorrido_em < d.ponto_valido_desde) AS antes_do_corte,
--        count(*) FILTER (WHERE m.ocorrido_em < d.ponto_valido_desde
--                           AND m.servidor_id IS NOT NULL)            AS antes_e_com_dono,
--        min(m.ocorrido_em) AS mais_antiga
--   FROM public.dispositivos_rep d
--   JOIN public.marcacoes_ponto m ON m.dispositivo_id = d.id
--  GROUP BY d.nome, d.ponto_valido_desde
--  ORDER BY 4 DESC;
--   -- 'antes_e_com_dono' e o passivo herdado (9.626 hoje) e NAO cai com esta migration - ela
--   -- impede o proximo, nao desfaz o anterior. O que tem que ficar em ZERO daqui pra frente e
--   -- esse mesmo numero medido para relogios cadastrados DEPOIS de hoje.
--
-- 4. Ninguem pode ter PERDIDO dono por causa disto (o corte so alcanca o que e anterior a ele):
--
-- SELECT count(*) FILTER (WHERE servidor_id IS NOT NULL) AS com_dono, count(*) AS total
--   FROM public.marcacoes_ponto WHERE origem = 'rep';
--   -- esperado: identico ao de antes da migration.
--
-- 5. E o ponto do mes corrente tem que continuar entrando normalmente - confira uma batida de
--    hoje chegando na escala depois do proximo ciclo do coletor, em qualquer unidade ativa.
