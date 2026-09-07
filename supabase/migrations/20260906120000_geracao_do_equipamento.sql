-- ============================================================================
-- Geracao do equipamento: trocar o relogio deixa de descartar batida em silencio
-- ============================================================================
-- 06/09/2026. Plano em docs/planos/2026-09-06-troca-de-relogio-e-ciclo-de-vida-do-cadastro-rep.md
--
-- O CASO REAL (CCE / HMM): o REP queimou e foi trocado por um equipamento NOVO, mesmo IP e
-- mesma senha. O AFD do relogio novo recomeca no NSR 1. O SisEscala nao percebeu nada:
--
--   * fn_cursor_afd_dispositivo devolvia 111509 (fim do trecho contiguo do equipamento ANTIGO
--     + 1) contra um relogio cujo maior NSR e' pequeno. get_afd.fcgi devolve NADA, e a
--     sincronizacao e' gravada como "concluida" em TODO ciclo. Sintoma: nenhum.
--
--   * Se a batida chegasse seria PIOR: uq_afd_dispositivo_nsr e uq_marcacao_rep_nsr sao
--     (dispositivo_id, nsr), entao os NSR 1..N do relogio novo colidiriam com os do antigo e
--     o ON CONFLICT ... DO NOTHING os descartaria como duplicados. Sem erro em lugar nenhum.
--
-- A CORRECAO: uma coluna "geracao" que diz QUAL equipamento disse aquele NSR. O par
-- (dispositivo, geracao, nsr) volta a ser unico de verdade, e o cursor conta dentro da
-- geracao vigente - relogio novo faz o cursor voltar a 1 sozinho.
--
-- ⚠️ "nsr" continua sendo EXATAMENTE o que o equipamento disse. A alternativa considerada -
-- um nsr_offset por dispositivo, que evitaria reconstruir os dois indices - foi DESCARTADA:
-- falsificaria um campo do artefato legal. linha_bruta ficaria intacta, mas a coluna nsr
-- passaria a mentir para qualquer auditoria que a leia.
--
-- ⚠️ O SisEscala NAO troca a geracao sozinho. Detectar substituicao e' palpite (o relogio pode
-- so ter tido a memoria lida errado); trocar por engano cria um AFD paralelo que ninguem pediu.
-- Quem troca e' uma pessoa, por fn_registrar_substituicao_dispositivo, e fica registrado.
--
-- ⚠️ ADD COLUMN ... DEFAULT e' barato (PG11+ guarda o default no catalogo, sem reescrever a
-- tabela). O custo real desta migration e' reconstruir os DOIS indices unicos (~2,5M e ~2,4M
-- linhas em 06/09/2026). MEDIR EM HOMOLOGACAO ANTES de aplicar em producao.
--
-- ⚠️ marcacoes_ponto e' INSERT-only. ADD COLUMN e' DDL e nao dispara o trigger de
-- imutabilidade; e como fn_bloquear_alteracao_marcacao compara to_jsonb(NEW) - '<campo>', a
-- coluna nova ja entra coberta pelos TRES ramos existentes (reparse de AFD, fusao de setor,
-- mesclagem de cadastro) sem nenhuma edicao neles. Os tres precisam continuar la.
--
-- ⚠️ ESTE ARQUIVO E' GERADO. Nao edite a mao: rode
--     node scratchpad/gen_geracao_dispositivo.js
-- O gerador copia fn_cursor_afd_dispositivo, fn_registrar_marcacao e fn_ingerir_afd das
-- migrations VIGENTES de cada uma e aborta se qualquer substituicao nao bater na contagem.
-- ============================================================================

-- ============================================================================
-- 1. COLUNAS
-- ============================================================================

ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS geracao_atual smallint NOT NULL DEFAULT 1;

ALTER TABLE public.rep_afd_registros
    ADD COLUMN IF NOT EXISTS geracao smallint NOT NULL DEFAULT 1;

ALTER TABLE public.marcacoes_ponto
    ADD COLUMN IF NOT EXISTS geracao smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.dispositivos_rep.geracao_atual IS
    'Qual equipamento fisico esta neste ponto agora. Comeca em 1 e e incrementada apenas por '
    'fn_registrar_substituicao_dispositivo, nunca automaticamente.';

COMMENT ON COLUMN public.rep_afd_registros.geracao IS
    'Geracao do equipamento que emitiu este NSR. Junto com (dispositivo_id, nsr) forma a chave '
    'unica: dois equipamentos no mesmo ponto emitem NSR 1 cada um, e os dois sao verdadeiros.';

COMMENT ON COLUMN public.marcacoes_ponto.geracao IS
    'Espelha rep_afd_registros.geracao. So tem significado para origem = rep; marcacao de '
    'terminal fica na geracao 1 por DEFAULT.';

-- ============================================================================
-- 2. HISTORICO DE SUBSTITUICAO (append-only)
-- ============================================================================
-- Sem policy de escrita, de proposito: so a RPC SECURITY DEFINER grava. Trocar a geracao muda
-- como todo o AFD passado e' lido - nao pode ser um UPDATE que qualquer autenticado faz pelo
-- PostgREST (armadilha 12).

CREATE TABLE IF NOT EXISTS public.dispositivos_rep_substituicoes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id      uuid NOT NULL REFERENCES public.dispositivos_rep(id) ON DELETE CASCADE,
    geracao_anterior    smallint NOT NULL,
    geracao_nova        smallint NOT NULL,
    -- Fotografia do que a geracao anterior deixou. Depois da troca, esses numeros nao sao mais
    -- deriva'veis de forma obvia na tela, e sao eles que explicam por que o cursor caiu.
    nsr_max_anterior    bigint,
    registros_anteriores bigint,
    motivo              text NOT NULL,
    numero_serie_anterior text,
    numero_serie_novo   text,
    registrado_por_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_substituicao_avanca CHECK (geracao_nova > geracao_anterior),
    CONSTRAINT chk_substituicao_motivo CHECK (length(btrim(motivo)) >= 5)
);

CREATE INDEX IF NOT EXISTS idx_disp_rep_substituicoes_dispositivo
    ON public.dispositivos_rep_substituicoes (dispositivo_id, created_at DESC);

ALTER TABLE public.dispositivos_rep_substituicoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura de substituicoes de dispositivo" ON public.dispositivos_rep_substituicoes;
CREATE POLICY "Leitura de substituicoes de dispositivo"
    ON public.dispositivos_rep_substituicoes FOR SELECT
    TO authenticated
    USING (public.get_my_role() IN ('super_admin', 'admin', 'rh', 'rh_unidade'));

-- ============================================================================
-- 3. UNICIDADE POR (dispositivo, geracao, nsr)
-- ============================================================================
-- Cria o novo ANTES de derrubar o velho. Dentro da transacao da migration nao ha janela sem
-- unicidade em momento nenhum; a ordem so garante que, se o novo falhar, o velho continua la.

ALTER TABLE public.rep_afd_registros
    DROP CONSTRAINT IF EXISTS uq_afd_dispositivo_geracao_nsr;
ALTER TABLE public.rep_afd_registros
    ADD CONSTRAINT uq_afd_dispositivo_geracao_nsr UNIQUE (dispositivo_id, geracao, nsr);
ALTER TABLE public.rep_afd_registros
    DROP CONSTRAINT IF EXISTS uq_afd_dispositivo_nsr;

DROP INDEX IF EXISTS public.uq_marcacao_rep_geracao_nsr;
CREATE UNIQUE INDEX uq_marcacao_rep_geracao_nsr
    ON public.marcacoes_ponto (dispositivo_id, geracao, nsr) WHERE origem = 'rep';
DROP INDEX IF EXISTS public.uq_marcacao_rep_nsr;

-- Nenhum indice a mais. A propria constraint uq_afd_dispositivo_geracao_nsr ja e um btree
-- (dispositivo_id, geracao, nsr) e serve as duas consultas quentes - o LEAD do cursor e o
-- "ultimo elo da cadeia" de fn_ingerir_afd, que le em ordem DESC (btree varre para tras sem
-- custo). Um indice DESC dedicado seria 2,5M linhas construidas para nada.

-- ============================================================================
-- 4. fn_cursor_afd_dispositivo - conta DENTRO da geracao vigente
-- ============================================================================
-- Copiada de 20260817160000_fix_rep_afd_cursor_min_nsr.sql. A unica mudanca e' o filtro de geracao na
-- subconsulta: sem ele, o trecho contiguo do equipamento ANTIGO define o cursor do NOVO.

CREATE OR REPLACE FUNCTION public.fn_cursor_afd_dispositivo(p_dispositivo_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    -- Menor NSR cujo sucessor NAO existe = fim do primeiro trecho contiguo a partir do MENOR NSR
    -- que este dispositivo tem. Sem registro nenhum, COALESCE cai para 1 e pede o arquivo todo.
    SELECT COALESCE((
        SELECT MIN(t.nsr) + 1
          FROM (SELECT r.nsr, LEAD(r.nsr) OVER (ORDER BY r.nsr) AS prox
                  FROM public.rep_afd_registros r
                 WHERE r.dispositivo_id = p_dispositivo_id
                   AND r.geracao = (SELECT d.geracao_atual
                                      FROM public.dispositivos_rep d
                                     WHERE d.id = p_dispositivo_id)) t
         WHERE t.prox IS NULL OR t.prox <> t.nsr + 1), 1::bigint);
$fn$;

REVOKE ALL ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) IS
    'NSR a pedir ao equipamento: fim do primeiro trecho contiguo DENTRO da geracao vigente, '
    'mais 1. Equipamento substituido (geracao nova, zero registros) devolve 1 e o AFD inteiro '
    'do relogio novo entra sem colidir com o do antigo.';

-- ============================================================================
-- 5. fn_registrar_marcacao - deriva a geracao do dispositivo
-- ============================================================================
-- Copiada de 20260808070000_sync_marcacoes_from_escala_diaria.sql.
-- Nao ganhou parametro de proposito: assinatura nova seria objeto NOVO (armadilha 41), exigiria
-- DROP da de 16 argumentos e 14 migrations a chamam por posicao. Derivar de dentro tambem torna
-- impossivel um chamador novo esquecer de passar a geracao.

CREATE OR REPLACE FUNCTION public.fn_registrar_marcacao(
    p_servidor_id         uuid,
    p_origem              public.marcacao_origem,
    p_ocorrido_em         timestamptz,
    p_unidade_id          uuid    DEFAULT NULL,
    p_setor_id            uuid    DEFAULT NULL,
    p_coordenador_id      uuid    DEFAULT NULL,
    p_registrado_por_id   uuid    DEFAULT NULL,
    p_justificativa       text    DEFAULT NULL,
    p_sintetica           boolean DEFAULT NULL,
    p_retroativa          boolean DEFAULT false,
    p_dispositivo_id      uuid    DEFAULT NULL,
    p_nsr                 bigint  DEFAULT NULL,
    p_afd_registro_id     uuid    DEFAULT NULL,
    p_identificador_bruto text    DEFAULT NULL,
    p_via_pendrive        boolean DEFAULT false,
    p_observacao          text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fnreg$
DECLARE
    v_id      uuid;
    v_geracao smallint;
BEGIN
    IF p_ocorrido_em IS NULL OR p_origem IS NULL THEN
        RETURN NULL;
    END IF;

    -- Geracao do equipamento que produziu esta marcacao. Marcacao sem dispositivo
    -- (terminal, ajuste manual) fica na geracao 1, que e o DEFAULT da coluna: o campo so
    -- tem significado para origem `rep`, e e la que a unicidade por NSR o usa.
    IF p_dispositivo_id IS NOT NULL THEN
        SELECT d.geracao_atual INTO v_geracao
          FROM public.dispositivos_rep d WHERE d.id = p_dispositivo_id;
    END IF;

    INSERT INTO public.marcacoes_ponto (
        servidor_id, origem, ocorrido_em,
        unidade_id, setor_id,
        coordenador_id, registrado_por_id, justificativa,
        -- Segundos exatamente zero = horario derivado da jornada, nao batido. Mesma heuristica
        -- do backfill (CLAUDE.md armadilha 5): batida real de terminal tem segundos e
        -- microssegundos; validacao manual e fn_salvar_saida_bloco geram :00:00.
        sintetica, retroativa,
        dispositivo_id, geracao, nsr, afd_registro_id, identificador_bruto, via_pendrive,
        observacao
    ) VALUES (
        p_servidor_id, p_origem, p_ocorrido_em,
        p_unidade_id, p_setor_id,
        p_coordenador_id, p_registrado_por_id, p_justificativa,
        COALESCE(p_sintetica, date_part('second', p_ocorrido_em) = 0), p_retroativa,
        p_dispositivo_id, COALESCE(v_geracao, 1), p_nsr, p_afd_registro_id, p_identificador_bruto, p_via_pendrive,
        p_observacao
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$fnreg$;

COMMENT ON FUNCTION public.fn_registrar_marcacao IS
    'Ponto unico de insercao em marcacoes_ponto. Deriva sintetica dos segundos zerados e a '
    'geracao do dispositivo quando nao informada. marcacoes_ponto e INSERT-only: nao existe '
    'funcao de alteracao por design.';

REVOKE ALL ON FUNCTION public.fn_registrar_marcacao FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_marcacao TO service_role;

-- ============================================================================
-- 6. fn_ingerir_afd - grava a geracao e encadeia o hash dentro dela
-- ============================================================================
-- Copiada de 20260822210000_ponto_valido_desde_por_dispositivo.sql.

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

    SELECT unidade_id, geracao_atual INTO v_unidade_id, v_geracao
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
-- Assinatura conferida contra a migration vigente, nao chutada.
REVOKE ALL ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    TO service_role;

-- ============================================================================
-- 7. fn_registrar_substituicao_dispositivo - a troca, feita por uma pessoa
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_registrar_substituicao_dispositivo(
    p_dispositivo_id  uuid,
    p_motivo          text,
    p_numero_serie_novo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fnsub$
DECLARE
    v_disp        public.dispositivos_rep%ROWTYPE;
    v_nsr_max     bigint;
    v_registros   bigint;
    v_nova        smallint;
    v_papel       text;
BEGIN
    -- Guard de papel. Trocar a geracao muda como todo o AFD daquele ponto e' lido dali em
    -- diante; nao e' operacao de coordenador. auth.uid() nulo = service_role (script de
    -- manutencao), que passa - o mesmo criterio de fn_blocos_previstos_dia.
    IF auth.uid() IS NOT NULL THEN
        v_papel := public.get_my_role();
        IF v_papel IS NULL OR v_papel NOT IN ('super_admin', 'admin') THEN
            RAISE EXCEPTION 'Apenas Administrador pode registrar substituicao de equipamento.';
        END IF;
    END IF;

    IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
        RAISE EXCEPTION 'Informe o motivo da substituicao (minimo 5 caracteres).';
    END IF;

    SELECT * INTO v_disp FROM public.dispositivos_rep WHERE id = p_dispositivo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispositivo % nao cadastrado.', p_dispositivo_id;
    END IF;

    SELECT COALESCE(MAX(r.nsr), 0), COUNT(*)
      INTO v_nsr_max, v_registros
      FROM public.rep_afd_registros r
     WHERE r.dispositivo_id = p_dispositivo_id
       AND r.geracao = v_disp.geracao_atual;

    v_nova := v_disp.geracao_atual + 1;

    INSERT INTO public.dispositivos_rep_substituicoes (
        dispositivo_id, geracao_anterior, geracao_nova,
        nsr_max_anterior, registros_anteriores, motivo,
        numero_serie_anterior, numero_serie_novo, registrado_por_id)
    VALUES (
        p_dispositivo_id, v_disp.geracao_atual, v_nova,
        v_nsr_max, v_registros, btrim(p_motivo),
        v_disp.numero_serie, p_numero_serie_novo, auth.uid());

    UPDATE public.dispositivos_rep
       SET geracao_atual = v_nova,
           -- ultimo_nsr e' denormalizado e so' informativo. Mante-lo com o maximo da geracao
           -- anterior faria a tela afirmar que o equipamento novo ja coletou 111 mil linhas.
           ultimo_nsr    = NULL,
           numero_serie  = COALESCE(p_numero_serie_novo, numero_serie),
           updated_at    = now()
     WHERE id = p_dispositivo_id;

    RETURN jsonb_build_object(
        'sucesso', true,
        'geracao_anterior', v_disp.geracao_atual,
        'geracao_nova', v_nova,
        'nsr_max_anterior', v_nsr_max,
        'registros_anteriores', v_registros,
        'cursor_novo', public.fn_cursor_afd_dispositivo(p_dispositivo_id));
END;
$fnsub$;

REVOKE ALL ON FUNCTION public.fn_registrar_substituicao_dispositivo(uuid, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_substituicao_dispositivo(uuid, text, text)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_registrar_substituicao_dispositivo(uuid, text, text) IS
    'Registra que o equipamento fisico daquele ponto foi trocado: incrementa a geracao, guarda '
    'o que a anterior deixou e zera o ultimo_nsr denormalizado. O AFD antigo NAO e apagado - '
    'ele continua sendo a prova daquele periodo, apenas noutra geracao.';

-- ============================================================================
-- 8. CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 8.1 As colunas e a unicidade nova existem, e a antiga saiu:
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.rep_afd_registros'::regclass AND contype = 'u';
--   -- esperado: uq_afd_dispositivo_geracao_nsr (e NAO uq_afd_dispositivo_nsr)
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'marcacoes_ponto' AND indexname LIKE 'uq_marcacao_rep%';
--   -- esperado: uq_marcacao_rep_geracao_nsr apenas
--
-- 8.2 Nada mudou de valor para quem nao trocou de relogio (toda linha existente vira geracao 1):
--
--   SELECT geracao, count(*) FROM public.rep_afd_registros GROUP BY 1;
--   SELECT geracao, count(*) FROM public.marcacoes_ponto WHERE origem = 'rep' GROUP BY 1;
--   -- esperado: uma unica linha, geracao = 1, com as contagens de antes
--
-- 8.3 O cursor de cada dispositivo continua o mesmo de antes da migration (nenhum saltou):
--
--   SELECT d.nome, d.geracao_atual, d.ultimo_nsr,
--          public.fn_cursor_afd_dispositivo(d.id) AS cursor
--     FROM public.dispositivos_rep d WHERE d.ativo ORDER BY d.nome;
--
-- 8.4 SO ENTAO, para o CCE-01 (o relogio que foi trocado):
--
--   SELECT public.fn_registrar_substituicao_dispositivo(
--            '<uuid do CCE-01>',
--            'Equipamento queimou e foi substituido em 06/09/2026; AFD do novo recomeca no NSR 1.');
--   -- esperado: cursor_novo = 1
--
-- 8.5 Depois do proximo ciclo do coletor, o AFD do relogio novo tem que ter entrado:
--
--   SELECT geracao, count(*), min(nsr), max(nsr)
--     FROM public.rep_afd_registros WHERE dispositivo_id = '<uuid do CCE-01>' GROUP BY 1;
--   -- esperado: duas linhas - a geracao 1 intacta, e a geracao 2 comecando em 1
