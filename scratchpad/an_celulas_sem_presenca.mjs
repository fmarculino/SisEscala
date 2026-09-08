import fs from 'fs'

const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

async function pagina(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from+999}` } })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const p = await r.json()
    out.push(...p)
    if (p.length < 1000) break
  }
  return out
}

const MES = 9, ANO = 2026
const ini = `${ANO}-${String(MES).padStart(2,'0')}-01`
const fim = `${ANO}-${String(MES+1).padStart(2,'0')}-01`

// 1) marcacoes fisicas do mes (rep/terminal), por servidor+dia local
const marc = await pagina(`marcacoes_ponto?select=servidor_id,ocorrido_em,origem&origem=in.(rep,terminal)&ocorrido_em=gte.${ini}T00:00:00-03:00&ocorrido_em=lt.${fim}T00:00:00-03:00&servidor_id=not.is.null&order=ocorrido_em`)
const fmt = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'})
const batidas = new Map() // `${servidor}|${dia}` -> n
for (const m of marc) {
  const [a,mm,dd] = fmt.format(new Date(m.ocorrido_em)).split('-').map(Number)
  if (a!==ANO || mm!==MES) continue
  const k = `${m.servidor_id}|${dd}`
  batidas.set(k, (batidas.get(k)||0)+1)
}
console.log(`marcacoes fisicas rep/terminal em ${MES}/${ANO}: ${marc.length}`)
console.log(`pares (servidor,dia) com batida fisica: ${batidas.size}`)

// 2) escala_diaria do mes
const em = await pagina(`escala_mensal?select=id,servidor_id,unidade_id,setor_id&mes=eq.${MES}&ano=eq.${ANO}`)
const emById = new Map(em.map(e => [e.id, e]))
console.log(`escala_mensal em ${MES}/${ANO}: ${em.length}`)

const ed = []
for (let i = 0; i < em.length; i += 80) {
  const ids = em.slice(i, i+80).map(e=>e.id).join(',')
  ed.push(...await pagina(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem,reconciliado_em,dicionario_turnos_id&escala_mensal_id=in.(${ids})&categoria=neq.Sobreaviso&dicionario_turnos_id=not.is.null&order=id`))
}
console.log(`escala_diaria com turno (nao-sobreaviso): ${ed.length}`)

const hoje = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'}))
const diaHoje = hoje.getMonth()+1===MES && hoje.getFullYear()===ANO ? hoje.getDate() : 32

let semNada=0, semNadaComBatida=0, parcial=0, parcialComBatida=0, completo=0
const alvos = new Map()
for (const l of ed) {
  const e = emById.get(l.escala_mensal_id); if (!e) continue
  if (l.dia >= diaHoje) continue
  const k = `${e.servidor_id}|${l.dia}`
  const temB = batidas.has(k)
  const tem = !!l.presenca_entrada_em || !!l.presenca_saida_em
  const cheio = !!l.presenca_entrada_em && !!l.presenca_saida_em
  if (!tem) { semNada++; if (temB) { semNadaComBatida++; alvos.set(k,{...e,dia:l.dia,caso:'vazio'}) } }
  else if (!cheio) { parcial++; if (temB) { parcialComBatida++; if(!alvos.has(k)) alvos.set(k,{...e,dia:l.dia,caso:'parcial'}) } }
  else completo++
}
console.log(`\n--- dias JA PASSADOS de ${MES}/${ANO} ---`)
console.log(`celulas com turno e presenca completa : ${completo}`)
console.log(`celulas com turno e presenca PARCIAL  : ${parcial}  (com batida fisica no dia: ${parcialComBatida})`)
console.log(`celulas com turno e SEM presenca      : ${semNada}  (com batida fisica no dia: ${semNadaComBatida})`)
console.log(`\npares (servidor,dia) candidatos a recuperacao: ${alvos.size}`)
fs.writeFileSync('scratchpad/_alvos.json', JSON.stringify([...alvos.entries()].map(([k,v])=>({k,...v}))))
