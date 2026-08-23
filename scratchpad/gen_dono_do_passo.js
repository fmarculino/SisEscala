/**
 * Gera supabase/migrations/20260823100000_dono_do_passo_do_bloco.sql.
 *
 * Copia MECANICAMENTE os corpos vigentes e aplica substituicoes pontuais:
 *   fn_alocar_marcacoes_dia   <- 20260819200000  (+ 'turnos' no retorno, + espelho de fronteira)
 *   fn_projecao_marcacoes_dia <- 20260819210000  (+ filtro do dono do passo)
 *
 * ABORTA se qualquer ancora nao aparecer exatamente o numero esperado de vezes
 * (armadilha 1 do CLAUDE.md: seis regressoes ja sairam de recopiar essas funcoes a mao).
 *
 * ⚠️ O segundo argumento de String.replace e SEMPRE uma funcao: com string, o JS interpreta
 * $$ (dollar-quoting do plpgsql) e $' (que existe em ~ '^[0-9]+$'). Ver CLAUDE.md armadilha 1.
 */
const fs = require('fs')
const path = require('path')

const MIG = path.join(__dirname, '..', 'supabase', 'migrations')
const SRC_ALOC = path.join(MIG, '20260819200000_batida_de_transicao_entre_turnos.sql')
const SRC_PROJ = path.join(MIG, '20260819210000_coerencia_cronologica_na_projecao.sql')
const OUT = path.join(MIG, '20260823100000_dono_do_passo_do_bloco.sql')

const die = m => { console.error('ABORTADO: ' + m); process.exit(1) }
const conta = (s, sub) => s.split(sub).length - 1
function exige(s, sub, n, rot) {
  const c = conta(s, sub)
  if (c !== n) die(rot + ' — esperava ' + n + ' ocorrencia(s) de ' + JSON.stringify(sub.slice(0, 70)) + ', achei ' + c)
}
function troca(s, de, para, n, rot) {
  exige(s, de, n, rot)
  return s.split(de).join(para)
}
// Recorta de `ini` (inclusive) ate o fim de `fim` (inclusive).
function recorte(s, ini, fim, rot) {
  const a = s.indexOf(ini); if (a < 0) die(rot + ' — inicio nao encontrado')
  const b = s.indexOf(fim, a); if (b < 0) die(rot + ' — fim nao encontrado')
  return s.slice(a, b + fim.length)
}

const NL = '\r\n'
const alocSrc = fs.readFileSync(SRC_ALOC, 'utf8')
const projSrc = fs.readFileSync(SRC_PROJ, 'utf8')

// ---------------------------------------------------------------- fn_alocar_marcacoes_dia
let aloc = recorte(
  alocSrc,
  'CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia(',
  'TO authenticated, service_role;',
  'fn_alocar_marcacoes_dia'
)

// invariantes que precisam SOBREVIVER (conferidos antes e depois)
const INVARIANTES_ALOC = [
  ["c_teto_alocacao_min constant integer := 720;", 1],
  ["v_slot_opcional boolean[]     := '{}';", 1],
  ['-- REGRA DO DONO: a batida e do dia cujo passo previsto esta mais perto dela.', 1],
  ["'tipo', 'duplicada', 'marcacao_id', r.id,", 1],
  ['AND v_m_ts[k] >= v_slot_piso[s]', 1],
  ['-- 1.a BATIDA DE TRANSICAO', 1],
  ["ELSIF NOT COALESCE(v_slot_opcional[s], false) THEN", 1],
]
for (const [sub, n] of INVARIANTES_ALOC) exige(aloc, sub, n, 'aloc ANTES')

// 1) variavel nova
aloc = troca(aloc,
  "    v_substituidas  jsonb := '[]'::jsonb;",
  "    v_substituidas  jsonb := '[]'::jsonb;" + NL +
  "    -- Turnos de cada bloco, na ordem de escala_diaria_ids. E o que permite a projecao saber" + NL +
  "    -- QUAL linha e dona de cada passo do bloco, e nao so quais linhas o bloco nomeia." + NL +
  "    v_turnos        jsonb := '[]'::jsonb;",
  1, 'aloc: declaracao de v_turnos')

// 2) acumula os turnos do bloco, logo antes dos slots de fronteira
aloc = troca(aloc,
  '        -- 1.a BATIDA DE TRANSICAO',
  '        -- 1.a-0 DONO DE CADA PASSO DO BLOCO (20260823100000)' + NL +
  '        -- A entrada do bloco pertence ao PRIMEIRO turno, a saida ao ULTIMO, e o intervalo ao' + NL +
  '        -- turno cuja janela o contem. Sem isto a projecao copia o par do bloco para TODAS as' + NL +
  '        -- linhas dele, e a linha do expediente recebe a saida do plantao — 18h03 de hora extra' + NL +
  '        -- indevida em 08/2026, medido em 23/08/2026.' + NL +
  '        IF COALESCE(array_length(r.escala_diaria_ids, 1), 0) > 0 THEN' + NL +
  '            FOR i IN 1..array_length(r.escala_diaria_ids, 1) LOOP' + NL +
  '                v_turnos := v_turnos || jsonb_build_object(' + NL +
  "                    'escala_diaria_id', (r.escala_diaria_ids)[i]," + NL +
  "                    'bloco',            r.bloco_ordem," + NL +
  "                    'ordem',            i," + NL +
  "                    'total',            array_length(r.escala_diaria_ids, 1)," + NL +
  "                    'inicio',           COALESCE((r.turnos_inicio)[i], r.inicio_previsto)," + NL +
  "                    'fim',              COALESCE((r.turnos_fim)[i],    r.fim_previsto));" + NL +
  '            END LOOP;' + NL +
  '        END IF;' + NL +
  NL +
  '        -- 1.a BATIDA DE TRANSICAO',
  1, 'aloc: acumulacao de v_turnos')

// 3) espelho da batida de transicao solitaria, antes da consolidacao
aloc = troca(aloc,
  '    -- 3. CONSOLIDA ALOCACOES E PASSOS SEM MARCACAO',
  '    -- 2.b ESPELHO DA BATIDA DE TRANSICAO SOLITARIA (20260823100000)' + NL +
  '    -- Os dois slots de uma fronteira sao previstos no MESMO instante, mas o DP e 1-para-1:' + NL +
  '    -- uma batida ocupa um slot so. Quem batia UMA vez na transicao fechava o turno e nao abria' + NL +
  '    -- o seguinte, e a linha do turno seguinte voltava a herdar a entrada do bloco (AGNA, mat.' + NL +
  '    -- 205, dias 3 e 4 de 08/2026: entrada do plantao ficou com as 07:46 do expediente).' + NL +
  '    --' + NL +
  '    -- Espelhar NAO fabrica nada: e a MESMA marcacao real servindo aos dois lados da fronteira,' + NL +
  '    -- que e o comportamento ja desejado entre blocos encostados (armadilha 6 do CLAUDE.md).' + NL +
  '    -- Duas batidas distintas continuam vencendo — o espelho so age quando o irmao esta VAZIO,' + NL +
  '    -- entao os dias com 4 batidas nao mudam em nada.' + NL +
  '    --' + NL +
  '    -- E isto que derruba a regra folclorica de "sair e esperar 5 minutos para bater de novo":' + NL +
  "    -- a segunda batida em menos de rep_janela_duplicidade_segundos (60) e descartada como" + NL +
  '    -- duplicada, entao a regra real nunca foi 5 minutos, era 1 minuto. Agora e nenhuma.' + NL +
  '    IF n_slots > 1 THEN' + NL +
  '        FOR s IN 1..(n_slots - 1) LOOP' + NL +
  '            IF COALESCE(v_slot_opcional[s], false)' + NL +
  '               AND COALESCE(v_slot_opcional[s + 1], false)' + NL +
  "               AND v_slot_passo[s]     = 'saida'" + NL +
  "               AND v_slot_passo[s + 1] = 'entrada'" + NL +
  '               AND v_slot_prev[s]      = v_slot_prev[s + 1] THEN' + NL +
  '                IF v_win_marcacao[s] IS NOT NULL AND v_win_marcacao[s + 1] IS NULL THEN' + NL +
  '                    v_win_marcacao[s + 1] := v_win_marcacao[s];' + NL +
  '                    v_win_peso[s + 1]     := v_win_peso[s];' + NL +
  '                    v_win_dist[s + 1]     := v_win_dist[s];' + NL +
  '                ELSIF v_win_marcacao[s + 1] IS NOT NULL AND v_win_marcacao[s] IS NULL THEN' + NL +
  '                    v_win_marcacao[s] := v_win_marcacao[s + 1];' + NL +
  '                    v_win_peso[s]     := v_win_peso[s + 1];' + NL +
  '                    v_win_dist[s]     := v_win_dist[s + 1];' + NL +
  '                END IF;' + NL +
  '            END IF;' + NL +
  '        END LOOP;' + NL +
  '    END IF;' + NL +
  NL +
  '    -- 3. CONSOLIDA ALOCACOES E PASSOS SEM MARCACAO',
  1, 'aloc: espelho de fronteira')

// 4) devolve os turnos
aloc = troca(aloc,
  "        'substituidas',  v_substituidas" + NL,
  "        'substituidas',  v_substituidas," + NL +
  "        'turnos',        v_turnos" + NL,
  1, 'aloc: turnos no retorno')

// 5) comentario da funcao
aloc = troca(aloc,
  "    'Teto de casamento de 720 min. Ver 20260819200000, 20260819180000 e 20260819120000.';",
  "    'Uma batida solitaria na fronteira espelha para o slot irmao, e o retorno declara os '" + NL +
  "    'turnos de cada bloco para a projecao saber o dono de cada passo. '" + NL +
  "    'Teto de casamento de 720 min. Ver 20260823100000, 20260819200000, 20260819180000 e '" + NL +
  "    '20260819120000.';",
  1, 'aloc: COMMENT')

for (const [sub, n] of INVARIANTES_ALOC) exige(aloc, sub, n, 'aloc DEPOIS')

// ---------------------------------------------------------------- fn_projecao_marcacoes_dia
let proj = recorte(
  projSrc,
  'DROP FUNCTION IF EXISTS public.fn_projecao_marcacoes_dia(uuid, date);',
  'GRANT EXECUTE ON FUNCTION public.fn_projecao_marcacoes_dia(uuid, date) TO authenticated, service_role;',
  'fn_projecao_marcacoes_dia'
)

const INVARIANTES_PROJ = [
  ['-- Janela real do turno naquela linha, quando existe batida de transicao.', 1],
  ['ORDER BY cd.fronteira DESC', 12],
  ['WHERE cd.fronteira', 1],
]
// count(*) vira count(cd.ed_id) no passo 3.b — conferido a parte, so ANTES.
for (const [sub, n] of INVARIANTES_PROJ) exige(proj, sub, n, 'proj ANTES')
exige(proj, 'count(*) > 0', 1, 'proj ANTES (count)')

// 1) uma unica chamada a fn_alocar_marcacoes_dia + CTE de turnos
proj = troca(proj,
  '    WITH alocacoes AS (' + NL +
  '        SELECT x' + NL +
  '          FROM jsonb_array_elements(' + NL +
  '                   public.fn_alocar_marcacoes_dia(p_servidor_id, p_data) -> \'alocacoes\'' + NL +
  '               ) AS x' + NL +
  '    ),',
  '    -- MATERIALIZED: fn_alocar_marcacoes_dia roda o DP inteiro. Sem isto o planejador pode' + NL +
  '    -- inline-a-la uma vez por CTE que a referencia.' + NL +
  '    WITH aloc AS MATERIALIZED (' + NL +
  '        SELECT public.fn_alocar_marcacoes_dia(p_servidor_id, p_data) AS j' + NL +
  '    ),' + NL +
  '    alocacoes AS (' + NL +
  "        SELECT x FROM aloc, jsonb_array_elements(aloc.j -> 'alocacoes') AS x" + NL +
  '    ),' + NL +
  '    -- Cada linha de escala_diaria com a posicao dela dentro do bloco e a janela do seu turno.' + NL +
  '    turnos AS (' + NL +
  "        SELECT (t.x->>'escala_diaria_id')::uuid AS ed_id," + NL +
  "               (t.x->>'ordem')::integer         AS ordem," + NL +
  "               (t.x->>'total')::integer         AS total," + NL +
  "               (t.x->>'inicio')::timestamptz    AS turno_inicio," + NL +
  "               (t.x->>'fim')::timestamptz       AS turno_fim" + NL +
  "          FROM aloc, jsonb_array_elements(aloc.j -> 'turnos') AS t(x)" + NL +
  '    ),',
  1, 'proj: CTE aloc/turnos')

// 2) expandido ganha a ordinalidade e o previsto
proj = troca(proj,
  "        SELECT NULLIF(btrim(e.valor), '')::uuid              AS ed_id," + NL +
  "               a.x->>'passo'                                 AS passo," + NL +
  "               (a.x->>'marcacao_id')::uuid                   AS marcacao_id," + NL +
  "               COALESCE((a.x->>'fronteira')::boolean, false)  AS fronteira" + NL +
  '          FROM alocacoes a' + NL +
  "          CROSS JOIN LATERAL jsonb_array_elements_text(a.x->'escala_diaria_ids') AS e(valor)" + NL +
  "         WHERE NULLIF(btrim(e.valor), '') IS NOT NULL",
  "        SELECT NULLIF(btrim(e.valor), '')::uuid              AS ed_id," + NL +
  '               e.ord::integer                                AS ed_ordem,' + NL +
  "               jsonb_array_length(a.x->'escala_diaria_ids')  AS ed_total," + NL +
  "               a.x->>'passo'                                 AS passo," + NL +
  "               (a.x->>'marcacao_id')::uuid                   AS marcacao_id," + NL +
  "               (a.x->>'previsto')::timestamptz               AS previsto," + NL +
  "               COALESCE((a.x->>'fronteira')::boolean, false)  AS fronteira" + NL +
  '          FROM alocacoes a' + NL +
  "          CROSS JOIN LATERAL jsonb_array_elements_text(a.x->'escala_diaria_ids')" + NL +
  '               WITH ORDINALITY AS e(valor, ord)' + NL +
  "         WHERE NULLIF(btrim(e.valor), '') IS NOT NULL",
  1, 'proj: expandido com ordinalidade')

// 3) o filtro do dono, entre expandido e com_dados
proj = troca(proj,
  '    com_dados AS (' + NL +
  '        SELECT ex.ed_id, ex.passo, ex.marcacao_id, ex.fronteira, m.ocorrido_em, m.origem' + NL +
  '          FROM expandido ex' + NL +
  '          JOIN public.marcacoes_ponto m ON m.id = ex.marcacao_id' + NL +
  '    ),',
  '    -- DONO DO PASSO (20260823100000)' + NL +
  '    -- Uma alocacao de BLOCO nomeia todas as linhas dele, mas cada passo tem um dono so:' + NL +
  '    --   entrada  -> a linha do PRIMEIRO turno' + NL +
  '    --   saida    -> a linha do ULTIMO turno' + NL +
  '    --   intervalo-> a linha do turno cuja janela contem o intervalo previsto' + NL +
  '    -- Criterio POSICIONAL, nao por tolerancia de horario: deterministico e sem numero magico.' + NL +
  '    --' + NL +
  '    -- Sem isto a linha do expediente recebia a saida do plantao e a folha cobrava aquelas' + NL +
  '    -- horas como EXTRA, alem de o plantao ja as pagar pelo anexo — a mesma jornada contada' + NL +
  '    -- duas vezes. Bloco de um turno so (ed_total = 1) e alocacao de FRONTEIRA nao mudam nada.' + NL +
  '    --' + NL +
  '    -- Nada e fabricado: sem batida na fronteira, o passo simplesmente fica VAZIO e vira' + NL +
  '    -- pendencia visivel. Decisao do usuario em 23/08/2026 — o sistema nao preenche onde o' + NL +
  '    -- servidor TEM como registrar (vedacao 2 da Portaria 671/2021).' + NL +
  '    dono AS (' + NL +
  '        SELECT ex.*' + NL +
  '          FROM expandido ex' + NL +
  '          LEFT JOIN turnos t ON t.ed_id = ex.ed_id' + NL +
  '         WHERE ex.fronteira' + NL +
  '            OR COALESCE(ex.ed_total, 1) <= 1' + NL +
  "            OR (ex.passo = 'entrada' AND ex.ed_ordem = 1)" + NL +
  "            OR (ex.passo = 'saida'   AND ex.ed_ordem = ex.ed_total)" + NL +
  "            OR (ex.passo LIKE 'intervalo%'" + NL +
  '                AND (t.ed_id IS NULL' + NL +
  '                     OR ex.previsto IS NULL' + NL +
  '                     OR (ex.previsto >= t.turno_inicio AND ex.previsto <= t.turno_fim)))' + NL +
  '    ),' + NL +
  '    com_dados AS (' + NL +
  '        SELECT ex.ed_id, ex.passo, ex.marcacao_id, ex.fronteira, m.ocorrido_em, m.origem' + NL +
  '          FROM dono ex' + NL +
  '          JOIN public.marcacoes_ponto m ON m.id = ex.marcacao_id' + NL +
  '    ),',
  1, 'proj: CTE dono')

// 3.b linha que perdeu TODOS os passos precisa continuar na projecao, com tudo nulo.
// ⚠️ filtrado AS (...) era a ULTIMA CTE e nao tinha virgula. Sem acrescenta-la aqui o arquivo
// gerado sai com erro de sintaxe — e plpgsql/sql so acusaria no CREATE.
proj = troca(proj,
  '    )' + NL +
  '    -- Pode haver DUAS alocacoes para o mesmo (linha, passo)',
  '    ),' + NL +
  '    -- Toda linha nomeada por alguma alocacao continua na projecao, mesmo que o filtro do dono' + NL +
  '    -- tenha tirado todos os passos dela. E o que faz fn_reconciliar_marcacoes_dia LIMPAR o' + NL +
  '    -- valor velho: ela grava a projecao inteira, inclusive os nulos, mas so alcanca as linhas' + NL +
  '    -- que a projecao devolve. Sem isto, a linha do plantao de um dia em que so houve entrada' + NL +
  '    -- ficaria para sempre com a entrada do expediente (AGNA, mat. 205, dias 5, 6 e 7).' + NL +
  '    linhas AS (' + NL +
  '        SELECT DISTINCT ed_id FROM expandido' + NL +
  '    )' + NL +
  '    -- Pode haver DUAS alocacoes para o mesmo (linha, passo)',
  1, 'proj: CTE linhas')

proj = troca(proj,
  '    SELECT' + NL +
  '        cd.ed_id,',
  '    SELECT' + NL +
  '        l.ed_id,',
  1, 'proj: SELECT sobre linhas')

// count(*) contaria 1 no LEFT JOIN sem par; tem que contar a coluna do lado direito.
proj = troca(proj,
  '        -- Confirmada quando ha qualquer marcacao no dia.' + NL +
  '        count(*) > 0' + NL +
  '      FROM filtrado cd' + NL +
  '     GROUP BY cd.ed_id',
  '        -- Confirmada quando ha qualquer marcacao no dia. count(cd.ed_id), NAO count(*): no' + NL +
  '        -- LEFT JOIN sem par o count(*) devolveria 1 e a linha vazia sairia como confirmada.' + NL +
  '        count(cd.ed_id) > 0' + NL +
  '      FROM linhas l' + NL +
  '      LEFT JOIN filtrado cd ON cd.ed_id = l.ed_id' + NL +
  '     GROUP BY l.ed_id',
  1, 'proj: LEFT JOIN linhas')

// 4) comentario da funcao
proj = troca(proj,
  "    'linha que tem batida de transicao nao herda passo do bloco fora da janela do seu turno.';",
  "    'linha que tem batida de transicao nao herda passo do bloco fora da janela do seu turno. '" + NL +
  "    'Passo do bloco alcanca so a linha do turno DONO dele: entrada no primeiro, saida no '" + NL +
  "    'ultimo, intervalo no turno que o contem. Ver 20260823100000.';",
  1, 'proj: COMMENT')

for (const [sub, n] of INVARIANTES_PROJ) exige(proj, sub, n, 'proj DEPOIS')
exige(proj, 'count(cd.ed_id) > 0', 1, 'proj DEPOIS (count)')
exige(proj, 'count(*) > 0', 0, 'proj DEPOIS (count antigo sumiu)')
exige(proj, 'LEFT JOIN filtrado cd ON cd.ed_id = l.ed_id', 1, 'proj DEPOIS (left join)')

// ---------------------------------------------------------------- cabecalho + montagem
const CAB = [
  '-- ============================================================================',
  '-- Migration: o passo do bloco pertence a UM turno, e a batida de transicao solitaria espelha',
  '-- Data: 2026-08-23',
  '--',
  '-- PROBLEMA (medido em producao em 23/08/2026, competencia 08/2026)',
  '--   Regular 08:00-14:00 + Plantao T 14:00-20:00 fundem em UM bloco (armadilha 6). A projecao',
  '--   grava o par entrada/saida do BLOCO em TODAS as linhas dele, entao com duas batidas so',
  '--   (08:03 e 18:02) as duas linhas ficam 08:03 -> 18:02. Dois sintomas, um defeito:',
  '--',
  '--     - a folha cobra a saida das 18:02 contra a jornada que acaba as 14:00 e credita 4h de',
  '--       hora extra que o anexo de plantoes JA esta pagando como plantao;',
  '--     - o anexo mostra o plantao comecando as 08:03, a entrada do expediente.',
  '--',
  '--   AGNA CRISTINA RIBEIRO DO ROSARIO (mat. 205, LACEM), dias 10, 11 e 12 de 08/2026.',
  '--   Em 08/2026: 27 dias com hora extra em dia de plantao escalado, 75h12 no total. Deste',
  '--   plano saem 18h03 em 4 dias; 47h48 saem so regerando a folha (snapshot anterior ao',
  '--   turnosDaFolha de 19/08); o resto sao casos individuais do coordenador.',
  '--',
  '-- CORRECAO — duas ideias, tres funcoes intocadas',
  '--   C1 (fn_projecao_marcacoes_dia) o passo do bloco alcanca so a linha do turno DONO dele.',
  '--      entrada -> primeiro turno; saida -> ultimo; intervalo -> o turno que o contem.',
  '--      Sem batida na fronteira o passo fica VAZIO e vira pendencia. Nada e fabricado.',
  '--   C2 (fn_alocar_marcacoes_dia) batida solitaria na fronteira espelha para o slot irmao.',
  '--      Acaba com a regra folclorica de "esperar 5 minutos": UMA batida na transicao passa a',
  '--      fechar o expediente e abrir o plantao.',
  '--',
  '--   fn_alocar_marcacoes_dia passa a devolver a chave "turnos" (aditiva) para C1 saber a ordem',
  '--   e a janela de cada turno do bloco.',
  '--',
  '-- O QUE NAO MUDA',
  '--   - Bloco de UM turno so: nada muda (ed_total <= 1 passa direto).',
  '--   - Dia com 4 batidas (2 na fronteira): nada muda — o espelho so age em slot VAZIO.',
  '--   - Bloco Regular + Extra: a folha e NEUTRA. turnosDaFolha mantem as duas linhas e o',
  '--     min(entrada)/max(saida) da o mesmo resultado de hoje.',
  '--   - Fusao de blocos, guards de Sobreaviso, regra do dono, piso de meia-noite, teto de 720',
  '--     min e o guard de escopo de fn_blocos_previstos_dia: todos intactos (conferidos por',
  '--     contagem no gerador).',
  '--   - fn_confirmar_presenca NAO e tocada (armadilha 1). O terminal continua sem os slots de',
  '--     fronteira — a batida de transicao segue virando marcacao pendente, que a reconciliacao',
  '--     aproveita. Aceitar a transicao no proprio terminal fica para migration propria.',
  '--',
  '-- MEDIDO POR SIMULACAO ANTES DE APLICAR (scratchpad/sim_fronteira.js, sim_folha_efeito.js),',
  '-- sobre os 223 dias de 08/2026 com bloco de 2+ turnos fundidos:',
  '--   154 linhas de escala_diaria mudam, em 17 servidores; 213 dias ficam identicos;',
  '--   na folha 10 dias mudam, 8 deles perdendo hora extra indevida; 72 fronteiras espelhadas.',
  '--',
  '-- Corpos copiados mecanicamente de 20260819200000 (alocacao) e 20260819210000 (projecao)',
  '-- por scratchpad/gen_dono_do_passo.js, que aborta se a contagem de ocorrencias divergir.',
  '--',
  '-- Plano: docs/planos/2026-08-23-turno-regular-emendado-com-plantao.md',
  '-- ============================================================================',
  '',
  '',
].join(NL)

const CONF = [
  '',
  '',
  '-- ============================================================================',
  '-- CONFERENCIA (rodar DEPOIS de aplicar; nenhuma delas escreve)',
  '-- ============================================================================',
  '--',
  '-- 1) A chave "turnos" existe e descreve o bloco (AGNA, 10/08/2026):',
  '--',
  "--    SELECT jsonb_pretty(public.fn_alocar_marcacoes_dia(s.id, DATE '2026-08-10') -> 'turnos')",
  "--      FROM public.servidores s WHERE s.matricula = '205';",
  '--',
  '-- 2) A linha do expediente deixou de carregar a saida do plantao:',
  '--',
  '--    SELECT ed.categoria, dt.codigo, p.entrada_em, p.saida_em',
  '--      FROM public.servidores s',
  '--      JOIN public.escala_mensal em ON em.servidor_id = s.id AND em.mes = 8 AND em.ano = 2026',
  '--      JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id AND ed.dia = 10',
  '--      JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id',
  "--      LEFT JOIN LATERAL public.fn_projecao_marcacoes_dia(s.id, DATE '2026-08-10') p",
  '--             ON p.escala_diaria_id = ed.id',
  "--     WHERE s.matricula = '205';",
  '--',
  '--    Esperado: Regular M com entrada 08:03 e saida NULA; Plantao T com entrada NULA e',
  '--    saida 18:02. A saida vazia do Regular e o resultado desejado, nao falha.',
  '--',
  '-- 3) O espelho da fronteira solitaria (AGNA, 03/08/2026 — uma batida so as 14:00):',
  '--',
  '--    Esperado: Regular M 08:06 -> 14:00 e Plantao T 14:00 -> 20:00.',
  '--    Antes desta migration o Plantao comecava as 08:06.',
  '--',
  '-- 4) Nenhum passo invertido em 08/2026 (mesmo portao de 20260819210000):',
  '--    rodar scratchpad/checa_inversao_projecao.js.',
  '--',
  '-- 5) Divergencia projecao x gravado, para escolher os dias a reconciliar:',
  '--    rodar scratchpad/sim_fronteira.js. A reconciliacao NAO deve ser em massa',
  '--    (memoria "nao-reconciliar-agosto-em-massa") — so os dias de bloco fundido.',
  '-- ============================================================================',
  '',
].join(NL)

const saida = CAB + aloc + NL + NL + NL + proj + CONF

// conferencia estrutural do arquivo inteiro (licao do gen_dobra.js)
const dolar = (saida.match(/\$fnaloc\$/g) || []).length
const dolarP = (saida.match(/\$fnproj\$/g) || []).length
if (dolar !== 2) die('delimitadores $fnaloc$ fora de par: ' + dolar)
if (dolarP !== 2) die('delimitadores $fnproj$ fora de par: ' + dolarP)
if (conta(saida, 'CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia(') !== 1) die('CREATE de fn_alocar fora de conta')
if (conta(saida, 'CREATE OR REPLACE FUNCTION public.fn_projecao_marcacoes_dia(') !== 1) die('CREATE de fn_projecao fora de conta')
if (conta(saida, 'GRANT EXECUTE ON FUNCTION public.fn_alocar_marcacoes_dia') !== 1) die('GRANT de fn_alocar fora de conta')
if (conta(saida, 'GRANT EXECUTE ON FUNCTION public.fn_projecao_marcacoes_dia') !== 1) die('GRANT de fn_projecao fora de conta')
if (/\n(?!\r)/.test(saida.replace(/\r\n/g, ''))) die('sobrou LF solto — migrations do projeto usam CRLF')

fs.writeFileSync(OUT, saida, 'utf8')
console.log('gerado: ' + path.relative(path.join(__dirname, '..'), OUT))
console.log('  linhas: ' + saida.split(NL).length)
console.log('  fn_alocar_marcacoes_dia   <- 20260819200000  (+turnos, +espelho)')
console.log('  fn_projecao_marcacoes_dia <- 20260819210000  (+dono do passo)')
