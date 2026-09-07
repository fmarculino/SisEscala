-- ============================================================================
-- Correcao: fn_registrar_substituicao_dispositivo violava NOT NULL em ultimo_nsr
-- ============================================================================
-- 06/09/2026, horas depois de 20260906120000. Pego na PRIMEIRA execucao real em producao:
--
--   ERROR: 23502: null value in column "ultimo_nsr" of relation "dispositivos_rep"
--          violates not-null constraint
--
-- A intencao estava certa: depois de trocar o equipamento, o ultimo_nsr denormalizado nao pode
-- continuar com o maximo da geracao ANTERIOR - a tela afirmaria que o aparelho novo ja coletou
-- 111 mil linhas. O valor e' que estava errado. A coluna e' `bigint NOT NULL DEFAULT 0` desde
-- 20260808000000: "nada ainda" nesta tabela sempre foi ZERO.
--
-- ⚠️ ARMADILHA 1, na forma mais pura: plpgsql resolve coluna e restricao so na EXECUCAO do
-- statement. CREATE OR REPLACE FUNCTION aceitou a funcao sem reclamar, tsc/build/lint nao veem
-- nada, e o portao de texto nao tem como saber que a coluna e NOT NULL. Antes de escrever um
-- valor numa coluna, LEIA A DEFINICAO DELA:
--     grep -rn "ultimo_nsr" supabase/migrations/*.sql | grep "NOT NULL"
--
-- ✅ NENHUM DADO FICOU PELA METADE. A chamada e' um statement unico, entao o INSERT no historico
-- e o UPDATE da geracao voltaram atras junto com o erro. O CCE-01 continua na geracao 1 e com o
-- AFD intacto - a substituicao simplesmente nao aconteceu ainda.
--
-- ⚠️ 20260906120000 NAO foi regerada. Ela ja rodou em producao, e reescrever arquivo ja aplicado
-- apaga o registro do que de fato foi executado. O corpo abaixo e' COPIADO de la por
-- scratchpad/gen_fix_ultimo_nsr_substituicao.js, com uma substituicao contada.
--
-- ⚠️ ESTE ARQUIVO E' GERADO. Nao edite a mao: rode
--     node scratchpad/gen_fix_ultimo_nsr_substituicao.js
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
           --
           -- ⚠️ ZERO, nunca NULL: a coluna e' `bigint NOT NULL DEFAULT 0` desde 20260808000000,
           -- e "nada ainda" nesta tabela sempre foi 0. A primeira versao escrevia NULL e morria
           -- com 23502 na primeira execucao real - plpgsql so descobre isso EXECUTANDO.
           ultimo_nsr    = 0,
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

-- ============================================================================
-- CONFERENCIA
-- ============================================================================
--
-- 1. Antes de rodar a substituicao: o CCE-01 tem que estar como sempre esteve (geracao 1,
--    ultimo_nsr e cursor altos). Se estiver assim, o erro nao deixou rastro nenhum.
--
--   SELECT d.nome, d.geracao_atual, d.ultimo_nsr,
--          public.fn_cursor_afd_dispositivo(d.id) AS cursor_hoje
--     FROM public.dispositivos_rep d WHERE d.nome ILIKE '%CCE%';
--
--   SELECT count(*) AS substituicoes_gravadas FROM public.dispositivos_rep_substituicoes;
--   -- esperado: 0 (nada foi gravado pela tentativa que falhou)
--
-- 2. A substituicao do CCE-01, agora:
--
--   SELECT public.fn_registrar_substituicao_dispositivo(
--            (SELECT d.id FROM public.dispositivos_rep d WHERE d.nome ILIKE '%CCE%'),
--            'Equipamento queimou e foi substituido em 06/09/2026; AFD do novo recomeca no NSR 1.');
--   -- esperado: geracao_nova = 2 e cursor_novo = 1
--
-- 3. Depois do proximo ciclo do coletor (ate 5 min), o AFD do aparelho novo tem que aparecer:
--
--   SELECT r.geracao, count(*), min(r.nsr), max(r.nsr)
--     FROM public.rep_afd_registros r
--     JOIN public.dispositivos_rep d ON d.id = r.dispositivo_id
--    WHERE d.nome ILIKE '%CCE%' GROUP BY 1 ORDER BY 1;
--   -- esperado: geracao 1 com os 111.508 intactos, e geracao 2 comecando em 1
