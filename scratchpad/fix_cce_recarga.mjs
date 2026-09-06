// Destrava o CCE-01: encerra os vinculos que apontam para o relogio SUBSTITUIDO e reenfileira.
// APLICA so com --aplicar. Relata o que MUDOU, nao o que foi varrido (CLAUDE.md armadilha 22).
import fs from 'node:fs'
const APLICAR = process.argv.includes('--aplicar')
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1',K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});const t=await r.text();if(!r.ok)throw new Error(p.slice(0,80)+' '+r.status+' '+t.slice(0,200));const pg=JSON.parse(t);out.push(...pg);if(pg.length<1000)break}return out}
async function rpc(fn,args){const r=await fetch(`${U}/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(args)});const t=await r.text();if(!r.ok)throw new Error(fn+' '+r.status+' '+t.slice(0,300));return t?JSON.parse(t):null}
const CCE='8a85f2e8-f06a-4301-83c9-ec8881e9d3e9'

// PRE-CONDICOES. Se qualquer uma falhar, o diagnostico mudou e nada deve ser escrito.
const snap = await q(`rep_usuarios_dispositivo?dispositivo_id=eq.${CCE}&select=id`)
if (snap.length !== 0) { console.error(`ABORTA: snapshot tem ${snap.length} linhas - o relogio ja foi lido com cadastros. Reveja antes de encerrar vinculo.`); process.exit(1) }
const vig = await q(`rep_vinculos_servidor?dispositivo_id=eq.${CCE}&vigente_ate=is.null&select=id,servidor_id,identificador_afd`)
console.log(`snapshot=0 (relogio lido e vazio)  |  vinculos vigentes=${vig.length}`)
const pend = await q(`rep_cadastros_fila?dispositivo_id=eq.${CCE}&status=eq.pendente&select=id`)
console.log(`fila pendente antes: ${pend.length}`)
if (!APLICAR) { console.log('\n(ensaio - nada foi escrito; rode com --aplicar)'); process.exit(0) }

// 1) Encerra os vinculos. NAO mexe em ponto passado: a autoria e resolvida pelo vinculo vigente
//    NA DATA da batida, e vigente_ate=now() so fecha dali para frente.
const agora = new Date().toISOString()
const r1 = await fetch(`${U}/rep_vinculos_servidor?dispositivo_id=eq.${CCE}&vigente_ate=is.null`,
  { method:'PATCH', headers:{...H, Prefer:'return=representation'}, body: JSON.stringify({ vigente_ate: agora }) })
const enc = JSON.parse(await r1.text())
if (!r1.ok) { console.error('falha ao encerrar vinculos', enc); process.exit(1) }
console.log(`vinculos encerrados: ${enc.length}`)

// 2) Reenfileira: por LOTACAO e por ESCALA (as duas, nunca uma so).
const hoje = new Date()
console.log('por lotacao :', JSON.stringify(await rpc('fn_enfileirar_cadastros_rep', { p_dispositivo_id: CCE })))
console.log('por escala  :', JSON.stringify(await rpc('fn_enfileirar_cadastros_por_escala', { p_dispositivo_id: CCE, p_mes: hoje.getMonth()+1, p_ano: hoje.getFullYear() })))

const pend2 = await q(`rep_cadastros_fila?dispositivo_id=eq.${CCE}&status=eq.pendente&select=servidor_id`)
console.log(`\nfila pendente AGORA: ${pend2.length}  (o coletor grava 20 por ciclo de 5 min)`)
