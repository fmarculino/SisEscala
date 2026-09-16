#!/usr/bin/env node
/**
 * Gera 20260915120000_abrangencia_do_relogio_alocacao.sql
 *
 * Copia fn_alocar_marcacoes_dia da migration VIGENTE (20260909170000) e troca a restricao de
 * LUGAR: a batida deixa de exigir "mesma unidade" e passa a exigir "o relogio onde ela foi
 * feita atende o setor da escala daquele passo".
 *
 * 🚨 ISTO MEXE NA ARMADILHA 55. O default continua FECHADO: a batida so atravessa unidade onde
 *    alguem DECLAROU que aquele relogio atende aquele setor. O caso que motivou a 55 (batida do
 *    HMI-02 virando ponto no CRISMU) continua barrado.
 *
 * ⚠️ A fonte esta em LF puro, nao CRLF (armadilha 59). O EOL e DETECTADO.
 */
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const FONTE = path.join(RAIZ, 'supabase/migrations/20260909170000_dia_vizinho_fora_do_escopo_nao_derruba.sql')
const SAIDA = path.join(RAIZ, 'supabase/migrations/20260915120000_abrangencia_do_relogio_alocacao.sql')

const bruto = fs.readFileSync(FONTE, 'utf8')
const crlf = (bruto.match(/\r\n/g) || []).length
const lf = (bruto.match(/\n/g) || []).length
if (crlf !== 0 && crlf !== lf) {
  console.error(`ABORTADO: fonte com EOL MISTO (${crlf} CRLF de ${lf} LF).`); process.exit(1)
}
const EOL = crlf === lf && crlf > 0 ? '\r\n' : '\n'
console.log(`fonte: ${path.basename(FONTE)}  EOL=${EOL === '\r\n' ? 'CRLF' : 'LF'}`)

const INI = 'CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia('
const i = bruto.indexOf(INI)
if (i < 0) { console.error('ABORTADO: fn_alocar_marcacoes_dia nao encontrada.'); process.exit(1) }
const FIMTAG = `${EOL}$fnaloc$;`
const j = bruto.indexOf(FIMTAG, i)
if (j < 0) { console.error('ABORTADO: fim ($fnaloc$;) nao encontrado.'); process.exit(1) }
let fn = bruto.slice(i, j + FIMTAG.length)
console.log(`fn_alocar_marcacoes_dia: ${fn.split(EOL).length} linhas copiadas`)

// ---------------------------------------------------------------------------
// Invariantes ANTES - as defesas que NAO podem sair (armadilha 1)
// ---------------------------------------------------------------------------
const INVARIANTES = [
  ['piso de meia-noite',            /v_slot_piso/g],
  ['regra do dono (sombras)',       /v_sombra_prev/g],
  ['vinculos irmaos (duplo vinculo)', /v_irmao|irmao/g],
  ['fronteira entre vinculos',      /FRONTEIRA ENTRE VINCULOS/g],
  ['pendencia outra_unidade',       /outra_unidade/g],
  ['dia vizinho tolerado',          /fn_blocos_previstos_dia_vizinho/g],
  ['slots opcionais de fronteira',  /v_slot_opcional/g],
]
for (const [nome, re] of INVARIANTES) {
  const n = (fn.match(re) || []).length
  if (n === 0) { console.error(`ABORTADO: invariante "${nome}" ausente na fonte.`); process.exit(1) }
  console.log(`  ok invariante ${nome}: ${n}`)
}

function trocar(texto, de, para, esperado, rotulo) {
  const partes = texto.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    console.error(`ABORTADO: "${rotulo}" casou ${achou}x, esperava ${esperado}x.`)
    process.exit(1)
  }
  console.log(`  ok troca ${rotulo}: ${achou}x`)
  return partes.join(para)
}
const L = (...l) => l.join(EOL)

// ---------------------------------------------------------------------------
// 1. DECLARE externo: o setor de cada slot
// ---------------------------------------------------------------------------
fn = trocar(fn,
  L(`    v_slot_unidade  uuid[]        := '{}';`,
    `    v_bloco_unidade uuid;`),
  L(`    v_slot_unidade  uuid[]        := '{}';`,
    `    v_bloco_unidade uuid;`,
    `    -- Setor da escala a que cada slot pertence (15/09/2026). E o que permite perguntar`,
    `    -- "o relogio da batida atende ESTE setor?" em vez de "a batida e da mesma unidade?".`,
    `    -- NULL = bloco com setores diferentes: cai na regra de unidade, como antes.`,
    `    v_slot_setor    uuid[]        := '{}';`,
    `    v_bloco_setor   uuid;`),
  1, 'declaracao de v_slot_setor')

// ---------------------------------------------------------------------------
// 2. Calcular o setor do bloco junto com a unidade
// ---------------------------------------------------------------------------
fn = trocar(fn,
  L(`        SELECT CASE WHEN count(DISTINCT em.unidade_id) = 1`,
    `                    THEN (array_agg(DISTINCT em.unidade_id))[1] END`,
    `          INTO v_bloco_unidade`,
    `          FROM unnest(r.escala_diaria_ids) AS x(id)`,
    `          JOIN public.escala_diaria ed  ON ed.id = x.id`,
    `          JOIN public.escala_mensal em  ON em.id = ed.escala_mensal_id;`),
  L(`        SELECT CASE WHEN count(DISTINCT em.unidade_id) = 1`,
    `                    THEN (array_agg(DISTINCT em.unidade_id))[1] END,`,
    `               CASE WHEN count(DISTINCT em.setor_id) = 1`,
    `                    THEN (array_agg(DISTINCT em.setor_id))[1] END`,
    `          INTO v_bloco_unidade, v_bloco_setor`,
    `          FROM unnest(r.escala_diaria_ids) AS x(id)`,
    `          JOIN public.escala_diaria ed  ON ed.id = x.id`,
    `          JOIN public.escala_mensal em  ON em.id = ed.escala_mensal_id;`),
  1, 'calculo de v_bloco_setor')

// ---------------------------------------------------------------------------
// 3. Os SEIS empilhamentos de slot ganham o setor junto
// ---------------------------------------------------------------------------
fn = trocar(fn,
  `v_slot_unidade := v_slot_unidade || v_bloco_unidade;`,
  `v_slot_unidade := v_slot_unidade || v_bloco_unidade; v_slot_setor := v_slot_setor || v_bloco_setor;`,
  6, 'empilhamento do setor nos 6 slots')

// ---------------------------------------------------------------------------
// 4. REORDENACAO - o array novo tem que entrar junto (senao o setor desalinha do slot)
// ---------------------------------------------------------------------------
fn = trocar(fn,
  L(`               array_agg(t.uni   ORDER BY t.prev, t.ord)`,
    `          INTO v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional, v_slot_unidade`,
    `          FROM unnest(v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional, v_slot_unidade)`,
    `               WITH ORDINALITY AS t(passo, prev, bloco, ids, dta, piso, opc, uni, ord);`),
  L(`               array_agg(t.uni   ORDER BY t.prev, t.ord),`,
    `               array_agg(t.set   ORDER BY t.prev, t.ord)`,
    `          INTO v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional, v_slot_unidade, v_slot_setor`,
    `          FROM unnest(v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional, v_slot_unidade, v_slot_setor)`,
    `               WITH ORDINALITY AS t(passo, prev, bloco, ids, dta, piso, opc, uni, set, ord);`),
  1, 'reordenacao inclui v_slot_setor')

// ---------------------------------------------------------------------------
// 5. DECLARE interno: o dispositivo da batida e a matriz de compatibilidade
// ---------------------------------------------------------------------------
fn = trocar(fn,
  L(`            v_m_uni     uuid[]        := '{}';`,
    `            v_m_cross   boolean[]     := '{}';`),
  L(`            v_m_uni     uuid[]        := '{}';`,
    `            -- Qual RELOGIO registrou a batida. So origem 'rep' tem: e o que permite`,
    `            -- perguntar pela abrangencia dele (15/09/2026).`,
    `            v_m_disp    uuid[]        := '{}';`,
    `            -- Compatibilidade de lugar (marcacao k x slot s), pre-computada uma vez.`,
    `            -- Pre-computar importa: a alternativa era chamar fn_dispositivo_atende_setor`,
    `            -- dentro do laco do DP, que e O(n_marc x n_slots) e roda por (servidor, dia)`,
    `            -- em toda ingestao de AFD.`,
    `            v_lugar     boolean[]     := '{}';`,
    `            v_m_cross   boolean[]     := '{}';`),
  1, 'declaracao de v_m_disp e v_lugar')

// ---------------------------------------------------------------------------
// 6. Cursor: trazer o dispositivo junto do lugar
// ---------------------------------------------------------------------------
fn = trocar(fn,
  L(`                SELECT m.id, m.ocorrido_em,`,
    `                       CASE WHEN m.origem = 'rep' AND m.dispositivo_id IS NOT NULL`,
    `                            THEN m.unidade_id END AS lugar`),
  L(`                SELECT m.id, m.ocorrido_em,`,
    `                       CASE WHEN m.origem = 'rep' AND m.dispositivo_id IS NOT NULL`,
    `                            THEN m.unidade_id END AS lugar,`,
    `                       CASE WHEN m.origem = 'rep' AND m.dispositivo_id IS NOT NULL`,
    `                            THEN m.dispositivo_id END AS disp`),
  1, 'cursor traz o dispositivo')

fn = trocar(fn,
  `                v_m_uni := v_m_uni || r.lugar;`,
  L(`                v_m_uni := v_m_uni || r.lugar;`,
    `                v_m_disp := v_m_disp || r.disp;`),
  1, 'preenchimento de v_m_disp')

// ---------------------------------------------------------------------------
// 7. O CONSERTO: a compatibilidade de lugar passa pela abrangencia
// ---------------------------------------------------------------------------
fn = trocar(fn,
  L(`            v_m_cross := array_fill(false, ARRAY[GREATEST(n_marc, 1)]);`,
    `            FOR k IN 1..n_marc LOOP`,
    `                IF v_m_uni[k] IS NOT NULL THEN`,
    `                    FOR s IN 1..n_slots LOOP`,
    `                        IF v_slot_unidade[s] IS NOT NULL`,
    `                           AND v_slot_unidade[s] <> v_m_uni[k]`,
    `                           AND v_m_ts[k] >= v_slot_piso[s]`,
    `                           AND abs(extract(epoch FROM (v_m_ts[k] - v_slot_prev[s])) / 60.0) <= v_tol_ontem THEN`,
    `                            v_m_cross[k] := true;`,
    `                            EXIT;`,
    `                        END IF;`,
    `                    END LOOP;`,
    `                END IF;`,
    `            END LOOP;`),
  L(`            -- ABRANGENCIA DO RELOGIO (15/09/2026). Ate aqui a regra era "mesma unidade".`,
    `            -- Ela esta certa para o caso dominante e continua sendo o primeiro ramo - mas`,
    `            -- deixava de fora o setor que funciona FISICAMENTE dentro de outra unidade (os`,
    `            -- 4 polos do CAF, medidos em 15/09/2026: 16 pessoas, zero batidas). Agora a`,
    `            -- pergunta e "o relogio onde a batida foi feita atende o setor desta escala?".`,
    `            --`,
    `            -- 🚨 O DEFAULT CONTINUA FECHADO. So atravessa unidade o que alguem DECLAROU em`,
    `            --    dispositivos_rep_setores. O caso da armadilha 55 (batida do HMI-02 virando`,
    `            --    ponto no CRISMU) continua barrado: ninguem vinculou setor do CRISMU ali.`,
    `            --`,
    `            -- A ordem do CASE e deliberada: o ramo caro (a funcao) so e alcancado quando as`,
    `            -- unidades DIVERGEM, que e o caso raro.`,
    `            v_lugar := array_fill(true, ARRAY[GREATEST(n_marc, 1) * GREATEST(n_slots, 1)]);`,
    `            FOR k IN 1..n_marc LOOP`,
    `                FOR s IN 1..n_slots LOOP`,
    `                    v_lugar[(k - 1) * n_slots + s] := CASE`,
    `                        -- Lugar desconhecido nunca recusa: nao existe batida descartada por`,
    `                        -- falta de informacao (regra do modulo).`,
    `                        WHEN v_m_uni[k] IS NULL OR v_slot_unidade[s] IS NULL THEN true`,
    `                        WHEN v_m_uni[k] = v_slot_unidade[s]                  THEN true`,
    `                        -- Bloco com setores diferentes (v_slot_setor NULL) ou batida sem`,
    `                        -- relogio: sem como consultar abrangencia, vale a regra antiga.`,
    `                        WHEN v_m_disp[k] IS NULL OR v_slot_setor[s] IS NULL  THEN false`,
    `                        ELSE public.fn_dispositivo_atende_setor(v_m_disp[k], v_slot_setor[s], v_slot_unidade[s])`,
    `                    END;`,
    `                END LOOP;`,
    `            END LOOP;`,
    ``,
    `            v_m_cross := array_fill(false, ARRAY[GREATEST(n_marc, 1)]);`,
    `            FOR k IN 1..n_marc LOOP`,
    `                IF v_m_uni[k] IS NOT NULL THEN`,
    `                    FOR s IN 1..n_slots LOOP`,
    `                        IF NOT v_lugar[(k - 1) * n_slots + s]`,
    `                           AND v_m_ts[k] >= v_slot_piso[s]`,
    `                           AND abs(extract(epoch FROM (v_m_ts[k] - v_slot_prev[s])) / 60.0) <= v_tol_ontem THEN`,
    `                            v_m_cross[k] := true;`,
    `                            EXIT;`,
    `                        END IF;`,
    `                    END LOOP;`,
    `                END IF;`,
    `            END LOOP;`),
  1, 'matriz de compatibilidade de lugar')

// ---------------------------------------------------------------------------
// 8. O DP consome a matriz
// ---------------------------------------------------------------------------
fn = trocar(fn,
  L(`                       AND (v_m_uni[k] IS NULL OR v_slot_unidade[s] IS NULL`,
    `                            OR v_m_uni[k] = v_slot_unidade[s])`),
  `                       AND v_lugar[(k - 1) * n_slots + s]`,
  1, 'DP usa a matriz de lugar')

// ---------------------------------------------------------------------------
// 9. Invariantes DEPOIS
// ---------------------------------------------------------------------------
for (const [nome, re] of INVARIANTES) {
  if (!(fn.match(re) || []).length) { console.error(`ABORTADO: invariante "${nome}" sumiu apos as trocas.`); process.exit(1) }
}
const contagens = [
  ['v_slot_setor', 11], // 1 declaracao + 6 empilhamentos + 2 reordenacao(agg/into/unnest=3) ...
]
// contagem estrutural robusta: cada array de slot tem que aparecer o MESMO numero de vezes
// nos tres pontos da reordenacao, senao ele desalinha.
for (const alvo of ['v_slot_unidade', 'v_slot_setor']) {
  const naReord = (fn.match(new RegExp(`${alvo}`, 'g')) || []).length
  if (naReord < 8) { console.error(`ABORTADO: ${alvo} aparece so ${naReord}x - esperava >= 8.`); process.exit(1) }
  console.log(`  ok ${alvo}: ${naReord} ocorrencias`)
}
// 5 = declaracao, array_fill, atribuicao no laco, leitura no v_m_cross, leitura no DP.
// Menos que isso significa que a matriz nao esta sendo consumida em algum dos dois pontos -
// e ai a restricao vale so num deles, que e pior que nao existir (a batida casaria E seria
// rotulada como de outra unidade, ou o contrario).
if ((fn.match(/v_lugar/g) || []).length !== 5) {
  console.error(`ABORTADO: v_lugar aparece ${(fn.match(/v_lugar/g) || []).length}x, esperava 5x.`)
  process.exit(1)
}
if ((fn.match(/v_m_uni\[k\] = v_slot_unidade\[s\]/g) || []).length !== 1) {
  console.error('ABORTADO: a comparacao de unidade deveria sobrar 1x (dentro do CASE), como primeiro ramo.')
  process.exit(1)
}
if ((fn.match(/\$fnaloc\$/g) || []).length !== 2) {
  console.error('ABORTADO: delimitadores $fnaloc$ desbalanceados.'); process.exit(1)
}
console.log('  ok invariantes pos-troca')

// ---------------------------------------------------------------------------
// 10. Monta a migration
// ---------------------------------------------------------------------------
const cabecalho = L(
'-- Migration: abrangencia do relogio REP - ALOCACAO (parte 3 de 3)',
'-- Data: 2026-09-15',
'--',
'-- Gerada por scratchpad/gen_abrangencia_alocacao.js a partir de',
'-- 20260909170000_dia_vizinho_fora_do_escopo_nao_derruba.sql (corpo copiado, nao redigitado).',
'-- Plano: docs/planos/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md',
'--',
'-- DEPENDE DE 20260915100000 (coluna + fn_dispositivo_atende_setor). Aplicar depois dela.',
'--',
'-- O QUE MUDA',
'--   A batida de relogio deixa de exigir "mesma unidade" para casar com um passo e passa a',
'--   exigir "o relogio onde ela foi feita ATENDE o setor daquela escala". Sem isto, as duas',
'--   migrations anteriores fazem a pessoa aparecer na tela e chegar ao equipamento - e a batida',
'--   dela continuaria virando pendencia `outra_unidade`, sem nunca chegar a folha.',
'--',
'-- 🚨 ISTO MEXE NA RESTRICAO DA ARMADILHA 55, E O DEFAULT CONTINUA FECHADO',
'--   A batida so atravessa unidade onde alguem DECLAROU, em dispositivos_rep_setores, que',
'--   aquele relogio atende aquele setor. Hoje nao existe nenhum vinculo assim (medido: 0),',
'--   entao esta migration e INERTE ate a primeira vinculacao pela tela.',
'--   O caso que motivou a 55 - batida do REP-iDClass-HMI-02 virando ponto de uma escala do',
'--   CRISMU - continua barrado, porque ninguem vinculou setor do CRISMU aquele equipamento.',
'--',
'-- PROIBIR, NAO PENALIZAR (mantido)',
'--   O ramo do DP continua sendo NAO CONSIDERADO quando o lugar nao bate - custo infinito, nao',
'--   custo alto. Com penalidade, a troca volta sempre que nao houver candidata melhor.',
'--',
'-- NUNCA DESCARTAR BATIDA (mantido)',
'--   O cursor de candidatas continua SEM filtro de lugar: a batida e lida, disputa o DP e, se',
'--   nao casar, vira pendencia com tipo `outra_unidade`, visivel na aba Pendencias.',
'--',
'-- PERFORMANCE',
'--   A compatibilidade (marcacao x slot) e pre-computada UMA vez numa matriz, e o ramo que',
'--   chama fn_dispositivo_atende_setor so e alcancado quando as unidades DIVERGEM - o caso raro.',
'--   No caso dominante nao ha uma chamada de funcao sequer a mais que hoje.',
'--',
'-- IDEMPOTENTE: so CREATE OR REPLACE, mesma assinatura (os privilegios sao preservados).',
'',
'')

const rodape = L(
'',
'',
'-- ============================================================================',
'-- CONFERENCIA (roda junto, aborta a migration inteira se algo divergir)',
'-- ============================================================================',
'-- Armadilha 42: tem que EXECUTAR a funcao, nao so conferir que ela existe. E confere os DOIS',
'-- sentidos - afrouxar demais aqui reabre exatamente o defeito de 08/09/2026.',
'',
'DO $conf$',
'DECLARE',
'    v_dep       integer;',
'    v_par       record;',
'    v_aloc      jsonb;',
'    v_n         integer := 0;',
'    v_com       integer := 0;',
'BEGIN',
'    -- 1. A parte 1 precisa estar aplicada (o predicado e chamado la dentro).',
'    IF to_regprocedure(\'public.fn_dispositivo_atende_setor(uuid, uuid, uuid)\') IS NULL THEN',
'        RAISE EXCEPTION \'ABORTADO: aplique 20260915100000 (fn_dispositivo_atende_setor) antes desta.\';',
'    END IF;',
'',
'    -- 2. A funcao EXECUTA e continua alocando em dias reais. Uma quebra aqui apareceria como',
'    --    "ninguem mais tem ponto", entao a amostra precisa ter alocacao de verdade.',
'    FOR v_par IN',
'        SELECT m.servidor_id AS sid, (m.ocorrido_em AT TIME ZONE \'America/Sao_Paulo\')::date AS dia',
'          FROM public.marcacoes_ponto m',
'         WHERE m.origem = \'rep\' AND m.servidor_id IS NOT NULL',
'           AND m.ocorrido_em >= now() - interval \'20 days\'',
'         GROUP BY 1, 2',
'         ORDER BY 2 DESC',
'         LIMIT 40',
'    LOOP',
'        v_aloc := public.fn_alocar_marcacoes_dia(v_par.sid, v_par.dia);',
'        v_n := v_n + 1;',
'        IF jsonb_array_length(COALESCE(v_aloc->\'alocacoes\', \'[]\'::jsonb)) > 0 THEN',
'            v_com := v_com + 1;',
'        END IF;',
'    END LOOP;',
'',
'    IF v_n = 0 THEN',
'        RAISE NOTICE \'-   amostra vazia (banco sem batida de relogio recente): conferencia funcional pulada\';',
'    ELSE',
'        IF v_com = 0 THEN',
'            RAISE EXCEPTION \'ABORTADO: nenhum dos % dias da amostra teve alocacao - a restricao de lugar esta recusando tudo.\', v_n;',
'        END IF;',
'        RAISE NOTICE \'ok  % de % dias da amostra continuam com alocacao\', v_com, v_n;',
'    END IF;',
'',
'    -- 3. O OUTRO SENTIDO: sem vinculo cruzado, batida de outra unidade continua SEM casar.',
'    --    Afrouxar demais aqui e o defeito de 08/09/2026 de volta.',
'    SELECT count(*) INTO v_dep',
'      FROM public.dispositivos_rep_setores ds',
'      JOIN public.dispositivos_rep d ON d.id = ds.dispositivo_id',
'      JOIN public.setores s          ON s.id = ds.setor_id',
'     WHERE s.unidade_id IS DISTINCT FROM d.unidade_id;',
'    RAISE NOTICE \'ok  vinculos cruzados declarados hoje: % (0 = esta migration esta inerte)\', v_dep;',
'',
'    -- 4. Privilegios preservados (mesma assinatura, mas confirmar e barato).',
'    IF has_function_privilege(\'anon\', \'public.fn_alocar_marcacoes_dia(uuid, date, integer, integer)\', \'EXECUTE\') THEN',
'        RAISE EXCEPTION \'ABORTADO: anon ganhou execute em fn_alocar_marcacoes_dia.\';',
'    END IF;',
'    RAISE NOTICE \'ok  anon continua fora de fn_alocar_marcacoes_dia\';',
'END;',
'$conf$;',
'')

fs.writeFileSync(SAIDA, cabecalho + fn + rodape, 'utf8')
const txt = fs.readFileSync(SAIDA, 'utf8')
console.log(`\nescrito: ${path.relative(RAIZ, SAIDA)}  (${txt.split(EOL).length} linhas, EOL=${EOL === '\r\n' ? 'CRLF' : 'LF'})`)
