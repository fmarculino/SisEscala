// Gera 20260917140000_batida_retida_na_previa.sql a partir de
// 20260908110000_reconciliacao_pendente_na_grade.sql (copia mecanica, armadilha 1).
//
// O QUE MUDA
//   fn_reconciliacao_pendente_escala e fn_reconciliar_dia_pendente passam a enxergar as
//   batidas FISICAS que uma reversao tirou de circulacao, e a dizer isso em vez de responder
//   "Nada a preencher neste dia".
//
// ABORTA se qualquer substituicao nao bater na contagem esperada, se o EOL divergir, ou se
// um invariante da fonte tiver sumido.
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const FONTE = path.join(RAIZ, 'supabase/migrations/20260908110000_reconciliacao_pendente_na_grade.sql')
const DESTINO = path.join(RAIZ, 'supabase/migrations/20260917140000_batida_retida_na_previa.sql')

const bruto = fs.readFileSync(FONTE, 'utf8')

// EOL DETECTADO, NUNCA ASSUMIDO (armadilha 59): a convencao do projeto e CRLF, mas ha
// migrations em LF. Padrao montado com o EOL errado vira no-op silencioso.
const EOL = bruto.includes('\r\n') ? '\r\n' : '\n'
const src = bruto.split(/\r?\n/).join('\n')
console.log(`fonte: ${path.basename(FONTE)} (EOL ${EOL === '\r\n' ? 'CRLF' : 'LF'})`)

function recortar(nome, fim) {
  const ini = src.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`)
  if (ini < 0) throw new Error(`ABORTADO: nao achei ${nome} na fonte.`)
  const f = src.indexOf(fim, ini)
  if (f < 0) throw new Error(`ABORTADO: nao achei o fim de ${nome}.`)
  return src.slice(ini, f + fim.length)
}

let previa = recortar('fn_reconciliacao_pendente_escala', '\n$$;')
let aplica = recortar('fn_reconciliar_dia_pendente', '\n$fn$;')

// ---------------------------------------------------------------------------
// Invariantes da FONTE. Se qualquer um sumir, a fonte mudou e o gerador precisa ser revisto.
// ---------------------------------------------------------------------------
const invariantesFonte = [
  ['previa: janela de batida D-1..D+2', previa, /mp\.ocorrido_em >= \(c\.data - 1\)/, 1],
  ['previa: elegivel exige ganho puro', previa, /bool_and\(t\.tipo = 'ganho' AND t\.impedimento IS NULL\)/, 1],
  ['aplica: recusa conflito', aplica, /'status','conflito'/, 1],
  ['aplica: recusa sem_mudanca', aplica, /'status','sem_mudanca'/, 1],
  ['aplica: limpar_sem_marcacao continua FALSE', aplica, /fn_reconciliar_marcacoes_dia\(p_servidor_id, p_data, false\)/, 1],
]
for (const [nome, texto, re, n] of invariantesFonte) {
  const achou = (texto.match(new RegExp(re.source, 'g')) || []).length
  if (achou !== n) throw new Error(`ABORTADO: invariante da fonte "${nome}" -> ${achou} ocorrencia(s), esperado ${n}.`)
}
console.log(`invariantes da fonte: ${invariantesFonte.length} ok`)

// ---------------------------------------------------------------------------
// Substituicoes. O 2o argumento de String.replace e SEMPRE funcao (armadilha: $$ e $' em
// string de substituicao sao padroes do JS e destroem dollar-quoting de plpgsql).
// ---------------------------------------------------------------------------
const trocas = []
function trocar(rotulo, alvo, de, para, n = 1) {
  const achou = (alvo.match(new RegExp(de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  if (achou !== n) throw new Error(`ABORTADO: "${rotulo}" -> ${achou} ocorrencia(s), esperado ${n}.`)
  trocas.push(rotulo)
  return alvo.split(de).join(para)
}

// --- (1) coluna nova no RETURNS TABLE -------------------------------------
// CREATE OR REPLACE nao altera a lista de colunas de um RETURNS TABLE: a migration derruba a
// assinatura antes (DROP explicito, sem CASCADE).
previa = trocar('previa: coluna batidas_retidas', previa,
  `    dia_elegivel     boolean,
    impedimento      text
)`,
  `    dia_elegivel     boolean,
    impedimento      text,
    batidas_retidas  integer
)`)

// --- (2) CTE que conta as batidas retidas do dia --------------------------
previa = trocar('previa: CTE retidas', previa,
  `com_batida AS (`,
  `-- Batidas FISICAS que uma reversao tirou de circulacao neste dia. Elas existem, estao
-- gravadas e corretas -- e fn_alocar_marcacoes_dia as filtra, entao a projecao nao as ve.
-- Sem esta contagem, o dia ou some da lista (a projecao iguala o atual) ou aparece como
-- troca/perda sem dizer que a causa e reversivel. Ver 20260917140000.
retidas AS (
    SELECT c.escala_mensal_id, c.servidor_id, c.status, c.mes, c.ano, c.data,
           count(*)::integer AS n
      FROM candidatos c
      JOIN public.marcacoes_ponto mp
        ON mp.servidor_id = c.servidor_id
       AND mp.ocorrido_em >= (c.data - 1)
       AND mp.ocorrido_em <  (c.data + 2)
       AND public.fn_batida_fisica(mp.origem, mp.sintetica)
       AND public.fn_marcacao_desconsiderada(mp.id)
     GROUP BY 1,2,3,4,5,6
),
com_batida AS (`)

// --- (3) a coluna no SELECT final + as linhas de diagnostico --------------
previa = trocar('previa: select final', previa,
  `SELECT t.escala_mensal_id, t.servidor_id, s.nome::text, t.dia, t.data, t.escala_diaria_id,
       t.categoria, t.turno_codigo::text, t.campo, t.atual, t.projetado, t.origem,
       t.tipo, d.elegivel, t.impedimento
  FROM tipado t
  JOIN por_dia d ON d.servidor_id = t.servidor_id AND d.data = t.data
  JOIN public.servidores s ON s.id = t.servidor_id
 ORDER BY s.nome, t.data, t.categoria, t.campo;`,
  `SELECT t.escala_mensal_id, t.servidor_id, s.nome::text, t.dia, t.data, t.escala_diaria_id,
       t.categoria, t.turno_codigo::text, t.campo, t.atual, t.projetado, t.origem,
       t.tipo, d.elegivel, t.impedimento, COALESCE(r.n, 0)
  FROM tipado t
  JOIN por_dia d ON d.servidor_id = t.servidor_id AND d.data = t.data
  JOIN public.servidores s ON s.id = t.servidor_id
  LEFT JOIN retidas r ON r.escala_mensal_id = t.escala_mensal_id AND r.data = t.data

UNION ALL

-- LINHA DE DIAGNOSTICO. O dia cuja projecao iguala o atual nao produz nenhuma linha em
-- cmp (ela filtra projetado IS DISTINCT FROM atual) -- e e exatamente o caso em que a
-- reversao levou TODAS as candidatas: a tela respondia "Nada a preencher neste dia" com
-- batida real retida no banco. Aqui o dia aparece, com campo e tipo proprios e
-- dia_elegivel = false: e diagnostico, nunca algo a aplicar.
SELECT r.escala_mensal_id, r.servidor_id, s.nome::text,
       extract(day from r.data)::integer, r.data, NULL::uuid,
       NULL::text, NULL::text, 'batida_retida'::text, NULL::timestamptz, NULL::timestamptz,
       NULL::public.marcacao_origem,
       'batida_retida'::text, false, 'batida_retida'::text, r.n
  FROM retidas r
  JOIN public.servidores s ON s.id = r.servidor_id
-- ⚠️ O casamento e por (escala_mensal_id, data), NUNCA por (servidor_id, data): o servidor
-- pode ter DUAS escalas no mes (outro setor), e retidas tem uma linha por escala. Por
-- servidor, o LEFT JOIN acima DUPLICARIA cada divergencia, e o diagnostico abaixo sumiria da
-- segunda escala sempre que a primeira tivesse qualquer linha.
 WHERE NOT EXISTS (
     SELECT 1 FROM tipado t2
      WHERE t2.escala_mensal_id = r.escala_mensal_id AND t2.data = r.data)

 ORDER BY 3, 5, 7, 9;`)

// --- (4) aplicacao: declarar e contar as retidas --------------------------
aplica = trocar('aplica: declarar v_retidas', aplica,
  `    v_mudados    integer;`,
  `    v_mudados    integer;
    v_retidas    integer;`)

// --- (5) aplicacao: os dois ramos novos ----------------------------------
aplica = trocar('aplica: ramos de batida retida', aplica,
  `    IF COALESCE(v_conflitos,0) > 0 THEN`,
  `    -- Batidas FISICAS que uma reversao tirou de circulacao. NAO sao restauradas aqui: isto
    -- e um caminho de preenchimento, e repor batida em circulacao e ato de quem tem
    -- autoridade (fn_restaurar_batidas_dia). O que muda e que o dia deixa de responder
    -- "nada a preencher" quando existe batida real retida no banco.
    SELECT count(*)::integer INTO v_retidas
      FROM public.fn_batidas_retidas_dia(p_servidor_id, p_data);

    IF COALESCE(v_conflitos,0) > 0 THEN`)

aplica = trocar('aplica: conflito cita as retidas', aplica,
  `            'motivo','Este dia deixou de ser so acrescimo: ha horario ja gravado que a '
                  || 'reconciliacao mudaria. Resolva pela validacao manual.');`,
  `            'motivo','Este dia deixou de ser so acrescimo: ha horario ja gravado que a '
                  || 'reconciliacao mudaria. Resolva pela validacao manual.'
                  || CASE WHEN COALESCE(v_retidas,0) > 0
                          THEN ' Atencao: ' || v_retidas::text || ' batida(s) real(is) deste '
                            || 'dia foram tiradas de circulacao por uma reversao -- restaure-as '
                            || 'antes, porque sem elas a projecao trabalha com menos batidas do '
                            || 'que houve.'
                          ELSE '' END,
            'batidas_retidas', COALESCE(v_retidas,0));`)

aplica = trocar('aplica: sem_mudanca vira batida_retida', aplica,
  `    IF COALESCE(v_ganhos,0) = 0 THEN
        RETURN jsonb_build_object('status','sem_mudanca','campos',0,
            'motivo','Nada a preencher neste dia.');
    END IF;`,
  `    IF COALESCE(v_ganhos,0) = 0 THEN
        IF COALESCE(v_retidas,0) > 0 THEN
            RETURN jsonb_build_object('status','batida_retida','campos',0,
                'batidas_retidas', v_retidas,
                'motivo', v_retidas::text || ' batida(s) real(is) deste dia foram tiradas de '
                       || 'circulacao por uma reversao de presenca. Elas continuam gravadas: '
                       || 'restaure-as para que possam ser aplicadas.');
        END IF;
        RETURN jsonb_build_object('status','sem_mudanca','campos',0,
            'motivo','Nada a preencher neste dia.');
    END IF;`)

// --- montagem --------------------------------------------------------------
const cabecalho = `-- Migration: a previa de reconciliacao passa a enxergar batida retida por reversao
-- Data: 2026-09-17
-- Plano: docs/planos/2026-09-17-batida-que-nao-alcanca-a-escala-certa.md (defeito D2, fase a)
-- Gerada por scratchpad/gen_batida_retida.js a partir de
--   20260908110000_reconciliacao_pendente_na_grade.sql (copia mecanica, armadilha 1).
--   NAO EDITAR A MAO: regenere pelo script, que aborta se a fonte divergir.
--
-- O QUE ESTAVA ERRADO
--   fn_sincronizar_marcacoes_escala_diaria grava 'desconsiderar' sempre que um UPDATE zera um
--   passo de presenca -- e o trigger nao sabe POR QUE o passo esta sendo zerado. Quem reverte
--   para corrigir a escala e relancar o dia perde a batida REAL junto, e a partir dai
--   fn_alocar_marcacoes_dia a filtra. O "Preencher pelas Batidas" entao responde
--   "Nada a preencher neste dia" (quando a reversao levou TODAS as candidatas) ou recusa por
--   'conflito' sem dizer que a causa e reversivel.
--
--   Medido em producao em 17/09/2026: 1.166 tratamentos 'desconsiderar' vigentes, 1.092 deles
--   com a justificativa automatica da reversao; 173 sao batida FISICA (146 rep + terminal nao
--   sintetica); 20 dias tem escala hoje com passo vazio e 16 deles a tela fica MUDA.
--   So em 17/09 foram 47 batidas rep tiradas de circulacao, em 14 servidores.
--
--   Caso real (THAYNA, mat 69051, 03/09/2026): quatro batidas do turno Regular MT -- 07:08,
--   14:51, 15:51 e 19:00 -- foram desconsideradas em 17/09 entre 15:46 e 15:47. A linha do MT
--   ficou vazia e reconciliado_em NUNCA; com quatro das sete candidatas fora, a projecao passou
--   a propor TROCAR a entrada em 176 min e PERDER o intervalo, e o botao recusou.
--
-- O QUE ESTA MIGRATION FAZ, E O QUE ELA NAO FAZ
--   FAZ: as duas superficies do "Preencher pelas Batidas" passam a contar as batidas fisicas
--   desconsideradas do dia e a dize-lo -- a previa com uma linha de diagnostico propria
--   (tipo 'batida_retida', dia_elegivel = false) e a aplicacao com um status proprio.
--   NAO FAZ: nao restaura nada e nao reconcilia nada por conta propria. Repor batida em
--   circulacao e ato de quem tem autoridade -- fn_restaurar_batidas_dia (20260917160000).
--
-- 🚨 ASSINATURA NOVA E OBJETO NOVO (armadilhas 24 e 41)
--   fn_reconciliacao_pendente_escala ganha a coluna batidas_retidas no RETURNS TABLE, e
--   CREATE OR REPLACE NAO altera a lista de colunas (42P13). A assinatura antiga e derrubada
--   com DROP explicito -- sem CASCADE, para um dependente de verdade dar erro em vez de sumir
--   em silencio -- e os privilegios sao REESCRITOS aqui: objeto novo nasce com EXECUTE para
--   PUBLIC.
--
-- ORDEM DE DEPLOY
--   A coluna nova e ACRESCENTADA no fim do RETURNS TABLE e o frontend le por nome, entao o
--   bundle anterior continua funcionando. O status 'batida_retida' e novo: a tela antiga cai
--   no ramo generico e mostra o 'motivo', que ja e legivel.


-- ============================================================================
-- 1. FONTE UNICA: o que e "batida fisica" e quais estao retidas
-- ============================================================================
-- ⚠️ "Batida fisica" nao e "origem rep ou terminal". marcacoes_ponto de origem 'terminal' e
--    sintetica = true sao os timestamps FABRICADOS por fn_salvar_saida_bloco (ate 5 por
--    batida) -- 533 delas so em 08/2026. Restaurar ou contabilizar essas seria tratar
--    horario inventado como fato. ajuste_coordenador / ajuste_servidor sao declaracao de
--    alguem, e tambem ficam de fora: quem as reverteu esta desfazendo a propria declaracao.

CREATE OR REPLACE FUNCTION public.fn_batida_fisica(
    p_origem    public.marcacao_origem,
    p_sintetica boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
    SELECT p_origem = 'rep'
        OR (p_origem = 'terminal' AND COALESCE(p_sintetica, false) = false);
$fn$;

COMMENT ON FUNCTION public.fn_batida_fisica(public.marcacao_origem, boolean) IS
    'True quando a marcacao e uma batida que a pessoa deu num equipamento: rep sempre, e '
    'terminal apenas quando NAO for sintetica (as sinteticas sao fabricadas por '
    'fn_salvar_saida_bloco). FONTE UNICA -- nao replicar o predicado.';

REVOKE ALL ON FUNCTION public.fn_batida_fisica(public.marcacao_origem, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_batida_fisica(public.marcacao_origem, boolean) TO authenticated, service_role;


-- As batidas fisicas do dia que estao fora de circulacao AGORA.
-- A janela D-1 .. D+2 e a MESMA de fn_reconciliacao_pendente_escala: um turno que atravessa a
-- meia-noite tem batida nos dois dias civis, e uma janela mais estreita esconderia metade delas.
CREATE OR REPLACE FUNCTION public.fn_batidas_retidas_dia(
    p_servidor_id uuid,
    p_data        date
)
RETURNS TABLE (
    marcacao_id uuid,
    origem      public.marcacao_origem,
    ocorrido_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT m.id, m.origem, m.ocorrido_em
      FROM public.marcacoes_ponto m
     WHERE m.servidor_id = p_servidor_id
       AND public.fn_batida_fisica(m.origem, m.sintetica)
       AND m.ocorrido_em >= (p_data - 1)
       AND m.ocorrido_em <  (p_data + 2)
       AND public.fn_marcacao_desconsiderada(m.id)
     ORDER BY m.ocorrido_em;
$fn$;

COMMENT ON FUNCTION public.fn_batidas_retidas_dia(uuid, date) IS
    'Batidas fisicas do dia que estao fora de circulacao agora (ultimo tratamento = '
    'desconsiderar). Janela D-1..D+2, a mesma da previa de reconciliacao, porque turno que '
    'atravessa a meia-noite tem batida nos dois dias civis.';

REVOKE ALL ON FUNCTION public.fn_batidas_retidas_dia(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_batidas_retidas_dia(uuid, date) TO authenticated, service_role;


-- ============================================================================
-- 2. A PREVIA (copia mecanica; so o que esta marcado no gerador mudou)
-- ============================================================================
DROP FUNCTION IF EXISTS public.fn_reconciliacao_pendente_escala(uuid[]);

`

// 🚨 Os privilegios sao REESCRITOS aqui, e nao vieram de graca com a copia. O recorte da funcao
//    vai ate o delimitador de fechamento; o REVOKE/GRANT da fonte fica FORA dele. Sem estas
//    linhas, o DROP + CREATE devolve a funcao a PUBLIC (armadilha 24/41) -- foi exatamente o que
//    a conferencia 4.5 pegou em homologacao, com a funcao ja correta em todo o resto.
const meio = `

REVOKE ALL ON FUNCTION public.fn_reconciliacao_pendente_escala(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reconciliacao_pendente_escala(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_reconciliacao_pendente_escala(uuid[]) IS
    'Previa read-only do que a reconciliacao faria nas escalas dadas. dia_elegivel e a decisao '
    'do par (servidor, dia): false assim que qualquer campo do dia for troca ou perda. '
    'batidas_retidas conta as batidas FISICAS que uma reversao tirou de circulacao naquele dia, '
    'e o tipo batida_retida e a linha de diagnostico do dia que so tem isso. Nao escreve nada.';


-- ============================================================================
-- 3. A APLICACAO (copia mecanica; so o que esta marcado no gerador mudou)
-- ============================================================================

`

const conferencia = `

-- fn_reconciliar_dia_pendente e CREATE OR REPLACE sobre a MESMA assinatura (nao ha coluna nova
-- a declarar), entao ela conserva os privilegios. Reafirmados assim mesmo: custa uma linha e
-- torna a migration reaplicavel sobre um banco onde alguem tenha mexido nisso.
REVOKE ALL ON FUNCTION public.fn_reconciliar_dia_pendente(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reconciliar_dia_pendente(uuid, date) TO authenticated, service_role;


-- ============================================================================
-- 4. CONFERENCIA -- EXECUTA as funcoes, nunca so checa se existem (armadilha 42)
-- ============================================================================
-- 🚨 Conferir que a funcao EXISTE nao serve: plpgsql e SQL so resolvem nome de coluna, de
--    funcao e operador na EXECUCAO. A 20260916100000 so nao foi a producao quebrada porque a
--    conferencia dela chamava a funcao.
DO $conf$
DECLARE
    v_cols     integer;
    v_res      text;
    v_srv      uuid;
    v_r        jsonb;
    v_n        integer;
BEGIN
    -- 4.1 A coluna nova existe, E ha exatamente UMA fn_reconciliacao_pendente_escala.
    -- ⚠️ A leitura e por pg_get_function_result, nao por information_schema.parameters: ali as
    --    colunas de um RETURNS TABLE nao aparecem com parameter_mode = 'TABLE' de forma
    --    confiavel, e a primeira versao desta conferencia abortou por isso em homologacao com
    --    a funcao JA correta -- conferencia que reprova o certo e pior que conferencia nenhuma.
    SELECT count(*) INTO v_cols
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_reconciliacao_pendente_escala';
    -- ⚠️ RAISE EXCEPTION exige string LITERAL: 'a ' || 'b' da 42601, e so na EXECUCAO do
    --    CREATE -- nenhum tsc/build alcanca. Foi o que derrubou a primeira aplicacao desta
    --    conferencia em homologacao.
    IF v_cols <> 1 THEN
        RAISE EXCEPTION 'ABORTADO: ha % versao(oes) de fn_reconciliacao_pendente_escala (esperado 1). Sobrecarga faz o PostgREST devolver PGRST203 (armadilha 41).', v_cols;
    END IF;

    SELECT pg_get_function_result(p.oid) INTO v_res
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_reconciliacao_pendente_escala';
    IF v_res IS NULL OR v_res NOT LIKE '%batidas_retidas integer%' THEN
        RAISE EXCEPTION 'ABORTADO: fn_reconciliacao_pendente_escala nao expoe batidas_retidas. Retorno: %', v_res;
    END IF;
    -- O OUTRO SENTIDO: as colunas antigas nao podem ter sumido -- a grade le por nome.
    IF v_res NOT LIKE '%dia_elegivel boolean%' OR v_res NOT LIKE '%impedimento text%'
       OR v_res NOT LIKE '%valor_projetado timestamp with time zone%' THEN
        RAISE EXCEPTION 'ABORTADO: fn_reconciliacao_pendente_escala PERDEU coluna que a grade le. Retorno: %', v_res;
    END IF;

    -- 4.2 fn_batida_fisica: os QUATRO sentidos. Fechar demais aqui faria a contagem ignorar
    --     batida de terminal legitima; abrir demais faria horario FABRICADO contar como fato.
    IF NOT public.fn_batida_fisica('rep', false)                 THEN RAISE EXCEPTION 'ABORTADO: rep nao-sintetica deveria ser fisica.'; END IF;
    IF NOT public.fn_batida_fisica('rep', true)                  THEN RAISE EXCEPTION 'ABORTADO: rep e SEMPRE fisica (o AFD grava com precisao de minuto, entao sintetica nao se aplica a ela).'; END IF;
    IF NOT public.fn_batida_fisica('terminal', false)            THEN RAISE EXCEPTION 'ABORTADO: terminal nao-sintetica deveria ser fisica.'; END IF;
    IF     public.fn_batida_fisica('terminal', true)             THEN RAISE EXCEPTION 'ABORTADO: terminal SINTETICA nao pode contar como batida (fn_salvar_saida_bloco fabrica ate 5 por batida).'; END IF;
    IF     public.fn_batida_fisica('ajuste_coordenador', false)  THEN RAISE EXCEPTION 'ABORTADO: ajuste_coordenador e declaracao, nao batida.'; END IF;
    IF     public.fn_batida_fisica('ajuste_servidor', false)     THEN RAISE EXCEPTION 'ABORTADO: ajuste_servidor e declaracao, nao batida.'; END IF;
    IF NOT public.fn_batida_fisica('terminal', NULL)             THEN RAISE EXCEPTION 'ABORTADO: sintetica NULA deve cair para nao-sintetica (COALESCE).'; END IF;

    -- 4.3 EXECUTA a previa e a aplicacao contra um servidor real, sem escrever nada.
    --     fn_reconciliar_dia_pendente so escreve quando ha ganho puro; uma data sem escala
    --     nenhuma devolve 'sem_escala' antes de qualquer UPDATE.
    SELECT id INTO v_srv FROM public.servidores WHERE status = 'Ativo' LIMIT 1;
    IF v_srv IS NULL THEN
        RAISE NOTICE 'sem servidor Ativo para a sonda -- pulando 4.3';
    ELSE
        PERFORM 1 FROM public.fn_batidas_retidas_dia(v_srv, '1900-01-01'::date);
        v_r := public.fn_reconciliar_dia_pendente(v_srv, '1900-01-01'::date);
        IF v_r IS NULL OR v_r->>'status' IS NULL THEN
            RAISE EXCEPTION 'ABORTADO: fn_reconciliar_dia_pendente nao devolveu status.';
        END IF;
        RAISE NOTICE 'sonda da aplicacao: status=%', v_r->>'status';
    END IF;

    -- 4.4 A previa executa com lista vazia (caminho que a grade usa quando nada e selecionado)
    SELECT count(*) INTO v_n FROM public.fn_reconciliacao_pendente_escala(ARRAY[]::uuid[]);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'ABORTADO: previa com lista vazia devolveu % linha(s).', v_n;
    END IF;

    -- 4.5 anon NAO executa nenhuma das duas funcoes novas (armadilha 24)
    IF has_function_privilege('anon', 'public.fn_batida_fisica(public.marcacao_origem, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ainda executa fn_batida_fisica.';
    END IF;
    IF has_function_privilege('anon', 'public.fn_batidas_retidas_dia(uuid, date)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ainda executa fn_batidas_retidas_dia.';
    END IF;
    IF has_function_privilege('anon', 'public.fn_reconciliacao_pendente_escala(uuid[])', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ainda executa fn_reconciliacao_pendente_escala.';
    END IF;
    IF has_function_privilege('anon', 'public.fn_reconciliar_dia_pendente(uuid, date)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ainda executa fn_reconciliar_dia_pendente -- ela ESCREVE presenca.';
    END IF;

    -- 4.6 O OUTRO SENTIDO: authenticated NAO pode ter perdido a previa -- a grade chama com
    --     a sessao do coordenador, e revogar ali derruba o botao inteiro.
    IF NOT has_function_privilege('authenticated', 'public.fn_reconciliacao_pendente_escala(uuid[])', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated PERDEU fn_reconciliacao_pendente_escala.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_batidas_retidas_dia(uuid, date)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated PERDEU fn_batidas_retidas_dia.';
    END IF;

    RAISE NOTICE 'batida retida na previa: ok.';
END;
$conf$;
`

const saida = (cabecalho + previa + meio + aplica + conferencia).split('\n').join(EOL)
fs.writeFileSync(DESTINO, saida, 'utf8')

// ---------------------------------------------------------------------------
// Invariantes do RESULTADO
// ---------------------------------------------------------------------------
const res = saida.split(/\r?\n/).join('\n')
const invariantesSaida = [
  // A previa e LANGUAGE sql e abre/fecha com $$; as duas funcoes novas usam $fn$ e a
  // conferencia usa $conf$, nenhum deles casa com /\$\$/.
  ['dollar-quoting $$ em pares (previa)', /\$\$/g, 2],
  ['dollar-quoting $fn$ em pares', /\$fn\$/g, 6],      // fn_batida_fisica, fn_batidas_retidas_dia, fn_reconciliar_dia_pendente
  ['dollar-quoting $conf$ em pares', /\$conf\$/g, 2],
  ['DROP da assinatura antiga, sem CASCADE', /DROP FUNCTION IF EXISTS public\.fn_reconciliacao_pendente_escala\(uuid\[\]\);/g, 1],
  // Sem CASCADE no DROP: um dependente de verdade precisa dar ERRO, nunca sumir em silencio.
  // (a palavra aparece no comentario do cabecalho, entao o padrao olha o comando.)
  ['nenhum DROP com CASCADE', /DROP\s+FUNCTION[^;]*CASCADE/gi, 0],
  ['coluna batidas_retidas no RETURNS TABLE', /batidas_retidas  integer/g, 1],
  ['linha de diagnostico emitida', /'batida_retida'::text, NULL::timestamptz/g, 1],
  ['status novo na aplicacao', /'status','batida_retida'/g, 1],
  ['limpar_sem_marcacao continua FALSE', /fn_reconciliar_marcacoes_dia\(p_servidor_id, p_data, false\)/g, 1],
  ['nada e restaurado aqui', /'restaurar'/g, 0],
  ['conferencia EXECUTA a aplicacao', /public\.fn_reconciliar_dia_pendente\(v_srv/g, 1],
]
for (const [nome, re, n] of invariantesSaida) {
  const achou = (res.match(re) || []).length
  if (achou !== n) {
    fs.unlinkSync(DESTINO)
    throw new Error(`ABORTADO: invariante do resultado "${nome}" -> ${achou}, esperado ${n}. Arquivo removido.`)
  }
}

console.log(`substituicoes aplicadas: ${trocas.length}`)
for (const t of trocas) console.log(`  - ${t}`)
console.log(`invariantes do resultado: ${invariantesSaida.length} ok`)
console.log(`\nescrito: ${path.relative(RAIZ, DESTINO)} (${saida.split(/\r?\n/).length} linhas)`)
