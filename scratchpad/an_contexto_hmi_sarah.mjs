import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(`${p} -> ${r.status}`);const d=await r.json();o.push(...d);if(d.length<1000)break}return o}

const unidades = await todas('unidades?select=id,nome')
const nomeU = new Map(unidades.map(u=>[u.id,u.nome]))

console.log('=== Desde quando cada unidade tem escala (o "toca pouco" pode ser "comecou agora") ===')
const em = await todas('escala_mensal?select=unidade_id,mes,ano')
const porU = new Map()
for (const e of em) {
  const k = e.unidade_id
  const comp = e.ano*100+e.mes
  const g = porU.get(k) ?? { min: Infinity, max: 0, n: 0 }
  g.min = Math.min(g.min, comp); g.max = Math.max(g.max, comp); g.n++
  porU.set(k, g)
}
for (const [u,g] of [...porU.entries()].sort((a,b)=>a[1].min-b[1].min))
  console.log(`  ${String(nomeU.get(u)).slice(0,42).padEnd(44)} de ${g.min} a ${g.max}   ${String(g.n).padStart(4)} escalas`)

console.log('\n=== Quantos SERVIDORES cada unidade dos 19 tem (o tamanho do que "unidade inteira" alcanca) ===')
const serv = await todas('servidores?select=id,unidade_id,status')
const setores = await todas('setores?select=id,unidade_id,ativo')
const alvos = ['HMI','LACEM','CRISMU','CEI','CTA','Laranjeiras','Pedro Cavalcante','HIROSHI','ENFERMEIRA ZEZINHA','Demósthenes','JOSE PEREIRA','EMERSON','Jaime Pinto','João Batista']
for (const a of alvos) {
  const u = unidades.find(x => (x.nome||'').includes(a)); if (!u) continue
  const nS = serv.filter(s => s.unidade_id === u.id && s.status === 'Ativo').length
  const nSet = setores.filter(s => s.unidade_id === u.id && s.ativo !== false).length
  console.log(`  ${String(u.nome).slice(0,42).padEnd(44)} ${String(nSet).padStart(4)} setores  ${String(nS).padStart(4)} servidores ativos`)
}

console.log('\n=== SARAH BEATRIZ: as 10 unidades e o tamanho ===')
const perfis = await todas('profiles?select=id,full_name,role,profile_unidades(unidade_id)')
const sarah = perfis.find(p => (p.full_name||'').startsWith('SARAH BEATRIZ'))
let totS = 0, totSet = 0
for (const pu of sarah.profile_unidades) {
  const nS = serv.filter(s => s.unidade_id === pu.unidade_id && s.status === 'Ativo').length
  const nSet = setores.filter(s => s.unidade_id === pu.unidade_id && s.ativo !== false).length
  totS += nS; totSet += nSet
  console.log(`  ${String(nomeU.get(pu.unidade_id)).slice(0,42).padEnd(44)} ${String(nSet).padStart(3)} setores  ${String(nS).padStart(4)} servidores`)
}
console.log(`  ${'TOTAL'.padEnd(44)} ${String(totSet).padStart(3)} setores  ${String(totS).padStart(4)} servidores`)
