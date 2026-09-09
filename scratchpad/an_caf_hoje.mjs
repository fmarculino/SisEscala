import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,200));return r.json()}
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'
console.log('=== terminal POLO II: responsavel atual ===')
const t=(await q(`terminais_locais?select=nome,responsavel_coordenador_id,ultimo_contato_em`))[0]
const p=(await q(`profiles?select=full_name,role&id=eq.${t.responsavel_coordenador_id}`))[0]
console.log(` ${t.nome} -> ${p.full_name} (${p.role}) | ultimo contato ${loc(t.ultimo_contato_em)}`)

console.log('\n=== recusas "Sem permissao" HOJE (09/09) ===')
const r=await q(`logs_tentativas_presenca?select=data_hora_tentativa,nome_servidor_detectado&mensagem_erro=ilike.*Sem permiss*&data_hora_tentativa=gte.2026-09-09`)
console.log(' total:', r.length)
for(const x of r) console.log('  ',loc(x.data_hora_tentativa), x.nome_servidor_detectado)

console.log('\n=== batidas do setor POLO II hoje ===')
const m=await q(`marcacoes_ponto?select=ocorrido_em,origem,observacao&setor_id=eq.0dd13187-24af-4d58-b106-0e5c67de59d3&ocorrido_em=gte.2026-09-09&order=ocorrido_em`)
console.log(' total:', m.length)
for(const x of m) console.log('  ',loc(x.ocorrido_em), x.origem, x.observacao? '| '+x.observacao.slice(0,60):'| (aceita direto)')
