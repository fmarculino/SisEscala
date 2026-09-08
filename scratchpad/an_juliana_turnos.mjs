import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));return []}return r.json()}
const s=(await q(`servidores?select=id,telefone&matricula=eq.68184`))[0]
console.log('telefone:', JSON.stringify(s.telefone))
const unis=await q(`unidades?select=id,nome`);const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const tt=Object.fromEntries((await q(`dicionario_turnos?select=id,codigo,horas_computadas`)).map(t=>[t.id,t.codigo]))
const ems=await q(`escala_mensal?select=id,unidade_id,mes&servidor_id=eq.${s.id}&ano=eq.2026&mes=eq.9`)
const linhas={}
for(const e of ems){
  const eds=await q(`escala_diaria?select=dia,categoria,dicionario_turnos_id,hora_inicio_prevista&escala_mensal_id=eq.${e.id}&order=dia`)
  for(const d of eds){ (linhas[d.dia]=linhas[d.dia]||[]).push(`${un[e.unidade_id].split(' ')[0]}:${d.categoria}/${tt[d.dicionario_turnos_id]}${d.hora_inicio_prevista?'@'+d.hora_inicio_prevista.slice(0,5):''}`) }
}
console.log('\n=== ESCALA PREVISTA 09/2026 (dia -> o que esta lancado) ===')
for(let d=1;d<=30;d++) if(linhas[d]) console.log(String(d).padStart(2),'|',linhas[d].join('   +   '))
