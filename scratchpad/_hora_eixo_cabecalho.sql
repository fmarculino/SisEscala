-- ============================================================================
-- A HORA INFORMADA NAO DIZ DE QUE DIA ELA E — E O SISTEMA CHUTAVA "HOJE" (10/09/2026)
-- ============================================================================
-- escala_diaria.hora_inicio_prevista e o NIVEL 1 da cadeia de precedencia de horario
-- (docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md): a hora que o COORDENADOR
-- informou ao escalar, e a que vence todas as outras. So que ela e um `time` — nao carrega dia.
-- O nivel 1 fazia
--
--     CASE WHEN ed.categoria <> 'Regular'
--          THEN extract(hour from ed.hora_inicio_prevista)::integer END
--
-- e o resultado virava `start_hour * 60`, ou seja: SEMPRE o dia civil da celula.
--
-- Numa jornada que cruza a meia-noite isso poe o turno no lado errado do dia. Caso real medido em
-- producao em 10/09/2026 (vigias/agentes de portaria, jornada 18H AS 06H): a hora extra de
-- passagem de turno, informada como 06:00, nascia
--
--     06:00 -> 07:00 do PROPRIO dia — 12 horas ANTES do turno noturno que ela emenda
--
-- em vez de 06:00 -> 07:00 do dia SEGUINTE. Conferido chamando fn_blocos_previstos_dia:
--
--     bloco 1  Extra    01/09 06:00 -> 01/09 07:00     <- 12h antes do turno
--     bloco 2  Regular  01/09 18:00 -> 02/09 06:00
--
-- O ESTRAGO, medido:
--   1. A batida real das 07:0x do dia seguinte NAO APARECE no modal de validacao manual. A janela
--      do modal e a uniao do dia civil com a janela prevista do bloco (src/utils/janelaBatidas.ts)
--      — com o bloco 12h fora do lugar, a batida cai em `fora` e some da lista. O coordenador ve
--      so a batida das 18:00, que e a ENTRADA dele.
--   2. A alocacao automatica nunca casa a batida com o passo do Extra: ela fica 25h longe do slot.
--      Sobra para o slot de saida do Regular, que ela ultrapassa em 1h.
--   3. A FOLHA fica errada, e este e o pior. A folha consolida o dia por min(entrada)/max(saida)
--      sobre Regular + Extra (src/utils/folha/origemMarcacao.ts). Com o Extra gravado as 06:00 do
--      dia civil, min(entrada) vira 06:00 — e a folha de ILMAR (mat. 54457, USF ENFERMEIRA
--      ZEZINHA, 08/2026, status Revisada) saiu com
--
--          dia 10  entrada 06:00   saida 07:00
--
--      para uma noite de 18:00 as 07:01. As 12 HORAS DE TURNO NOTURNO SUMIRAM DA FOLHA. Nos dias
--      em que o Extra por acaso ficou no dia certo, a mesma folha traz 17:44 -> 07:01, correto.
--      Padrao repetido em 8+ dias do mes, nos dois vigias daquela unidade.
--
-- ALCANCE MEDIDO EM PRODUCAO (10/09/2026), sobre as 1.265 linhas com hora_inicio_prevista:
--       145 linhas mudam de dia — 11 servidores, 8 unidades, competencias 08 e 09/2026
--       132 sao codigo `1` e 13 sao `1N`, todas jornada 18H AS 06H com hora 06:00
--         1 linha (Plantao MT 12h em jornada 19H AS 07H) fica INALTERADA de proposito, abaixo
--       844 linhas em dia cujo Regular nao cruza a meia-noite: inalteradas
--       274 linhas sem Regular no dia: inalteradas
--
-- A REGRA, e por que ela e estreita
--   A hora informada sobe um dia quando, e somente quando:
--     (a) o Regular do dia CRUZA a meia-noite;
--     (b) a hora informada e EXATAMENTE a hora em que essa jornada termina — ou seja, ela emenda
--         no fim do turno; e
--     (c) no dia civil o turno terminaria ANTES do inicio da jornada, deixando um vao.
--
--   A condicao (c) e o que separa o caso resolvivel do ambiguo. Uma hora extra de 1h as 06:00 numa
--   jornada 18H AS 06H termina as 07:00 e fica 11 horas solta antes do turno: no dia civil ela nao
--   emenda em nada, no dia seguinte ela emenda perfeitamente — nao ha duas leituras. Ja um Plantao
--   MT de 12h as 07:00 numa jornada 19H AS 07H emenda dos DOIS lados (07:00-19:00 encosta no
--   inicio; 07:00+1 encosta no fim), e ai NAO HA COMO AFIRMAR qual o coordenador quis. Nesse caso
--   nada muda — e o comportamento de hoje, mais o NIVEL 2-A, que ja poe o plantao diurno ANTES da
--   jornada noturna de proposito (20260809000000). E a unica linha assim em toda a base.
--
--   ⚠️ NAO AFROUXAR (b) PARA "hora <= fim da jornada". Ficaria valendo para qualquer hora da
--   madrugada, inclusive as que caem DENTRO do turno noturno, onde as duas leituras sao possiveis
--   e a escolha viraria chute. Se um dia aparecer caso real fora desta forma, o caminho e dar ao
--   coordenador como dizer o dia — nunca alargar a adivinhacao.
--
-- ⚠️ ISTO NAO E "a hora do coordenador deixou de valer". O nivel 1 continua sendo o mais alto e
--   continua sendo a hora que ele digitou; o que muda e que o DIA dela passa a ser derivado do
--   proprio dia da escala em vez de assumido. Sem hora informada nada disso e alcancado — e, por
--   ironia, o ultimo ramo da cascata legada ja resolvia este caso certo (fim da jornada + 24). Era
--   informar a hora que quebrava, e informar a hora e obrigatorio para o codigo nao ancorado nao
--   ficar "?h" na grade (armadilha 51).
--
-- FUNCOES RECRIADAS (copia mecanica do corpo vigente + 1 substituicao por cursor):
--   fn_confirmar_presenca         <- 20260909100000  (2 cursores: ontem e hoje)
--   fn_confirmar_presenca_manual  <- 20260903100000
--   fn_blocos_previstos_dia       <- 20260908140000
--   Gerado por scratchpad/gen_hora_eixo_do_dia.js — NAO EDITAR A MAO (armadilha 1).
--
-- IDEMPOTENTE: so CREATE OR REPLACE, sem DROP e sem mudanca de assinatura nas tres recriadas —
-- nenhuma vira objeto novo, entao os GRANTs existentes sao preservados (armadilha 41).
--
-- ⚠️ NAO CORRIGE DADO JA GRAVADO. As 26 linhas que ja tem presenca (todas 08/2026, folhas
-- Revisada) continuam como estao: sao ponto passado em documento assinado, e mexer nisso e
-- decisao de quem responde pela folha, por lista fechada e com ensaio antes/depois (armadilha 46).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A hora informada pertence ao dia seguinte?
-- ----------------------------------------------------------------------------
-- PURA de proposito: recebe numeros, nao consulta nada. E isso que permite a conferencia no fim
-- desta migration EXECUTAR a regra inteira contra uma tabela-verdade, sem depender de dado que
-- existe em producao e nao em homologacao (armadilha 3) e sem montar cenario sintetico.
CREATE OR REPLACE FUNCTION public.fn_hora_prevista_dia_seguinte(
    p_hora     integer,
    p_duracao  numeric,
    p_reg_ini  integer,
    p_reg_fim  integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fnhora$
BEGIN
    -- Sem os numeros nao ha o que afirmar. FALSE e o default da funcao inteira: "nao sei" nunca
    -- muda comportamento nenhum.
    IF p_hora IS NULL OR p_reg_ini IS NULL OR p_reg_fim IS NULL THEN
        RETURN false;
    END IF;

    -- (a) A jornada do dia precisa cruzar a meia-noite. Sem isso o dia civil da celula e o unico
    -- dia que existe, e a hora informada nunca foi ambigua.
    --
    -- ⚠️ ESTE GUARD E REDUNDANTE HOJE, E NAO E CODIGO MORTO. Numa jornada diurna a hora informada
    -- so chega aqui se for igual ao FIM dela (guard (b)), e ai ela e' maior ou igual ao inicio,
    -- entao o guard (c) ja recusaria sozinho. Ele fica porque enuncia a condicao que da nome a
    -- regra inteira: se (b) ou (c) mudarem, e ele que impede a mudanca de alcancar as 844 linhas
    -- de jornada diurna medidas em producao. Por ser inalcancavel, nenhuma tabela-verdade o pega —
    -- quem o protege e a checagem estrutural de scratchpad/sim_hora_eixo_do_dia.js.
    IF p_reg_fim >= p_reg_ini THEN
        RETURN false;
    END IF;

    -- (b) So a hora do FIM da jornada emenda nela. Ver a nota de "NAO AFROUXAR" no cabecalho:
    -- qualquer hora da madrugada passaria a ser adivinhada, inclusive as que caem dentro do turno.
    IF p_hora <> p_reg_fim THEN
        RETURN false;
    END IF;

    IF COALESCE(p_duracao, 0) <= 0 THEN
        RETURN false;
    END IF;

    -- (c) No dia civil ele tem que ficar SOLTO antes da jornada. Encostando (ou invadindo), as
    -- duas leituras emendam e a escolha viraria chute — e o NIVEL 2-A ja decidiu essa,
    -- deliberadamente, a favor do dia civil (20260809000000: a manha de quem faz noite vem antes).
    IF p_hora + COALESCE(p_duracao, 0) >= p_reg_ini THEN
        RETURN false;
    END IF;

    RETURN true;
END;
$fnhora$;

COMMENT ON FUNCTION public.fn_hora_prevista_dia_seguinte(integer, numeric, integer, integer) IS
    'A hora informada em escala_diaria.hora_inicio_prevista pertence ao dia seguinte? True so '
    'quando o Regular do dia cruza a meia-noite, a hora e exatamente a do fim dele e no dia civil '
    'o turno ficaria solto antes da jornada. Devolve false sempre que nao houver como afirmar.';

-- Armadilha 24: CREATE FUNCTION ja concede EXECUTE a PUBLIC. Sem o REVOKE, funcao nova nasce
-- aberta a anon. As duas sao chamadas de dentro de funcoes SECURITY DEFINER, que executam com os
-- privilegios do dono — revogar aqui nao quebra nenhuma delas.
REVOKE ALL ON FUNCTION public.fn_hora_prevista_dia_seguinte(integer, numeric, integer, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hora_prevista_dia_seguinte(integer, numeric, integer, integer)
    TO service_role;


-- A hora informada, ja no eixo do dia da escala (pode passar de 24, como o resto da cascata ja
-- faz: `N` em dia com Regular resolve para 7 + 24). Devolve NULL para hora nula, para o COALESCE
-- da cascata continuar descendo os niveis exatamente como antes.
CREATE OR REPLACE FUNCTION public.fn_hora_prevista_no_eixo_do_dia(
    p_escala_mensal_id uuid,
    p_dia              integer,
    p_hora_prevista    time,
    p_duracao_horas    numeric
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fneixo$
DECLARE
    v_hora integer;
    v_reg  jsonb;
BEGIN
    IF p_hora_prevista IS NULL THEN
        RETURN NULL;
    END IF;

    -- Os minutos continuam sendo descartados aqui, como sempre foram: a cascata inteira trabalha
    -- em horas cheias (start_hour * 60). Mudar isso e outra decisao, de outro tamanho.
    v_hora := extract(hour from p_hora_prevista)::integer;

    v_reg := public.fn_obter_horario_regular_dia(p_escala_mensal_id, p_dia);
    IF v_reg IS NULL THEN
        RETURN v_hora;
    END IF;

    IF public.fn_hora_prevista_dia_seguinte(
           v_hora, p_duracao_horas,
           (v_reg->>'start_hour')::integer,
           (v_reg->>'end_hour')::integer) THEN
        RETURN v_hora + 24;
    END IF;

    RETURN v_hora;
END;
$fneixo$;

COMMENT ON FUNCTION public.fn_hora_prevista_no_eixo_do_dia(uuid, integer, time, numeric) IS
    'NIVEL 1 da cadeia de horario (10/09/2026): a hora que o coordenador informou, posta no eixo '
    'do dia da escala. hora_inicio_prevista e um time e nao diz de que dia e; em jornada que cruza '
    'a meia-noite a hora extra de passagem de turno nascia 12h antes do turno que emenda.';

REVOKE ALL ON FUNCTION public.fn_hora_prevista_no_eixo_do_dia(uuid, integer, time, numeric)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hora_prevista_no_eixo_do_dia(uuid, integer, time, numeric)
    TO service_role;
