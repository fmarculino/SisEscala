// Gera a migration que ensina o NIVEL 1 da cadeia de horario (escala_diaria.hora_inicio_prevista)
// a saber A QUE DIA a hora informada pertence.
//
// O PROBLEMA
//   hora_inicio_prevista e um `time` — nao carrega dia. O nivel 1 fazia
//       extract(hour from ed.hora_inicio_prevista)::integer
//   e o resultado virava `start_hour * 60`, ou seja, sempre o DIA CIVIL da celula. Numa jornada
//   que cruza a meia-noite (18H AS 06H) a hora extra de passagem de turno informada como 06:00
//   nascia 12h ANTES do turno que ela deveria emendar.
//
// COPIA MECANICA (armadilha 1) — le as TRES migrations VIGENTES, uma por funcao, e faz 1
// substituicao por cursor. Aborta se qualquer contagem divergir.
//
// split().join(), nunca String.replace com string (replace interpreta $$ e $').
const fs = require('fs')

const SAIDA = 'supabase/migrations/20260910110000_hora_prevista_no_eixo_do_dia.sql'

// Cada fonte e a migration VIGENTE daquela funcao. Confira antes de regerar:
//   grep -rln "CREATE OR REPLACE FUNCTION public.<fn>(" supabase/migrations/ | sort | tail -1
const FONTES = [
  { fn: 'fn_confirmar_presenca',
    arquivo: 'supabase/migrations/20260909100000_terminal_local_nao_herda_escopo_do_coordenador.sql',
    fim: '$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;',
    cursores: 2,   // cursor de ontem + cursor de hoje
    titulo: 'fn_confirmar_presenca  (base: 20260909100000, 2 cursores: ontem e hoje)' },
  { fn: 'fn_confirmar_presenca_manual',
    arquivo: 'supabase/migrations/20260903100000_ancora_do_plantao_que_nao_colide_com_o_regular.sql',
    fim: '$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;',
    cursores: 1,
    titulo: 'fn_confirmar_presenca_manual  (base: 20260903100000)' },
  { fn: 'fn_blocos_previstos_dia',
    arquivo: 'supabase/migrations/20260908140000_bloco_nao_atravessa_unidade.sql',
    fim: '$fnbloco$;',
    cursores: 1,
    titulo: 'fn_blocos_previstos_dia  (base: 20260908140000)' },
]

// ⚠️ O EOL e DETECTADO, nunca assumido (armadilha 59): a convencao do projeto e CRLF, mas ha
// migration em LF. Montar a ancora com o EOL errado faz a substituicao virar no-op SILENCIOSO.
function trecho(EOL, linhas) { return linhas.join(EOL) }

// ⚠️ O RECUO NAO E O MESMO NAS TRES FUNCOES: fn_confirmar_presenca e fn_blocos_previstos_dia
// escrevem o cursor com 16 espacos, fn_confirmar_presenca_manual com 12. Fixar o recuo faria a
// substituicao virar no-op SILENCIOSO naquela funcao — o mesmo modo de falha do EOL errado
// (armadilha 48/59). Aqui ele e' DERIVADO da propria fonte, e a contagem de ocorrencias aborta.
const MARCA_THEN = 'THEN extract(hour from ed.hora_inicio_prevista)::integer END,'

const ANTES = (EOL, n) => trecho(EOL, [
  `${' '.repeat(n)}CASE WHEN ed.categoria <> 'Regular'`,
  `${' '.repeat(n + 5)}${MARCA_THEN}`,
])

const DEPOIS = (EOL, n) => trecho(EOL, [
  `${' '.repeat(n)}CASE WHEN ed.categoria <> 'Regular'`,
  `${' '.repeat(n + 5)}THEN public.fn_hora_prevista_no_eixo_do_dia(`,
  `${' '.repeat(n + 10)}em.id, ed.dia, ed.hora_inicio_prevista, dt.horas_computadas) END,`,
])

// Recuo da linha do THEN dentro deste corpo, conferindo que todas as ocorrencias usam o mesmo.
function recuoDoCase(corpo, fn) {
  const recuos = new Set()
  for (const linha of corpo.split(/\r?\n/)) {
    const i = linha.indexOf(MARCA_THEN)
    if (i < 0) continue
    if (linha.slice(0, i).trim() !== '') {
      console.error(`ABORTADO: em ${fn} o nivel 1 nao comeca a linha — o trecho mudou de forma.`)
      process.exit(1)
    }
    recuos.add(i)
  }
  if (recuos.size !== 1) {
    console.error(`ABORTADO: ${fn} tem ${recuos.size} recuo(s) distinto(s) no nivel 1 (${[...recuos]}).`)
    process.exit(1)
  }
  const n = [...recuos][0] - 5
  if (n < 0) { console.error(`ABORTADO: recuo do nivel 1 em ${fn} menor que o esperado.`); process.exit(1) }
  return n
}

function extrai(f) {
  const src = fs.readFileSync(f.arquivo, 'utf8')
  const EOL = src.includes('\r\n') ? '\r\n' : '\n'
  const INI = `CREATE OR REPLACE FUNCTION public.${f.fn}(`
  const i = src.indexOf(INI)
  if (i < 0) { console.error(`ABORTADO: nao achei ${f.fn} em ${f.arquivo}.`); process.exit(1) }
  const j = src.indexOf(f.fim, i)
  if (j < 0) { console.error(`ABORTADO: nao achei o delimitador de fim de ${f.fn}.`); process.exit(1) }
  let corpo = src.slice(i, j + f.fim.length)

  if ((corpo.split('CREATE OR REPLACE FUNCTION').length - 1) !== 1) {
    console.error(`ABORTADO: o extrato de ${f.fn} contem mais de uma funcao — o delimitador mudou.`)
    process.exit(1)
  }

  const recuo = recuoDoCase(corpo, f.fn)
  const achadas = corpo.split(ANTES(EOL, recuo)).length - 1
  if (achadas !== f.cursores) {
    console.error(`ABORTADO: ${f.fn} tem ${achadas} ocorrencia(s) do nivel 1, esperava ${f.cursores}.`)
    console.error('  (ou o trecho mudou, ou a fonte nao e a vigente — reconfira com o grep do cabecalho)')
    process.exit(1)
  }
  corpo = corpo.split(ANTES(EOL, recuo)).join(DEPOIS(EOL, recuo))

  // Os invariantes que esta migration NAO pode apagar ao recopiar (armadilha 1).
  //
  // ⚠️ Nem todos valem para as tres: fn_confirmar_presenca_manual NAO funde blocos (ela valida
  // turno a turno), entao dobra_diurna e a nao-fusao entre unidades nao existem la. Exigir marca
  // que a funcao nunca teve reprova a migration pelo motivo errado.
  const invariantes = [
    ["NAO vale para Regular: la o nome da jornada continua mandando", 'a condicao que protege o Regular do nivel 1'],
    ['fn_ancora_plantao_livre_do_regular', 'o NIVEL 2-B (20260903100000)'],
    ['fn_intervalo_previsto_minutos', 'o intervalo do plantao (20260822120000, armadilha 9)'],
    ["'Sobreaviso'", 'o guard de Sobreaviso (armadilha 6)'],
  ]
  if (f.fn !== 'fn_confirmar_presenca_manual') {
    invariantes.push(['dobra_diurna', 'o guard de nao-fusao do plantao diurno em jornada noturna (20260809000000)'])
    invariantes.push(['IS NOT DISTINCT FROM v_s2_unidade', 'a nao-fusao entre unidades (20260908140000)'])
  }
  if (f.fn === 'fn_confirmar_presenca') {
    invariantes.push(["'terminal_local'", 'o bypass de escopo do terminal local (20260909100000, armadilha 56)'])
  }
  for (const [marca, oque] of invariantes) {
    if (!corpo.includes(marca)) {
      console.error(`ABORTADO: ${f.fn} perdeu ${oque} (marca ausente: ${marca}).`)
      process.exit(1)
    }
  }
  if (corpo.includes('extract(hour from ed.hora_inicio_prevista)')) {
    console.error(`ABORTADO: sobrou nivel 1 sem eixo do dia em ${f.fn}.`)
    process.exit(1)
  }
  console.log(`  ${f.fn.padEnd(30)} ${achadas} cursor(es) trocado(s), ${corpo.length} bytes, EOL=${EOL === '\r\n' ? 'CRLF' : 'LF'}`)
  return { corpo, EOL }
}

console.log('lendo as fontes vigentes:')
const partes = FONTES.map(f => ({ ...f, ...extrai(f) }))
const EOL = partes[0].EOL
if (partes.some(p => p.EOL !== EOL)) {
  console.error('ABORTADO: as fontes tem EOL diferentes — a migration sairia com fim de linha misturado.')
  process.exit(1)
}

const CAB = fs.readFileSync('scratchpad/_hora_eixo_cabecalho.sql', 'utf8').split(/\r?\n/).join(EOL)
const CONF = fs.readFileSync('scratchpad/_hora_eixo_conferencia.sql', 'utf8').split(/\r?\n/).join(EOL)

const secao = (n, titulo) => trecho(EOL, [
  '',
  '-- ----------------------------------------------------------------------------',
  `-- ${n}. ${titulo}`,
  '-- ----------------------------------------------------------------------------',
  '',
])

let out = CAB
partes.forEach((p, i) => { out += secao(i + 2, p.titulo) + p.corpo + EOL })
out += EOL + CONF

fs.writeFileSync(SAIDA, out)
console.log(`\n${SAIDA}: ${out.length} bytes`)

// Conferencia estrutural do arquivo inteiro (o gerador do dollar-quoting ja mordeu antes).
const abre = (out.split('CREATE OR REPLACE FUNCTION').length - 1)
if (abre !== 5) { console.error(`ABORTADO: ${abre} CREATE OR REPLACE, esperava 5.`); process.exit(1) }
for (const [d, n] of [['$fnhora$', 2], ['$fneixo$', 2], ['$fnbloco$', 2], ['$conf$', 2]]) {
  const c = out.split(d).length - 1
  if (c !== n) { console.error(`ABORTADO: delimitador ${d} aparece ${c}x, esperava ${n}.`); process.exit(1) }
}
const dq = out.split('$$').length - 1
if (dq % 2 !== 0) { console.error(`ABORTADO: ${dq} delimitadores $$ — numero impar, dollar-quoting desbalanceado.`); process.exit(1) }
console.log(`estrutura OK: 5 funcoes, ${dq} delimitadores $$ (par), blocos nomeados batendo.`)
