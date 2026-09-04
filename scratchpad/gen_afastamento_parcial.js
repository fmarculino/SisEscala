/*
 * Gera a migration que faz o afastamento PARCIAL por slot deixar de anular o dia inteiro.
 *
 * 🚨 LE DUAS FONTES, e isso e o ponto do arquivo (armadilha 1 do CLAUDE.md: "descubra qual
 *    migration define a versao VIGENTE — nao e necessariamente a que o nome sugere"). A primeira
 *    versao deste gerador copiou as tres funcoes de 20260820120000 e produziu uma migration que
 *    NAO TERIA EFEITO NENHUM na grade: fn_check_shift_conflicts foi reescrita depois, em
 *    20260821100000, ganhando o 7o argumento p_escala_mensal_id — e e ESSA que o ScaleGrid chama.
 *    A copia de 6 argumentos existia como sobrecarga morta. So se descobriu aplicando em
 *    homologacao e recebendo "function is not unique".
 *
 *      fn_check_shift_conflicts       -> 20260821100000 (7 args)
 *      fn_prevent_shift_during_event  -> 20260820120000
 *      fn_clean_conflicting_shifts    -> 20260820120000
 *
 * Aborta se qualquer contagem divergir, em qualquer das duas fontes.
 */
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'supabase', 'migrations')
const FONTE_CONFLITOS = path.join(DIR, '20260821100000_conflict_check_ignores_own_cell.sql')
const FONTE_TRIGGERS = path.join(DIR, '20260820120000_block_all_categories_during_leave.sql')
const DESTINO = path.join(DIR, '20260904120000_afastamento_parcial_preserva_o_turno.sql')

// CRLF -> LF, e espacos no fim da linha removidos: as fontes tem trailing space em
// "se.slots IS NULL " e casar isso a mao e a forma classica de a substituicao falhar em silencio.
const ler = (p) =>
  fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n')

const subs = []
function sub(estado, nome, de, para, esperadas = 1) {
  const partes = estado.sql.split(de)
  const achadas = partes.length - 1
  if (achadas !== esperadas) {
    console.error('ABORTADO: "' + nome + '" esperava ' + esperadas + ' ocorrencia(s), achou ' + achadas + '.')
    process.exit(1)
  }
  estado.sql = partes.join(para)
  subs.push(nome + ': ' + achadas)
}

// O bloco antigo de leitura do afastamento e IDENTICO nas duas fontes — e a copia mecanica que
// 20260821100000 fez de 20260820120000. Por isso o mesmo par de/para serve para as duas.
const SELECT_ANTIGO_CHECK = `    -- 2. Verificar se o servidor possui algum afastamento/evento ativo no dia especificado que conflite nos slots
    -- Afastamentos por horas (periodo_tipo = 'horas') não bloqueiam a inclusão do turno na escala
    SELECT te.nome, se.slots INTO v_afastamento_nome, v_afastamento_slots
    FROM public.servidores_eventos se
    JOIN public.tipos_eventos te ON te.id = se.tipo_evento_id
    WHERE se.servidor_id = p_servidor_id
      AND MAKE_DATE(p_ano, p_mes, p_dia) >= se.data_inicio
      AND MAKE_DATE(p_ano, p_mes, p_dia) <= se.data_fim
      AND COALESCE(se.periodo_tipo, 'integral') <> 'horas'
      AND se.hora_inicio IS NULL
      AND (
        se.slots IS NULL
        OR array_length(se.slots, 1) IS NULL
        OR se.slots && v_turno_slots
      )
    LIMIT 1;

    -- Se o servidor possuir um afastamento/evento integral ou por slot conflitante
    IF v_afastamento_nome IS NOT NULL THEN`

const SELECT_NOVO_CHECK = `    -- 2. Afastamento/evento do dia. Afastamento por horas (periodo_tipo = 'horas') nunca bloqueia.
    -- A leitura e do DIA INTEIRO, nunca de um evento isolado: duas declaracoes de comparecimento
    -- (uma {M} e outra {T}) sao parciais uma a uma e, JUNTAS, cobrem o turno MT.
    SELECT a.nome, a.integral, a.slots
      INTO v_afastamento_nome, v_afastamento_integral, v_afastamento_slots
    FROM public.fn_afastamento_dia(p_servidor_id, MAKE_DATE(p_ano, p_mes, p_dia)) a;

    -- So bloqueia quando o afastamento ANULA o turno: integral, ou cobrindo TODOS os slots dele.
    -- Afastamento PARCIAL ({M} sobre um turno MT) deixa o servidor escalado — ele trabalha a tarde.
    IF v_afastamento_nome IS NOT NULL
       AND public.fn_afastamento_anula_turno(v_afastamento_integral, v_afastamento_slots, v_turno_slots) THEN`

// ============================================================ FONTE 1: fn_check_shift_conflicts
const conflitos = { sql: ler(FONTE_CONFLITOS) }

sub(conflitos, 'declare/check', `    v_afastamento_nome TEXT;
    v_afastamento_slots TEXT[];
    v_permitir_plantao BOOLEAN;`, `    v_afastamento_nome TEXT;
    v_afastamento_slots TEXT[];
    v_afastamento_integral BOOLEAN;
    v_permitir_plantao BOOLEAN;`)

sub(conflitos, 'select/check', SELECT_ANTIGO_CHECK, SELECT_NOVO_CHECK)

// Recorta so a funcao (a fonte tem cabecalho proprio, o DROP e os GRANT).
const iCheck = conflitos.sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_check_shift_conflicts')
const fimCheck = conflitos.sql.indexOf('$function$;', iCheck)
if (iCheck < 0 || fimCheck < 0) {
  console.error('ABORTADO: nao achei fn_check_shift_conflicts em ' + path.basename(FONTE_CONFLITOS))
  process.exit(1)
}
const BLOCO_CHECK = conflitos.sql.slice(iCheck, fimCheck + '$function$;'.length)

// Os privilegios da versao de 7 argumentos vem junto — recria-los e obrigatorio se a assinatura
// mudar, e inofensivo se nao mudar (armadilha 24/41).
const iGrant = conflitos.sql.indexOf('GRANT EXECUTE ON FUNCTION public.fn_check_shift_conflicts')
const PRIVILEGIOS_CHECK = iGrant >= 0 ? conflitos.sql.slice(iGrant).trim() : ''

// ======================================================= FONTE 2: os dois triggers de afastamento
const triggers = { sql: ler(FONTE_TRIGGERS) }

sub(triggers, 'declare/prevent', `    v_afastamento_nome TEXT;
    v_permitir_plantao BOOLEAN;
    v_shift_date DATE;
    v_turno_slots TEXT[];`, `    v_afastamento_nome TEXT;
    v_afastamento_slots TEXT[];
    v_afastamento_integral BOOLEAN;
    v_permitir_plantao BOOLEAN;
    v_shift_date DATE;
    v_turno_slots TEXT[];`)

sub(triggers, 'select/prevent', `    -- Verificar se o servidor possui algum afastamento integral ou de slot ativo
    SELECT te.nome INTO v_afastamento_nome
    FROM public.servidores_eventos se
    JOIN public.tipos_eventos te ON te.id = se.tipo_evento_id
    WHERE se.servidor_id = v_servidor_id
      AND v_shift_date >= se.data_inicio
      AND v_shift_date <= se.data_fim
      AND COALESCE(se.periodo_tipo, 'integral') <> 'horas'
      AND se.hora_inicio IS NULL
      AND (
        se.slots IS NULL
        OR array_length(se.slots, 1) IS NULL
        OR se.slots && v_turno_slots
      )
    LIMIT 1;

    IF v_afastamento_nome IS NOT NULL THEN`, `    -- Afastamento/evento do dia, lido em conjunto (ver fn_afastamento_dia).
    SELECT a.nome, a.integral, a.slots
      INTO v_afastamento_nome, v_afastamento_integral, v_afastamento_slots
    FROM public.fn_afastamento_dia(v_servidor_id, v_shift_date) a;

    -- Mesma regra da fn_check_shift_conflicts: so recusa o que ANULA o turno inteiro.
    IF v_afastamento_nome IS NOT NULL
       AND public.fn_afastamento_anula_turno(v_afastamento_integral, v_afastamento_slots, v_turno_slots) THEN`)

// ⚠️ O `integral` TEM que sair da propria fn_afastamento_dia, nunca um FALSE fixo: um afastamento
// integral convivendo com um parcial no mesmo dia seria classificado como parcial, e a escala
// deixaria de ser apagada num dia inteiramente afastado.
// ⚠️ E o COALESCE nao e zelo: sem afastamento no dia o subselect da NULL, e `AND NOT NULL` e NULL
// — a linha nao seria apagada. O default de uma limpeza tem que ser "apaga como antes".
const GUARD_LIMPEZA = `      AND NOT COALESCE((
            SELECT public.fn_afastamento_parcial_no_turno(
                     ad.integral,
                     ad.slots,
                     (SELECT dt.slots FROM public.dicionario_turnos dt WHERE dt.id = ed.dicionario_turnos_id))
            FROM public.fn_afastamento_dia(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia)) ad
          ), FALSE)
`

sub(triggers, 'delete/permite-plantao', `      AND ed.categoria IN ('Regular', 'Sobreaviso')
      AND ed.presenca_entrada_em IS NULL`, `      AND ed.categoria IN ('Regular', 'Sobreaviso')
` + GUARD_LIMPEZA + `      AND ed.presenca_entrada_em IS NULL`)

sub(triggers, 'delete/geral', `      AND MAKE_DATE(em.ano, em.mes, ed.dia) <= NEW.data_fim
      AND ed.presenca_entrada_em IS NULL
      AND ed.presenca_saida_em IS NULL
      AND ed.presenca_confirmada = false
      AND ed.confirmado_por_id IS NULL;
  END IF;`, `      AND MAKE_DATE(em.ano, em.mes, ed.dia) <= NEW.data_fim
` + GUARD_LIMPEZA + `      AND ed.presenca_entrada_em IS NULL
      AND ed.presenca_saida_em IS NULL
      AND ed.presenca_confirmada = false
      AND ed.confirmado_por_id IS NULL;
  END IF;`)

// Recorta as duas funcoes de trigger, da fn_prevent ate o fim do arquivo.
const iPrevent = triggers.sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_prevent_shift_during_event')
if (iPrevent < 0) {
  console.error('ABORTADO: nao achei fn_prevent_shift_during_event em ' + path.basename(FONTE_TRIGGERS))
  process.exit(1)
}
const BLOCO_TRIGGERS = triggers.sql.slice(iPrevent)

// -------------------------------------------------------------------- cabecalho da migration
const CABECALHO = `-- Migration: Afastamento parcial por slot preserva o turno do periodo trabalhado
-- Description: Um afastamento de MEIO PERIODO (slots = {M} sobre um turno MT) deixava o dia
-- inteiro em branco: fn_clean_conflicting_shifts APAGAVA a escala_diaria do dia (o DELETE nunca
-- olhou slot nenhum, so data) e fn_prevent_shift_during_event impedia relancar, porque a condicao
-- era INTERSECAO (se.slots && v_turno_slots). O periodo efetivamente trabalhado sumia da folha,
-- que imprimia "AFASTAMENTO PARCIAL: ... | FOLGA" sem horario nenhum.
--
-- Caso real (LUANA JESUS DE OLIVEIRA, mat. 52705, DMAC/SMS, 25 e 27/08/2026): DECLARACAO DE
-- COMPARECIMENTO com slots {M} sobre jornada 08H AS 18H (turno MT). Os dois dias ficaram sem
-- linha em escala_diaria e sem hora nenhuma na folha, embora ela tenha trabalhado as duas tardes.
--
-- A regra passa a ser a CONTENCAO, nao a intersecao:
--   integral (sem slots)            -> anula o turno   (inalterado)
--   slots que COBREM o turno        -> anula o turno   (inalterado)
--   slots que alcancam PARTE dele   -> PARCIAL: preserva a escala e nao bloqueia (novo)
--   slots que NAO alcancam o turno  -> nao e parcial; a limpeza continua apagando (inalterado)
--
-- ⚠️ O ultimo caso e deliberado e nao pode ser "consertado" junto. Ha Ferias e Licenca Premio
-- lancadas em producao com slots {M,T} sobre turno N (intersecao VAZIA) — uso indevido do campo,
-- mas cuja escala precisa continuar sendo apagada. Parar de apagar ali deixaria o servidor
-- escalado durante as proprias ferias.
--
-- ⚠️ A leitura e do DIA, nunca de um evento isolado: duas declaracoes de comparecimento no mesmo
-- dia (uma {M} e outra {T}, caso KETHURY CHAVES em 14/08/2026) sao parciais uma a uma e juntas
-- COBREM o turno MT. fn_afastamento_dia devolve a uniao — sem isso, o dia inteiro afastado
-- passaria como se fosse meio periodo.
--
-- 🚨 COPIA MECANICA DE DUAS FONTES, via scratchpad/gen_afastamento_parcial.js. Nao editar a mao.
--      fn_check_shift_conflicts      <- 20260821100000_conflict_check_ignores_own_cell.sql
--      fn_prevent_shift_during_event <- 20260820120000_block_all_categories_during_leave.sql
--      fn_clean_conflicting_shifts   <- 20260820120000_block_all_categories_during_leave.sql
--    A primeira versao deste gerador copiou as TRES de 20260820120000 e produziu uma migration
--    inofensiva na pratica: fn_check_shift_conflicts ganhou o 7o argumento (p_escala_mensal_id)
--    em 20260821100000, e e a de 7 que o ScaleGrid chama — a de 6 seria uma sobrecarga morta.
--    So apareceu ao aplicar em homologacao ("function is not unique").
--
-- MEDIDO EM PRODUCAO EM 04/09/2026, ANTES DE APLICAR (scratchpad/an_impacto_parcial.mjs):
--   495 servidores_eventos, 48 deles por slot, 242 pares (servidor, dia) alcancados.
--   Com a ESCALA VIVA: 0 dias em que o afastamento cobre o turno, 1 de intersecao vazia e
--   ZERO dias parciais. Ou seja: NENHUMA folha existente muda de valor com esta migration — ela
--   apenas passa a permitir o que hoje e impossivel. Os 152 dias parciais ja tiveram a escala
--   apagada e nao voltam sozinhos; relanca-los e ato do coordenador na grade.

-- ---------------------------------------------------------------------------------------------
-- 1. Fonte unica: o afastamento do DIA, e a classificacao dele contra os slots de um turno.
-- ---------------------------------------------------------------------------------------------

-- Afastamentos bloqueantes (nao por horas) que alcancam p_data, lidos em conjunto.
-- Devolve zero linhas quando nao ha nenhum. integral e verdadeiro se ALGUM deles nao tem slots.
CREATE OR REPLACE FUNCTION public.fn_afastamento_dia(
    p_servidor_id UUID,
    p_data DATE
)
RETURNS TABLE(nome TEXT, integral BOOLEAN, slots TEXT[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_nome TEXT;
    v_integral BOOLEAN := FALSE;
    v_slots TEXT[] := ARRAY[]::TEXT[];
    r RECORD;
BEGIN
    FOR r IN
        SELECT te.nome AS tipo_nome, se.slots AS ev_slots
        FROM public.servidores_eventos se
        JOIN public.tipos_eventos te ON te.id = se.tipo_evento_id
        WHERE se.servidor_id = p_servidor_id
          AND p_data >= se.data_inicio
          AND p_data <= se.data_fim
          AND COALESCE(se.periodo_tipo, 'integral') <> 'horas'
          AND se.hora_inicio IS NULL
        ORDER BY te.nome
    LOOP
        IF v_nome IS NULL THEN
            v_nome := r.tipo_nome;
        END IF;
        IF r.ev_slots IS NULL OR array_length(r.ev_slots, 1) IS NULL THEN
            v_integral := TRUE;
        ELSE
            SELECT ARRAY(SELECT DISTINCT s FROM unnest(v_slots || r.ev_slots) AS s ORDER BY s)
              INTO v_slots;
        END IF;
    END LOOP;

    IF v_nome IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY SELECT v_nome, v_integral, v_slots;
END;
$function$;

-- O afastamento ANULA este turno? Integral sempre anula; por slot, so quando COBRE todos eles.
-- Turno sem slots conhecidos nunca e anulado por afastamento de slot — igual ao operador && de
-- antes, que da falso com array vazio.
CREATE OR REPLACE FUNCTION public.fn_afastamento_anula_turno(
    p_integral BOOLEAN,
    p_slots TEXT[],
    p_turno_slots TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT CASE
        WHEN COALESCE(p_integral, FALSE) THEN TRUE
        WHEN p_turno_slots IS NULL OR array_length(p_turno_slots, 1) IS NULL THEN FALSE
        WHEN p_slots IS NULL OR array_length(p_slots, 1) IS NULL THEN FALSE
        ELSE p_turno_slots <@ p_slots
    END;
$function$;

-- O afastamento e PARCIAL neste turno? Alcanca parte dele E nao o cobre.
-- ⚠️ Intersecao VAZIA nao e parcial: e o caso das ferias lancadas com slots que nao batem com o
-- turno, e ali a limpeza de escala precisa continuar valendo.
CREATE OR REPLACE FUNCTION public.fn_afastamento_parcial_no_turno(
    p_integral BOOLEAN,
    p_slots TEXT[],
    p_turno_slots TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT CASE
        WHEN COALESCE(p_integral, FALSE) THEN FALSE
        WHEN p_turno_slots IS NULL OR array_length(p_turno_slots, 1) IS NULL THEN FALSE
        WHEN p_slots IS NULL OR array_length(p_slots, 1) IS NULL THEN FALSE
        WHEN NOT (p_slots && p_turno_slots) THEN FALSE
        ELSE NOT (p_turno_slots <@ p_slots)
    END;
$function$;

-- Armadilha 24: CREATE FUNCTION ja concede EXECUTE a PUBLIC. As tres sao chamadas apenas de
-- dentro de funcoes SECURITY DEFINER, que executam com os privilegios do dono.
REVOKE ALL ON FUNCTION public.fn_afastamento_dia(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_afastamento_anula_turno(BOOLEAN, TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_afastamento_parcial_no_turno(BOOLEAN, TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_afastamento_dia(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_afastamento_anula_turno(BOOLEAN, TEXT[], TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_afastamento_parcial_no_turno(BOOLEAN, TEXT[], TEXT[]) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. fn_check_shift_conflicts — copia de 20260821100000 (a de SETE argumentos).
-- ---------------------------------------------------------------------------------------------

-- ⚠️ A sobrecarga de 6 argumentos foi derrubada por 20260821100000 e nao pode voltar: com as duas
-- vivas, a chamada do ScaleGrid fica ambigua para o PostgREST (PGRST203 / "is not unique").
-- Este DROP e defensivo — um ambiente onde ela tenha sido ressuscitada volta ao estado correto.
DROP FUNCTION IF EXISTS public.fn_check_shift_conflicts(UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT);

${BLOCO_CHECK}

${PRIVILEGIOS_CHECK}

-- ---------------------------------------------------------------------------------------------
-- 3. Os dois gatilhos de afastamento — copia de 20260820120000.
-- ---------------------------------------------------------------------------------------------

${BLOCO_TRIGGERS}`

const saida = CABECALHO

// ------------------------------------------------------------------- conferencia estrutural
const conta = (re) => (saida.match(re) || []).length
// Codigo executavel, sem as linhas de comentario: o cabecalho CITA a condicao antiga.
const codigo = saida.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
const invariantes = [
  ['delimitadores $function$ em pares', conta(/\$function\$/g) % 2 === 0],
  ['delimitadores $$ soltos em pares', conta(/(?<![$a-zA-Z_])\$\$(?![$a-zA-Z_])/g) % 2 === 0],
  ['3 funcoes auxiliares novas', conta(/CREATE OR REPLACE FUNCTION public\.fn_afastamento_/g) === 3],
  ['fn_check_shift_conflicts 1x', conta(/CREATE OR REPLACE FUNCTION public\.fn_check_shift_conflicts/g) === 1],
  ['fn_check_shift_conflicts com p_escala_mensal_id (a versao VIGENTE, 7 args)', /p_escala_mensal_id UUID DEFAULT NULL/.test(codigo)],
  ['exclusao da propria celula preservada (20260821100000)', /AND em\.id = p_escala_mensal_id\n\s+AND ed\.categoria = p_categoria::public\.escala_categoria/.test(codigo)],
  ['DROP da sobrecarga de 6 argumentos', /DROP FUNCTION IF EXISTS public\.fn_check_shift_conflicts\(UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT\);/.test(codigo)],
  ['fn_prevent_shift_during_event 1x', conta(/CREATE OR REPLACE FUNCTION public\.fn_prevent_shift_during_event/g) === 1],
  ['fn_clean_conflicting_shifts 1x', conta(/CREATE OR REPLACE FUNCTION public\.fn_clean_conflicting_shifts/g) === 1],
  ['intersecao "se.slots && v_turno_slots" removida', !/se\.slots && v_turno_slots/.test(codigo)],
  ['conflito entre setores "dt.slots && v_turno_slots" preservado', conta(/dt\.slots && v_turno_slots/g) === 1],
  ['fn_afastamento_parcial_no_turno: 1 def + 2 privilegios + 2 DELETE', conta(/fn_afastamento_parcial_no_turno\(/g) === 5],
  ['fn_afastamento_anula_turno: 1 def + 2 privilegios + 2 usos', conta(/fn_afastamento_anula_turno\(/g) === 5],
  ['fn_afastamento_dia: 1 def + 2 privilegios + 2 SELECT + 2 DELETE', conta(/fn_afastamento_dia\(/g) === 7],
  ['guard de categoria Regular/Sobreaviso preservado', conta(/IN \('Regular', 'Sobreaviso'\)/g) === 3],
  ['permitir_plantao_extra ainda consultado 3x', conta(/permitir_plantao_extra_durante_eventos/g) === 3],
  ['guard de afastamento por horas preservado', conta(/'integral'\) (?:<>|=) 'horas'/g) === 2],
  ['guard de presenca preservado nos 2 DELETE', conta(/ed\.presenca_confirmada = false/g) === 2],
  ['privilegios de fn_check_shift_conflicts recriados', /GRANT EXECUTE ON FUNCTION public\.fn_check_shift_conflicts/.test(codigo)],
  ['gatilho reafirmado', /CREATE TRIGGER trigger_prevent_shift_during_event/.test(saida)],
]
let falhou = false
for (const [nome, ok] of invariantes) {
  console.log((ok ? 'ok    ' : 'FALHA ') + nome)
  if (!ok) falhou = true
}
if (falhou) {
  console.error('\nABORTADO: invariante estrutural violado. Nada foi escrito.')
  process.exit(1)
}

fs.writeFileSync(DESTINO, saida.replace(/\n/g, '\r\n'), 'utf8')
console.log('\nsubstituicoes: ' + subs.join(' | '))
console.log('escrito: ' + path.relative(process.cwd(), DESTINO))
