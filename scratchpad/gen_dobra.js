// Gera a migration da dobra noturna por COPIA MECANICA das funcoes vigentes.
// Aborta em qualquer contagem de ocorrencias divergente (CLAUDE.md armadilha 1).
//
//   node gen_dobra.js
//
// Fontes:
//   20260808110000  -> fn_confirmar_presenca, fn_confirmar_presenca_manual, fn_blocos_previstos_dia
//   20260706115000  -> fn_salvar_saida_bloco
const fs = require('fs')
const path = require('path')

const MIG = 'c:/Users/Cliente/Projetos/SisEscala/supabase/migrations'
const SRC_FN = path.join(MIG, '20260808110000_add_hora_inicio_prevista_escala_diaria.sql')
const SRC_SB = path.join(MIG, '20260706115000_fix_extra_shifts_crossing_midnight.sql')
const OUT = path.join(MIG, '20260809000000_night_double_shift_anchor_and_transition_punch.sql')

const NL = '\r\n' // arquivos usam CRLF
let falhas = []

function sub(src, nome, pattern, replacer, esperado) {
  let n = 0
  const out = src.replace(pattern, (...args) => { n++; return replacer(...args) })
  if (n !== esperado) falhas.push(`${nome}: esperava ${esperado} ocorrencia(s), achei ${n}`)
  else console.log(`  ok  ${nome} (${n}x)`)
  return out
}

// ---------------------------------------------------------------------------
// 1. As tres funcoes de 20260808110000
// ---------------------------------------------------------------------------
const full = fs.readFileSync(SRC_FN, 'utf8')
const linhas = full.split(NL)
// secao 3 comeca na linha 169 (1-indexed) e as funcoes terminam em "$fnbloco$;"
const ini = linhas.findIndex(l => l.includes('3. fn_confirmar_presenca (terminal)')) - 1
const fim = linhas.findIndex(l => l.trim() === '$fnbloco$;')
if (ini < 0 || fim < 0) { console.error('ABORTA: nao localizei os limites da secao de funcoes'); process.exit(1) }
let fn = linhas.slice(ini, fim + 1).join(NL)
console.log(`funcoes copiadas: linhas ${ini + 1}..${fim + 1} (${fim - ini + 1} linhas)`)

// --- A. NIVEL 2-A: ancora espelho da jornada noturna (4 sitios) -------------
const reAncora = /([ \t]*)CASE WHEN public\.fn_obter_horario_regular_dia\(em\.id, ed\.dia\) IS NULL\r\n[ \t]*THEN extract\(hour from dt\.horario_inicio\)::integer END,/g
fn = sub(fn, 'A. ancora espelho (nivel 2-A)', reAncora, (m, I) => {
  const arm = [
    `${I}-- NIVEL 2-A da cadeia de precedencia. Ver`,
    `${I}-- docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md`,
    `${I}--`,
    `${I}-- ESPELHO DA JORNADA NOTURNA. Quando o Regular do dia CRUZA A MEIA-NOITE`,
    `${I}-- (18H AS 06H), o plantao de periodo diurno NAO e sequencia do expediente:`,
    `${I}-- ele vem ANTES dele. A cascata legada alinhava o plantao pelo INICIO da`,
    `${I}-- jornada (18:00) e o sobrepunha inteiro ao Regular. A ancora correta e o`,
    `${I}-- FIM da jornada - a "manha" de quem faz noite comeca quando a noite dela`,
    `${I}-- terminaria (06:00).`,
    `${I}--`,
    `${I}-- Vale so para slots[1] em (M, T), o codigo que declara o periodo. Codigo de`,
    `${I}-- duracao livre (slots[1] numerico) continua resolvendo pelo NIVEL 1, acima.`,
    `${I}-- Fica ACIMA do nivel 2 porque a ancora fixa do dicionario (MT = 07:00) nao`,
    `${I}-- conhece a jornada do servidor e erraria por uma hora.`,
    `${I}CASE WHEN COALESCE(dt.slots[1], '') IN ('M', 'T')`,
    `${I}          AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer`,
    `${I}            < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer`,
    `${I}     THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer END,`
  ].join(NL)
  return arm + NL + m
}, 4)

// --- B. coluna dobra_diurna nos 3 cursores ---------------------------------
const reCursor = /([ \t]*)COALESCE\(u\.permite_marca_intervalo, false\) as permite_marca_intervalo,/g
fn = sub(fn, 'B. coluna dobra_diurna no cursor', reCursor, (m, I) => {
  const col = [
    `${I}-- Marca o plantao diurno que cai em dia de jornada noturna. Um turno marcado assim`,
    `${I}-- NAO FUNDE com nenhum outro bloco: sao duas jornadas de 12h, cada uma com seu`,
    `${I}-- proprio intervalo, e um bloco so carrega UM intervalo`,
    `${I}-- (v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min)). Fundir apagaria`,
    `${I}-- o intervalo da segunda jornada. NAO REMOVER.`,
    `${I}(ed.categoria = 'Plantão'`,
    `${I} AND COALESCE(dt.slots[1], '') IN ('M', 'T')`,
    `${I} AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer`,
    `${I}   < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer`,
    `${I}) as dobra_diurna,`
  ].join(NL)
  return m + NL + col
}, 3)

// --- C. declaracao das variaveis por turno (2 sitios cada) ------------------
for (const s of ['1', '2', '3']) {
  fn = sub(fn, `C${s}. DECLARE v_s${s}_dobra_diurna`,
    new RegExp(`v_s${s}_permite_int BOOLEAN;`, 'g'),
    m => `${m} v_s${s}_dobra_diurna BOOLEAN;`, 2)
}

// --- D. atribuicao no laco do cursor (3 sitios cada) -----------------------
for (const s of ['1', '2', '3']) {
  fn = sub(fn, `D${s}. atribui v_s${s}_dobra_diurna`,
    new RegExp(`v_s${s}_permite_int := v_permite_int;`, 'g'),
    m => `${m} v_s${s}_dobra_diurna := COALESCE(r.dobra_diurna, false);`, 3)
}

// --- E. guards de nao-fusao (12 sitios) ------------------------------------
fn = sub(fn, 'E1. guard fusao s1+s2',
  /v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso' THEN/g,
  () => `v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'` +
        `${NL}               AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN`, 6)

fn = sub(fn, 'E2. guard fusao s2+s3',
  /v_s2_cat <> 'Sobreaviso' AND v_s3_cat <> 'Sobreaviso' THEN/g,
  () => `v_s2_cat <> 'Sobreaviso' AND v_s3_cat <> 'Sobreaviso'` +
        `${NL}                   AND NOT v_s2_dobra_diurna AND NOT v_s3_dobra_diurna THEN`, 3)

fn = sub(fn, 'E3. guard fusao b1+s3',
  /IF v_s3_inicio <= v_b1_fim AND v_s3_cat <> 'Sobreaviso' THEN/g,
  () => `IF v_s3_inicio <= v_b1_fim AND v_s3_cat <> 'Sobreaviso' AND NOT v_s3_dobra_diurna THEN`, 3)

// --- F. batida de transicao ------------------------------------------------
fn = sub(fn, 'F1. DECLARE v_matched_idx / v_transicao',
  /v_matched_cat TEXT := NULL;/g,
  m => `${m}${NL}        v_matched_idx INTEGER := NULL;${NL}        v_transicao BOOLEAN := false;`, 1)

fn = sub(fn, 'F2. registra o indice do bloco no checkout',
  /v_matched_action := 'checkout';/g,
  m => `${m}${NL}                    v_matched_idx := idx;`, 2)

fn = sub(fn, 'F3. abre o bloco seguinte na batida de transicao',
  /( *)PERFORM public\.fn_salvar_saida_bloco\(v_matched_ids, v_now, p_coordenador_id, v_timezone, false\);/g,
  (m, I) => {
    const bloco = [
      ``,
      `${I}-- BATIDA DE TRANSICAO (09/08/2026). Ver`,
      `${I}-- docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md`,
      `${I}--`,
      `${I}-- Dois blocos encostados (fim do bloco i == inicio do bloco i+1) sao duas`,
      `${I}-- jornadas seguidas sem intervalo entre elas: o servidor sai de uma e entra na`,
      `${I}-- outra no mesmo instante. Uma batida so responde pelos dois passos.`,
      `${I}--`,
      `${I}-- O horario gravado na entrada do bloco seguinte e a BATIDA REAL, nunca o`,
      `${I}-- previsto - e o oposto de fabricar timestamp (Portaria 671/2021, vedacao 2).`,
      `${I}-- Sem esta regra o servidor teria de bater duas vezes no mesmo minuto, e quem`,
      `${I}-- esquecesse a segunda deixaria a jornada seguinte sem entrada.`,
      `${I}IF v_matched_idx = 1 AND v_blocks_count >= 2`,
      `${I}       AND v_b2_inicio = v_b1_fim AND v_b2_entradas[1] IS NULL THEN`,
      `${I}    UPDATE public.escala_diaria`,
      `${I}    SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id`,
      `${I}    WHERE id = ANY(v_b2_ids);`,
      `${I}    v_transicao := true;`,
      `${I}ELSIF v_matched_idx = 2 AND v_blocks_count >= 3`,
      `${I}       AND v_b3_inicio = v_b2_fim AND v_b3_entradas[1] IS NULL THEN`,
      `${I}    UPDATE public.escala_diaria`,
      `${I}    SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id`,
      `${I}    WHERE id = ANY(v_b3_ids);`,
      `${I}    v_transicao := true;`,
      `${I}END IF;`
    ].join(NL)
    return m + NL + bloco
  }, 1)

fn = sub(fn, 'F4. mensagem da transicao',
  /RETURN jsonb_build_object\('success', true, 'message', 'Saída confirmada às ' \|\| to_char\(v_now_local, 'HH24:MI'\) \|\| '\. Bom descanso!'\);/g,
  () => `RETURN jsonb_build_object('success', true, 'message',` +
        `${NL}                CASE WHEN v_transicao` +
        `${NL}                     THEN 'Saída do turno e entrada do turno seguinte confirmadas às ' || to_char(v_now_local, 'HH24:MI') || '. Bom trabalho!'` +
        `${NL}                     ELSE 'Saída confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!'` +
        `${NL}                END);`, 1)

// ---------------------------------------------------------------------------
// 2. fn_salvar_saida_bloco de 20260706115000
// ---------------------------------------------------------------------------
const fullSb = fs.readFileSync(SRC_SB, 'utf8')
const lSb = fullSb.split(NL)
const iSb = lSb.findIndex(l => l.startsWith('CREATE OR REPLACE FUNCTION public.fn_salvar_saida_bloco'))
const fSb = lSb.findIndex((l, i) => i > iSb && l.startsWith('$$ LANGUAGE plpgsql SECURITY DEFINER'))
if (iSb < 0 || fSb < 0) { console.error('ABORTA: nao localizei fn_salvar_saida_bloco'); process.exit(1) }
let sb = lSb.slice(iSb, fSb + 1).join(NL)
console.log(`fn_salvar_saida_bloco copiada: linhas ${iSb + 1}..${fSb + 1} (${fSb - iSb + 1} linhas)`)

sb = sub(sb, 'G1. SELECT busca hora_inicio_prevista e horario_inicio',
  /dt\.horas_computadas, dt\.slots, j\.horas_totais, dt\.codigo as turno_codigo, j\.nome as jornada_nome, ed\.categoria::text/g,
  m => `${m},${NL}            ed.hora_inicio_prevista, dt.horario_inicio`, 1)

sb = sub(sb, 'G2. niveis 1, 2-A e 2 na cascata',
  /( *)v_start_hour := COALESCE\(\r\n( *)CASE WHEN r\.categoria = 'Regular' THEN/g,
  (m, I, I2) => [
    `${I}-- NIVEL 1: hora informada pelo coordenador (escala_diaria.hora_inicio_prevista).`,
    `${I}-- Esta funcao FABRICA os horarios de transicao de um bloco com varios turnos, entao`,
    `${I}-- precisa enxergar a mesma cadeia que fn_confirmar_presenca usou para montar o bloco.`,
    `${I}-- Sem isso ela divide o bloco num horario que o terminal nunca cobrou.`,
    `${I}v_start_hour := COALESCE(`,
    `${I2}CASE WHEN r.categoria <> 'Regular'`,
    `${I2}     THEN extract(hour from r.hora_inicio_prevista)::integer END,`,
    `${I2}CASE WHEN r.categoria = 'Regular' THEN`
  ].join(NL), 1)

sb = sub(sb, 'G3. nivel 2-A e 2 dentro do ramo Plantao',
  /( *)CASE WHEN r\.categoria = 'Plantão' THEN\r\n( *)COALESCE\(\r\n/g,
  (m, I, I2) => [
    `${I}CASE WHEN r.categoria = 'Plantão' THEN`,
    `${I2}COALESCE(`,
    `${I2}    -- NIVEL 2-A: espelho da jornada noturna (ver secao 1 do cabecalho).`,
    `${I2}    CASE WHEN COALESCE(r.slots[1], '') IN ('M', 'T')`,
    `${I2}              AND (public.fn_obter_horario_regular_dia(r.escala_mensal_id, r.dia)->>'end_hour')::integer`,
    `${I2}                < (public.fn_obter_horario_regular_dia(r.escala_mensal_id, r.dia)->>'start_hour')::integer`,
    `${I2}         THEN (public.fn_obter_horario_regular_dia(r.escala_mensal_id, r.dia)->>'end_hour')::integer END,`,
    `${I2}    -- NIVEL 2: ancora fixa do dicionario, so quando nao ha Regular no dia.`,
    `${I2}    CASE WHEN public.fn_obter_horario_regular_dia(r.escala_mensal_id, r.dia) IS NULL`,
    `${I2}         THEN extract(hour from r.horario_inicio)::integer END,`,
    ``
  ].join(NL), 1)

// ---------------------------------------------------------------------------
if (falhas.length) {
  console.error('\nABORTADO. Nenhum arquivo escrito:')
  falhas.forEach(f => console.error('  ' + f))
  process.exit(1)
}

const crlf = s => s.replace(/\r?\n/g, NL)
const cab = crlf(fs.readFileSync(path.join(__dirname, 'cabecalho_dobra.sql'), 'utf8'))
const rodape = crlf(fs.readFileSync(path.join(__dirname, 'rodape_dobra.sql'), 'utf8'))
// ATENCAO: o segundo argumento de String.replace TEM de ser uma funcao. Com string, o JS
// interpreta os padroes de dolar: "$$" vira "$" (quebra o dollar-quoting do plpgsql) e "$'"
// - que existe dentro de '^[0-9]+$' - e substituido pelo RESTO do arquivo. Foi exatamente
// isso que produziu "syntax error at or near $" na primeira tentativa de aplicar.
const saida = [cab, fn, '', '', rodape.replace('%%SALVAR_SAIDA_BLOCO%%', () => sb)].join(NL)

// Conferencia estrutural do arquivo inteiro. Barata, e pega corrupcao de splice.
const conta = (s, sub) => s.split(sub).length - 1
const checks = [
  ['marcador do template consumido', conta(saida, '%%SALVAR_SAIDA_BLOCO%%'), 0],
  ['CREATE OR REPLACE FUNCTION', conta(saida, 'CREATE OR REPLACE FUNCTION public.'), 4],
  ['delimitadores $$ (pares)', conta(saida, '$$') % 2, 0],
  ['$fnbloco$ (par)', conta(saida, '$fnbloco$'), 2],
  ['GRANT no fim, uma vez so', conta(saida, 'GRANT EXECUTE ON FUNCTION'), 1],
  // 15 na regiao das tres funcoes + 2 em fn_salvar_saida_bloco. E o padrao que continha o
  // "$'" corrompido pela primeira versao do splice - por isso vale conferir explicitamente.
  ["regex '^[0-9]+$' intacta", conta(saida, "~ '^[0-9]+$'"), 17]
]
const ruins = checks.filter(([, achou, esperado]) => achou !== esperado)
if (ruins.length) {
  console.error('\nABORTADO na conferencia estrutural. Nenhum arquivo escrito:')
  ruins.forEach(([nome, achou, esperado]) => console.error(`  ${nome}: esperava ${esperado}, achei ${achou}`))
  process.exit(1)
}
checks.forEach(([nome]) => console.log(`  ok  ${nome}`))

fs.writeFileSync(OUT, saida)
console.log(`\nescrito: ${OUT} (${saida.split(NL).length} linhas)`)
