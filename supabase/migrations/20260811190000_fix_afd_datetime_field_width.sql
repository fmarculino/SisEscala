-- Migration: Corrige o campo de data/hora do AFD (12 digitos, nao 24 - ISO 8601)
-- Data: 2026-08-11
--
-- MOTIVACAO
--   fn_parse_linha_afd (20260808080000) assume que o campo de data/hora de uma marcacao
--   (tipo 3) e o exemplo ilustrativo do plano ("2023-11-08T08:46:00-0300", 24 caracteres) sao
--   os bytes reais. Nao sao: confirmado em 11/08/2026 buscando o AFD de verdade do equipamento
--   (10.110.2.89) pelo coletor-rep. O campo real tem 12 digitos, sem separador nenhum:
--   DDMMYYYYHHMM. O exemplo do plano era uma reformatacao para leitura humana na documentacao.
--
--   Consequencia em producao: o cast direto `v_dt_txt::timestamptz` falhava (capturado pelo
--   EXCEPTION ja existente) para TODA linha tipo 3, ocorrido_em ficava NULL, e
--   fn_ingerir_afd nunca criava marcacao nenhuma - mesmo com a linha correta no banco.
--   Uma sincronizacao de teste em 11/08/2026 trouxe 17.448 registros do historico completo do
--   equipamento (o coletor ainda pede sempre a partir do NSR 1) e ZERO marcacoes.
--
-- POR QUE ISSO NAO CORROMPEU NADA
--   rep_afd_registros.linha_bruta e o artefato legal, gravado exatamente como veio do
--   equipamento - e estava certo o tempo todo. O bug era so na extracao das colunas
--   DERIVADAS (ocorrido_em, identificador_afd), e parse_versao existe exatamente para
--   permitir reprocessar essas colunas sem jamais tocar em linha_bruta. Nada foi apagado,
--   nada foi fabricado: o modo de falha era "nao extrai nada", nunca "extrai errado".
--
-- CONFIRMACAO CRUZADA
--   O NSR 8 (identificador 011111211111, CRC 5939) e literalmente o mesmo evento do exemplo
--   ilustrativo do plano - confirma que so a formatacao mudou, nao o dado. Ver CONFERENCIA.
--
-- O QUE MUDA NOS OFFSETS
--   data/hora: posicao 11, 12 caracteres (era 24)
--   identificador tipo 3: posicao 23 (era 35) - desloca 12 posicoes para tras
--   identificador tipo 5: posicao 24 (era 36) - mesma logica, +1 pelo campo de operacao I/A/E
--
-- REPARSE + BACKFILL
--   fn_reparse_afd_dispositivo(dispositivo_id) reprocessa rep_afd_registros existente com a
--   funcao corrigida (sob o guard sisescala.reparse_afd, a unica excecao que o trigger de
--   imutabilidade permite) e cria as marcacoes de tipo 3 que ficaram faltando - idempotente,
--   seguro rodar de novo. Executado ao final desta migration para todo dispositivo_rep
--   existente, sem hardcode de UUID especifico (seguro rodar em qualquer ambiente,
--   inclusive homologacao sem nenhum dispositivo cadastrado).


-- ============================================================================
-- 1. FUNCAO CORRIGIDA
-- ============================================================================

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

    -- Data/hora real: DDMMYYYYHHMM, 12 digitos sem separador. Os tipos 1 (cabecalho) e 9
    -- (trailer) nao carregam data/hora nesta posicao.
    IF v_tipo IN ('2', '3', '4', '5', '6', '7', '8') AND length(p_linha) >= 22 THEN
        v_dt_txt := substring(p_linha from 11 for 12);
        BEGIN
            -- to_timestamp(...) devolve timestamptz no fuso da SESSAO, nao no do equipamento;
            -- o cast para timestamp descarta esse fuso presumido, e o AT TIME ZONE final
            -- reinterpreta o horario de parede como sendo America/Sao_Paulo de verdade - o
            -- mesmo padrao que fn_confirmar_presenca usa na direcao inversa para v_now_local.
            -- Fixo (nao le configuracoes_globais.timezone): a funcao e IMMUTABLE, e o Brasil
            -- nao tem mais horario de verao desde 2019, entao o offset e estavel.
            ocorrido_em := (to_timestamp(v_dt_txt, 'DDMMYYYYHH24MI')::timestamp AT TIME ZONE 'America/Sao_Paulo');
        EXCEPTION WHEN OTHERS THEN
            erro := 'data/hora invalida: ' || v_dt_txt;
        END;
    END IF;

    -- Identificador do trabalhador: CPF com zero a esquerda (12 digitos). Desloca 12 posicoes
    -- para tras em relacao a v1 (35->23, 36->24) pela mesma razao: o campo de data/hora real
    -- tem 12 caracteres, nao 24.
    IF v_tipo = '3' AND length(p_linha) >= 34 THEN
        identificador := substring(p_linha from 23 for 12);
    ELSIF v_tipo = '5' AND length(p_linha) >= 35 THEN
        -- No tipo 5 ha um caractere de operacao (I/A/E) antes do identificador.
        identificador := substring(p_linha from 24 for 12);
    END IF;

    ok := (erro IS NULL);
    RETURN NEXT;
END;
$fn$;

COMMENT ON FUNCTION public.fn_parse_linha_afd(text) IS
    'v2 (11/08/2026): campo de data/hora tem 12 digitos (DDMMYYYYHHMM), nao 24 (ISO 8601) - '
    'corrigido apos confirmar contra o arquivo real do equipamento. parse_versao existe '
    'exatamente para isto: reparsear rep_afd_registros sem tocar em linha_bruta.';

GRANT EXECUTE ON FUNCTION public.fn_parse_linha_afd(text) TO authenticated, service_role;


-- ============================================================================
-- 2. REPARSE + BACKFILL DE MARCACOES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_reparse_afd_dispositivo(p_dispositivo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_unidade_id            uuid;
    v_setor_id              uuid;
    v_registros_atualizados integer := 0;
    v_marcacoes_criadas     integer := 0;
    v_servidor_id           uuid;
    r                       RECORD;
    v_parsed                RECORD;
BEGIN
    PERFORM set_config('sisescala.reparse_afd', 'on', true);

    SELECT unidade_id, setor_id INTO v_unidade_id, v_setor_id
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;

    FOR r IN
        SELECT a.id, a.nsr, a.linha_bruta
          FROM public.rep_afd_registros a
         WHERE a.dispositivo_id = p_dispositivo_id
         ORDER BY a.nsr
    LOOP
        SELECT * INTO v_parsed FROM public.fn_parse_linha_afd(r.linha_bruta);

        UPDATE public.rep_afd_registros
           SET ocorrido_em       = v_parsed.ocorrido_em,
               identificador_afd = v_parsed.identificador,
               parse_versao      = 2,
               parse_ok          = v_parsed.ok,
               parse_erro        = v_parsed.erro
         WHERE id = r.id;
        v_registros_atualizados := v_registros_atualizados + 1;

        -- So cria marcacao para tipo 3 (marcacao real) com data/hora valida, e so se ainda nao
        -- existir uma para este (dispositivo_id, nsr) - idempotente, seguro rodar de novo.
        IF v_parsed.tipo = '3' AND v_parsed.ocorrido_em IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM public.marcacoes_ponto m
                WHERE m.dispositivo_id = p_dispositivo_id AND m.nsr = r.nsr
           )
        THEN
            -- Mesma resolucao de vinculo que fn_ingerir_afd usa: vigente NA DATA da batida,
            -- nao o vinculo atual - nao reescreve autoria de batidas antigas.
            SELECT v.servidor_id INTO v_servidor_id
              FROM public.rep_vinculos_servidor v
             WHERE v.dispositivo_id = p_dispositivo_id
               AND v.identificador_afd = v_parsed.identificador
               AND v.vigente_de <= v_parsed.ocorrido_em
               AND (v.vigente_ate IS NULL OR v.vigente_ate > v_parsed.ocorrido_em)
             ORDER BY v.vigente_de DESC
             LIMIT 1;

            PERFORM public.fn_registrar_marcacao(
                v_servidor_id, 'rep'::public.marcacao_origem, v_parsed.ocorrido_em,
                v_unidade_id, v_setor_id, NULL, NULL, NULL,
                false, true, p_dispositivo_id, r.nsr, r.id, v_parsed.identificador, false,
                'Reparse: marcacao recuperada apos correcao de fn_parse_linha_afd (v2, 11/08/2026)'
            );
            v_marcacoes_criadas := v_marcacoes_criadas + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'dispositivo_id', p_dispositivo_id,
        'registros_atualizados', v_registros_atualizados,
        'marcacoes_criadas', v_marcacoes_criadas
    );
END;
$fn$;

COMMENT ON FUNCTION public.fn_reparse_afd_dispositivo(uuid) IS
    'Reprocessa rep_afd_registros de um dispositivo com a versao vigente de fn_parse_linha_afd '
    '(sem tocar linha_bruta) e cria as marcacoes de tipo 3 que ficaram faltando. Idempotente.';

REVOKE ALL ON FUNCTION public.fn_reparse_afd_dispositivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reparse_afd_dispositivo(uuid) TO service_role;


-- ============================================================================
-- 3. APLICA O REPARSE A TODO DISPOSITIVO EXISTENTE
-- ============================================================================
-- Sem hardcode de UUID: seguro rodar em qualquer ambiente, inclusive homologacao sem nenhum
-- dispositivo cadastrado (o loop simplesmente nao executa nada).

DO $$
DECLARE
    v_dispositivo RECORD;
    v_resultado   jsonb;
BEGIN
    FOR v_dispositivo IN SELECT id FROM public.dispositivos_rep LOOP
        v_resultado := public.fn_reparse_afd_dispositivo(v_dispositivo.id);
        RAISE NOTICE 'Reparse do dispositivo %: %', v_dispositivo.id, v_resultado;
    END LOOP;
END
$$;


-- CONFERENCIA APOS APLICAR
--
--   1) O parser corrigido bate com o exemplo do plano, usando o dado REAL (sem hifen/dois
--      pontos), que e o NSR 8 do dispositivo de teste (10.110.2.89):
--
--   SELECT * FROM public.fn_parse_linha_afd('00000000830811202308460111112111115939');
--   -- esperado: nsr=8, tipo='3', ocorrido_em='2023-11-08 08:46:00-03',
--   --           identificador='011111211111', ok=true, erro=NULL
--
--   2) Tipo 5 (cadastro) tambem bate - exemplo real, NSR 10, "JOSUE IVAN MELO COSTA":
--
--   SELECT tipo, ocorrido_em, identificador FROM public.fn_parse_linha_afd(
--     '0000000105081120230846I018221461070JOSUE IVAN MELO COSTA                               1000123456789100a16');
--   -- esperado: tipo='5', ocorrido_em='2023-11-08 08:46:00-03', identificador='018221461070'
--
--   3) O backfill rodou e criou marcacoes onde antes era zero:
--
--   SELECT count(*) FROM public.marcacoes_ponto WHERE origem = 'rep';
--   -- esperado: maior que zero (antes desta migration, era 0 mesmo com milhares de
--   --           rep_afd_registros ja ingeridos)
--
--   4) linha_bruta continua intocada (a correcao nao mexeu no artefato legal):
--
--   SELECT count(*) FROM public.rep_afd_registros WHERE parse_versao = 2;
--   -- esperado: igual ao total de registros do dispositivo reparsado
--   SELECT linha_bruta FROM public.rep_afd_registros WHERE nsr = 8 LIMIT 1;
--   -- esperado: '00000000830811202308460111112111115939' - identico ao que entrou
