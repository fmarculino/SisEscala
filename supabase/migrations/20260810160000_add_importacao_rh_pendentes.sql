-- Migration: staging de vinculo novo do RH, e a funcao que promove para servidores
-- Data: 2026-08-10
--
-- Plano: docs/planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md
-- Estudo: docs/planos/2026-08-10-estudo-importacao-dados-cadastrais-rh.md
-- Depende de: 20260810110000 (financiamento_saude_blocos), 20260810140000 (vinculo_multiplo_confirmado,
--             fn_cpf_ja_cadastrado)
--
-- CONTEXTO
--   O CSV do RH tem 3.492 vinculos ativos, 3.259 CPFs dos quais nao estao no SisEscala hoje. O
--   CSV nao tem granularidade de SETOR (so unidade, via Departamento) e nao tem TELEFONE (0%
--   preenchido) - servidor novo nao pode entrar pronto em `servidores` sem essas decisoes, porque
--   apareceria em escala sem setor resolvido. Fica em staging ate um humano completar.
--
--   Mesmo raciocinio de nunca fabricar horario (fn_confirmar_presenca) aplicado a cadastro: nao
--   fabricar lotacao. Um servidor "pela metade" gravado direto em `servidores` e pior que um que
--   fica visivelmente pendente.
--
--   fn_promover_pendencia_rh faz o que createServidor (servidores/actions.ts) faz na escrita real
--   - mesma tabela, mesmas constraints (chk_servidores_cpf_digito, chk_servidores_status,
--   matricula UNIQUE) - chamada pela tela /servidores/pendencias quando o coordenador confirma
--   unidade+setor+cargo. Campos complementares (RG, endereco, PIS etc.) vem prontos do CSV em
--   `dados_complementares`; so unidade/setor/cargo podem ser ajustados na promocao.

CREATE TABLE IF NOT EXISTS public.importacao_rh_pendentes (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cpf_normalizado         text NOT NULL,
    nome                    text NOT NULL,
    matricula               text NOT NULL,
    classificacao           text,
    cargo_sugerido          text,
    financiamento_bloco_id  uuid REFERENCES public.financiamento_saude_blocos(id),
    unidade_id              uuid REFERENCES public.unidades(id),
    departamento_origem     text NOT NULL,
    dados_complementares    jsonb NOT NULL DEFAULT '{}'::jsonb,
    vinculo_adicional_de_cpf boolean NOT NULL DEFAULT false,
    criado_em               timestamptz NOT NULL DEFAULT now(),
    promovido_em            timestamptz,
    promovido_servidor_id   uuid REFERENCES public.servidores(id),
    CONSTRAINT importacao_rh_pendentes_matricula_key UNIQUE (matricula)
);

COMMENT ON TABLE public.importacao_rh_pendentes IS
    'Vinculo ativo do CSV de RH cujo CPF nao esta em servidores. Aguarda setor (obrigatorio, o '
    'CSV nao tem) e, quando unidade_id for nulo, a unidade certa. Promovido via '
    'fn_promover_pendencia_rh, nunca por INSERT direto em servidores.';

COMMENT ON COLUMN public.importacao_rh_pendentes.departamento_origem IS
    'Texto cru do Departamento do CSV - preenchido mesmo quando unidade_id ja resolveu, para '
    'conferencia.';

COMMENT ON COLUMN public.importacao_rh_pendentes.vinculo_adicional_de_cpf IS
    'true quando este CPF ja tem outro vinculo ativo (no CSV ou ja promovido) - evita que a tela '
    'de conclusao trate como CPF duplicado por engano.';

CREATE INDEX IF NOT EXISTS idx_importacao_rh_pendentes_cpf
    ON public.importacao_rh_pendentes (cpf_normalizado);

CREATE INDEX IF NOT EXISTS idx_importacao_rh_pendentes_pendentes
    ON public.importacao_rh_pendentes (id) WHERE promovido_em IS NULL;

ALTER TABLE public.importacao_rh_pendentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de importacao_rh_pendentes para administradores" ON public.importacao_rh_pendentes;
CREATE POLICY "Permitir leitura de importacao_rh_pendentes para administradores" ON public.importacao_rh_pendentes
    FOR SELECT TO authenticated
    USING (((SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])));

-- Escrita inicial (carga) e service_role; UPDATE de promovido_em/promovido_servidor_id acontece
-- so dentro de fn_promover_pendencia_rh (SECURITY DEFINER), nunca por UPDATE direto do cliente.
GRANT SELECT ON public.importacao_rh_pendentes TO authenticated;
GRANT ALL ON public.importacao_rh_pendentes TO service_role;

-- ============================================================================
-- fn_promover_pendencia_rh — grava o servidor de verdade e fecha a pendencia
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_promover_pendencia_rh(
    p_pendencia_id                uuid,
    p_unidade_id                  uuid,
    p_setor_id                    uuid,
    p_cargo                       text,
    p_confirma_vinculo_adicional  boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_pend      public.importacao_rh_pendentes%ROWTYPE;
    v_existente record;
    v_dados     jsonb;
    v_novo_id   uuid;
    v_vinculo_multiplo boolean := false;
BEGIN
    SELECT * INTO v_pend
      FROM public.importacao_rh_pendentes
     WHERE id = p_pendencia_id AND promovido_em IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pendencia nao encontrada, ou ja foi promovida.';
    END IF;

    IF p_unidade_id IS NULL OR p_setor_id IS NULL THEN
        RAISE EXCEPTION 'Unidade e setor sao obrigatorios para concluir o cadastro.';
    END IF;

    IF p_cargo IS NULL OR btrim(p_cargo) = '' THEN
        RAISE EXCEPTION 'Cargo e obrigatorio para concluir o cadastro.';
    END IF;

    -- Mesmo gate de vinculo multiplo da action (20260810140000) - a pendencia pode ter sido
    -- marcada vinculo_adicional_de_cpf no momento da carga, mas confere de novo aqui porque outra
    -- pendencia do mesmo CPF pode ter sido promovida entre a carga e agora.
    SELECT * INTO v_existente FROM public.fn_cpf_ja_cadastrado(v_pend.cpf_normalizado) LIMIT 1;
    IF FOUND THEN
        IF NOT p_confirma_vinculo_adicional THEN
            RAISE EXCEPTION 'CPF ja cadastrado como % (matricula %). Confirme se e vinculo adicional da mesma pessoa.',
                v_existente.nome, v_existente.matricula;
        END IF;
        v_vinculo_multiplo := true;
    END IF;

    v_dados := COALESCE(v_pend.dados_complementares, '{}'::jsonb);

    INSERT INTO public.servidores (
        nome, matricula, cpf, cargo, vinculo, unidade_id, setor_id, status,
        financiamento_bloco_id, vinculo_multiplo_confirmado,
        data_nascimento, sexo, nacionalidade, naturalidade, nome_mae, nome_pai,
        escolaridade, estado_civil, nome_conjuge,
        endereco_logradouro, endereco_numero, bairro, cep, municipio_residencia,
        telefone_residencial, rg_numero, rg_orgao_emissor, rg_data_emissao, pis_pasep,
        registro_profissional, registro_profissional_orgao, data_admissao_pmm, observacao
    ) VALUES (
        v_pend.nome, v_pend.matricula, v_pend.cpf_normalizado, p_cargo,
        COALESCE(v_pend.classificacao, 'Contratada'), p_unidade_id, p_setor_id, 'Ativo',
        v_pend.financiamento_bloco_id, v_vinculo_multiplo,
        NULLIF(v_dados->>'data_nascimento','')::date,
        NULLIF(v_dados->>'sexo',''),
        NULLIF(v_dados->>'nacionalidade',''),
        NULLIF(v_dados->>'naturalidade',''),
        NULLIF(v_dados->>'nome_mae',''),
        NULLIF(v_dados->>'nome_pai',''),
        NULLIF(v_dados->>'escolaridade',''),
        NULLIF(v_dados->>'estado_civil',''),
        NULLIF(v_dados->>'nome_conjuge',''),
        NULLIF(v_dados->>'endereco_logradouro',''),
        NULLIF(v_dados->>'endereco_numero',''),
        NULLIF(v_dados->>'bairro',''),
        NULLIF(v_dados->>'cep',''),
        NULLIF(v_dados->>'municipio_residencia',''),
        NULLIF(v_dados->>'telefone_residencial',''),
        NULLIF(v_dados->>'rg_numero',''),
        NULLIF(v_dados->>'rg_orgao_emissor',''),
        NULLIF(v_dados->>'rg_data_emissao','')::date,
        NULLIF(v_dados->>'pis_pasep',''),
        NULLIF(v_dados->>'registro_profissional',''),
        NULLIF(v_dados->>'registro_profissional_orgao',''),
        NULLIF(v_dados->>'data_admissao_pmm','')::date,
        NULLIF(v_dados->>'observacao','')
    )
    RETURNING id INTO v_novo_id;

    UPDATE public.importacao_rh_pendentes
       SET promovido_em = now(), promovido_servidor_id = v_novo_id
     WHERE id = p_pendencia_id;

    RETURN v_novo_id;
END;
$fn$;

COMMENT ON FUNCTION public.fn_promover_pendencia_rh(uuid, uuid, uuid, text, boolean) IS
    'Grava em servidores o vinculo pendente de importacao do RH, depois de unidade/setor/cargo '
    'confirmados. Chamada exclusiva da tela /servidores/pendencias - nunca INSERT direto do cliente.';

GRANT EXECUTE ON FUNCTION public.fn_promover_pendencia_rh(uuid, uuid, uuid, text, boolean) TO authenticated, service_role;

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--   1. Tabela e funcao existem, RLS ligada:
--      SELECT count(*) FROM public.importacao_rh_pendentes;  -- esperado: 0 (populada na fase 4)
--      SELECT proname FROM pg_proc WHERE proname = 'fn_promover_pendencia_rh';
--   2. A funcao recusa sem unidade/setor (rode e desfaca, ou confie na leitura do corpo acima).
