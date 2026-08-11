-- Migration: historico de vinculo (carreira) do servidor, ancorado por CPF
-- Data: 2026-08-10
--
-- Plano: docs/planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md
-- Estudo: docs/planos/2026-08-10-estudo-importacao-dados-cadastrais-rh.md § 3.11
--
-- CONTEXTO
--   O relatorio de RH mostra que mudanca de vinculo e comum: 1.611 dos 6.526 CPFs distintos do
--   arquivo (25%) tem mais de um registro (matricula nova a cada readmissao/renovacao/mudanca de
--   cargo). Nao e ruido - 853 desses 1.611 mudaram de CARGO entre os registros, 960 mudaram de
--   LOTACAO. E o historico de carreira de verdade, e o usuario pediu para nao se perder.
--
--   historico_transferencias (20260612100000) ja existe mas so cobre unidade/setor - nao cobre
--   cargo, funcao, matricula nem classificacao (vinculo). Esta tabela cobre o que falta.
--
--   Ancorada por CPF, nao por servidor_id: a matricula muda quando o vinculo muda, mas o CPF da
--   pessoa nao. Um servidor_id de hoje pode nao ter relacao nenhuma com a linha historica de uma
--   matricula anterior da mesma pessoa (a matricula antiga pode nunca ter existido em `servidores`
--   - so entra aqui via a carga do CSV do RH).
--
--   Append-only por natureza (sem UPDATE/DELETE de aplicacao) - registro de carreira nao se
--   reescreve. Populada uma vez pela carga do RH (fase 4 do plano) com todo o historico do CPF no
--   CSV, incluindo os registros "Demitido" de quem tem vinculo ativo hoje (readmissao/renovacao).
--   Gente que so tem "Demitido" no arquivo inteiro (nunca esteve ativa na janela do CSV) nao entra
--   em lugar nenhum - fora do escopo desta importacao.
--
--   Fora de escopo desta fase: manter isto atualizado automaticamente quando cargo/unidade mudar
--   pelo proprio SisEscala depois de hoje (precisaria de trigger em servidores, similar a
--   historico_transferencias). Registrado para fase futura, nao bloqueia a importacao do RH.

CREATE TABLE IF NOT EXISTS public.servidores_historico_vinculo (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cpf_normalizado         text NOT NULL,
    matricula               text NOT NULL,
    nome                    text NOT NULL,
    cargo                   text,
    funcao                  text,
    classificacao           text,
    financiamento_bloco_id  uuid REFERENCES public.financiamento_saude_blocos(id),
    departamento_origem     text,
    data_inicio             date,
    data_fim                date,
    origem                  text NOT NULL DEFAULT 'importacao_rh_2026_07',
    created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.servidores_historico_vinculo IS
    'Historico de carreira por CPF (matricula, cargo, funcao, classificacao, lotacao ao longo do '
    'tempo). Append-only. Complementa historico_transferencias, que so cobre unidade/setor.';

COMMENT ON COLUMN public.servidores_historico_vinculo.departamento_origem IS
    'Texto cru do campo Departamento do CSV de origem - nao tenta resolver unidade aqui, e so '
    'para auditoria/rastreabilidade.';

CREATE INDEX IF NOT EXISTS idx_servidores_historico_vinculo_cpf
    ON public.servidores_historico_vinculo (cpf_normalizado);

CREATE INDEX IF NOT EXISTS idx_servidores_historico_vinculo_matricula
    ON public.servidores_historico_vinculo (matricula);

ALTER TABLE public.servidores_historico_vinculo ENABLE ROW LEVEL SECURITY;

-- Dado sensivel (carreira/remuneracao indiretamente ligada) - leitura restrita a administradores,
-- diferente de historico_transferencias (que e escopado por unidade/setor porque coordenador
-- precisa ver transferencia de quem esta sob ele). Aqui nao ha unidade/setor para escopar por CPF
-- de forma confiavel (o CSV nao resolve unidade), entao o corte e por papel.
DROP POLICY IF EXISTS "Permitir leitura de servidores_historico_vinculo para administradores" ON public.servidores_historico_vinculo;
CREATE POLICY "Permitir leitura de servidores_historico_vinculo para administradores" ON public.servidores_historico_vinculo
    FOR SELECT TO authenticated
    USING (((SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])));

-- Escrita so pela carga (service_role) - nao ha fluxo de usuario que grave aqui diretamente.
GRANT SELECT ON public.servidores_historico_vinculo TO authenticated;
GRANT ALL ON public.servidores_historico_vinculo TO service_role;

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--   SELECT count(*) FROM public.servidores_historico_vinculo;  -- esperado: 0 (populada na fase 4)
