// SOMENTE LEITURA. Quantifica o dano em 09/2026 nos 10 casos de mesma unidade.
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r = await fetch(`${U}/rest/v1/${p}`,{headers:{...H, Range:`${f}-${f+999}`}})
  if(!r.ok){ console.error('ERRO',p.slice(0,90),r.status,(await r.text()).slice(0,300)); process.exit(1) }
  const pg = await r.json(); out.push(...pg); if(pg.length<1000) break } return out }
const tz='America/Sao_Paulo'
const dnum = iso => Number(new Intl.DateTimeFormat('en-CA',{timeZone:tz,day:'2-digit'}).format(new Date(iso)))
const grupos = JSON.parse(fs.readFileSync('scratchpad/_dup_ids.json','utf8')).filter(g=>g.mesma)
const ids = grupos.flatMap(g=>g.ids)
const em = await q(`escala_mensal?select=id,servidor_id&servidor_id=in.(${ids.join(',')})&ano=eq.2026&mes=eq.9`)
const ed = em.length? await q(`escala_diaria?select=escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em&escala_mensal_id=in.(${em.map(e=>e.id).join(',')})`):[]
const marc = await q(`marcacoes_ponto?select=servidor_id,ocorrido_em&origem=eq.rep&ocorrido_em=gte.2026-09-01&ocorrido_em=lt.2026-10-01&servidor_id=in.(${ids.join(',')})`)
const emServ = Object.fromEntries(em.map(e=>[e.id,e.servidor_id]))

let diasEscalados=0, diasSemPresenca=0, batidasEmDiaSemTurno=0, totalBatidas=marc.length
let matrSemNenhumaBatida=0, matrComEscala=0
const porPessoa=[]
for(const g of grupos){
  const linhas = g.ids.map((id,i)=>{
    const dias = new Set(ed.filter(d=>emServ[d.escala_mensal_id]===id).map(d=>d.dia))
    const semPres = ed.filter(d=>emServ[d.escala_mensal_id]===id && !d.presenca_entrada_em).length
    const b = marc.filter(m=>m.servidor_id===id)
    return {mat:g.mats[i], dias, nDias:dias.size, semPres, nB:b.length, b}
  })
  for(const l of linhas){
    diasEscalados+=l.nDias; diasSemPresenca+=l.semPres
    if(l.nDias>0){ matrComEscala++; if(l.nB===0) matrSemNenhumaBatida++ }
  }
  // batida atribuida a uma matricula em dia sem turno dela, tendo a irma turno naquele dia
  for(let i=0;i<linhas.length;i++){
    const outra = linhas[1-i]
    for(const m of linhas[i].b){
      const d = dnum(m.ocorrido_em)
      if(!linhas[i].dias.has(d) && outra.dias.has(d)) batidasEmDiaSemTurno++
    }
  }
  porPessoa.push({nome:g.nome.trim(), linhas:linhas.map(l=>`mat ${l.mat}: ${l.nDias}d escala, ${l.nB} batidas, ${l.semPres}d sem presenca`)})
}
console.log('=== 09/2026, os 10 casos de mesma unidade ===')
for(const p of porPessoa) console.log(`  ${p.nome.padEnd(38)} ${p.linhas.join('  |  ')}`)
console.log(`\nmatriculas com escala em 09/2026: ${matrComEscala}`)
console.log(`  delas, com ZERO batida propria: ${matrSemNenhumaBatida}`)
console.log(`dias de escala: ${diasEscalados} | dias SEM presenca registrada: ${diasSemPresenca}`)
console.log(`batidas REP no mes: ${totalBatidas}`)
console.log(`  atribuidas a uma matricula em dia SEM turno dela, tendo a irma turno: ${batidasEmDiaSemTurno}`)
