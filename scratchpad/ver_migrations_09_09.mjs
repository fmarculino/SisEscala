// Confere em PRODUCAO que 20260909110000 e 20260909120000 estao valendo. Sai com codigo 1 se
// qualquer assercao falhar. Read-only, exceto o ensaio (C), que cria e apaga uma linha de fila.
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const A = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
let falhas = 0
const ok = (c,m) => { console.log(`${c?'  ok  ':'FALHA '} ${m}`); if(!c) falhas++ }
async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r = await fetch(`${U}/rest/v1/${p}`,{headers:{...H, Range:`${f}-${f+999}`}})
  if(!r.ok){ console.error('ERRO',p,r.status,(await r.text()).slice(0,200)); process.exit(1) }
  const pg = await r.json(); out.push(...pg); if(pg.length<1000) break } return out }
async function rpc(f,b,key=K){ const r = await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',
  headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(b)})
  return { status:r.status, body: r.ok ? await r.json() : (await r.text()).slice(0,200) } }

console.log('=== A. fn_falha_rep_de_transporte existe e classifica certo ===')
const casos = [
  ['Post "https://10.110.4.19:443/login.fcgi": dial tcp 10.110.4.19:443: connectex: A connection attempt failed because the connected party did not properly respond.', true, 'connectex do Windows'],
  ['Post "https://10.110.4.51:443/login.fcgi": dial tcp: connectex: No connection could be made because the target machine actively refused it.', true, 'actively refused'],
  ['Post "https://x/add_users.fcgi": read tcp 1.2.3.4:1->5.6.7.8:443: wsarecv: An existing connection was forcibly closed by the remote host.', true, 'wsarecv'],
  ['add_users.fcgi recusou (formato users:[{pis}]): PIS ja cadastrado: 123', false, 'recusa: PIS ja cadastrado'],
  ['add_users.fcgi recusou (formato users:[{pis}]): Matricula ja cadastrada', false, 'recusa: matricula'],
  ['nenhum formato de add_users.fcgi funcionou neste equipamento; tentativas: users:[{cpf}] -> add_users.fcgi recusou (formato users:[{cpf}]): CPF ja cadastrado', false, 'nenhum formato funcionou'],
  ['matricula "67.255" nao e numerica - este rele so aceita registration numerico', false, 'matricula nao numerica'],
  ['login.fcgi nao devolveu sessao valida: map[code:401 error:Invalid user or password]', false, 'credencial errada'],
  [null, false, 'erro nulo'],
]
for (const [erro, esperado, nome] of casos) {
  const r = await rpc('fn_falha_rep_de_transporte', { p_erro: erro })
  if (r.status !== 200) { ok(false, `${nome}: RPC devolveu ${r.status} ${r.body}`); continue }
  ok(r.body === esperado, `${nome}: ${r.body} (esperado ${esperado})`)
}
const anonR = await rpc('fn_falha_rep_de_transporte', { p_erro: 'x' }, A)
ok(anonR.status === 401 || anonR.status === 403 || anonR.status === 404,
   `anon recusado (HTTP ${anonR.status})`)

console.log('\n=== B. fn_cadastro_rep_reprovado: transporte deixou de reprovar ===')
const nomes = Object.fromEntries((await q(`dispositivos_rep?select=id,nome`)).map(d=>[d.id,d.nome]))
const falhasFila = await q(`rep_cadastros_fila?select=dispositivo_id,servidor_id,erro,processado_em,created_at&status=eq.falhou`)
const pares = new Map()
for (const f of falhasFila) {
  const k = `${f.dispositivo_id}|${f.servidor_id}`
  const t = f.processado_em || f.created_at
  const cur = pares.get(k)
  if (!cur) pares.set(k, { erros: [f.erro], t, d: f.dispositivo_id, s: f.servidor_id })
  else { cur.erros.push(f.erro); if (t > cur.t) cur.t = t }
}
const ehTransp = e => !/recusou/i.test(e||'') &&
  (/^Post "http/i.test(e||'') || /connectex|dial tcp|read tcp|wsarecv|wsasend|i\/o timeout|deadline exceeded|Client\.Timeout|connection reset|no such host|network is unreachable/i.test(e||''))
let reprov = 0, reprovSoTransporte = 0, porDisp = {}
for (const [, v] of pares) {
  const r = await rpc('fn_cadastro_rep_reprovado', { p_dispositivo_id: v.d, p_servidor_id: v.s })
  if (r.status !== 200) { ok(false, `RPC reprovado ${r.status} ${r.body}`); break }
  if (r.body !== true) continue
  reprov++
  porDisp[nomes[v.d]] = (porDisp[nomes[v.d]]||0)+1
  if (v.erros.every(ehTransp)) reprovSoTransporte++
}
console.log(`  pares com falha: ${pares.size} | reprovados agora: ${reprov}`)
for (const [n,c] of Object.entries(porDisp).sort((a,b)=>b[1]-a[1])) console.log(`      ${c.toString().padStart(4)}  ${n}`)
ok(reprovSoTransporte === 0, `nenhum par com SO falha de transporte continua reprovado (${reprovSoTransporte})`)
ok(reprov > 0 && reprov < 60, `recusas legitimas continuam reprovadas (${reprov}, era 324 antes / 34 esperadas)`)
ok(reprovSoTransporte === 0, 'todo reprovado restante tem ao menos uma recusa do equipamento')

console.log(`\nfalhas=${falhas}`)
process.exit(falhas ? 1 : 0)
