import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const D = '19454bce-aa64-45af-865f-df2b18e0a205'
async function pag(p) { const o=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok) throw new Error(r.status+await r.text()); const x=await r.json(); o.push(...x); if(x.length<1000) break } return o }
const dia = iso => new Date(new Date(iso).getTime()-3*3600e3).toISOString().slice(0,10)

// pares distintos do HMI-01 nos dias comparaveis
for (const [a,b,rot] of [['2026-09-16T03:00:00Z','2026-09-17T03:00:00Z','16/09 (257 batidas)'],['2026-09-15T03:00:00Z','2026-09-16T03:00:00Z','15/09']]) {
  const m = await pag(`marcacoes_ponto?select=servidor_id,ocorrido_em&dispositivo_id=eq.${D}&ocorrido_em=gte.${a}&ocorrido_em=lt.${b}&servidor_id=not.is.null`)
  const pares = new Set(m.map(x => `${x.servidor_id}|${dia(x.ocorrido_em)}`))
  console.log(`${rot}: ${m.length} batidas com dono -> ${pares.size} pares (servidor,dia)`)
}

// as 7137 sincronizacoes de 500 linhas: quantas tinham marcacoes COM DONO?
const s500 = await pag('rep_sincronizacoes?select=id,dispositivo_id,iniciada_em,linhas_recebidas,marcacoes_criadas,marcacoes_orfas&linhas_recebidas=eq.501&status=eq.concluida&order=iniciada_em.desc')
const comDono = s500.filter(x => (x.marcacoes_criadas||0) - (x.marcacoes_orfas||0) > 0)
console.log(`\nsincronizacoes de 500 linhas concluidas: ${s500.length}`)
console.log(`  com marcacoes COM DONO (orfas < criadas): ${comDono.length}`)
console.log(`  so orfas (relogio reaproveitado, laco de reconciliacao vazio): ${s500.length - comDono.length}`)
console.log('\n  as 10 mais recentes COM DONO:')
for (const x of comDono.slice(0,10)) console.log(`   ${x.iniciada_em} disp=${x.dispositivo_id.slice(0,8)} criadas=${x.marcacoes_criadas} orfas=${x.marcacoes_orfas} -> com dono=${x.marcacoes_criadas-x.marcacoes_orfas}`)
