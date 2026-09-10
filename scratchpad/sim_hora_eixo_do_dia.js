// Portao da regra do NIVEL 1 no eixo do dia (20260910110000).
//
// Nao ha framework de teste no projeto, e esta regra vive SO no SQL — nao existe modulo TS para
// espelhar. Duplicar a regra aqui em JS seria um portao que passa mesmo com o SQL quebrado: ele
// testaria a copia, nunca o original.
//
// Entao este portao TRADUZ o corpo de fn_hora_prevista_dia_seguinte para JS, mecanicamente, e roda
// a tabela-verdade em cima da traducao. Guard removido, comparador trocado ou condicao afrouxada
// mudam a traducao e reprovam. Toda linha do corpo precisa casar com um padrao conhecido — se
// aparecer construcao nova, o portao ABORTA em vez de ignorar (o modo de falha oposto ao de um
// replace que vira no-op, armadilha 48).
//
// Uso: node scratchpad/sim_hora_eixo_do_dia.js
const fs = require('fs')

const MIGRATION = process.argv[2] || 'supabase/migrations/20260910110000_hora_prevista_no_eixo_do_dia.sql'
const sql = fs.readFileSync(MIGRATION, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (!cond) { console.error('  REPROVADO: ' + msg); falhas++ } }

// ---------------------------------------------------------------------------
// 1. Extrai o corpo da regra pura e traduz para JS.
// ---------------------------------------------------------------------------
function corpoEntre(fn, delim) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`)
  if (i < 0) { console.error(`ABORTADO: ${fn} nao existe na migration.`); process.exit(1) }
  const a = sql.indexOf(`AS ${delim}`, i)
  const b = sql.indexOf(`${delim};`, a + 3)
  if (a < 0 || b < 0) { console.error(`ABORTADO: nao achei o corpo de ${fn}.`); process.exit(1) }
  return sql.slice(a + `AS ${delim}`.length, b)
}

function traduzir(corpo) {
  const linhas = corpo.split(/\r?\n/)
  const js = []
  for (const bruta of linhas) {
    const l = bruta.replace(/--.*$/, '').trim()
    if (l === '' || l === 'BEGIN' || l === 'END;') continue

    let m
    if ((m = /^IF (.+) THEN$/.exec(l))) { js.push(`if (${expr(m[1])}) {`); continue }
    if (l === 'END IF;') { js.push('}'); continue }
    if ((m = /^RETURN (true|false);$/.exec(l))) { js.push(`return ${m[1]};`); continue }

    console.error(`ABORTADO: linha nao traduzivel no corpo da regra: ${JSON.stringify(l)}`)
    console.error('  (construcao nova? entao o portao precisa aprender a ler antes de aprovar)')
    process.exit(1)
  }
  return js.join('\n')
}

function expr(e) {
  let s = e
  s = s.replace(/COALESCE\(([a-z_]+), 0\)/g, '($1 ?? 0)')
  s = s.replace(/([a-z_]+) IS NULL/g, '($1 === null)')
  s = s.replace(/ OR /g, ' || ').replace(/ AND /g, ' && ')
  s = s.replace(/<>/g, '!==')
  if (/[A-Z]/.test(s.replace(/[A-Z]/g, m => (/^(IS|NULL|OR|AND|COALESCE)$/.test(m) ? m : m)))
      && /\b(IS|NULL|COALESCE|OR|AND|NOT|THEN|ELSE)\b/.test(s)) {
    console.error(`ABORTADO: sobrou SQL nao traduzido na condicao: ${JSON.stringify(e)} -> ${JSON.stringify(s)}`)
    process.exit(1)
  }
  return s
}

const corpoRegra = corpoEntre('fn_hora_prevista_dia_seguinte', '$fnhora$')
const traduzido = traduzir(corpoRegra)
// eslint-disable-next-line no-new-func
const diaSeguinte = new Function('p_hora', 'p_duracao', 'p_reg_ini', 'p_reg_fim', traduzido)

console.log('regra traduzida do SQL:')
console.log(traduzido.split('\n').map(l => '   ' + l).join('\n'))

// ---------------------------------------------------------------------------
// 2. Tabela-verdade. Os DOIS sentidos: o que tem que subir de dia e o que NAO pode.
// ---------------------------------------------------------------------------
// [hora, duracao, reg_ini, reg_fim, esperado, descricao]
const CASOS = [
  // --- DISPARA: a hora extra de passagem de turno do vigia ---
  [6, 1, 18, 6, true, 'extra 1h @06:00 em 18H AS 06H (o caso que motivou)'],
  [7, 1, 19, 7, true, 'extra 1h @07:00 em 19H AS 07H (a outra jornada noturna do catalogo)'],
  [6, 2, 18, 6, true, 'extra 2h @06:00 em 18H AS 06H — ainda fica solta antes da jornada'],
  [6, 11, 18, 6, true, 'extra de 11h @06:00 termina 17:00, 1h antes do turno: ainda solta'],

  // --- NAO DISPARA: encosta no inicio da jornada no dia civil (ambiguo) ---
  [7, 12, 19, 7, false, 'plantao MT 12h @07:00 em 19H AS 07H emenda dos DOIS lados'],
  [6, 12, 18, 6, false, 'plantao 12h @06:00 em 18H AS 06H emenda no inicio, no dia civil'],
  [6, 13, 18, 6, false, 'turno que INVADE a jornada no dia civil nao pode ser movido as cegas'],

  // --- NAO DISPARA: jornada diurna. E a maioria da base (844 linhas medidas) ---
  [13, 2, 7, 13, false, 'jornada 07H AS 13H'],
  [14, 4, 8, 18, false, 'jornada 08H AS 18H'],
  [18, 2, 8, 18, false, 'jornada 08H AS 18H, hora no fim dela'],
  [7, 1, 7, 13, false, 'jornada 07H AS 13H, hora igual ao inicio'],

  // --- NAO DISPARA: hora da madrugada que nao e o fim da jornada (NAO AFROUXAR) ---
  [2, 1, 18, 6, false, 'hora dentro da madrugada, fora do fim: adivinhacao'],
  [5, 1, 18, 6, false, 'uma hora antes do fim: adivinhacao'],
  [0, 1, 18, 6, false, 'meia-noite: adivinhacao'],
  [8, 1, 18, 6, false, 'depois do fim da jornada, ainda no dia: adivinhacao'],

  // --- NAO DISPARA: hora ja na parte noturna do eixo ---
  [18, 1, 18, 6, false, 'hora igual ao inicio da jornada'],
  [19, 1, 18, 6, false, 'hora depois do inicio da jornada'],
  [23, 1, 18, 6, false, 'quase meia-noite, ja dentro do turno'],

  // --- NAO DISPARA: falta informacao. O default e "nao sei", e "nao sei" nunca muda nada ---
  [6, 0, 18, 6, false, 'duracao zero'],
  [6, null, 18, 6, false, 'duracao nula'],
  [null, 1, 18, 6, false, 'hora nula'],
  [6, 1, null, 6, false, 'inicio da jornada desconhecido'],
  [6, 1, 18, null, false, 'fim da jornada desconhecido'],
  [6, -1, 18, 6, false, 'duracao negativa'],

  // --- Borda: jornada de 24h (ini = fim). Nao cruza a meia-noite pela regra (fim >= ini) ---
  [6, 1, 6, 6, false, 'jornada que comeca e termina na mesma hora'],
]

console.log(`\ntabela-verdade (${CASOS.length} casos):`)
for (const [h, d, ini, fim, esperado, desc] of CASOS) {
  const r = diaSeguinte(h, d, ini, fim)
  ok(r === esperado, `${desc}: esperava ${esperado}, veio ${r}  [h=${h} d=${d} ini=${ini} fim=${fim}]`)
}

// O guard (a) — "so jornada que cruza a meia-noite" — e INALCANCAVEL hoje: numa jornada diurna a
// hora informada so passa por (b) se for igual ao fim, e ai (c) ja recusa. Nenhuma tabela-verdade
// consegue pega-lo, entao ele so pode ser protegido pela FORMA. Ele fica porque enuncia a condicao
// que da nome a regra: afrouxar (b) ou (c) com ele fora alcancaria as 844 linhas de jornada diurna.
ok(/IF p_reg_fim >= p_reg_ini THEN\s+RETURN false;/.test(corpoRegra),
  'a regra perdeu o guard que a limita a jornada que cruza a meia-noite (guard (a))')

// ---------------------------------------------------------------------------
// 3. O ENVELOPE: forma do que ele faz com o resultado da regra.
// ---------------------------------------------------------------------------
const corpoEixo = corpoEntre('fn_hora_prevista_no_eixo_do_dia', '$fneixo$')
ok(/IF p_hora_prevista IS NULL THEN\s+RETURN NULL;/.test(corpoEixo),
  'o envelope tem que devolver NULL para hora nula — e o que faz o COALESCE da cascata descer os niveis')
ok(corpoEixo.includes('public.fn_obter_horario_regular_dia(p_escala_mensal_id, p_dia)'),
  'o envelope tem que ler o Regular DO DIA — sem isso a regra decide sobre a jornada errada')
ok(/IF v_reg IS NULL THEN\s+RETURN v_hora;/.test(corpoEixo),
  'sem Regular no dia a hora informada sai crua, nunca erro')
ok(corpoEixo.includes('RETURN v_hora + 24;'),
  'o envelope tem que somar 24 quando a regra dispara — e assim que o resto da cascata expressa "dia seguinte"')
ok(corpoEixo.includes('public.fn_hora_prevista_dia_seguinte('),
  'o envelope tem que delegar a decisao a regra pura, nunca reimplementa-la')

// ---------------------------------------------------------------------------
// 4. Os quatro cursores passaram a chamar o envelope, e nenhum ficou para tras.
// ---------------------------------------------------------------------------
const chamadas = sql.split('THEN public.fn_hora_prevista_no_eixo_do_dia(').length - 1
ok(chamadas === 4, `esperava 4 cursores chamando o envelope (2 em fn_confirmar_presenca, 1 em cada uma das outras), achei ${chamadas}`)
ok(!sql.includes('THEN extract(hour from ed.hora_inicio_prevista)::integer END,'),
  'sobrou cursor lendo a hora sem o eixo do dia')

for (const fn of ['fn_confirmar_presenca', 'fn_confirmar_presenca_manual', 'fn_blocos_previstos_dia']) {
  ok(sql.includes(`CREATE OR REPLACE FUNCTION public.${fn}(`), `${fn} nao foi recriada na migration`)
}

// ---------------------------------------------------------------------------
// 5. Privilegios (armadilha 24) e conferencia que EXECUTA (armadilha 42).
// ---------------------------------------------------------------------------
for (const assinatura of [
  'public.fn_hora_prevista_dia_seguinte(integer, numeric, integer, integer)',
  'public.fn_hora_prevista_no_eixo_do_dia(uuid, integer, time, numeric)',
]) {
  ok(sql.includes(`REVOKE ALL ON FUNCTION ${assinatura}\n    FROM PUBLIC, anon, authenticated;`)
     || sql.includes(`REVOKE ALL ON FUNCTION ${assinatura}\r\n    FROM PUBLIC, anon, authenticated;`),
    `funcao nova sem REVOKE de PUBLIC: ${assinatura} nasceria aberta a anon`)
}
ok(sql.includes('PERFORM * FROM public.fn_blocos_previstos_dia('),
  'a conferencia precisa EXECUTAR fn_blocos_previstos_dia — conferir que ela existe nao prova nada')
ok(sql.includes('public.fn_hora_prevista_dia_seguinte(7, 12, 19, 7)'),
  'a conferencia precisa provar tambem o sentido que NAO pode disparar')
ok(sql.includes("has_function_privilege('authenticated',"),
  'a conferencia precisa checar que fn_blocos_previstos_dia NAO perdeu authenticated (a grade a chama)')

// ---------------------------------------------------------------------------
console.log('')
if (falhas > 0) { console.error(`${falhas} assercao(oes) REPROVADA(S).`); process.exit(1) }
console.log(`OK — ${CASOS.length} casos da tabela-verdade + forma do envelope, dos cursores e dos privilegios.`)
