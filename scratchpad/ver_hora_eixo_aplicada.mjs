// Confere 20260910110000 CONTRA O BANCO, executando as funcoes par a par.
//
// MEDIR EXECUTANDO, NUNCA ESTIMANDO. Conferir que a funcao existe nao prova nada: plpgsql so
// resolve nome de coluna, de funcao e de operador na hora em que o statement roda (armadilha 42).
//
// Uso:  node scratchpad/ver_hora_eixo_aplicada.mjs [--homolog]   (default: producao, so leitura)
// Sai com codigo 1 se qualquer assercao falhar.
import fs from 'fs'

const HOMOLOG = process.argv.includes('--homolog')
const ARQ = HOMOLOG ? '.env.local' : '.env.production'
const env = Object.fromEntries(fs.readFileSync(ARQ, 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))

const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

console.log(`banco: ${U}${HOMOLOG ? '  (HOMOLOGACAO)' : '  (PRODUCAO — so leitura)'}\n`)

let falhas = 0
const ok = (cond, msg) => { if (cond) return; console.error('  REPROVADO: ' + msg); falhas++ }

const rpc = async (fn, body, key = K) => {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, corpo: await r.text() }
}
const get = async (p) => {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${p}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${p} ${r.status} ${await r.text()}`)
    const pag = await r.json(); out.push(...pag)
    if (pag.length < 1000) break
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. A regra pura, EXECUTADA no banco, caso a caso. Os dois sentidos.
// ---------------------------------------------------------------------------
const TABELA = [
  [[6, 1, 18, 6], true,  'extra 1h @06:00 em 18H AS 06H (o caso do vigia)'],
  [[7, 1, 19, 7], true,  'extra 1h @07:00 em 19H AS 07H'],
  [[6, 2, 18, 6], true,  'extra 2h @06:00 em 18H AS 06H'],
  [[7, 12, 19, 7], false, 'plantao MT 12h @07:00 em 19H AS 07H — ambiguo, NAO pode subir'],
  [[13, 2, 7, 13], false, 'jornada diurna 07H AS 13H'],
  [[14, 4, 8, 18], false, 'jornada diurna 08H AS 18H'],
  [[2, 1, 18, 6], false, 'madrugada fora do fim da jornada'],
  [[19, 1, 18, 6], false, 'hora ja dentro do turno noturno'],
  [[6, 0, 18, 6], false, 'duracao zero'],
  [[null, 1, 18, 6], false, 'hora nula'],
]
console.log(`1. fn_hora_prevista_dia_seguinte — ${TABELA.length} casos, executados no banco:`)
for (const [[h, d, ini, fim], esperado, desc] of TABELA) {
  const r = await rpc('fn_hora_prevista_dia_seguinte', { p_hora: h, p_duracao: d, p_reg_ini: ini, p_reg_fim: fim })
  if (r.status !== 200) { ok(false, `${desc}: HTTP ${r.status} ${r.corpo.slice(0, 160)}`); continue }
  ok(JSON.parse(r.corpo) === esperado, `${desc}: esperava ${esperado}, veio ${r.corpo}`)
}

// ---------------------------------------------------------------------------
// 2. O envelope sobre as linhas REAIS: quem muda de dia tem exatamente a forma prevista.
// ---------------------------------------------------------------------------
console.log('\n2. fn_hora_prevista_no_eixo_do_dia sobre as linhas com hora informada:')
const linhas = await get('escala_diaria?select=id,escala_mensal_id,dia,categoria,hora_inicio_prevista,dicionario_turnos(codigo,horas_computadas)&hora_inicio_prevista=not.is.null&categoria=neq.Regular')
const emIds = [...new Set(linhas.map(l => l.escala_mensal_id))]
const regs = new Map()
for (let i = 0; i < emIds.length; i += 100) {
  const chunk = emIds.slice(i, i + 100)
  for (const r of await get(`escala_diaria?select=escala_mensal_id,dia,escala_mensal(jornadas(nome))&categoria=eq.Regular&escala_mensal_id=in.(${chunk.join(',')})`)) {
    regs.set(`${r.escala_mensal_id}|${r.dia}`, r.escala_mensal?.jornadas?.nome || null)
  }
}
const parse = (nome) => {
  if (!nome) return null
  const i = /^([0-9]+)/.exec(nome), f = /(?:ÀS|AS|as|às)\s*([0-9]+)/.exec(nome)
  return (i && f) ? { ini: +i[1], fim: +f[1] } : null
}

let subiram = 0, comForma = 0
for (const l of linhas) {
  const jor = parse(regs.get(`${l.escala_mensal_id}|${l.dia}`))
  const h = +String(l.hora_inicio_prevista).slice(0, 2)
  const d = Number(l.dicionario_turnos?.horas_computadas || 0)
  const deveSubir = !!jor && jor.fim < jor.ini && h === jor.fim && d > 0 && h + d < jor.ini
  if (deveSubir) comForma++

  const r = await rpc('fn_hora_prevista_no_eixo_do_dia', {
    p_escala_mensal_id: l.escala_mensal_id, p_dia: l.dia,
    p_hora_prevista: l.hora_inicio_prevista, p_duracao_horas: d,
  })
  if (r.status !== 200) { ok(false, `linha ${l.id}: HTTP ${r.status} ${r.corpo.slice(0, 120)}`); continue }
  const eixo = JSON.parse(r.corpo)
  if (eixo >= 24) subiram++
  ok(eixo === (deveSubir ? h + 24 : h),
    `linha ${l.id} (dia ${l.dia}, ${l.dicionario_turnos?.codigo} @${l.hora_inicio_prevista}, jornada ${regs.get(`${l.escala_mensal_id}|${l.dia}`)}): esperava ${deveSubir ? h + 24 : h}, veio ${eixo}`)
}
console.log(`   ${linhas.length} linhas conferidas | ${comForma} com a forma do vigia | ${subiram} resolvem no dia seguinte`)
ok(subiram === comForma, `${comForma} linhas com a forma, mas ${subiram} subiram de dia`)

// ---------------------------------------------------------------------------
// 3. O EFEITO: o bloco previsto do Extra passou a emendar no fim do turno noturno.
// ---------------------------------------------------------------------------
console.log('\n3. fn_blocos_previstos_dia nos dias afetados (amostra):')
const afetadas = []
for (const l of linhas) {
  const jor = parse(regs.get(`${l.escala_mensal_id}|${l.dia}`))
  const h = +String(l.hora_inicio_prevista).slice(0, 2)
  const d = Number(l.dicionario_turnos?.horas_computadas || 0)
  if (jor && jor.fim < jor.ini && h === jor.fim && d > 0 && h + d < jor.ini) afetadas.push({ ...l, jor })
}
const ems = afetadas.length
  ? await get(`escala_mensal?select=id,mes,ano,servidor_id,servidores(matricula)&id=in.(${[...new Set(afetadas.map(a => a.escala_mensal_id))].join(',')})`)
  : []
const emById = Object.fromEntries(ems.map(e => [e.id, e]))
const fmt = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'null'

let conferidos = 0
for (const a of afetadas.slice(0, 12)) {
  const em = emById[a.escala_mensal_id]
  if (!em) continue
  const data = `${em.ano}-${String(em.mes).padStart(2, '0')}-${String(a.dia).padStart(2, '0')}`
  const r = await rpc('fn_blocos_previstos_dia', { p_servidor_id: em.servidor_id, p_data: data })
  if (r.status !== 200) { ok(false, `blocos ${data}: HTTP ${r.status} ${r.corpo.slice(0, 120)}`); continue }
  const blocos = JSON.parse(r.corpo)
  const doExtra = blocos.find(b => (b.escala_diaria_ids || []).includes(a.id))
  if (!doExtra) { ok(false, `${em.servidores.matricula} ${data}: a linha do Extra nao aparece em bloco nenhum`); continue }

  const idx = doExtra.escala_diaria_ids.indexOf(a.id)
  const iniTurno = doExtra.turnos_inicio?.[idx]
  const diaTurno = iniTurno ? new Date(iniTurno).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null
  const diaCelula = new Date(`${data}T12:00:00-03:00`).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  // O que se prova aqui: o Extra comeca no dia SEGUINTE ao da celula, e o bloco em que ele esta
  // tambem carrega o turno Regular — ou seja, ele EMENDOU, em vez de virar um bloco solto.
  ok(diaTurno !== null && diaTurno !== diaCelula,
    `${em.servidores.matricula} ${data}: o Extra ainda comeca no proprio dia (${diaTurno})`)
  ok(doExtra.escala_diaria_ids.length > 1,
    `${em.servidores.matricula} ${data}: o Extra ficou num bloco SOLTO (nao emendou no turno noturno)`)
  conferidos++
  console.log(`   ${em.servidores.matricula.padEnd(7)} ${data}  bloco ${fmt(doExtra.inicio_previsto)} -> ${fmt(doExtra.fim_previsto)}  (${doExtra.escala_diaria_ids.length} turnos, Extra comeca ${fmt(iniTurno)})`)
}
ok(afetadas.length === 0 || conferidos > 0, 'nenhum dia afetado pode ser conferido — a amostra saiu vazia')

// ---------------------------------------------------------------------------
// 4. Privilegios, nos dois sentidos (armadilhas 24 e 39).
// ---------------------------------------------------------------------------
console.log('\n4. privilegios:')
for (const fn of ['fn_hora_prevista_dia_seguinte', 'fn_hora_prevista_no_eixo_do_dia']) {
  const r = await rpc(fn, { p_hora: 6, p_duracao: 1, p_reg_ini: 18, p_reg_fim: 6 }, ANON)
  ok(r.status === 401 || r.status === 403 || r.status === 404,
    `${fn} respondeu ${r.status} para anon — devia recusar`)
  console.log(`   anon em ${fn}: HTTP ${r.status}`)
}

console.log('')
if (falhas > 0) { console.error(`${falhas} assercao(oes) REPROVADA(S).`); process.exit(1) }
console.log('OK — a migration esta aplicada e se comporta como o portao descreve.')
