-- Migration: Geracao da matricula temporaria passa para o banco
-- Data: 2026-08-07
--
-- SINTOMA
--   Cadastrar servidor deixando a matricula em branco falhava com
--     duplicate key value violates unique constraint "servidores_matricula_key"
--   Funcionou por meses e "de repente" comecou a quebrar.
--
-- CAUSA RAIZ: RLS x constraint global
--   A matricula temporaria era calculada no frontend (createServidor, updateServidor e
--   importServidores, com a mesma logica triplicada):
--
--     supabase.from('servidores').select('matricula')
--       .like('matricula', 'T26%').order('matricula', desc).limit(1)
--
--   Esse SELECT usa o cliente do usuario logado, entao passa pela policy
--   "Users can view relevant servers", que escopa servidores por unidade/setor.
--   A constraint UNIQUE, porem, e GLOBAL. Quem enxerga so parte da tabela calcula um
--   sequencial que ja foi usado por alguem de outra unidade.
--
--   Auditoria em producao (07/08/2026):
--     - 13 matriculas temporarias, espalhadas por 3 unidades:
--         SMS (T2600004,05,07,11,12,13,14,19), HMM (T2600006),
--         USF ENFERMEIRA ZEZINHA (T2600015,16,17,18)
--     - 20 dos 29 perfis tem visao restrita (11 coordenadores + 9 admins sem as flags
--       acesso_todas_unidades / acesso_todos_setores)
--     - buracos na sequencia: 1,2,3,8,9,10  <- rastro das colisoes
--
--   Exemplo concreto: coordenador da USF ENFERMEIRA ZEZINHA enxerga no maximo T2600018,
--   calcula T2600019 e colide com o registro da SMS, que ele nao pode ver.
--
--   Por isso "funcionava bem" no inicio: enquanto todas as temporarias eram da SMS, todas
--   as visoes coincidiam. O bug nasceu junto com a primeira temporaria em outra unidade.
--
-- CORRECAO
--   A geracao passa a ser feita por trigger BEFORE INSERT OR UPDATE, com SECURITY DEFINER:
--
--     1. SECURITY DEFINER faz o SELECT rodar como dono da tabela, que nao esta sujeito a
--        RLS - o calculo enxerga TODAS as matriculas, nao so as visiveis ao usuario;
--     2. rodar dentro da transacao do proprio INSERT elimina a janela entre calcular e
--        gravar, que a versao anterior tinha mesmo com visao total;
--     3. pg_advisory_xact_lock serializa dois cadastros concorrentes;
--     4. o laco pula sequenciais ja ocupados, entao os buracos historicos nao travam nada
--        e uma corrida remanescente se resolve sozinha em vez de estourar.
--
--   Vale para QUALQUER caminho de escrita - cadastro individual, edicao e importacao CSV,
--   que hoje repetem a mesma logica - e tambem para um INSERT manual no SQL editor.
--
--   O formato nao muda: T + ano com 2 digitos + 5 digitos (ex: T2600020).
--
-- COMPATIVEL COM O FRONTEND ATUAL
--   Se a aplicacao continuar mandando uma matricula ja calculada, a trigger nao interfere -
--   ela so age quando matricula vem NULL ou vazia. Isso permite aplicar esta migration
--   antes do deploy do frontend, sem quebrar nada no intervalo.

CREATE OR REPLACE FUNCTION public.fn_atribuir_matricula_temporaria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_prefixo    text;
    v_seq        integer;
    v_candidata  text;
    v_tentativas integer := 0;
BEGIN
    -- Matricula informada pelo usuario: nao mexe.
    IF NEW.matricula IS NOT NULL AND btrim(NEW.matricula) <> '' THEN
        RETURN NEW;
    END IF;

    v_prefixo := 'T' || to_char(
        now() AT TIME ZONE COALESCE(
            (SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
            'America/Sao_Paulo'),
        'YY');

    -- Serializa geradores concorrentes ate o fim desta transacao.
    PERFORM pg_advisory_xact_lock(hashtext('servidores.matricula_temporaria'));

    -- Maior sequencial do ano corrente. Sem RLS no caminho, gracas ao SECURITY DEFINER.
    SELECT COALESCE(MAX(substring(s.matricula from '^T[0-9][0-9]([0-9]+)$')::integer), 0)
      INTO v_seq
      FROM public.servidores s
     WHERE s.matricula ~ ('^' || v_prefixo || '[0-9]+$');

    -- Pula sequenciais ja ocupados (buracos historicos, corrida remanescente).
    LOOP
        v_seq        := v_seq + 1;
        v_tentativas := v_tentativas + 1;
        v_candidata  := v_prefixo || lpad(v_seq::text, 5, '0');

        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.servidores s WHERE s.matricula = v_candidata
        );

        IF v_tentativas > 1000 THEN
            RAISE EXCEPTION 'Nao foi possivel gerar matricula temporaria com prefixo % apos % tentativas',
                v_prefixo, v_tentativas;
        END IF;
    END LOOP;

    NEW.matricula := v_candidata;
    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_atribuir_matricula_temporaria() IS
    'Preenche servidores.matricula com o proximo sequencial temporario (T<AA>NNNNN) quando vem vazia. SECURITY DEFINER para enxergar toda a tabela, que a RLS esconderia do usuario.';


DROP TRIGGER IF EXISTS trg_atribuir_matricula_temporaria ON public.servidores;

CREATE TRIGGER trg_atribuir_matricula_temporaria
    BEFORE INSERT OR UPDATE OF matricula ON public.servidores
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_atribuir_matricula_temporaria();


-- CONFERENCIA APOS APLICAR
--
--   1. Proximo sequencial que sera gerado (deve ser T2600020 em 07/08/2026):
--
--      SELECT 'T' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YY')
--             || lpad((COALESCE(MAX(substring(matricula from '^T[0-9][0-9]([0-9]+)$')::integer), 0) + 1)::text, 5, '0')
--        FROM servidores
--       WHERE matricula ~ ('^T' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YY') || '[0-9]+$');
--
--   2. Nenhuma matricula duplicada (deve retornar zero linhas):
--
--      SELECT matricula, count(*) FROM servidores GROUP BY matricula HAVING count(*) > 1;
