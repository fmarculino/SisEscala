import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(`${p} -> ${r.status} ${await r.text()}`);const d=await r.json();o.push(...d);if(d.length<1000)break}return o}

// Que colunas de autoria existem? Sonda barata: 1 linha de cada tabela candidata.
for (const t of ['logs_sistema','escala_mensal','folha_ponto','escala_diaria_turno_historico']) {
  const r = await fetch(`${U}/rest/v1/${t}?select=*&limit=1`, { headers: H })
  if (!r.ok) { console.log(`${t}: HTTP ${r.status}`); continue }
  const d = await r.json()
  console.log(`${t}: ${d.length ? Object.keys(d[0]).join(', ') : '(vazia)'}\n`)
}
