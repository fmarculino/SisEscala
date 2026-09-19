import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function pag(p) { const o=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok) throw new Error(r.status+await r.text()); const x=await r.json(); o.push(...x); if(x.length<1000) break } return o }

const s = await pag('rep_sincronizacoes?select=iniciada_em,concluida_em,status,linhas_recebidas,linhas_novas,marcacoes_criadas,dispositivo_id&status=eq.concluida&linhas_recebidas=gte.50&order=iniciada_em.desc')
const pts = s.filter(x => x.concluida_em && x.iniciada_em)
  .map(x => ({ n: x.linhas_recebidas, m: x.marcacoes_criadas, seg: (new Date(x.concluida_em) - new Date(x.iniciada_em)) / 1000 }))
  .filter(x => x.seg >= 0)

console.log(`amostras com >=50 linhas: ${pts.length}`)
const faixas = [[50,99],[100,149],[150,199],[200,299],[300,499],[500,99999]]
console.log('\nfaixa de linhas   n    seg_med  seg_p90  seg_max   marc_med')
for (const [a,b] of faixas) {
  const f = pts.filter(p => p.n >= a && p.n <= b)
  if (!f.length) { console.log(`${a}-${b}`.padEnd(17), '   0'); continue }
  const segs = f.map(p=>p.seg).sort((x,y)=>x-y)
  const med = segs[Math.floor(segs.length/2)]
  const p90 = segs[Math.floor(segs.length*0.9)]
  const marc = (f.reduce((s,p)=>s+p.m,0)/f.length).toFixed(0)
  console.log(`${a}-${b}`.padEnd(17), String(f.length).padStart(4), String(med.toFixed(1)).padStart(9), String(p90.toFixed(1)).padStart(8), String(segs[segs.length-1].toFixed(1)).padStart(8), String(marc).padStart(10))
}
// regressao simples seg ~ a + b*marcacoes
const n = pts.length
const sx = pts.reduce((s,p)=>s+p.m,0), sy = pts.reduce((s,p)=>s+p.seg,0)
const sxy = pts.reduce((s,p)=>s+p.m*p.seg,0), sxx = pts.reduce((s,p)=>s+p.m*p.m,0)
const b = (n*sxy - sx*sy) / (n*sxx - sx*sx), a = (sy - b*sx)/n
console.log(`\nseg ~= ${a.toFixed(2)} + ${b.toFixed(4)} * marcacoes`)
for (const m of [100,170,250,400,500]) console.log(`  ${String(m).padStart(3)} marcacoes -> ${(a+b*m).toFixed(1)}s`)
const maiores = pts.sort((x,y)=>y.n-x.n).slice(0,12)
console.log('\nmaiores lotes ja ingeridos:')
for (const p of maiores) console.log(`  linhas=${p.n} marcacoes=${p.m} -> ${p.seg.toFixed(1)}s`)
