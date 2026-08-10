-- Migration: CHECK de digito verificador em CPF, CNPJ e PIS
-- Data: 2026-08-09
--
-- Plano: docs/planos/2026-08-09-validacao-de-documentos.md
-- Depende de: 20260809220000 (fn_cnpj_digito_valido, fn_pis_digito_valido, fn_documentos_invalidos)
--
-- ⚠️ NAO APLIQUE ANTES DE CORRIGIR OS CPFs INVALIDOS.
--
--   Em 09/08/2026 havia 4 CPFs gravados com digito invalido:
--     HUGO MARCELO OSORIO                15473729253
--     MICHELLE RAIANNE MORAIS DA SILVA   00700922228
--     FRANCISCA ASSIS ALMEIDA SANTOS     66871107315
--     LUCILIA LIMA AZEVEDO               60230476268
--
--   Eles NAO podem ser corrigidos por deducao. Digito verificador errado diz que algum algarismo
--   esta errado, mas nao diz qual: 15473729253 tanto pode ser 15473729254 quanto 15473729153.
--   A correcao e administrativa - conferir a ficha de cada um. Sao quatro pessoas.
--
--   Enquanto sobrar algum invalido, esta migration ABORTA de proposito, listando quem e. Sem
--   isso o ALTER TABLE falharia com uma mensagem crua do Postgres que nao diz de quem se trata.
--
-- POR QUE O CHECK, se a server action ja recusa
--   A action e a camada que da mensagem boa; o CHECK e a que sobrevive ao resto. INSERT pelo SQL
--   editor, script de migracao de dados e qualquer caminho futuro nao passam por action nenhuma.
--   E o mesmo raciocinio do indice unico de CPF em 20260809110000: a checagem de matricula
--   duplicada existia SO no frontend e a RLS a cegava (20260807110000).
--
-- O QUE ESTE CHECK NAO E
--   `unidades` ja tinha chk_unidade_cnpj e chk_unidade_responsavel_cpf desde 20260807120000, mas
--   elas conferem so o FORMATO (`^[0-9]{14}$` / `^[0-9]{11}$`) - aceitam 14 digitos quaisquer.
--   As constraints daqui sao de DIGITO e convivem com aquelas; nenhuma substitui a outra.


-- ============================================================================
-- 0. PORTAO — aborta enquanto houver documento invalido gravado
-- ============================================================================
DO $$
DECLARE
    v_lista text;
    v_qtd   integer;
BEGIN
    SELECT count(*), string_agg(format('  %s.%s  %s  (%s)', tabela, campo, valor, nome), E'\n')
      INTO v_qtd, v_lista
      FROM public.fn_documentos_invalidos();

    IF v_qtd > 0 THEN
        RAISE EXCEPTION E'Ha % documento(s) com digito verificador invalido gravado(s).\n%\n\nCorrija-os no cadastro antes de aplicar esta migration. A lista completa sai de:\n  SELECT * FROM public.fn_documentos_invalidos();',
            v_qtd, v_lista;
    END IF;

    RAISE NOTICE 'Nenhum documento invalido gravado - seguindo com as constraints.';
END
$$;


-- ============================================================================
-- 1. servidores.cpf
-- ============================================================================
-- O CPF e a chave de identidade real do cadastro: a matricula nunca protegeu unicidade, porque
-- deixada em branco a trigger trg_atribuir_matricula_temporaria gera uma nova (ver 20260809110000).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_servidores_cpf_digito'
           AND conrelid = 'public.servidores'::regclass
    ) THEN
        ALTER TABLE public.servidores
            ADD CONSTRAINT chk_servidores_cpf_digito
            CHECK (cpf IS NULL OR public.fn_cpf_digito_valido(cpf));
    END IF;
END
$$;

COMMENT ON CONSTRAINT chk_servidores_cpf_digito ON public.servidores IS
    'Digito verificador do CPF. NULL continua aceito - 57 servidores estao sem CPF em 09/08/2026 '
    'e torna-lo obrigatorio e outra decisao.';


-- ============================================================================
-- 2. servidores.pis_pasep
-- ============================================================================
-- Esta 0% preenchido, entao nasce protegido - que e exatamente o ponto. O preenchimento e projeto
-- da Fase 9 do modulo REP, e e por PIS/NIS que o auditor fiscal casa os registros.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_servidores_pis_digito'
           AND conrelid = 'public.servidores'::regclass
    ) THEN
        ALTER TABLE public.servidores
            ADD CONSTRAINT chk_servidores_pis_digito
            CHECK (pis_pasep IS NULL OR public.fn_pis_digito_valido(pis_pasep));
    END IF;
END
$$;

COMMENT ON CONSTRAINT chk_servidores_pis_digito ON public.servidores IS
    'Digito verificador do PIS/PASEP. Campo estava 100% vazio quando a constraint entrou.';


-- ============================================================================
-- 3. unidades.cnpj e unidades.responsavel_cpf
-- ============================================================================
-- Os 16 CNPJs de unidade ja eram validos em 09/08/2026 - entra sem passivo. O CNPJ vai para o
-- registro tipo 2 do AFD, ou seja, erro aqui contamina o arquivo oficial que o auditor le.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_unidade_cnpj_digito'
           AND conrelid = 'public.unidades'::regclass
    ) THEN
        ALTER TABLE public.unidades
            ADD CONSTRAINT chk_unidade_cnpj_digito
            CHECK (cnpj IS NULL OR public.fn_cnpj_digito_valido(cnpj));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_unidade_responsavel_cpf_digito'
           AND conrelid = 'public.unidades'::regclass
    ) THEN
        ALTER TABLE public.unidades
            ADD CONSTRAINT chk_unidade_responsavel_cpf_digito
            CHECK (responsavel_cpf IS NULL OR public.fn_cpf_digito_valido(responsavel_cpf));
    END IF;
END
$$;

COMMENT ON CONSTRAINT chk_unidade_cnpj_digito ON public.unidades IS
    'Digito verificador do CNPJ. Complementa chk_unidade_cnpj (20260807120000), que confere so o '
    'formato de 14 digitos.';


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. As quatro constraints existem:
--
--      SELECT conname, conrelid::regclass
--        FROM pg_constraint
--       WHERE conname IN ('chk_servidores_cpf_digito', 'chk_servidores_pis_digito',
--                         'chk_unidade_cnpj_digito', 'chk_unidade_responsavel_cpf_digito');
--
--   2. Nao ha invalido gravado (esperado: zero linhas):
--
--      SELECT * FROM public.fn_documentos_invalidos();
--
--   3. O CHECK realmente barra. Rode em transacao e desfaca:
--
--      BEGIN;
--        UPDATE public.servidores SET cpf = '11111111112' WHERE id = (SELECT id FROM public.servidores LIMIT 1);
--        -- esperado: ERROR ... "chk_servidores_cpf_digito"
--      ROLLBACK;
--
--   4. Editar um servidor pela tela continua funcionando (o caso que a constraint poderia travar
--      por engano se algum CPF invalido tivesse sobrado).
