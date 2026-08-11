-- Migration: 12 cargos do RH sem correspondente em `cargos`
-- Data: 2026-08-10
--
-- Plano: docs/planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md
-- Gerado por: scratchpad/rh_normalizar_cargos.js (revisado pelo usuario em 10/08/2026)
-- Depende de: 20260810120000 (cargos_codigos_origem)
--
-- CONTEXTO
--   `cargos` tem 267 linhas, 241 ja mapeadas em cargos_codigos_origem (20260810120000). Destes,
--   12 codigos do relatorio de RH nao correspondem a nenhum cargo hoje - o maior peso esta em
--   dois so: "0007 AG.SERV.GER." (435 pessoas) e "0001 AG.PORT." (205 pessoas).
--
--   NENHUM destes se funde com cargo existente. O RH separa cargo por regime (concursado x
--   contratado) de proposito - decisao do usuario em 10/08/2026, revertendo uma leitura minha
--   anterior de que seria duplicidade a normalizar. Por isso mesmo os 4 casos onde ja existe a
--   versao concursada (ex.: "3834 MEDICO PSIQUIATRA_CONTRATADO" ao lado de um "MEDICO
--   PSIQUIATRA" ja cadastrado) entram como cargo PROPRIO, nao apontam pro existente.
--
--   Texto corrigido de mojibake (UTF-8 relido com pagina de codigo errada e regravado) antes de
--   entrar aqui - "3706 COORD. DE MATERIAS, INSUMOS E SERVIÃ‡OS" (cru) vira "...SERVIÇOS".
--   scratchpad/rh_csv_utils.js documenta o mecanismo.

DO $$
DECLARE
    v_cargo_id uuid;
    v_novos jsonb := '[
        {"codigo": "0007", "nome": "AG.SERV.GER."},
        {"codigo": "0001", "nome": "AG.PORT."},
        {"codigo": "3369", "nome": "COORDENADOR III"},
        {"codigo": "0010", "nome": "COORDENADOR I"},
        {"codigo": "3794", "nome": "TEC.INFORM_CONTRATADO"},
        {"codigo": "3834", "nome": "MEDICO PSIQUIATRA_CONTRATADO"},
        {"codigo": "3835", "nome": "MEDICO INFECTOLOGISTA_CONTRATADO"},
        {"codigo": "3825", "nome": "MEDICO CARDIOLOGISTA_CONTRATADO"},
        {"codigo": "3836", "nome": "BIOMEDICO-CONTRATADO"},
        {"codigo": "3678", "nome": "COORD. DE INFORMATICA"},
        {"codigo": "3706", "nome": "COORD. DE MATERIAS, INSUMOS E SERVIÇOS"},
        {"codigo": "3838", "nome": "MEDICO REUMATOLOGISTA_CONTRATADO"}
    ]'::jsonb;
    v_item record;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_to_recordset(v_novos) AS x(codigo text, nome text)
    LOOP
        -- Idempotente: se o codigo ja foi mapeado (rodar a migration de novo), pula.
        IF EXISTS (SELECT 1 FROM public.cargos_codigos_origem WHERE codigo = v_item.codigo AND sistema_origem = 'SFPRC01M') THEN
            CONTINUE;
        END IF;

        INSERT INTO public.cargos (nome, codigo, ativo, nivel)
        VALUES (v_item.nome, v_item.codigo, true, 1)
        RETURNING id INTO v_cargo_id;

        INSERT INTO public.cargos_codigos_origem (cargo_id, codigo)
        VALUES (v_cargo_id, v_item.codigo);
    END LOOP;
END
$$;

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--   1. 12 codigos novos mapeados:
--      SELECT count(*) FROM public.cargos_codigos_origem
--       WHERE codigo IN ('0007','0001','3369','0010','3794','3834','3835','3825','3836','3678','3706','3838');
--      -- esperado: 12
--   2. Nenhum cargo com nome mojibake:
--      SELECT nome FROM public.cargos WHERE nome LIKE '%Ã%' OR nome LIKE '%Â%';
--      -- esperado: 0 linhas
