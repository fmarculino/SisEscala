import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const j=async p=>(await fetch(`${U}/rest/v1/${p}`,{headers:H})).json()
const s=(await j('servidores?select=id,nome,matricula,status,unidade_id,setor_id&matricula=eq.40002'))[0]
console.log('SERVIDOR',JSON.stringify(s))
console.log('\nTODAS as escalas dele (qualquer mes/ativo):')
for(const e of await j(`escala_mensal?select=id,mes,ano,ativo,status,unidade_id,setor_id,jornada_id&servidor_id=eq.${s.id}&order=ano.desc,mes.desc`))
  console.log('  ',JSON.stringify(e))
console.log('\nTODAS as folhas dele:')
for(const f of await j(`folha_ponto?select=id,mes,ano,status,escala_mensal_id,gerado_em,total_horas_normais,servidor_id&servidor_id=eq.${s.id}`))
  console.log('  ',JSON.stringify(f))
console.log('\n=== o que a listagem NOVA veria (unidade Hiroshi, 09/2026) ===')
const sel=encodeURIComponent('id,status,servidor_id,escala_mensal_id,escala_mensal!inner(unidade_id,setor_id)')
const fol=await j(`folha_ponto?select=${sel}&mes=eq.9&ano=eq.2026&escala_mensal.unidade_id=eq.${s.unidade_id}&order=id.asc&limit=1000`)
const dele=fol.filter(f=>f.servidor_id===s.id)
console.log('folhas da unidade:',fol.length,'| do ALDENIR:',JSON.stringify(dele))
const esc=await j(`escala_mensal?select=id,servidor_id&mes=eq.9&ano=eq.2026&ativo=eq.true&unidade_id=eq.${s.unidade_id}&order=id.asc&limit=1000`)
const escDele=esc.filter(e=>e.servidor_id===s.id)
console.log('escalas ativas da unidade:',esc.length,'| do ALDENIR:',JSON.stringify(escDele))
for(const e of escDele) console.log('  casa com folha?',fol.some(f=>f.escala_mensal_id===e.id))
