import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,250));return r.json()}
const unis=await q('unidades?select=id,nome');const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
console.log('=== TERMINAIS LOCAIS cadastrados ===')
const t=await q('terminais_locais?select=*')
console.log('total:',t.length)
if(t.length) console.log('colunas:',Object.keys(t[0]).join(', '))
for(const x of t) console.log(` ${x.nome||'(sem nome)'} | ${un[x.unidade_id]} | setor=${x.setor_id||'—'} | ativo=${x.ativo} | resp=${x.responsavel_coordenador_id||'—'}`)
console.log('\n=== marcacoes do CAF: quem eh o coordenador gravado? ===')
const m=await q(`marcacoes_ponto?select=id,ocorrido_em,origem,coordenador_id,registrado_por_id,setor_id,observacao&origem=eq.terminal&ocorrido_em=gte.2026-09-08&order=ocorrido_em.desc&limit=8`)
for(const x of m) console.log(` ${x.ocorrido_em} coord=${x.coordenador_id||'—'} reg_por=${x.registrado_por_id||'—'} setor=${x.setor_id}`)
