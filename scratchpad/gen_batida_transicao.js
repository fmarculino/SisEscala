/**
 * Gera a migration da BATIDA DE TRANSICAO entre turnos fundidos no mesmo bloco.
 *
 * POR QUE POR SCRIPT (armadilha 1 do CLAUDE.md)
 *   As tres funcoes sao recriadas inteiras. Redigitar corpo a mao ja apagou logica critica seis
 *   vezes neste projeto. Aqui cada corpo vigente e COPIADO byte a byte do arquivo que o define
 *   hoje, e so os pontos alvo sao trocados — com contagem de ocorrencias conferida antes e depois.
 *
 * O QUE MUDA
 *   1. fn_blocos_previstos_dia  passa a expor `turnos_inicio[]` / `turnos_fim[]` — o previsto de
 *      CADA turno fundido, na mesma ordem de `escala_diaria_ids`. A fusao em si nao muda.
 *   2. fn_alocar_marcacoes_dia  cria, em cada fronteira interna do bloco, dois slots OPCIONAIS:
 *      a saida do turno que fecha e a entrada do turno que abre. Slot opcional sem batida nao
 *      vira pendencia.
 *   3. fn_projecao_marcacoes_dia desempata a favor da alocacao de fronteira, que e especifica
 *      de uma linha, contra a do bloco, que vale para todas.
 */
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'supabase', 'migrations')
const DESTINO = '20260819200000_batida_de_transicao_entre_turnos.sql'
const L = a => a.join('\r\n')
const conta = (txt, agulha) => txt.split(agulha).length - 1

const recorta = (arquivo, inicio, fim) => {
  const bruto = fs.readFileSync(path.join(DIR, arquivo), 'utf8')
  const i = bruto.indexOf(inicio)
  if (i < 0) { console.error('ABORTADO: nao achei "' + inicio.slice(0, 60) + '" em ' + arquivo); process.exit(1) }
  const j = bruto.indexOf(fim, i)
  if (j < 0) { console.error('ABORTADO: nao achei o fim "' + fim + '" em ' + arquivo); process.exit(1) }
  return bruto.slice(i, j + fim.length)
}

const exigir = (corpo, esperado, rotulo) => {
  for (const [agulha, n] of Object.entries(esperado)) {
    const achou = conta(corpo, agulha)
    if (achou !== n) {
      console.error(`ABORTADO (${rotulo}): esperava ${n}x "${agulha.slice(0, 70)}", achei ${achou}.`)
      process.exit(1)
    }
  }
}

// ============================================================================
// 1. fn_blocos_previstos_dia — expor o previsto de cada turno fundido
// ============================================================================
let blocos = recorta('20260812130000_scope_guard_blocos_previstos_dia.sql',
  'CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_dia(', '$fnbloco$;')

const DECL_B3 = '    v_b3_inicio INTEGER; v_b3_fim INTEGER; v_b3_ids UUID[];'
const RET_TABLE = L([
  '    intervalo_fim_previsto    timestamptz,',
  '    permite_intervalo         boolean',
  ')',
])
const RE_IDS = /( *)v_b(\d)_ids := ARRAY\[([^\]]+)\];/g

exigir(blocos, {
  [RET_TABLE]: 1,
  [DECL_B3]: 1,
  'RETURN NEXT;': 3,
  'auth.uid() IS NOT NULL AND NOT EXISTS': 1,   // guard de escopo (20260812130000)
  "v_s3_cat <> 'Sobreaviso'": 2,                 // guards de Sobreaviso na fusao
  '$fnbloco$': 2,
}, 'blocos/antes')
const nIds = (blocos.match(RE_IDS) || []).length
if (nIds !== 11) { console.error('ABORTADO: esperava 11 atribuicoes de v_bN_ids, achei ' + nIds + '.'); process.exit(1) }

let trocasB = 0

// 1.1 duas colunas novas na saida
blocos = blocos.replace(RET_TABLE, () => { trocasB++; return L([
  '    intervalo_fim_previsto    timestamptz,',
  '    permite_intervalo         boolean,',
  '    -- O previsto de CADA turno fundido neste bloco, na mesma ordem de escala_diaria_ids.',
  '    -- Um bloco com 2 turnos tem 1 fronteira interna: turnos_fim[1] = turnos_inicio[2]. E ali',
  '    -- que a batida de transicao acontece. Ver 20260819200000.',
  '    turnos_inicio             timestamptz[],',
  '    turnos_fim                timestamptz[]',
  ')',
]) })

// 1.2 arrays novos por bloco
blocos = blocos.replace(DECL_B3, () => { trocasB++; return DECL_B3 })
blocos = blocos.replace(/( *)v_b3_inicio INTEGER;([^\r\n]*)/, (m, ind, resto) => {
  trocasB++
  return m + '\r\n' + ind + '-- Previsto de cada turno fundido, para a batida de transicao (20260819200000).' +
    '\r\n' + ind + 'v_b1_turnos_ini INTEGER[]; v_b1_turnos_fim INTEGER[];' +
    '\r\n' + ind + 'v_b2_turnos_ini INTEGER[]; v_b2_turnos_fim INTEGER[];' +
    '\r\n' + ind + 'v_b3_turnos_ini INTEGER[]; v_b3_turnos_fim INTEGER[];'
})

// 1.3 os 11 pontos de montagem: o mesmo conjunto de turnos, nos previstos
blocos = blocos.replace(RE_IDS, (m, ind, bloco, lista) => {
  trocasB++
  const turnos = lista.split(',').map(s => s.trim())
  const inis = turnos.map(t => t.replace(/_id$/, '_inicio')).join(', ')
  const fins = turnos.map(t => t.replace(/_id$/, '_fim')).join(', ')
  return m + ` v_b${bloco}_turnos_ini := ARRAY[${inis}]; v_b${bloco}_turnos_fim := ARRAY[${fins}];`
})

// 1.4 emitir as colunas novas nos tres RETURN NEXT
for (const b of [1, 2, 3]) {
  const de = L([
    `        intervalo_fim_previsto    := CASE WHEN COALESCE(v_b${b}_permite_int, false) AND v_b${b}_int_fim IS NOT NULL`,
    `                                          THEN (p_data::timestamp + make_interval(mins => v_b${b}_int_fim)) AT TIME ZONE v_timezone END;`,
    '        RETURN NEXT;',
  ])
  if (conta(blocos, de) !== 1) { console.error('ABORTADO: RETURN NEXT do bloco ' + b + ' nao bate.'); process.exit(1) }
  blocos = blocos.replace(de, () => { trocasB++; return L([
    `        intervalo_fim_previsto    := CASE WHEN COALESCE(v_b${b}_permite_int, false) AND v_b${b}_int_fim IS NOT NULL`,
    `                                          THEN (p_data::timestamp + make_interval(mins => v_b${b}_int_fim)) AT TIME ZONE v_timezone END;`,
    `        turnos_inicio             := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone`,
    `                                             FROM unnest(v_b${b}_turnos_ini) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);`,
    `        turnos_fim                := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone`,
    `                                             FROM unnest(v_b${b}_turnos_fim) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);`,
    '        RETURN NEXT;',
  ]) })
}

if (trocasB !== 1 + 2 + 11 + 3) { console.error('ABORTADO: blocos — esperava 17 substituicoes, fiz ' + trocasB + '.'); process.exit(1) }
exigir(blocos, {
  'turnos_inicio             timestamptz[],': 1,
  'v_b1_turnos_ini INTEGER[]; v_b1_turnos_fim INTEGER[];': 1,
  'turnos_ini := ARRAY[': 11,
  'turnos_inicio             := ARRAY(': 3,
  'auth.uid() IS NOT NULL AND NOT EXISTS': 1,
  "v_s3_cat <> 'Sobreaviso'": 2,
  'RETURN NEXT;': 3,
  '$fnbloco$': 2,
}, 'blocos/depois')

// ============================================================================
// 2. fn_alocar_marcacoes_dia — slots opcionais nas fronteiras
// ============================================================================
let aloc = recorta('20260819180000_dono_da_batida_e_piso_de_meia_noite.sql',
  'CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia(', '$fnaloc$;')

const RE_PISO = /( *)v_slot_piso  := v_slot_piso  \|\| \(date_trunc\('day', r\.inicio_previsto AT TIME ZONE v_timezone\) AT TIME ZONE v_timezone\);/g
const FIM_LOOP_SLOTS = L(['    END LOOP;', '', '    -- 1.b SLOTS-SOMBRA'])
const DECL_PISO = "    v_slot_piso     timestamptz[] := '{}';"
const N_SLOTS = '    n_slots := COALESCE(array_length(v_slot_passo, 1), 0);'
const PEND_SEM_MARC = L([
  '            ELSE',
  '                v_pendencias := v_pendencias || jsonb_build_object(',
  "                    'tipo',              'passo_sem_marcacao',",
])
const ALOC_JSON = "                    'passo',             v_slot_passo[s],\r\n                    'previsto',          v_slot_prev[s],\r\n                    'data_bloco',        v_slot_data[s],\r\n                    'marcacao_id',       v_win_marcacao[s],"

exigir(aloc, {
  [DECL_PISO]: 1,
  [FIM_LOOP_SLOTS]: 1,
  [N_SLOTS]: 1,
  [PEND_SEM_MARC]: 1,
  [ALOC_JSON]: 1,
  'AND v_m_ts[k] >= v_slot_piso[s]': 1,
  'c_teto_alocacao_min constant integer := 720;': 1,
  'n_sombras := COALESCE(array_length(v_sombra_prev, 1), 0);': 1,
  '$fnaloc$': 2,
}, 'aloc/antes')
const nPiso = (aloc.match(RE_PISO) || []).length
if (nPiso !== 4) { console.error('ABORTADO: esperava 4 atribuicoes de v_slot_piso, achei ' + nPiso + '.'); process.exit(1) }

let trocasA = 0

// 2.1 array de "este slot e opcional"
aloc = aloc.replace(DECL_PISO, () => { trocasA++; return L([
  DECL_PISO,
  '    -- Slot OPCIONAL: existe para receber a batida de transicao entre dois turnos fundidos.',
  '    -- Sem batida ele nao vira pendencia — a esmagadora maioria dos dias em bloco continuo',
  '    -- nao tem batida na fronteira, e isso e normal, nao falta. Ver 20260819200000.',
  "    v_slot_opcional boolean[]     := '{}';",
]) })

// 2.2 os 4 slots do bloco sao obrigatorios
aloc = aloc.replace(RE_PISO, (m, ind) => { trocasA++; return m + '\r\n' + ind + 'v_slot_opcional := v_slot_opcional || false;' })

// 2.3 slots de fronteira, ainda dentro do laco dos blocos
aloc = aloc.replace(FIM_LOOP_SLOTS, () => { trocasA++; return L([
  '',
  '        -- 1.a BATIDA DE TRANSICAO',
  '        -- Um bloco pode ser a fusao de ate 3 turnos (armadilha 6). Na fronteira entre dois',
  '        -- deles a pessoa pode bater duas vezes — fechando um turno e abrindo o outro — e ate',
  '        -- aqui essas batidas viravam "fora_da_janela", porque o bloco so tinha os 4 passos do',
  '        -- conjunto. Medido em producao em 19/08/2026 (MAISA, 18/08): bateu 07:04, 13:07, 13:10',
  '        -- e 19:09 num Regular 07:00-13:00 + Plantao 13:00-19:00, e as duas do meio se perderam.',
  '        --',
  '        -- Os slots abaixo sao gravados na LINHA de cada turno (um unico escala_diaria_id), nao',
  '        -- no bloco inteiro — e por isso que a folha e o anexo passam a saber onde o plantao',
  '        -- comecou de fato. Nada e fabricado: sem batida, nao ha alocacao nem pendencia.',
  '        IF COALESCE(array_length(r.turnos_fim, 1), 0) > 1 THEN',
  '            FOR i IN 1..(array_length(r.turnos_fim, 1) - 1) LOOP',
  '                -- fecha o turno i',
  "                v_slot_passo    := v_slot_passo    || 'saida'::text;",
  '                v_slot_prev     := v_slot_prev     || (r.turnos_fim)[i];',
  '                v_slot_bloco    := v_slot_bloco    || r.bloco_ordem;',
  '                v_slot_ids      := v_slot_ids      || (r.escala_diaria_ids)[i]::text;',
  '                v_slot_data     := v_slot_data     || r.dia_ref;',
  "                v_slot_piso     := v_slot_piso     || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);",
  '                v_slot_opcional := v_slot_opcional || true;',
  '',
  '                -- abre o turno i + 1',
  "                v_slot_passo    := v_slot_passo    || 'entrada'::text;",
  '                v_slot_prev     := v_slot_prev     || (r.turnos_inicio)[i + 1];',
  '                v_slot_bloco    := v_slot_bloco    || r.bloco_ordem;',
  '                v_slot_ids      := v_slot_ids      || (r.escala_diaria_ids)[i + 1]::text;',
  '                v_slot_data     := v_slot_data     || r.dia_ref;',
  "                v_slot_piso     := v_slot_piso     || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);",
  '                v_slot_opcional := v_slot_opcional || true;',
  '            END LOOP;',
  '        END IF;',
  FIM_LOOP_SLOTS,
]) })

// 2.4 o DP alinha por ordem: os slots precisam estar em ordem cronologica
aloc = aloc.replace(N_SLOTS, () => { trocasA++; return L([
  '    -- O DP e um alinhamento monotonico: ele casa a k-esima batida com o s-esimo slot sem',
  '    -- cruzar. Os slots de fronteira nascem no fim do array (13:00 depois da saida das 19:00),',
  '    -- entao sem esta ordenacao o alinhamento fica impossivel e a batida de transicao seria',
  '    -- recusada exatamente como antes. Ordena por instante previsto, mantendo a ordem de',
  '    -- insercao no empate — o que fecha um turno vem antes do que abre o seguinte.',
  '    IF COALESCE(array_length(v_slot_passo, 1), 0) > 1 THEN',
  '        SELECT array_agg(t.passo ORDER BY t.prev, t.ord),',
  '               array_agg(t.prev  ORDER BY t.prev, t.ord),',
  '               array_agg(t.bloco ORDER BY t.prev, t.ord),',
  '               array_agg(t.ids   ORDER BY t.prev, t.ord),',
  '               array_agg(t.dta   ORDER BY t.prev, t.ord),',
  '               array_agg(t.piso  ORDER BY t.prev, t.ord),',
  '               array_agg(t.opc   ORDER BY t.prev, t.ord)',
  '          INTO v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional',
  '          FROM unnest(v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional)',
  '               WITH ORDINALITY AS t(passo, prev, bloco, ids, dta, piso, opc, ord);',
  '    END IF;',
  '',
  N_SLOTS,
]) })

// 2.5 slot opcional sem batida nao vira pendencia
aloc = aloc.replace(PEND_SEM_MARC, () => { trocasA++; return L([
  '            ELSIF NOT COALESCE(v_slot_opcional[s], false) THEN',
  '                v_pendencias := v_pendencias || jsonb_build_object(',
  "                    'tipo',              'passo_sem_marcacao',",
]) })

// 2.6 a projecao precisa saber que esta alocacao e de fronteira
aloc = aloc.replace(ALOC_JSON, () => { trocasA++; return L([
  "                    'passo',             v_slot_passo[s],",
  "                    'previsto',          v_slot_prev[s],",
  "                    'data_bloco',        v_slot_data[s],",
  "                    'fronteira',         COALESCE(v_slot_opcional[s], false),",
  "                    'marcacao_id',       v_win_marcacao[s],",
]) })

if (trocasA !== 1 + 4 + 1 + 1 + 1 + 1) { console.error('ABORTADO: aloc — esperava 9 substituicoes, fiz ' + trocasA + '.'); process.exit(1) }
exigir(aloc, {
  "v_slot_opcional boolean[]     := '{}';": 1,
  'v_slot_opcional := v_slot_opcional || false;': 4,
  'v_slot_opcional := v_slot_opcional || true;': 2,
  'WITH ORDINALITY AS t(passo, prev, bloco, ids, dta, piso, opc, ord);': 1,
  'ELSIF NOT COALESCE(v_slot_opcional[s], false) THEN': 1,
  "'fronteira',         COALESCE(v_slot_opcional[s], false),": 1,
  // nada do que ja existia pode ter sumido
  'AND v_m_ts[k] >= v_slot_piso[s]': 1,
  'c_teto_alocacao_min constant integer := 720;': 1,
  'n_sombras := COALESCE(array_length(v_sombra_prev, 1), 0);': 1,
  'fn_precedencia_origem': 2,
  "'fora_da_janela'": 2,
  "'sem_escala'": 1,
  "'duplicada'": 1,
  '$fnaloc$': 2,
}, 'aloc/depois')

// ============================================================================
// 3. fn_projecao_marcacoes_dia — a alocacao de fronteira vence a do bloco
// ============================================================================
const projecao = L([
  'DROP FUNCTION IF EXISTS public.fn_projecao_marcacoes_dia(uuid, date);',
  '',
  'CREATE OR REPLACE FUNCTION public.fn_projecao_marcacoes_dia(',
  '    p_servidor_id uuid,',
  '    p_data        date',
  ')',
  'RETURNS TABLE (',
  '    escala_diaria_id      uuid,',
  '    entrada_em            timestamptz,',
  '    entrada_origem        public.marcacao_origem,',
  '    entrada_marcacao_id   uuid,',
  '    int_saida_em          timestamptz,',
  '    int_saida_origem      public.marcacao_origem,',
  '    int_saida_marcacao_id uuid,',
  '    int_ret_em            timestamptz,',
  '    int_ret_origem        public.marcacao_origem,',
  '    int_ret_marcacao_id   uuid,',
  '    saida_em              timestamptz,',
  '    saida_origem          public.marcacao_origem,',
  '    saida_marcacao_id     uuid,',
  '    confirmada            boolean',
  ')',
  'LANGUAGE sql',
  'STABLE',
  'SECURITY DEFINER',
  'SET search_path = public',
  'AS $fnproj$',
  '    WITH alocacoes AS (',
  '        SELECT x',
  '          FROM jsonb_array_elements(',
  "                   public.fn_alocar_marcacoes_dia(p_servidor_id, p_data) -> 'alocacoes'",
  '               ) AS x',
  '    ),',
  '    expandido AS (',
  '        -- Uma alocacao vale para todas as linhas de escala_diaria que ela nomeia. As do bloco',
  '        -- nomeiam todas as linhas; as de FRONTEIRA nomeiam uma linha so (ver 20260819200000).',
  "        SELECT NULLIF(btrim(e.valor), '')::uuid            AS ed_id,",
  "               a.x->>'passo'                               AS passo,",
  "               (a.x->>'marcacao_id')::uuid                 AS marcacao_id,",
  "               COALESCE((a.x->>'fronteira')::boolean, false) AS fronteira",
  '          FROM alocacoes a',
  "          CROSS JOIN LATERAL jsonb_array_elements_text(a.x->'escala_diaria_ids') AS e(valor)",
  "         WHERE NULLIF(btrim(e.valor), '') IS NOT NULL",
  '    ),',
  '    com_dados AS (',
  '        SELECT ex.ed_id, ex.passo, ex.marcacao_id, ex.fronteira, m.ocorrido_em, m.origem',
  '          FROM expandido ex',
  '          JOIN public.marcacoes_ponto m ON m.id = ex.marcacao_id',
  '    )',
  '    -- Pode haver DUAS alocacoes para o mesmo (linha, passo): a do bloco, que vale para todas as',
  '    -- linhas, e a da fronteira, que e daquela linha so. A especifica vence — e o que faz a linha',
  '    -- do plantao mostrar a batida das 13:10 em vez da entrada do expediente das 07:04. Fora esse',
  '    -- desempate os agregados apenas pivotam de linhas para colunas.',
  '    --',
  '    -- array_agg(...)[1] em vez de max() nao e preciosismo: NAO EXISTE max(uuid) no Postgres -',
  '    -- usar max em marcacao_id falha com 42883 no CREATE FUNCTION. E, para a coluna de origem,',
  '    -- max() de enum funciona mas escolheria pelo ordinal do tipo, o que sugeriria uma regra de',
  '    -- desempate que nao existe aqui. Nao trocar de volta.',
  '    SELECT',
  '        cd.ed_id,',
  "        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'entrada'))[1],",
  "        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'entrada'))[1],",
  "        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'entrada'))[1],",
  "        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_saida'))[1],",
  "        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_saida'))[1],",
  "        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_saida'))[1],",
  "        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_retorno'))[1],",
  "        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_retorno'))[1],",
  "        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_retorno'))[1],",
  "        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'saida'))[1],",
  "        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'saida'))[1],",
  "        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'saida'))[1],",
  '        -- Confirmada quando ha qualquer marcacao no dia.',
  '        count(*) > 0',
  '      FROM com_dados cd',
  '     GROUP BY cd.ed_id',
  '$fnproj$;',
  '',
  'COMMENT ON FUNCTION public.fn_projecao_marcacoes_dia(uuid, date) IS',
  "    'O que escala_diaria deveria conter para um servidor num dia, derivado das marcacoes. '",
  "    'Fonte unica compartilhada por fn_reconciliar_marcacoes_dia e fn_conferir_reconciliacao. '",
  "    'Alocacao de fronteira (batida de transicao) vence a do bloco na mesma linha e passo.';",
  '',
  'GRANT EXECUTE ON FUNCTION public.fn_projecao_marcacoes_dia(uuid, date) TO authenticated, service_role;',
])

// ============================================================================
// 4. Montar o arquivo
// ============================================================================
const cabecalho = [
  '-- ============================================================================',
  '-- Migration: batida de transicao entre turnos fundidos no mesmo bloco',
  '-- Data: 2026-08-19',
  '--',
  '-- PROBLEMA (medido em producao em 19/08/2026)',
  '--   Regular M 07:00-13:00 + Plantao T 13:00-19:00 fundem em UM bloco continuo (armadilha 6),',
  '--   e o bloco tem 4 passos no maximo: entrada, intervalo (quando ha) e saida. Nao existia',
  '--   passo na FRONTEIRA dos dois turnos.',
  '--',
  '--   Consequencias, as duas visiveis no anexo de plantoes:',
  '--     - quem bate na transicao perde a batida: MAISA (mat. 32269), 18/08/2026, bateu 07:04,',
  '--       13:07, 13:10 e 19:09; as duas do meio viraram pendencia "fora_da_janela".',
  '--     - a projecao grava o MESMO par entrada/saida em todas as linhas do bloco, entao a linha',
  '--       do plantao recebia o horario do expediente (07:04 -> 19:09) — e no anexo o plantao',
  '--       aparecia com o horario do regular.',
  '--',
  '-- CORRECAO — tres funcoes, uma ideia so',
  '--   Cada fronteira interna do bloco ganha DOIS slots opcionais: a saida do turno que fecha e a',
  '--   entrada do turno que abre, ambos previstos no mesmo instante. Eles sao gravados na LINHA de',
  '--   cada turno, nao no bloco inteiro.',
  '--',
  '--   1. fn_blocos_previstos_dia expoe turnos_inicio[] / turnos_fim[] — o previsto de cada turno',
  '--      fundido, na ordem de escala_diaria_ids. A regra de fusao NAO muda.',
  '--   2. fn_alocar_marcacoes_dia cria os slots de fronteira e ordena os slots por instante',
  '--      previsto (o DP e um alinhamento monotonico; sem ordenar, a batida de transicao seria',
  '--      recusada do mesmo jeito). Slot opcional sem batida NAO vira pendencia.',
  '--   3. fn_projecao_marcacoes_dia desempata a favor da alocacao de fronteira, que e especifica',
  '--      de uma linha, contra a do bloco, que vale para todas.',
  '--',
  '-- O QUE NAO MUDA',
  '--   - Quem trabalha em bloco continuo e bate so duas vezes continua igual: os slots de',
  '--     fronteira ficam vazios e nao geram pendencia nem horario nenhum.',
  '--   - Nada e fabricado. Sem batida na fronteira, a linha do plantao segue com o horario do',
  '--     bloco, como hoje — a Portaria 671/2021 veda marcacao automatica, nao preenchimento',
  '--     derivado de uma batida real.',
  '--   - A fusao de blocos, os guards de Sobreaviso e o guard de escopo de fn_blocos_previstos_dia',
  '--     seguem intactos (conferidos por contagem no gerador).',
  '--',
  '-- fn_blocos_previstos_dia muda a lista de colunas do RETURNS TABLE, entao precisa de DROP antes',
  '-- do CREATE (42P13 — ver a nota de 13/08/2026 no CLAUDE.md). Sem CASCADE: se algum dependente',
  '-- real existir, e melhor o erro do que a remocao silenciosa. fn_blocos_previstos_mes lista as',
  '-- colunas que consome uma a uma, entao nao quebra com colunas novas.',
  '--',
  '-- Corpos copiados mecanicamente de 20260812130000 (blocos) e 20260819180000 (alocacao)',
  '-- por scratchpad/gen_batida_transicao.js, que aborta se a contagem de ocorrencias divergir.',
  '-- ============================================================================',
  '',
  '',
  'DROP FUNCTION IF EXISTS public.fn_blocos_previstos_dia(uuid, date);',
  '',
  '',
]

const rodapeBlocos = L([
  '',
  '',
  'COMMENT ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) IS',
  "    'Blocos de trabalho previstos de um servidor num dia, com janela de intervalo e o previsto '",
  "    'de cada turno fundido (turnos_inicio/turnos_fim), que e onde mora a batida de transicao. '",
  "    'Corpo copiado mecanicamente de fn_confirmar_presenca - regerar pelo script, nunca editar a '",
  "    'mao. Sobreaviso fica de fora por construcao.';",
  '',
  'GRANT EXECUTE ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) TO authenticated, service_role;',
  '',
  '',
])

const rodapeAloc = L([
  '',
  '',
  'COMMENT ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer) IS',
  "    'Aloca marcacoes do dia nos passos previstos. Um passo nunca casa com batida anterior a '",
  "    'meia-noite do dia civil em que o bloco comeca (piso), uma batida cujo passo previsto mais '",
  "    'proximo pertence a um bloco de dia vizinho nao e candidata aqui (regra do dono), e cada '",
  "    'fronteira entre turnos fundidos tem slots opcionais para a batida de transicao. '",
  "    'Teto de casamento de 720 min. Ver 20260819200000, 20260819180000 e 20260819120000.';",
  '',
  'GRANT EXECUTE ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer)',
  '    TO authenticated, service_role;',
  '',
  '',
])

const saida = cabecalho.join('\r\n') + blocos + rodapeBlocos + aloc + rodapeAloc + projecao + '\r\n'

exigir(saida, {
  '$fnbloco$': 2,
  '$fnaloc$': 2,
  '$fnproj$': 2,
  'CREATE OR REPLACE FUNCTION': 3,
  'DROP FUNCTION IF EXISTS': 2,
  'GRANT EXECUTE': 3,
  'COMMENT ON FUNCTION': 3,
}, 'arquivo')
if (/\n(?!\r)/.test(saida.replace(/\r\n/g, ''))) { console.error('ABORTADO: sobrou quebra de linha sem CR (o projeto usa CRLF).'); process.exit(1) }

fs.writeFileSync(path.join(DIR, DESTINO), saida)
console.log('OK: ' + DESTINO + ' (' + saida.split('\r\n').length + ' linhas; blocos ' + trocasB + ' trocas, alocacao ' + trocasA + ')')
