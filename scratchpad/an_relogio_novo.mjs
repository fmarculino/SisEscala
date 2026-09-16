import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
const q=async p=>(await fetch(`${U}/rest/v1/${p}`,{headers:H})).json()
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const d=await q('dispositivos_rep?select=nome,unidade_id,ativo,created_at,atende_toda_unidade&order=created_at.desc&limit=4')
console.log('=== RELOGIOS MAIS RECENTES ===')
for(const x of d) console.log(` ${String(x.created_at).slice(0,16)}  ${x.nome.padEnd(28)} ${un[x.unidade_id]}  toda_unidade=${x.atende_toda_unidade}`)
const cb=await q('dispositivos_rep?select=id,nome&nome=like.*USF-CB*')
const srv=await q(`servidores?select=nome,matricula,setor_id,status&unidade_id=eq.${(await q('dispositivos_rep?select=unidade_id&nome=like.*USF-CB*'))[0].unidade_id}&status=eq.Ativo`)
console.log('\n=== LOTADOS ATIVOS NA USF CARLOS BARRETO ===', srv.length)
for(const s of srv) console.log(`   ${s.matricula} ${s.nome}`)
