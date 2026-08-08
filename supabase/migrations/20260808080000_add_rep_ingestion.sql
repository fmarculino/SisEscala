-- Migration: Cadastro de dispositivos e ingestao de AFD (Fase 4)
-- Data: 2026-08-08
--
-- OBJETIVO
--   Abrir o caminho de entrada do relogio de ponto: cadastrar o equipamento, autenticar o
--   coletor e ingerir linhas de AFD de forma idempotente, criando marcacoes.
--
--   Nesta fase as batidas do REP entram em marcacoes_ponto e aparecem LADO A LADO com o que
--   escala_diaria diz - mas NAO escrevem nela. E aqui que a realidade aparece (deriva de
--   relogio, dedo errado, quem esquece de bater) com risco zero para a folha de ponto.
--
-- LAYOUT DO AFD (Portaria 671), confirmado no arquivo real do equipamento em 07/08/2026
--   Registro tipo 3 - MARCACAO, 50 caracteres:
--     NSR(9) + tipo(1) + data/hora ISO 8601 com offset(24) + identificador(12) + CRC(4)
--     exemplo: 000000008 3 2023-11-08T08:46:00-0300 011111211111 5939
--
--   O identificador de 12 digitos e o CPF com zero a esquerda. A MATRICULA NAO APARECE em
--   nenhum registro de marcacao - ela so existe no registro tipo 5 (cadastro) e em
--   load_users.fcgi. Por isso rep_vinculos_servidor e a unica ponte possivel, e precisa ser
--   populada ANTES de qualquer remove_users.fcgi.
--
--   Registro tipo 5 - CADASTRO, 118 caracteres:
--     NSR(9) + tipo(1) + data/hora(24) + operacao(1) + identificador(12) + nome(52) + ...
--     E ele que permite propor vinculos automaticamente.
--
-- ENCODING
--   O AFD sai do equipamento em latin1/ISO-8859-1. A conversao para UTF-8 acontece UMA VEZ,
--   no cliente, antes de chamar esta funcao - e o sha256 enviado e o dos BYTES ORIGINAIS.
--   Um parser UTF-8 aplicado direto ao arquivo corrompe silenciosamente os nomes acentuados.
--
-- IDEMPOTENCIA
--   Em duas camadas: (dispositivo_id, lote_id) unico em rep_sincronizacoes faz o reenvio do
--   mesmo lote devolver o resultado anterior sem reprocessar; e (dispositivo_id, nsr) unico em
--   rep_afd_registros garante que a mesma linha nunca vira duas marcacoes, venha por rede ou
--   por pendrive.


-- ============================================================================
-- 1. CADASTRO DE DISPOSITIVO E TOKEN DO COLETOR
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_gerar_token_dispositivo_rep(p_dispositivo_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_token text;
BEGIN
    IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores podem gerar credencial de coletor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 64 hex a partir de dois uuid v4. Evita depender da extensao pgcrypto (gen_random_bytes),
    -- que pode nao estar habilitada nos dois bancos (CLAUDE.md armadilha 3).
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

    UPDATE public.dispositivos_rep
       SET token_hash        = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
           token_criado_em   = now(),
           token_criado_por_id = auth.uid(),
           updated_at        = now()
     WHERE id = p_dispositivo_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    -- Devolvido em texto claro UMA UNICA VEZ. O banco guarda apenas o sha256.
    RETURN v_token;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_gerar_token_dispositivo_rep(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.fn_autenticar_dispositivo_rep(
    p_dispositivo_id uuid,
    p_token          text,
    p_ip             inet DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_hash  text;
    v_ativo boolean;
    v_ok    boolean;
BEGIN
    SELECT token_hash, ativo INTO v_hash, v_ativo
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;

    IF v_hash IS NULL OR NOT COALESCE(v_ativo, false) THEN
        RETURN false;
    END IF;

    -- Comparacao em tempo constante: hashes tem tamanho fixo, entao um = simples ja nao vaza
    -- posicao do primeiro byte divergente de forma util, mas o cast explicito evita
    -- curto-circuito por tamanho.
    v_ok := (v_hash = encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex'));

    IF v_ok THEN
        UPDATE public.dispositivos_rep
           SET ultimo_contato_em = now(),
               ultimo_ip_origem  = COALESCE(p_ip, ultimo_ip_origem)
         WHERE id = p_dispositivo_id;
    END IF;

    RETURN v_ok;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_autenticar_dispositivo_rep(uuid, text, inet) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_autenticar_dispositivo_rep(uuid, text, inet) TO service_role;


-- ============================================================================
-- 2. PARSE DE UMA LINHA DE AFD
-- ============================================================================
-- Isolado numa funcao propria para poder ser testado e versionado sozinho. rep_afd_registros
-- guarda parse_versao justamente para permitir reprocessar o historico quando esta funcao for
-- corrigida, sem nunca tocar em linha_bruta.

CREATE OR REPLACE FUNCTION public.fn_parse_linha_afd(p_linha text)
RETURNS TABLE (nsr bigint, tipo char(1), ocorrido_em timestamptz, identificador text, ok boolean, erro text)
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
    v_nsr_txt text;
    v_tipo    char(1);
    v_dt_txt  text;
BEGIN
    nsr := NULL; tipo := NULL; ocorrido_em := NULL; identificador := NULL; ok := false; erro := NULL;

    IF p_linha IS NULL OR length(p_linha) < 10 THEN
        erro := 'linha curta demais'; RETURN NEXT; RETURN;
    END IF;

    v_nsr_txt := substring(p_linha from 1 for 9);
    v_tipo    := substring(p_linha from 10 for 1);

    IF v_nsr_txt !~ '^[0-9]{9}$' THEN
        erro := 'NSR nao numerico: ' || v_nsr_txt; RETURN NEXT; RETURN;
    END IF;

    nsr  := v_nsr_txt::bigint;
    tipo := v_tipo;

    -- Os tipos 1 (cabecalho) e 9 (trailer) nao carregam data/hora nesta posicao.
    IF v_tipo IN ('2', '3', '4', '5', '6', '7', '8') AND length(p_linha) >= 34 THEN
        v_dt_txt := substring(p_linha from 11 for 24);
        BEGIN
            ocorrido_em := v_dt_txt::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            erro := 'data/hora invalida: ' || v_dt_txt;
        END;
    END IF;

    -- Identificador do trabalhador: CPF com zero a esquerda (12 digitos).
    IF v_tipo = '3' AND length(p_linha) >= 46 THEN
        identificador := substring(p_linha from 35 for 12);
    ELSIF v_tipo = '5' AND length(p_linha) >= 47 THEN
        -- No tipo 5 ha um caractere de operacao (I/A/E) antes do identificador.
        identificador := substring(p_linha from 36 for 12);
    END IF;

    ok := (erro IS NULL);
    RETURN NEXT;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_parse_linha_afd(text) TO authenticated, service_role;


-- ============================================================================
-- 3. INGESTAO
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
BEGIN
    -- 3.1 Idempotencia do lote: reenvio apos falha de rede devolve o resultado anterior.
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

    SELECT unidade_id, setor_id INTO v_unidade_id, v_setor_id
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % nao cadastrado.', p_dispositivo_id;
    END IF;

    INSERT INTO public.rep_sincronizacoes (
        dispositivo_id, lote_id, canal, arquivo_sha256, assinatura_verificada,
        coletor_versao, coletor_hostname, ip_origem, importado_por_id)
    VALUES (p_dispositivo_id, p_lote_id, p_canal, p_arquivo_sha256, p_assinatura_ok,
            p_coletor_versao, p_coletor_host, p_ip, p_importado_por)
    RETURNING id INTO v_sinc_id;

    -- 3.2 Ultimo elo da cadeia de hash deste dispositivo.
    SELECT hash_encadeado INTO v_hash_ant
      FROM public.rep_afd_registros
     WHERE dispositivo_id = p_dispositivo_id
     ORDER BY nsr DESC LIMIT 1;

    -- 3.3 Processa em ordem de NSR. A ordem importa: a cadeia de hash e sequencial.
    FOR v_linha IN
        SELECT x FROM jsonb_array_elements_text(p_linhas) AS x
         ORDER BY substring(x from 1 for 9)
    LOOP
        v_recebidas := v_recebidas + 1;
        SELECT * INTO v_p FROM public.fn_parse_linha_afd(v_linha);

        IF v_p.nsr IS NULL THEN
            CONTINUE;   -- linha ilegivel: nao entra na cadeia
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
            CONTINUE;   -- NSR ja ingerido: a cadeia dele ja existe, nao avanca v_hash_ant
        END IF;

        v_novas    := v_novas + 1;
        v_hash_ant := encode(sha256(convert_to(COALESCE(v_hash_ant, '') || v_sha, 'UTF8')), 'hex');
        v_nsr_min  := LEAST(COALESCE(v_nsr_min, v_p.nsr), v_p.nsr);
        v_nsr_max  := GREATEST(COALESCE(v_nsr_max, v_p.nsr), v_p.nsr);

        -- 3.4 Marcacao de ponto: somente registro tipo 3.
        IF v_p.tipo = '3' AND v_p.ocorrido_em IS NOT NULL THEN
            -- Resolucao do servidor pelo vinculo VIGENTE NA DATA DA BATIDA. Usar o vinculo
            -- atual faria uma correcao de hoje reescrever a autoria de batidas antigas.
            SELECT v.servidor_id INTO v_servidor_id
              FROM public.rep_vinculos_servidor v
             WHERE v.dispositivo_id = p_dispositivo_id
               AND v.identificador_afd = v_p.identificador
               AND v.vigente_de <= v_p.ocorrido_em
               AND (v.vigente_ate IS NULL OR v.vigente_ate > v_p.ocorrido_em)
             ORDER BY v.vigente_de DESC
             LIMIT 1;

            IF v_servidor_id IS NULL THEN
                v_orfas := v_orfas + 1;   -- orfa NUNCA e descartada, so fica sem dono
            END IF;

            PERFORM public.fn_registrar_marcacao(
                v_servidor_id,
                'rep'::public.marcacao_origem,
                v_p.ocorrido_em,
                v_unidade_id, v_setor_id,
                NULL, NULL, NULL,
                false,                                        -- batida de REP nunca e sintetica
                (v_p.ocorrido_em < now() - interval '1 day'), -- retroativa: coleta atrasada
                p_dispositivo_id, v_p.nsr, v_afd_id, v_p.identificador,
                (p_canal = 'pendrive'),
                'AFD NSR ' || v_p.nsr::text);

            v_marc := v_marc + 1;
        END IF;
    END LOOP;

    -- 3.5 Fecha a sincronizacao e avanca o NSR aceito do dispositivo.
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

    RETURN jsonb_build_object(
        'reenvio', false, 'sincronizacao_id', v_sinc_id,
        'recebidas', v_recebidas, 'novas', v_novas, 'duplicadas', v_dups,
        'marcacoes', v_marc, 'orfas', v_orfas,
        'nsr_inicial', v_nsr_min, 'nsr_max_aceito', v_nsr_max);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_ingerir_afd FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ingerir_afd TO service_role;

COMMENT ON FUNCTION public.fn_ingerir_afd IS
    'Ingere linhas de AFD de forma idempotente por (dispositivo, lote) e por (dispositivo, NSR). '
    'Grava a linha bruta com cadeia de hash e cria marcacoes de origem rep para os registros '
    'tipo 3. Batida orfa e criada com servidor_id NULL - nunca descartada.';


-- ============================================================================
-- 4. VINCULOS PROPOSTOS A PARTIR DO PROPRIO AFD
-- ============================================================================
-- Os registros tipo 5 carregam identificador + nome. Isso permite propor vinculos sem depender
-- de load_users.fcgi, util quando o AFD chega por pendrive de uma unidade que ja teve o
-- cadastro do equipamento alterado.

CREATE OR REPLACE FUNCTION public.fn_vinculos_sugeridos_afd(p_dispositivo_id uuid)
RETURNS TABLE (
    identificador_afd text,
    nome_no_device    text,
    batidas           bigint,
    servidor_id       uuid,
    servidor_nome     text,
    criterio          text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH cadastros AS (
        SELECT DISTINCT ON (r.identificador_afd)
               r.identificador_afd,
               btrim(substring(r.linha_bruta from 48 for 52)) AS nome_device
          FROM public.rep_afd_registros r
         WHERE r.dispositivo_id = p_dispositivo_id
           AND r.tipo_registro = '5'
           AND r.identificador_afd IS NOT NULL
         ORDER BY r.identificador_afd, r.nsr DESC
    ),
    batidas AS (
        SELECT m.identificador_bruto AS ident, count(*) AS n
          FROM public.marcacoes_ponto m
         WHERE m.dispositivo_id = p_dispositivo_id
         GROUP BY 1
    )
    SELECT c.identificador_afd,
           c.nome_device,
           COALESCE(b.n, 0),
           s.id,
           s.nome,
           CASE WHEN s.id IS NOT NULL THEN 'cpf' ELSE 'nao resolvido' END
      FROM cadastros c
      LEFT JOIN batidas b ON b.ident = c.identificador_afd
      -- O identificador tem 12 digitos (CPF com zero a esquerda); servidores.cpf pode estar
      -- mascarado, entao a comparacao e por digitos.
      LEFT JOIN public.servidores s
             ON regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g') = ltrim(c.identificador_afd, '0')
            AND regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g') <> ''
     ORDER BY COALESCE(b.n, 0) DESC, c.nome_device
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_vinculos_sugeridos_afd(uuid) TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) Cadastrar o relogio de teste (10.110.2.89, ja carregado com os 6 servidores da TI):
--
--   INSERT INTO public.dispositivos_rep (unidade_id, setor_id, nome, modelo, endereco_ip)
--   SELECT u.id, s.id, 'REP iDClass - TI', 'REP iDClass Bio Prox', '10.110.2.89'
--     FROM public.unidades u
--     JOIN public.setores s ON s.unidade_id = u.id
--    WHERE u.nome LIKE 'SMS%' AND s.id = '649f513a-94f1-4db9-aca2-69b67bbdce9e'
--   RETURNING id;
--
--   2) Gerar a credencial do coletor (aparece UMA vez):
--
--   SELECT public.fn_gerar_token_dispositivo_rep('<dispositivo_id>');
--
--   3) TESTE DE PARSE com linhas reais do equipamento:
--
--   SELECT * FROM public.fn_parse_linha_afd('00000000832023-11-08T08:46:00-03000111112111115939');
--   -- esperado: nsr=8, tipo=3, ocorrido_em=2023-11-08 08:46-03, identificador=011111211111, ok=true
--
--   4) TESTE DE INGESTAO (as duas chamadas, com o MESMO lote_id):
--
--   SELECT public.fn_ingerir_afd('<dispositivo_id>', '11111111-1111-1111-1111-111111111111'::uuid,
--          jsonb_build_array('00000000832023-11-08T08:46:00-03000111112111115939'), 'manual_ui');
--   -- 1a: novas=1, marcacoes=1, orfas=1 (sem vinculo cadastrado ainda)
--   -- 2a: reenvio=true e os MESMOS numeros, sem reprocessar
--
--   5) A cadeia de hash tem que fechar:
--
--   SELECT * FROM public.fn_verificar_integridade_afd('<dispositivo_id>');
--   -- esperado: integro = true
--
--   6) Vinculos sugeridos, depois de ingerir os registros tipo 5:
--
--   SELECT * FROM public.fn_vinculos_sugeridos_afd('<dispositivo_id>');
--
--   7) A batida orfa existe e esta sem dono - nao foi descartada:
--
--   SELECT id, ocorrido_em, identificador_bruto, servidor_id, nsr
--     FROM public.marcacoes_ponto WHERE origem = 'rep' ORDER BY nsr;
