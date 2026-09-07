import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const D2='a874f789-8ec7-4295-84c6-487597c76efc'
const SRV='73ce7cd4-e89e-47fd-bee9-dbfedfe40367'   // MANUEL CONCEICAO FARIAS NETO, mat 65879
const aplicar = process.argv.includes('--aplicar')

async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)throw new Error(`${p} ${r.status} ${await r.text()}`);return r.json()}

// PRE-CONDICOES: aborta se o mundo nao for o que eu medi.
const srv=await q(`servidores?select=id,nome,matricula,status,cpf&id=eq.${SRV}`)
if(srv.length!==1) throw new Error('servidor nao encontrado')
if(srv[0].status!=='Ativo') throw new Error(`servidor nao esta Ativo: ${srv[0].status}`)
if(srv[0].matricula!=='65879') throw new Error('matricula inesperada')
const snap=await q(`rep_usuarios_dispositivo?select=id&dispositivo_id=eq.${D2}&servidor_id=eq.${SRV}`)
if(snap.length) throw new Error('ABORTADO: ele JA esta no snapshot do CAF-02 - nao ha o que enfileirar')
const vinc=await q(`rep_vinculos_servidor?select=id&dispositivo_id=eq.${D2}&servidor_id=eq.${SRV}&vigente_ate=is.null`)
if(vinc.length) throw new Error('ABORTADO: ja existe vinculo vigente no CAF-02')
const pend=await q(`rep_cadastros_fila?select=id,status&dispositivo_id=eq.${D2}&servidor_id=eq.${SRV}&status=eq.pendente`)
if(pend.length) throw new Error('ABORTADO: ja existe linha pendente na fila - nada a fazer')

console.log(`servidor: ${srv[0].nome} (mat ${srv[0].matricula}, ${srv[0].status})`)
console.log('ausente do CAF-02, sem vinculo vigente, sem linha pendente -> enfileirar')
if(!aplicar){ console.log('\n(ENSAIO - rode com --aplicar para gravar)'); process.exit(0) }

const r=await fetch(`${U}/rest/v1/rep_cadastros_fila`,{method:'POST',headers:{...H,Prefer:'return=representation'},
  body:JSON.stringify({dispositivo_id:D2, servidor_id:SRV, status:'pendente'})})
if(!r.ok) throw new Error(`INSERT falhou: ${r.status} ${await r.text()}`)
const linha=(await r.json())[0]
console.log('\nenfileirado:',JSON.stringify({id:linha.id,status:linha.status,created_at:linha.created_at}))
