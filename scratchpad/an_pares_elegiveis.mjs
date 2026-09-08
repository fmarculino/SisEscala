import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const alvos = JSON.parse(fs.readFileSync('scratchpad/_alvos.json','utf8'))
const P = ['entrada','int_saida','int_ret','saida']
const cA = { entrada:'presenca_entrada_em', int_saida:'presenca_intervalo_saida_em', int_ret:'presenca_intervalo_retorno_em', saida:'presenca_saida_em' }
const cP = { entrada:'entrada_em', int_saida:'int_saida_em', int_ret:'int_ret_em', saida:'saida_em' }
const sel = 'id,categoria,'+P.map(p=>cA[p]).join(',')
let elegiveis=0, camposElegiveis=0, contaminados=0, nada=0
const fila=[...alvos]
async function worker(){ while(fila.length){ const a=fila.shift()
  const data=`2026-09-${String(a.dia).padStart(2,'0')}`
  let proj,cur
  try{ const [r1,r2]=await Promise.all([
    fetch(`${U}/rest/v1/rpc/fn_projecao_marcacoes_dia`,{method:'POST',headers:H,body:JSON.stringify({p_servidor_id:a.servidor_id,p_data:data})}),
    fetch(`${U}/rest/v1/escala_diaria?select=${sel}&escala_mensal_id=eq.${a.id}&dia=eq.${a.dia}`,{headers:H})])
    proj=await r1.json(); cur=await r2.json() }catch(e){ continue }
  if(!Array.isArray(proj)||!proj.length){ nada++; continue }
  const byId=new Map(cur.map(l=>[l.id,l]))
  let g=0, sujo=false
  for(const p of proj){
    if(!p.confirmada) continue
    const l=byId.get(p.escala_diaria_id); if(!l) continue
    for(const passo of P){
      const novo=p[cP[passo]], velho=l[cA[passo]]
      if(!novo&&!velho) continue
      if(novo&&!velho) g++
      else if(!novo&&velho) sujo=true
      else if(new Date(novo).getTime()!==new Date(velho).getTime()) sujo=true
    }
  }
  if(sujo) contaminados++
  else if(g){ elegiveis++; camposElegiveis+=g }
  else nada++
}}
await Promise.all(Array.from({length:4},worker))
console.log(`PARES (servidor,dia) — criterio: reconciliar o dia inteiro so ACRESCENTA`)
console.log(`  elegiveis (so ganho, nada mexido) : ${elegiveis}  ->  ${camposElegiveis} horarios recuperados`)
console.log(`  contaminados (o dia tem troca/perda; vao para decisao manual) : ${contaminados}`)
console.log(`  sem ganho nenhum : ${nada}`)
