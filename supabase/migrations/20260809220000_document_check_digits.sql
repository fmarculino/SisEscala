-- Migration: Digito verificador de CNPJ e PIS (o de CPF ja existia)
-- Data: 2026-08-09
--
-- Plano: docs/planos/2026-08-09-validacao-de-documentos.md
--
-- CONTEXTO
--   Ate 09/08/2026 o sistema tinha MASCARA de digitacao e NENHUMA validacao de digito - nem no
--   cliente, nem na server action, nem no banco. Resultado medido em producao: 4 CPFs gravados
--   com digito invalido entre 126 preenchidos. Mascara faz o dado PARECER certo; nao confere nada.
--
--   fn_cpf_digito_valido ja existe desde 20260809110000, criada de proposito como CONSULTA e nao
--   como CHECK, porque os 4 invalidos ja estavam gravados e a constraint travaria a edicao dessas
--   quatro pessoas - inclusive alteracoes que nada tem a ver com CPF.
--
-- ESTA MIGRATION SO CRIA FUNCOES. Nenhum CHECK entra aqui.
--   As constraints ficam para 20260809230000, que deve ser aplicada DEPOIS de os 4 CPFs serem
--   corrigidos na ficha. Ela aborta sozinha se ainda houver invalido.
--
-- POR QUE O ALGORITMO EXISTE EM DOIS LUGARES
--   Aqui e em src/utils/documentos.ts. Sao duas implementacoes inevitaveis - o CHECK precisa da
--   versao SQL, o formulario precisa da versao TS. O que nao pode e existir uma TERCEIRA, nem as
--   duas divergirem. scratchpad/confere_documentos.js roda ambas sobre os documentos reais de
--   producao e aborta se discordarem em qualquer um.


-- ============================================================================
-- 1. CNPJ
-- ============================================================================
-- 14 digitos, dois verificadores com pesos ciclicos de 2 a 9, modulo 11 com resto < 2 valendo 0.
--
-- Em producao os 16 CNPJs de unidades JA sao validos - esta funcao entra para impedir que o
-- proximo nao seja, nao para corrigir passivo.

CREATE OR REPLACE FUNCTION public.fn_cnpj_digito_valido(p_cnpj text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
    v     text;
    pesos int[];
    soma  integer;
    r     integer;
    d1    integer;
    d2    integer;
    i     integer;
BEGIN
    v := regexp_replace(COALESCE(p_cnpj, ''), '[^0-9]', '', 'g');

    IF length(v) <> 14 THEN
        RETURN false;
    END IF;

    -- 00000000000000 e afins passam na conta dos verificadores mas nao sao documento.
    IF v ~ ('^(' || substr(v, 1, 1) || '){14}$') THEN
        RETURN false;
    END IF;

    pesos := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
    soma := 0;
    FOR i IN 1..12 LOOP
        soma := soma + substr(v, i, 1)::integer * pesos[i];
    END LOOP;
    r := soma % 11;
    d1 := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
    IF d1 <> substr(v, 13, 1)::integer THEN
        RETURN false;
    END IF;

    pesos := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
    soma := 0;
    FOR i IN 1..13 LOOP
        soma := soma + substr(v, i, 1)::integer * pesos[i];
    END LOOP;
    r := soma % 11;
    d2 := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;

    RETURN d2 = substr(v, 14, 1)::integer;
END;
$fn$;

COMMENT ON FUNCTION public.fn_cnpj_digito_valido(text) IS
    'Confere os dois digitos verificadores do CNPJ. Espelho de validarCnpj em src/utils/documentos.ts - '
    'conferidas uma contra a outra por scratchpad/confere_documentos.js.';

GRANT EXECUTE ON FUNCTION public.fn_cnpj_digito_valido(text) TO authenticated, service_role;


-- ============================================================================
-- 2. PIS / PASEP / NIT / NIS
-- ============================================================================
-- 11 digitos, um verificador com pesos fixos 3,2,9,8,7,6,5,4,3,2.
--
-- Esta 0% preenchido hoje, e entra na validacao POR ISSO: o CLAUDE.md registra que auditor fiscal
-- casa por PIS/NIS, e o preenchimento e projeto da Fase 9 do modulo REP. Comecar a preencher 183
-- registros sem conferencia repetiria exatamente o que o CPF acabou de mostrar.

CREATE OR REPLACE FUNCTION public.fn_pis_digito_valido(p_pis text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
    v     text;
    pesos int[] := ARRAY[3,2,9,8,7,6,5,4,3,2];
    soma  integer := 0;
    r     integer;
    i     integer;
BEGIN
    v := regexp_replace(COALESCE(p_pis, ''), '[^0-9]', '', 'g');

    IF length(v) <> 11 THEN
        RETURN false;
    END IF;

    IF v ~ ('^(' || substr(v, 1, 1) || '){11}$') THEN
        RETURN false;
    END IF;

    FOR i IN 1..10 LOOP
        soma := soma + substr(v, i, 1)::integer * pesos[i];
    END LOOP;

    r := 11 - (soma % 11);
    IF r >= 10 THEN r := 0; END IF;

    RETURN r = substr(v, 11, 1)::integer;
END;
$fn$;

COMMENT ON FUNCTION public.fn_pis_digito_valido(text) IS
    'Confere o digito verificador do PIS/PASEP/NIT/NIS. Espelho de validarPis em '
    'src/utils/documentos.ts.';

GRANT EXECUTE ON FUNCTION public.fn_pis_digito_valido(text) TO authenticated, service_role;


-- ============================================================================
-- 3. DIAGNOSTICO DE DOCUMENTOS INVALIDOS
-- ============================================================================
-- Existe para responder "o que precisa ser corrigido antes de eu poder ligar o CHECK", e depois
-- para alimentar a tela de pendencias de cadastro. Sem isto, os invalidos so aparecem para quem
-- roda SQL.

CREATE OR REPLACE FUNCTION public.fn_documentos_invalidos()
RETURNS TABLE (
    tabela     text,
    campo      text,
    registro_id uuid,
    nome       text,
    valor      text,
    problema   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT 'servidores', 'cpf', s.id, s.nome, s.cpf,
           CASE WHEN length(regexp_replace(s.cpf, '[^0-9]', '', 'g')) <> 11
                THEN 'CPF nao tem 11 digitos'
                ELSE 'digito verificador invalido' END
      FROM public.servidores s
     WHERE NULLIF(regexp_replace(COALESCE(s.cpf, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
       AND NOT public.fn_cpf_digito_valido(s.cpf)

    UNION ALL
    SELECT 'servidores', 'pis_pasep', s.id, s.nome, s.pis_pasep, 'digito verificador invalido'
      FROM public.servidores s
     WHERE NULLIF(regexp_replace(COALESCE(s.pis_pasep, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
       AND NOT public.fn_pis_digito_valido(s.pis_pasep)

    UNION ALL
    SELECT 'unidades', 'cnpj', u.id, u.nome, u.cnpj, 'digito verificador invalido'
      FROM public.unidades u
     WHERE NULLIF(regexp_replace(COALESCE(u.cnpj, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
       AND NOT public.fn_cnpj_digito_valido(u.cnpj)

    UNION ALL
    SELECT 'unidades', 'responsavel_cpf', u.id, u.nome, u.responsavel_cpf, 'digito verificador invalido'
      FROM public.unidades u
     WHERE NULLIF(regexp_replace(COALESCE(u.responsavel_cpf, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
       AND NOT public.fn_cpf_digito_valido(u.responsavel_cpf)

    ORDER BY 1, 2, 4
$fn$;

COMMENT ON FUNCTION public.fn_documentos_invalidos() IS
    'Todos os documentos gravados com digito invalido. Use antes de aplicar 20260809230000 - a '
    'constraint aborta enquanto esta funcao devolver linhas.';

GRANT EXECUTE ON FUNCTION public.fn_documentos_invalidos() TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. Os 4 CPFs conhecidos aparecem, e nada mais (esperado: exatamente 4 linhas):
--
--      SELECT * FROM public.fn_documentos_invalidos();
--      -- HUGO MARCELO OSORIO                15473729253
--      -- MICHELLE RAIANNE MORAIS DA SILVA   00700922228
--      -- FRANCISCA ASSIS ALMEIDA SANTOS     66871107315
--      -- LUCILIA LIMA AZEVEDO               60230476268
--
--   2. Os 16 CNPJs de unidades continuam validos (esperado: nenhuma linha de cnpj acima).
--
--   3. As funcoes concordam com casos conhecidos:
--
--      SELECT public.fn_cnpj_digito_valido('11222333000181');  -- true
--      SELECT public.fn_cnpj_digito_valido('11222333000180');  -- false
--      SELECT public.fn_cnpj_digito_valido('00000000000000');  -- false (repetido)
--      SELECT public.fn_pis_digito_valido('12056412545');      -- true
--      SELECT public.fn_pis_digito_valido('12056412547');      -- false
