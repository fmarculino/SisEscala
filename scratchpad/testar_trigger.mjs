import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json',Prefer:'return=representation'}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});const t=await r.text();if(!r.ok)throw new Error(`${r.status} ${t.slice(0,200)}`);return JSON.parse(t)}
async function patch(p,b){const r=await fetch(`${U}/rest/v1/${p}`,{method:'PATCH',headers:H,body:JSON.stringify(b)});const t=await r.text();return {ok:r.ok,status:r.status,corpo:t.slice(0,320)}}

const LINHA='214b76a3-a8b7-4640-a853-b1b52cd0d0eb'   // ERIKA, 09/2026 dia 2, CLASSIFICACAO DE RISCO, Plantao N
const turnos=await q(`dicionario_turnos?select=id,codigo,slots&codigo=in.(N,N6,MT)`)
const t=Object.fromEntries(turnos.map(x=>[x.codigo,x]))
console.log('turnos:', turnos.map(x=>`${x.codigo}=${JSON.stringify(x.slots)}`).join('  '))
const original=(await q(`escala_diaria?select=dicionario_turnos_id&id=eq.${LINHA}`))[0].dicionario_turnos_id
console.log('turno original da linha:', Object.values(t).find(x=>x.id===original)?.codigo)

console.log('\n=== TESTE A (negativo): Plantao N -> MT, sobrepoe com o Regular MT em ENFERMEIROS ===')
const a=await patch(`escala_diaria?id=eq.${LINHA}`,{dicionario_turnos_id:t.MT.id})
if(a.ok){
  console.log('!!! PASSOU — o trigger NAO barrou. Revertendo agora.')
  const rev=await patch(`escala_diaria?id=eq.${LINHA}`,{dicionario_turnos_id:original})
  console.log('revertido:', rev.ok)
} else {
  console.log('RECUSADO (correto). status', a.status)
  console.log('mensagem:', a.corpo)
}

console.log('\n=== TESTE B (positivo): Plantao N -> N6, adjacente ao MT, deve PASSAR ===')
if(t.N6){
  const b=await patch(`escala_diaria?id=eq.${LINHA}`,{dicionario_turnos_id:t.N6.id})
  console.log(b.ok ? 'ACEITO (correto) — a dobra adjacente continua permitida' : `!!! RECUSADO indevidamente: ${b.corpo}`)
  const rev=await patch(`escala_diaria?id=eq.${LINHA}`,{dicionario_turnos_id:original})
  console.log('revertido para o turno original:', rev.ok)
} else console.log('turno N6 nao encontrado, teste B pulado')

const fim=(await q(`escala_diaria?select=dicionario_turnos_id&id=eq.${LINHA}`))[0].dicionario_turnos_id
console.log('\nestado final da linha ==', fim===original ? 'IGUAL AO ORIGINAL (ok)' : '!!! DIFERENTE DO ORIGINAL')
