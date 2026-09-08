import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const alvos = JSON.parse(fs.readFileSync('scratchpad/_alvos.json','utf8'))
const PASSOS = ['entrada','int_saida','int_ret','saida']
const cA = { entrada:'presenca_entrada_em', int_saida:'presenca_intervalo_saida_em', int_ret:'presenca_intervalo_retorno_em', saida:'presenca_saida_em' }
const cP = { entrada:'entrada_em', int_saida:'int_saida_em', int_ret:'int_ret_em', saida:'saida_em' }
const oA = { entrada:'presenca_entrada_origem', int_saida:'presenca_intervalo_saida_origem', int_ret:'presenca_intervalo_retorno_origem', saida:'presenca_saida_origem' }

const sel = 'id,categoria,'+PASSOS.map(p=>cA[p]).join(',')+','+PASSOS.map(p=>oA[p]).join(',')
const stats = { soGanho:0, mista:0, semMudanca:0, soTrocaPerda:0 }
const ganhosEmLinhaLimpa = { linhas:0, campos:0 }
const mistas = []
const fila = [...alvos]
async function worker(){ while(fila.length){ const a=fila.shift()
  const data=`2026-09-${String(a.dia).padStart(2,'0')}`
  let proj,cur
  try{
    const [r1,r2]=await Promise.all([
      fetch(`${U}/rest/v1/rpc/fn_projecao_marcacoes_dia`,{method:'POST',headers:H,body:JSON.stringify({p_servidor_id:a.servidor_id,p_data:data})}),
      fetch(`${U}/rest/v1/escala_diaria?select=${sel}&escala_mensal_id=eq.${a.id}&dia=eq.${a.dia}`,{headers:H})])
    proj=await r1.json(); cur=await r2.json()
  }catch(e){ continue }
  if(!Array.isArray(proj)) continue
  const byId=new Map(cur.map(l=>[l.id,l]))
  for(const p of proj){
    if(!p.confirmada) continue
    const l=byId.get(p.escala_diaria_id); if(!l) continue
    let g=0,t=0,pe=0
    for(const passo of PASSOS){
      const novo=p[cP[passo]], velho=l[cA[passo]]
      if(!novo&&!velho) continue
      if(novo&&!velho) g++
      else if(!novo&&velho) pe++
      else if(new Date(novo).getTime()!==new Date(velho).getTime()) t++
    }
    if(g&&!t&&!pe){ stats.soGanho++; ganhosEmLinhaLimpa.linhas++; ganhosEmLinhaLimpa.campos+=g }
    else if(g&&(t||pe)){ stats.mista++; if(mistas.length<10) mistas.push({servidor:a.servidor_id,dia:a.dia,cat:l.categoria,ganhos:g,trocas:t,perdas:pe}) }
    else if(!g&&(t||pe)) stats.soTrocaPerda++
    else stats.semMudanca++
  }
}}
await Promise.all(Array.from({length:4},worker))
console.log('LINHAS de escala_diaria classificadas:')
console.log(`  so GANHO (campos vazios preenchidos, nada mexido) : ${stats.soGanho}  -> ${ganhosEmLinhaLimpa.campos} campos`)
console.log(`  MISTA (ganha um passo e troca/perde outro)        : ${stats.mista}`)
console.log(`  so TROCA/PERDA (nada a ganhar)                    : ${stats.soTrocaPerda}`)
console.log(`  sem mudanca nenhuma                               : ${stats.semMudanca}`)
console.log('\nexemplos de linha MISTA (as que um botao ingenuo estragaria):')
mistas.forEach(m=>console.log(' ',JSON.stringify(m)))
