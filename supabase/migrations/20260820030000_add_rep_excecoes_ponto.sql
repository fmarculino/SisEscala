-- ============================================================================
-- Migration: excecao de ponto por (servidor, dispositivo)
-- Data: 2026-08-20
--
-- Problema medido em producao em 19/08/2026: fn_servidor_por_identificador_afd
-- resolve a identidade DIRETO na tabela servidores, por CPF ou PIS, sem exigir
-- rep_vinculos_servidor (mudou nas migrations de 17-18/08; o CLAUDE.md ainda
-- descreve o vinculo como "a unica ponte"). Consequencia: quem esta cadastrado
-- num relogio tem a batida atribuida automaticamente, com ou sem vinculo.
--
-- Isso quebra o caso do ADMINISTRADOR, que precisa estar cadastrado em todos os
-- equipamentos para configura-los e para cadastrar outros administradores, mas
-- registra ponto em um so. Caso real: o administrador testou biometria no CEI em
-- 15/08/2026 (11:24, 12:12, 12:41) e a batida das 11:24 virou a ENTRADA DO
-- PLANTAO dele na folha. Ele nao tinha nem vinculo no CEI - a resolucao por CPF
-- bastou.
--
-- Urgencia: o problema multiplica a cada administrador novo cadastrado nos
-- equipamentos.
--
-- Desenho: uma excecao explicita por (servidor, dispositivo). A batida continua
-- gravada no AFD e em marcacoes_ponto - a regra "nunca descartar batida" nao e
-- tocada. Ela apenas deixa de ter dono, entao nao projeta em escala_diaria.
--
-- Alternativas descartadas:
--   - encerrar o vinculo: nao resolve. No CEI nao havia vinculo nenhum e a
--     batida ganhou dono do mesmo jeito.
--   - restringir a resolucao a unidade do dispositivo: resolveria em geral, mas
--     quebraria "Servidor Externo" (v1.2.4), que e escalado numa unidade e
--     lotado em outra.
--
-- A funcao de identidade foi gerada por copia mecanica do corpo vigente
-- (20260818200000) com duas insercoes ancoradas e conferencia de contagem
-- (scratchpad/gen_exc.js) - nunca redigitada (armadilha 1).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A excecao
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rep_excecoes_ponto (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id    uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    dispositivo_id uuid NOT NULL REFERENCES public.dispositivos_rep(id) ON DELETE CASCADE,
    motivo         text NOT NULL DEFAULT 'Administrador do equipamento; nao registra ponto nele',
    criado_por_id  uuid REFERENCES public.profiles(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_rep_excecao_servidor_dispositivo UNIQUE (servidor_id, dispositivo_id)
);

COMMENT ON TABLE public.rep_excecoes_ponto IS
    'Pares (servidor, dispositivo) em que a batida NAO deve ser atribuida: tipicamente o '
    'administrador que precisa estar cadastrado no equipamento para configura-lo. A batida '
    'continua registrada em rep_afd_registros e marcacoes_ponto - so nao ganha dono.';

CREATE INDEX IF NOT EXISTS idx_rep_excecoes_ponto_lookup
    ON public.rep_excecoes_ponto (servidor_id, dispositivo_id);

ALTER TABLE public.rep_excecoes_ponto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gestao de excecoes de ponto REP por admin" ON public.rep_excecoes_ponto;
CREATE POLICY "Gestao de excecoes de ponto REP por admin" ON public.rep_excecoes_ponto
    FOR ALL TO authenticated
    USING ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role))
    WITH CHECK ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_excecoes_ponto FROM anon;
GRANT SELECT ON public.rep_excecoes_ponto TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. O teste, num lugar so
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ponto_excecao(
    p_servidor_id    uuid,
    p_dispositivo_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fne$
    SELECT EXISTS (
        SELECT 1 FROM public.rep_excecoes_ponto e
         WHERE e.servidor_id = p_servidor_id
           AND e.dispositivo_id = p_dispositivo_id
    );
$fne$;

COMMENT ON FUNCTION public.fn_ponto_excecao(uuid, uuid) IS
    'Fonte unica da excecao de ponto por (servidor, dispositivo). Usada por '
    'fn_servidor_por_identificador_afd nos tres caminhos de resolucao (vinculo, CPF, PIS).';

REVOKE ALL ON FUNCTION public.fn_ponto_excecao(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ponto_excecao(uuid, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. A resolucao de identidade passa a respeitar a excecao
-- ----------------------------------------------------------------------------
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
REVOKE ALL ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Seed: o administrador do sistema nao registra ponto fora do relogio da TI
--
--    Feito por SELECT sobre dispositivos_rep, e nao por lista de UUID, para que
--    todo relogio novo tambem entre - o administrador sera cadastrado neles pelo
--    mesmo motivo. O relogio da TI (onde ele de fato bate) fica de fora.
-- ----------------------------------------------------------------------------
INSERT INTO public.rep_excecoes_ponto (servidor_id, dispositivo_id, motivo)
SELECT s.id, d.id,
       'Administrador do sistema; cadastrado para configurar o equipamento e cadastrar outros administradores'
  FROM public.servidores s
  CROSS JOIN public.dispositivos_rep d
 WHERE s.matricula = '69497'                                      -- administrador do sistema
   AND d.id <> '76c51155-023b-415a-8d8a-a6b22f81ff72'::uuid        -- REP iDClass - Reg/TI/TFD
ON CONFLICT (servidor_id, dispositivo_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. Conferencia (rodar depois de aplicar)
-- ----------------------------------------------------------------------------
-- 5.1 As excecoes criadas (esperado: 1 linha por relogio, menos o da TI):
--     SELECT sv.nome, d.nome AS relogio, e.motivo
--       FROM public.rep_excecoes_ponto e
--       JOIN public.servidores sv ON sv.id = e.servidor_id
--       JOIN public.dispositivos_rep d ON d.id = e.dispositivo_id
--      ORDER BY sv.nome, d.nome;
--
-- 5.2 A resolucao devolve NULL fora da TI e continua resolvendo nela:
--     SELECT * FROM public.fn_servidor_por_identificador_afd(
--         '8634c013-f3be-4ebf-8506-0a2cde122dee', '053638930459');  -- CEI  -> NULL
--     SELECT * FROM public.fn_servidor_por_identificador_afd(
--         '76c51155-023b-415a-8d8a-a6b22f81ff72', '053638930459');  -- TI   -> servidor
--
-- 5.3 Ninguem mais foi afetado - a contagem de marcacoes com dono nao pode cair
--     para outros servidores. Comparar antes/depois:
--     SELECT count(*) FROM public.marcacoes_ponto
--      WHERE origem = 'rep' AND servidor_id IS NOT NULL
--        AND ocorrido_em >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo');
--
-- 5.4 ATENCAO - esta migration NAO corrige o passado. As batidas de 15/08/2026 no
--     CEI ja atribuidas continuam como estao; a excecao vale da proxima resolucao
--     em diante (ingestao ou reparse). Corrigir a folha de 15/08 e decisao a
--     parte, porque mexe em ponto ja registrado.
