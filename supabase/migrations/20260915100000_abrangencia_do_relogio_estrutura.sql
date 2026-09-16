-- Migration: abrangencia do relogio REP - ESTRUTURA (parte 1 de 3)
-- Data: 2026-09-15
--
-- Gerada por scratchpad/gen_abrangencia_estrutura.js a partir de
-- 20260906120000_geracao_do_equipamento.sql (fn_ingerir_afd copiada, nao redigitada).
-- Plano: docs/planos/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md
--
-- MOTIVACAO
--   dispositivos_rep.unidade_id responde DE QUEM O RELOGIO E. Falta responder QUEM ELE ATENDE.
--   Medido em producao em 15/09/2026: os 4 polos do CAF (unidade SMS) funcionam fisicamente
--   dentro de OUTRAS unidades - 16 pessoas, zero batidas. O POLO MORADA NOVA fica dentro da USF
--   Carlos Barreto, cujo relogio tem 1 pessoa no universo e esta ocioso.
--
-- ESTA MIGRATION E INERTE. Ela nao muda o comportamento de nada: cria a coluna que separa
--   "toda a unidade" de "lista de setores", cria o predicado unico de abrangencia e conserta a
--   derivacao do setor da marcacao. Quem passa a USAR o predicado sao as migrations seguintes.
--
-- POR QUE A COLUNA E OBRIGATORIA (e vem ANTES de qualquer vinculo cruzado)
--   Hoje "0 linhas em dispositivos_rep_setores" = "toda a unidade". Dar ao relogio da USF CB a
--   PRIMEIRA linha (o setor do polo, de outra unidade) faria a USF Carlos Barreto inteira
--   PERDER o relogio, em silencio. A coluna e o que torna as duas coisas independentes.
--
-- POR QUE fn_ingerir_afd ENTRA JUNTO
--   Ela deriva marcacoes_ponto.setor_id quando o dispositivo tem exatamente 1 setor vinculado.
--   Sem o conserto, o relogio do CB com 1 linha (o polo) carimbaria setor_id = POLO MORADA NOVA
--   - um setor de outra unidade - em TODA batida dele, enquanto unidade_id continua sendo a USF.
--   Marcacao internamente incoerente, sem erro nenhum. Hoje o conserto e inerte: NENHUM relogio
--   do parque tem exatamente 1 setor vinculado (medido: 0, 5, 6, 6, 11, 11, 31, 160, 160, 160,
--   161 - e 24 relogios com 0).
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, backfill condicionado, CREATE OR REPLACE.
-- Seguro reaplicar nos dois ambientes (armadilha 3).


-- ============================================================================
-- 1. A COLUNA QUE SEPARA "TODA A UNIDADE" DE "LISTA DE SETORES"
-- ============================================================================

ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS atende_toda_unidade boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.dispositivos_rep.atende_toda_unidade IS
    'true = o relogio atende TODOS os setores da unidade dele (dispositivos_rep.unidade_id). '
    'Independente disso, dispositivos_rep_setores pode somar setores especificos - inclusive de '
    'OUTRA unidade, para o caso do setor que funciona fisicamente dentro de outro predio. '
    'Ate 15/09/2026 isto era implicito ("0 linhas em dispositivos_rep_setores"), o que impedia '
    'um relogio de atender a unidade inteira E um setor de fora ao mesmo tempo. '
    'Ver docs/planos/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md.';

-- BACKFILL: reproduz exatamente a semantica anterior. Roda uma vez - a condicao no WHERE
-- impede que uma reaplicacao sobrescreva uma escolha feita depois pela tela.
DO $backfill$
DECLARE
    v_ajustados integer;
BEGIN
    IF EXISTS (SELECT 1 FROM public.dispositivos_rep WHERE NOT atende_toda_unidade) THEN
        RAISE NOTICE 'backfill: ja existe relogio com atende_toda_unidade = false - nada a fazer.';
        RETURN;
    END IF;

    UPDATE public.dispositivos_rep d
       SET atende_toda_unidade = false
     WHERE EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds
                    WHERE ds.dispositivo_id = d.id);
    GET DIAGNOSTICS v_ajustados = ROW_COUNT;
    RAISE NOTICE 'backfill: % relogio(s) com lista de setores marcados como NAO "toda a unidade".', v_ajustados;
END;
$backfill$;


-- ============================================================================
-- 2. O PREDICADO UNICO DE ABRANGENCIA
-- ============================================================================
-- FONTE UNICA. Toda pergunta "este relogio atende esta pessoa/escala?" passa a sair daqui.
-- Replicar a regra em cada funcao e o que faz tela e banco divergirem (armadilha 62).
--
-- p_setor_id   pode ser NULL: servidor sem setor cadastrado. Nesse caso so o ramo da unidade
--              dona responde - que e exatamente o comportamento de hoje (o predicado antigo
--              "NOT EXISTS(lista)" nao olhava o setor da pessoa).
-- p_unidade_id e a unidade DA PESSOA/DA ESCALA, nao a do relogio.

CREATE OR REPLACE FUNCTION public.fn_dispositivo_atende_setor(
    p_dispositivo_id uuid,
    p_setor_id       uuid,
    p_unidade_id     uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM public.dispositivos_rep d
         WHERE d.id = p_dispositivo_id
           AND d.atende_toda_unidade
           AND d.unidade_id = p_unidade_id
    ) OR EXISTS (
        SELECT 1 FROM public.dispositivos_rep_setores ds
         WHERE ds.dispositivo_id = p_dispositivo_id
           AND ds.setor_id = p_setor_id
    );
$fn$;

COMMENT ON FUNCTION public.fn_dispositivo_atende_setor(uuid, uuid, uuid) IS
    'Fonte unica da abrangencia de um relogio REP: atende a unidade dona inteira (quando '
    'atende_toda_unidade) mais os setores listados em dispositivos_rep_setores, que podem ser '
    'de OUTRA unidade. p_unidade_id e a unidade da pessoa/escala.';

-- Armadilha 24: CREATE FUNCTION ja concede EXECUTE a PUBLIC. Sem o REVOKE, anon executa.
REVOKE ALL ON FUNCTION public.fn_dispositivo_atende_setor(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dispositivo_atende_setor(uuid, uuid, uuid)
    TO authenticated, service_role;


-- ============================================================================
-- 3. fn_ingerir_afd: o setor da marcacao deixa de ser chutado
-- ============================================================================
-- Corpo copiado de 20260906120000. Mudam 3 trechos, conferidos por contagem pelo gerador:
-- a declaracao de v_toda_uni, a leitura da coluna nova, e o IF da derivacao do setor.
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
-- 4. CONFERENCIA (roda junto, aborta a migration inteira se algo divergir)
-- ============================================================================
-- Armadilha 42: conferencia que so checa se a funcao EXISTE nao serve - tem que EXECUTAR.
-- Confere os DOIS sentidos: a abrangencia nova reproduz a antiga em todo par que existe hoje
-- (prova de inercia), E o predicado nao virou "true para tudo".

DO $conf$
DECLARE
    v_div        integer;
    v_disp       record;
    v_setor      record;
    v_ok         boolean;
    v_esperado   boolean;
    v_pares      integer := 0;
    v_verdade    integer := 0;
    v_um_setor   integer;
BEGIN
    -- 4.1 A coluna reproduz a semantica antiga em TODOS os relogios.
    SELECT count(*) INTO v_div
      FROM public.dispositivos_rep d
     WHERE d.atende_toda_unidade
       <> NOT EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds
                       WHERE ds.dispositivo_id = d.id);
    IF v_div > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % relogio(s) com atende_toda_unidade divergindo do backfill.', v_div;
    END IF;
    RAISE NOTICE 'ok  4.1 backfill coerente com a semantica anterior em todos os relogios';

    -- 4.2 O PREDICADO NOVO devolve o MESMO que a regra antiga, par a par, EXECUTANDO.
    --     Regra antiga: unidade da pessoa = unidade do relogio
    --                   AND (relogio sem lista OR setor da pessoa na lista)
    FOR v_disp IN SELECT id, unidade_id FROM public.dispositivos_rep LOOP
        FOR v_setor IN
            SELECT s.id AS setor_id, s.unidade_id
              FROM public.setores s
             WHERE s.unidade_id = v_disp.unidade_id
             UNION ALL
            SELECT NULL::uuid, v_disp.unidade_id          -- servidor sem setor
             UNION ALL
            -- O SENTIDO NOVO: setor de OUTRA unidade tem que continuar dando FALSE enquanto
            -- ninguem o vinculou. Sem estas linhas a conferencia so exercita o caso antigo.
            SELECT s.id, s.unidade_id
              FROM public.setores s
             WHERE s.unidade_id <> v_disp.unidade_id
             LIMIT 5
        LOOP
            v_ok := public.fn_dispositivo_atende_setor(v_disp.id, v_setor.setor_id, v_setor.unidade_id);
            v_esperado := (v_setor.unidade_id = v_disp.unidade_id)
                          AND (NOT EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds
                                            WHERE ds.dispositivo_id = v_disp.id)
                               OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds
                                           WHERE ds.dispositivo_id = v_disp.id
                                             AND ds.setor_id = v_setor.setor_id));
            v_pares := v_pares + 1;
            IF v_ok THEN v_verdade := v_verdade + 1; END IF;
            IF v_ok <> v_esperado THEN
                RAISE EXCEPTION 'ABORTADO: abrangencia mudou para dispositivo % / setor % (novo=%, antigo=%).',
                    v_disp.id, coalesce(v_setor.setor_id::text, '(sem setor)'), v_ok, v_esperado;
            END IF;
        END LOOP;
    END LOOP;
    RAISE NOTICE 'ok  4.2 predicado identico a regra antiga em % pares (dispositivo, setor), setor de fora incluido', v_pares;

    -- 4.3 O outro sentido: o predicado NAO pode ter virado "sim para tudo".
    -- v_pares > 0 e obrigatorio: num banco sem relogio cadastrado (homologacao recem-criada)
    -- 0 = 0 abortaria a migration sem haver nada de errado.
    IF v_pares > 0 AND v_verdade = v_pares THEN
        RAISE EXCEPTION 'ABORTADO: o predicado respondeu VERDADEIRO em todos os % pares - nao esta restringindo nada.', v_pares;
    END IF;
    RAISE NOTICE 'ok  4.3 predicado restringe: % de % pares verdadeiros', v_verdade, v_pares;

    -- 4.4 Setor de OUTRA unidade ainda nao e atendido por ninguem (nada foi vinculado aqui).
    SELECT count(*) INTO v_div
      FROM public.dispositivos_rep_setores ds
      JOIN public.dispositivos_rep d ON d.id = ds.dispositivo_id
      JOIN public.setores s          ON s.id = ds.setor_id
     WHERE s.unidade_id <> d.unidade_id;
    RAISE NOTICE 'ok  4.4 vinculos para setor de outra unidade: % (esperado 0 nesta migration)', v_div;

    -- 4.5 A mudanca de fn_ingerir_afd e inerte hoje: nenhum relogio tem exatamente 1 setor.
    SELECT count(*) INTO v_um_setor
      FROM (SELECT ds.dispositivo_id FROM public.dispositivos_rep_setores ds
             GROUP BY ds.dispositivo_id HAVING count(*) = 1) x;
    IF v_um_setor > 0 THEN
        RAISE NOTICE 'ATENCAO: % relogio(s) com exatamente 1 setor - confira o setor_id das marcacoes deles.', v_um_setor;
    ELSE
        RAISE NOTICE 'ok  4.5 nenhum relogio com exatamente 1 setor: o conserto de fn_ingerir_afd e inerte';
    END IF;

    -- 4.6 anon nao executa o predicado novo.
    IF has_function_privilege('anon', 'public.fn_dispositivo_atende_setor(uuid, uuid, uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon continua podendo executar fn_dispositivo_atende_setor.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_dispositivo_atende_setor(uuid, uuid, uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated PERDEU execute em fn_dispositivo_atende_setor.';
    END IF;
    RAISE NOTICE 'ok  4.6 privilegios: anon fora, authenticated dentro';
END;
$conf$;
