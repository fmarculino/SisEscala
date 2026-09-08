// Gera a migration que impede a ALOCACAO de atravessar unidades.
//
// Copia mecanica de fn_alocar_marcacoes_dia a partir da migration VIGENTE dela
// (20260901120000). Aborta se qualquer contagem de ocorrencia divergir.
//
// split().join(), nunca String.replace com string (armadilha 1: replace interpreta $$ e $').
const fs = require('fs')

const FONTE = 'supabase/migrations/20260901120000_guarda_intervalo_minimo_e_deduplicacao_entrada.sql'
const SAIDA = 'supabase/migrations/20260908150000_alocacao_nao_atravessa_unidade.sql'
const src = fs.readFileSync(FONTE, 'utf8')

// O terminador VEM DA FONTE, nao e' assumido: 20260901120000 esta em LF enquanto a maioria das
// migrations do projeto esta em CRLF. Fixar CRLF aqui faria toda ancora multi-linha errar o
// alvo — e o gerador abortaria dizendo "contagem divergente" por um motivo que nao e' esse.
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const CRLF = EOL

const INI = 'CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia('
const FIM = '$fnaloc$;'
const i = src.indexOf(INI)
const j = src.indexOf(FIM, i)
if (i < 0 || j < 0) { console.error('ABORTADO: nao achei fn_alocar_marcacoes_dia na fonte.'); process.exit(1) }
let out = src.slice(i, j + FIM.length)

if ((out.split('CREATE OR REPLACE FUNCTION').length - 1) !== 1) {
  console.error('ABORTADO: o extrato contem mais de uma funcao.')
  process.exit(1)
}

const CALC_UNIDADE = [
  '    LOOP',
  '        -- LUGAR DO BLOCO (08/09/2026). Unidade COMUM das linhas deste bloco. Se o bloco',
  '        -- misturasse unidades a resposta e NULL, e a restricao de lugar simplesmente nao se',
  '        -- aplica aqui — e o que torna esta migration segura de aplicar sozinha, antes da',
  '        -- 20260908140000, que e quem faz o bloco parar de atravessar unidade.',
  '        SELECT CASE WHEN count(DISTINCT em.unidade_id) = 1',
  '                    THEN (array_agg(DISTINCT em.unidade_id))[1] END',
  '          INTO v_bloco_unidade',
  '          FROM unnest(r.escala_diaria_ids) AS x(id)',
  '          JOIN public.escala_diaria ed  ON ed.id = x.id',
  '          JOIN public.escala_mensal em  ON em.id = ed.escala_mensal_id;',
  '',
  '        -- entrada',
].join(CRLF)

const REORDENA_DE = [
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
].join(CRLF)

const REORDENA_PARA = [
  '        -- v_slot_unidade entra na reordenacao junto com os demais: reordenar seis arrays e',
  '        -- deixar o setimo parado desalinharia o lugar do slot do proprio slot, e a restricao',
  '        -- passaria a comparar a batida com a unidade de OUTRO passo.',
  '        SELECT array_agg(t.passo ORDER BY t.prev, t.ord),',
  '               array_agg(t.prev  ORDER BY t.prev, t.ord),',
  '               array_agg(t.bloco ORDER BY t.prev, t.ord),',
  '               array_agg(t.ids   ORDER BY t.prev, t.ord),',
  '               array_agg(t.dta   ORDER BY t.prev, t.ord),',
  '               array_agg(t.piso  ORDER BY t.prev, t.ord),',
  '               array_agg(t.opc   ORDER BY t.prev, t.ord),',
  '               array_agg(t.uni   ORDER BY t.prev, t.ord)',
  '          INTO v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional, v_slot_unidade',
  '          FROM unnest(v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional, v_slot_unidade)',
  '               WITH ORDINALITY AS t(passo, prev, bloco, ids, dta, piso, opc, uni, ord);',
].join(CRLF)

const CROSS = [
  '',
  '            -- LUGAR DA BATIDA x LUGAR DO PASSO (08/09/2026). Marca a batida de relogio que',
  '            -- tinha um passo no horario certo e so nao pode casar por ser de outra unidade.',
  '            -- Sem isto ela sairia como "fora_da_janela", que e mentira: o horario estava certo,',
  '            -- o lugar e que nao. A pendencia precisa dizer a verdade para alguem poder trata-la.',
  '            v_m_cross := array_fill(false, ARRAY[GREATEST(n_marc, 1)]);',
  '            FOR k IN 1..n_marc LOOP',
  '                IF v_m_uni[k] IS NOT NULL THEN',
  '                    FOR s IN 1..n_slots LOOP',
  '                        IF v_slot_unidade[s] IS NOT NULL',
  '                           AND v_slot_unidade[s] <> v_m_uni[k]',
  '                           AND v_m_ts[k] >= v_slot_piso[s]',
  '                           AND abs(extract(epoch FROM (v_m_ts[k] - v_slot_prev[s])) / 60.0) <= v_tol_ontem THEN',
  '                            v_m_cross[k] := true;',
  '                            EXIT;',
  '                        END IF;',
  '                    END LOOP;',
  '                END IF;',
  '            END LOOP;',
  '',
  '            v_custo   := array_fill(0::numeric, ARRAY[(n_marc + 1) * (n_slots + 1)]);',
].join(CRLF)

// [de, para, ocorrencias esperadas]
const SUBS = [
  // 1. DECLARACOES
  ["    v_slot_opcional boolean[]     := '{}';",
    "    v_slot_opcional boolean[]     := '{}';" + CRLF +
    '    -- Unidade da escala a que cada slot pertence. NULL = lugar desconhecido, e ai a' + CRLF +
    '    -- restricao de lugar nao se aplica (nunca recusar batida por falta de informacao).' + CRLF +
    "    v_slot_unidade  uuid[]        := '{}';" + CRLF +
    '    v_bloco_unidade uuid;', 1],

  ["            v_m_ts      timestamptz[] := '{}';",
    "            v_m_ts      timestamptz[] := '{}';" + CRLF +
    '            -- Onde a batida foi feita. So a marcacao de RELOGIO carrega lugar confiavel:' + CRLF +
    '            -- em origem terminal, marcacoes_ponto.unidade_id e a LOTACAO do servidor' + CRLF +
    '            -- (fn_registrar_ponto le servidores.unidade_id), e usar isso como lugar' + CRLF +
    '            -- derrubaria o ponto do Servidor Externo, lotado em A e escalado em B.' + CRLF +
    "            v_m_uni     uuid[]        := '{}';" + CRLF +
    "            v_m_cross   boolean[]     := '{}';", 1],

  // 2. LUGAR DO BLOCO, no topo do laco que monta os slots
  ['    LOOP' + CRLF + '        -- entrada', CALC_UNIDADE, 1],

  // 3. os seis pushes de slot carregam o lugar junto
  ['v_slot_opcional := v_slot_opcional || false;',
    'v_slot_opcional := v_slot_opcional || false; v_slot_unidade := v_slot_unidade || v_bloco_unidade;', 4],
  ['v_slot_opcional := v_slot_opcional || true;',
    'v_slot_opcional := v_slot_opcional || true; v_slot_unidade := v_slot_unidade || v_bloco_unidade;', 2],

  // 4. reordenacao inclui o lugar
  [REORDENA_DE, REORDENA_PARA, 1],

  // 5. o cursor de candidatas passa a trazer o lugar
  ['                SELECT m.id, m.ocorrido_em' + CRLF + '                  FROM public.marcacoes_ponto m',
    '                SELECT m.id, m.ocorrido_em,' + CRLF +
    "                       CASE WHEN m.origem = 'rep' AND m.dispositivo_id IS NOT NULL" + CRLF +
    '                            THEN m.unidade_id END AS lugar' + CRLF +
    '                  FROM public.marcacoes_ponto m', 1],

  ['                v_m_ts  := v_m_ts  || r.ocorrido_em;',
    '                v_m_ts  := v_m_ts  || r.ocorrido_em;' + CRLF +
    '                v_m_uni := v_m_uni || r.lugar;', 1],

  // 6. o pre-calculo do motivo da pendencia, antes do DP
  ['            v_custo   := array_fill(0::numeric, ARRAY[(n_marc + 1) * (n_slots + 1)]);', CROSS, 1],

  // 7. A RESTRICAO. Casar batida de relogio com passo de outra unidade fica PROIBIDO, nao
  //    penalizado: com penalidade a troca volta sempre que nao houver candidata melhor, e o
  //    preco de errar aqui e ponto de servidor publico em folha.
  ['                    IF v_dist <= v_tol_ontem' + CRLF +
    '                       AND v_m_ts[k] >= v_slot_piso[s]' + CRLF +
    '                       AND v_custo[(k - 1) * (n_slots + 1) + (s - 1) + 1] + v_dist < v_melhor THEN',
    '                    IF v_dist <= v_tol_ontem' + CRLF +
    '                       AND v_m_ts[k] >= v_slot_piso[s]' + CRLF +
    '                       AND (v_m_uni[k] IS NULL OR v_slot_unidade[s] IS NULL' + CRLF +
    '                            OR v_m_uni[k] = v_slot_unidade[s])' + CRLF +
    '                       AND v_custo[(k - 1) * (n_slots + 1) + (s - 1) + 1] + v_dist < v_melhor THEN', 1],

  // 8. a pendencia diz o motivo verdadeiro
  ["'tipo', 'fora_da_janela', 'marcacao_id', v_m_id[k],",
    "'tipo', CASE WHEN v_m_cross[k] THEN 'outra_unidade' ELSE 'fora_da_janela' END," + CRLF +
    "                        'unidade_marcacao', v_m_uni[k], 'marcacao_id', v_m_id[k],", 2],
]

let falhou = false
for (const [de, para, esperado] of SUBS) {
  const n = out.split(de).length - 1
  const ok = n === esperado
  if (!ok) falhou = true
  const rot = de.split(CRLF)[0].trim().slice(0, 62)
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${String(n).padStart(2)}/${String(esperado).padEnd(2)} ${rot}`)
  out = out.split(de).join(para)
}
if (falhou) { console.error('\nABORTADO: contagem divergente. Nao gerei nada.'); process.exit(1) }

// --- invariantes ---
const INV = [
  ['CREATE OR REPLACE FUNCTION', 1],
  ['$fnaloc$', 2],
]
for (const [p, esperado] of INV) {
  const n = out.split(p).length - 1
  if (n !== esperado) { console.error(`ABORTADO: "${p}" aparece ${n}x, esperado ${esperado}`); process.exit(1) }
  console.log(`ok   invariante ${p} = ${n}`)
}

// TODO push de slot tem de empilhar tambem o lugar. Um array de slot mais curto que os outros
// desalinha tudo o que vem depois dele, e o sintoma seria a batida comparada com a unidade de
// outro passo — pior que o defeito original, porque parece funcionar.
const nOpc = out.split('v_slot_opcional := v_slot_opcional ||').length - 1
const nUni = out.split('v_slot_unidade := v_slot_unidade ||').length - 1
if (nOpc !== nUni) {
  console.error(`ABORTADO: ${nOpc} push(es) de v_slot_opcional contra ${nUni} de v_slot_unidade — os arrays de slot ficariam de tamanhos diferentes.`)
  process.exit(1)
}
console.log(`ok   invariante: todo push de slot empilha o lugar (${nUni} pushes)`)

// A reordenacao tem de levar o lugar junto (mesmo motivo acima, por outra porta).
if (!out.includes('array_agg(t.uni   ORDER BY t.prev, t.ord)') || !out.includes(', v_slot_unidade)')) {
  console.error('ABORTADO: a reordenacao dos slots nao inclui v_slot_unidade.')
  process.exit(1)
}
console.log('ok   invariante: a reordenacao inclui o lugar')

// Guards que a copia nao pode ter perdido.
const GUARDS = [
  'REGRA DO DONO',
  'c_teto_alocacao_min constant integer := 720',
  'v_slot_piso',
  'ignora_janela_presenca',
  'fn_precedencia_origem',
  "'tipo', 'duplicada'",
  "'tipo', 'sem_escala'",
  "'passo_sem_marcacao'",
  'ESPELHO DA BATIDA DE TRANSICAO SOLITARIA',
  'marcacoes_tratamentos',
]
for (const g of GUARDS) {
  if (!out.includes(g)) { console.error(`ABORTADO: guard ausente: ${g}`); process.exit(1) }
  console.log(`ok   guard presente: ${g.slice(0, 60)}`)
}

// A restricao NAO pode ter virado filtro no cursor de candidatas: filtrar ali descartaria a
// batida antes de ela poder virar pendencia, e "nunca descartar batida" e regra do projeto.
if (out.includes('AND m.unidade_id =') || out.includes('AND m.unidade_id IN')) {
  console.error('ABORTADO: o cursor de candidatas filtra por unidade — a batida tem de ser lida e virar pendencia, nunca sumir.')
  process.exit(1)
}
console.log('ok   o cursor de candidatas nao filtra por unidade')

const cab = fs.readFileSync('scratchpad/cab_alocacao_unidade.txt', 'utf8')
const rod = fs.readFileSync('scratchpad/rod_alocacao_unidade.txt', 'utf8')
fs.writeFileSync(SAIDA, cab + out + CRLF + rod)
console.log(`\ngerado: ${SAIDA} (${fs.statSync(SAIDA).size} bytes)`)
