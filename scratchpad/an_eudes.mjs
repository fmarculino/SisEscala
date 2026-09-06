import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(p+' -> '+(await r.text()).slice(0,200));const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
const disp = JSON.parse(fs.readFileSync('scratchpad/_hmm_disp.json','utf8'))
const nd = Object.fromEntries(disp.map(d=>[d.id,d.nome]))
const s = (await todas(`servidores?matricula=eq.54364&select=id,nome,matricula,cpf,status`))[0]
console.log(`${s.nome} mat ${s.matricula} cpf ${s.cpf} status ${s.status}`)
const fila = await todas(`rep_cadastros_fila?servidor_id=eq.${s.id}&select=dispositivo_id,status,erro,created_at,processado_em&order=created_at.desc`)
console.log(`fila de cadastro: ${fila.length}`)
for (const f of fila.slice(0,8)) console.log(`  ${(nd[f.dispositivo_id]||f.dispositivo_id.slice(0,8)).padEnd(22)} ${f.status.padEnd(10)} ${f.created_at} ${(f.erro||'').slice(0,90)}`)
console.log('\n=== fila pendente/falhou por relogio do HMM (todos os servidores) ===')
for (const d of disp) {
  const p = await todas(`rep_cadastros_fila?dispositivo_id=eq.${d.id}&status=in.(pendente,falhou)&select=status`)
  const c = {}; for (const x of p) c[x.status]=(c[x.status]||0)+1
  console.log(`${d.nome.padEnd(22)} ${JSON.stringify(c)}`)
}
