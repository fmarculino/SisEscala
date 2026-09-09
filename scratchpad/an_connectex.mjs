import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r = await fetch(`${U}/rest/v1/${p}`,{headers:{...H, Range:`${f}-${f+999}`}})
  if(!r.ok){ console.error('ERRO',p,r.status,(await r.text()).slice(0,300)); process.exit(1) }
  const pg = await r.json(); out.push(...pg); if(pg.length<1000) break } return out }

const nomes = Object.fromEntries((await q(`dispositivos_rep?select=id,nome`)).map(d=>[d.id,d.nome]))
const falhas = await q(`rep_cadastros_fila?select=dispositivo_id,servidor_id,erro,processado_em&status=eq.falhou`)
console.log(`falhas 'falhou' no parque inteiro: ${falhas.length}`)

function classe(e){
  const m=(e||'').toLowerCase()
  if (m.includes('connectex')) return 'REDE (connectex/Windows)'
  if (m.includes('recusou')) return 'equipamento recusou'
  if (m.includes('timeout')||m.includes('deadline')) return 'timeout'
  if (m.includes('nenhum formato')) return 'nenhum formato aceito'
  return 'outro: '+(e||'').slice(0,60)
}
const porClasse={}
for(const f of falhas){ const c=classe(f.erro); porClasse[c]=(porClasse[c]||0)+1 }
console.log('\npor classe:')
for(const [c,n] of Object.entries(porClasse).sort((a,b)=>b[1]-a[1])) console.log(`${n.toString().padStart(5)}  ${c}`)

console.log('\nfalhas de REDE por dispositivo:')
const porDisp={}
for(const f of falhas) if(classe(f.erro).startsWith('REDE')) { const n=nomes[f.dispositivo_id]; porDisp[n]=(porDisp[n]||0)+1 }
for(const [n,c] of Object.entries(porDisp).sort((a,b)=>b[1]-a[1])) console.log(`${c.toString().padStart(5)}  ${n}`)

// cronologia HMM
console.log('\ncronologia das falhas de rede nos 4 relogios do HMM (hora UTC):')
const linhas={}
for(const f of falhas){ const n=nomes[f.dispositivo_id]||''
  if(!n.includes('HMM-')) continue
  if(!classe(f.erro).startsWith('REDE')) continue
  const h=(f.processado_em||'').slice(0,13); linhas[h]=linhas[h]||{}; linhas[h][n]=(linhas[h][n]||0)+1 }
for(const [h,v] of Object.entries(linhas).sort()) console.log(`   ${h}h`, JSON.stringify(v))
