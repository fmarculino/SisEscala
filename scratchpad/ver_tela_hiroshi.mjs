// Reproduz a listagem da tela (codigo NOVO) para USF HIROSHI MATSUDA, 09/2026.
import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const j=async p=>(await fetch(`${U}/rest/v1/${p}`,{headers:H})).json()
const UNI='36abf7d9-6b28-4890-8c4c-676bbcd048c0'
const esc=await j(`escala_mensal?select=id,servidor_id,status,servidores(nome,matricula)&mes=eq.9&ano=eq.2026&ativo=eq.true&unidade_id=eq.${UNI}&order=id.asc&limit=1000`)
const sel=encodeURIComponent('id,status,escala_mensal_id,escala_mensal!inner(unidade_id)')
const fol=await j(`folha_ponto?select=${sel}&mes=eq.9&ano=eq.2026&escala_mensal.unidade_id=eq.${UNI}&order=id.asc&limit=1000`)
const linhas=esc.map(e=>({nome:e.servidores?.nome,mat:e.servidores?.matricula,
  folha:fol.find(f=>f.escala_mensal_id===e.id)?.status||'Não Gerada'}))
  .sort((a,b)=>a.nome.localeCompare(b.nome))
const cont={};for(const l of linhas)cont[l.folha]=(cont[l.folha]||0)+1
console.log('USF HIROSHI MATSUDA, 09/2026 — como a tela NOVA monta:')
console.log(' escalas:',esc.length,'| folhas:',fol.length,'|',JSON.stringify(cont))
console.log('\nprimeiras 6 linhas (a mesma ordem do print):')
for(const l of linhas.slice(0,6))console.log(`  ${l.nome.padEnd(34)} mat ${String(l.mat).padEnd(9)} -> ${l.folha}`)
const ald=linhas.find(l=>l.mat==='40002')
console.log('\nALDENIR:',JSON.stringify(ald))
