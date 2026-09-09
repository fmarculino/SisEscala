import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,200));return r.json()}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)return null;return JSON.parse(t)}
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'
const SETOR='0dd13187-24af-4d58-b106-0e5c67de59d3'
const srvs=(await q('servidores?select=id,nome,matricula,setor_id,status')).filter(s=>s.setor_id===SETOR&&s.status==='Ativo')
console.log('=== dias do CAF que a projecao consegue preencher e ainda estao vazios ===')
let recup=0
for(const s of srvs){
  for(const dia of [2,8,9]){
    const data=`2026-09-0${dia}`
    const proj=await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:s.id,p_data:data})
    if(!proj||!proj.length) continue
    for(const p of proj){
      const d=(await q(`escala_diaria?select=presenca_entrada_em,presenca_saida_em&id=eq.${p.escala_diaria_id}`))[0]
      if(!d) continue
      const g=[], atual=[[d.presenca_entrada_em,p.entrada_em,'entrada'],[d.presenca_saida_em,p.saida_em,'saida']]
      for(const [a,b,rot] of atual) if(!a&&b) g.push(`${rot} ${loc(b)}`)
      const perda = atual.some(([a,b])=>a&&!b) || atual.some(([a,b])=>a&&b&&a!==b)
      if(g.length){ recup++
        console.log(`  ${data} ${s.nome.slice(0,30).padEnd(31)} ganharia: ${g.join(', ')}${perda?'   (COM troca/perda junto — validar a mao)':''}`) }
    }
  }
}
if(!recup) console.log('  (nenhum)')
console.log('\n=== marcacoes do CAF ainda PENDENTES (nao viraram presenca) ===')
const m=await q(`marcacoes_ponto?select=id,ocorrido_em,servidor_id&setor_id=eq.${SETOR}&ocorrido_em=gte.2026-09-01&order=ocorrido_em`)
const nome=Object.fromEntries(srvs.map(s=>[s.id,s.nome]))
let pend=0
for(const x of m){
  const usada=await q(`escala_diaria?select=id&or=(presenca_entrada_marcacao_id.eq.${x.id},presenca_saida_marcacao_id.eq.${x.id},presenca_intervalo_saida_marcacao_id.eq.${x.id},presenca_intervalo_retorno_marcacao_id.eq.${x.id})&limit=1`)
  if(!usada.length){ pend++; console.log(`  ${loc(x.ocorrido_em)} ${nome[x.servidor_id]||'(?)'}`) }
}
console.log(`  total pendente: ${pend} de ${m.length} batidas de 09/2026`)
