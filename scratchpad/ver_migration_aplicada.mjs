// Conferencia pos-aplicacao de 20260907100000 em producao. Executa a funcao par a par (nunca
// estima) e afirma os DOIS sentidos. Sai com codigo 1 se qualquer assercao falhar.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,ANON=env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(`${p} ${r.status} ${await r.text()}`);const x=await r.json();o.push(...x);if(x.length<1000)break}return o}
async function rpc(fn,b){const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)throw new Error(`${fn} ${r.status} ${t}`);return JSON.parse(t)}

const fila=await q('rep_cadastros_fila?select=dispositivo_id,servidor_id,status,created_at,processado_em')
const srvAll=await q('servidores?select=id,updated_at')
const SU=Object.fromEntries(srvAll.map(s=>[s.id,s.updated_at]))
const subs=await q('dispositivos_rep_substituicoes?select=dispositivo_id,created_at')
const ultSub={}; for(const s of subs) if(!ultSub[s.dispositivo_id]||s.created_at>ultSub[s.dispositivo_id]) ultSub[s.dispositivo_id]=s.created_at
const inst=f=>f.processado_em||f.created_at, lim=Date.now()-30*864e5
const par={}; for(const f of fila){const k=`${f.dispositivo_id}|${f.servidor_id}`;(par[k]=par[k]||[]).push(f)}
const comFalha=Object.entries(par).filter(([,ls])=>ls.some(x=>x.status==='falhou'))

let reprovados=0, erros=[]
let nSuperada=0, nPreSub=0, nLegitimo=0
for(const [k,ls] of comFalha){
  const [d,s]=k.split('|')
  const res=await rpc('fn_cadastro_rep_reprovado',{p_dispositivo_id:d,p_servidor_id:s})
  if(res) reprovados++
  // classificacao independente, em JS, replicando as 5 condicoes
  const fal=ls.filter(x=>x.status==='falhou')
  const ult=Math.max(...fal.map(x=>+new Date(inst(x))))
  const dentro30 = ult > lim
  const posUpdate = ult >= +new Date(SU[s]||0)
  const superada = ls.some(x=>x.status==='enviado'&&+new Date(inst(x))>ult)
  const preSub = ultSub[d] && ult < +new Date(ultSub[d])
  const esperado = dentro30 && posUpdate && !superada && !preSub
  if(res!==esperado) erros.push(`${k}: funcao=${res} esperado=${esperado} (30d=${dentro30} posUpd=${posUpdate} superada=${superada} preSub=${!!preSub})`)
  if(dentro30&&posUpdate){ if(superada)nSuperada++; else if(preSub)nPreSub++; else nLegitimo++ }
}
console.log(`pares com alguma falha: ${comFalha.length}`)
console.log(`reprovados AGORA: ${reprovados}   (antes da migration eram 43)`)
console.log(`  classificacao: ${nSuperada} superada por sucesso posterior | ${nPreSub} anterior a troca | ${nLegitimo} recusa legitima`)
console.log(`\nASSERCAO 1 - funcao concorda com a regra em todos os pares: ${erros.length===0?'OK':'FALHOU'}`)
for(const e of erros.slice(0,10)) console.log('   ',e)
const a2 = reprovados===nLegitimo
console.log(`ASSERCAO 2 - reprovados == recusas legitimas (${reprovados} == ${nLegitimo}): ${a2?'OK':'FALHOU'}`)

// O caso que motivou
const D2='a874f789-8ec7-4295-84c6-487597c76efc', MAN='73ce7cd4-e89e-47fd-bee9-dbfedfe40367'
const man=await rpc('fn_cadastro_rep_reprovado',{p_dispositivo_id:D2,p_servidor_id:MAN})
console.log(`ASSERCAO 3 - MANUEL no CAF-02 deixou de ser reprovado (false): ${man===false?'OK':'FALHOU (=' + man + ')'}`)

// Privilegio: anon nao pode executar (armadilha 24), authenticated continua podendo
const ra=await fetch(`${U}/rest/v1/rpc/fn_cadastro_rep_reprovado`,{method:'POST',headers:{apikey:ANON,Authorization:`Bearer ${ANON}`,'Content-Type':'application/json'},body:JSON.stringify({p_dispositivo_id:D2,p_servidor_id:MAN})})
console.log(`ASSERCAO 4 - anon NAO executa a funcao (HTTP ${ra.status}): ${ra.status>=400?'OK':'FALHOU - esta aberta a anon'}`)

const ok = erros.length===0 && a2 && man===false && ra.status>=400
console.log(`\n${ok?'TUDO OK':'HA FALHAS ACIMA'}`)
process.exit(ok?0:1)
