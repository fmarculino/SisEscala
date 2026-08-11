-- Migration: dicionario do bloco de financiamento do SUS (CodLotacao/Lotacao do RH)
-- Data: 2026-08-10
--
-- Plano: docs/planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md
-- Estudo: docs/planos/2026-08-10-estudo-importacao-dados-cadastrais-rh.md § 3.3
--
-- CONTEXTO
--   O relatorio de RH (SFPRC01M) tem uma coluna Lotacao/CodLotacao que NAO e a unidade fisica -
--   e o bloco de custeio do SUS que paga aquele vinculo (Portaria de Consolidacao no 6/2017): PAB,
--   SIH, MAC/VISA, PACS, PSF, SAMU, CEREST, Vigilancia em Saude, PNAISP, cedidos a outros orgaos.
--   Medido em 10/08/2026: sao exatamente 18 codigos (1-14, mais 52-55 para setores do HMM).
--
--   Quem indica onde a pessoa trabalha de fato e a coluna Departamento, que mapeia para
--   unidades.id - isto aqui e so o financiamento, nao substitui unidade nenhuma.
--
-- Coluna nova em servidores fica pronta para a importacao de RH gravar o bloco de cada vinculo,
-- mesmo sem UI de edicao nesta fase - e informativo, nao afeta escala nem ponto.

CREATE TABLE IF NOT EXISTS public.financiamento_saude_blocos (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo     text NOT NULL,
    nome       text NOT NULL,
    ativo      boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT financiamento_saude_blocos_codigo_key UNIQUE (codigo)
);

COMMENT ON TABLE public.financiamento_saude_blocos IS
    'Bloco de financiamento do SUS que custeia o vinculo (CodLotacao/Lotacao do relatorio de RH '
    'SFPRC01M). Nao e unidade de trabalho - ver Departamento/unidades.';

INSERT INTO public.financiamento_saude_blocos (codigo, nome) VALUES
    ('1',  'VIGILANCIA EM SAUDE'),
    ('2',  'PACS'),
    ('3',  'SAUDE FIM-PSF'),
    ('4',  'CEREST/RENAST-SAUDE'),
    ('5',  'SAUDE REC.PROPRIO-SEDE'),
    ('6',  'SAUDE FIM-MACA'),
    ('7',  'SAUDE FIM-PAB'),
    ('8',  'SAUDE FIM-SIH'),
    ('9',  'SAUDE FIM-SAMU'),
    ('10', 'MAC-VISA'),
    ('11', 'SAUDE - PNAISP'),
    ('12', 'SAUDE/COVID-19'),
    ('13', 'ACE-AGENTE DE COMBATE A ENDEMIAS'),
    ('14', 'SAUDE-CEDIDOS'),
    ('52', 'SAUDE FIM-SIH - HMM'),
    ('53', 'SAUDE FIM-SIH - HMI'),
    ('54', 'SAUDE FIM-SIH - UTI GERAL-HMM'),
    ('55', 'SAUDE FIM-SIH - CIRURGIAS ELETIVAS - HMM')
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE public.servidores
    ADD COLUMN IF NOT EXISTS financiamento_bloco_id uuid REFERENCES public.financiamento_saude_blocos(id);

COMMENT ON COLUMN public.servidores.financiamento_bloco_id IS
    'Bloco de financiamento do SUS do vinculo, quando conhecido pela importacao de RH. '
    'Informativo - nao afeta escala nem ponto.';

ALTER TABLE public.financiamento_saude_blocos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de financiamento_saude_blocos para autenticados" ON public.financiamento_saude_blocos;
CREATE POLICY "Permitir leitura de financiamento_saude_blocos para autenticados" ON public.financiamento_saude_blocos
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Permitir gerenciamento de financiamento_saude_blocos para administradores" ON public.financiamento_saude_blocos;
CREATE POLICY "Permitir gerenciamento de financiamento_saude_blocos para administradores" ON public.financiamento_saude_blocos
    FOR ALL TO authenticated USING (((SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])));

GRANT SELECT ON public.financiamento_saude_blocos TO authenticated;
GRANT ALL ON public.financiamento_saude_blocos TO service_role;

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--   SELECT count(*) FROM public.financiamento_saude_blocos;  -- esperado: 18
