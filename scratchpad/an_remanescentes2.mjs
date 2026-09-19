import fs from 'fs'
import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
async function pag(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(r.status+' '+await r.text());const x=await r.json();o.push(...x);if(x.length<1000)break}return o}
const rpc=async(fn,b)=>{const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)});return r.ok?await r.json():{__e:r.status,t:(await r.text()).slice(0,160)}}
const { ids } = JSON.parse(fs.readFileSync('scratchpad/_afd/antes.json','utf8'))
const em=[]; for(let i=0;i<ids.length;i+=25) em.push(...await pag(`escala_mensal?select=id,servidor_id,servidores(nome,matricula)&mes=eq.9&ano=eq.2026&servidor_id=in.(${ids.slice(i,i+25).join(',')})`))
const byEm=Object.fromEntries(em.map(e=>[e.id,e]))
const emIds=em.map(e=>e.id); const linhas=[]
for(let i=0;i<emIds.length;i+=25) linhas.push(...await pag(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em,dicionario_turnos(codigo)&escala_mensal_id=in.(${emIds.slice(i,i+25).join(',')})&dia=in.(17,18)`))

// pares (servidor,dia) com QUALQUER passo faltando
const pares = new Map()
for (const l of linhas) {
  if (l.categoria === 'Sobreaviso') continue
  const falta = !l.presenca_entrada_em || !l.presenca_saida_em || !l.presenca_intervalo_saida_em || !l.presenca_intervalo_retorno_em
  if (!falta) continue
  const e = byEm[l.escala_mensal_id]
  pares.set(`${e.servidor_id}|${l.dia}`, { sid: e.servidor_id, dia: l.dia, nome: e.servidores?.nome, mat: e.servidores?.matricula })
}
console.log(`pares (servidor,dia) com algum passo faltando nos dias 17/18: ${pares.size}`)

let ganho=0, troca=0, perda=0, semNada=0
const detalhe=[]
for (const p of pares.values()) {
  const data = `2026-09-${String(p.dia).padStart(2,'0')}`
  const proj = await rpc('fn_projecao_marcacoes_dia', { p_servidor_id: p.sid, p_data: data })
  if (proj.__e || !Array.isArray(proj)) { continue }
  const conf = proj.filter(x => x.confirmada)
  if (!conf.length) { semNada++; continue }
  const linhasDoDia = linhas.filter(l => byEm[l.escala_mensal_id].servidor_id === p.sid && l.dia === p.dia)
  let g=0,t=0
  for (const c of conf) {
    const ed = linhasDoDia.find(l => l.id === c.escala_diaria_id); if (!ed) continue
    for (const [a,b] of [[ed.presenca_entrada_em,c.entrada_em],[ed.presenca_intervalo_saida_em,c.int_saida_em],[ed.presenca_intervalo_retorno_em,c.int_ret_em],[ed.presenca_saida_em,c.saida_em]]) {
      if ((b||null) === (a||null)) continue
      if (a === null && b) g++; else if (a && (b||null)!==a) t++
    }
  }
  if (t>0) { troca++; detalhe.push(`TROCA  ${data} ${p.mat} ${p.nome?.slice(0,28)} ganhos=${g} trocas=${t}`) }
  else if (g>0) { ganho++; detalhe.push(`GANHO  ${data} ${p.mat} ${p.nome?.slice(0,28)} campos=${g}`) }
  else semNada++
}
console.log(`  so acrescimo (GANHO): ${ganho}`)
console.log(`  com troca/perda:      ${troca}`)
console.log(`  nada a fazer:         ${semNada}`)
console.log()
for (const d of detalhe) console.log('  '+d)
