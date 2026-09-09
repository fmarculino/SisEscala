// SOMENTE LEITURA. Qual matricula ganhou o vinculo em CADA relogio, para quem tem duplo vinculo.
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
const grupos = JSON.parse(fs.readFileSync('scratchpad/_dup_ids.json','utf8')).filter(g=>g.mesma)
const disp  = Object.fromEntries((await q('dispositivos_rep?select=id,nome,unidade_id,ativo')).map(d=>[d.id,d]))
const ids = grupos.flatMap(g=>g.ids).join(',')
const vinc = (await q(`rep_vinculos_servidor?select=dispositivo_id,servidor_id,identificador_afd,vigente_de,vigente_ate,tem_biometria&servidor_id=in.(${ids})`)).filter(v=>!v.vigente_ate)
const snap = await q(`rep_usuarios_dispositivo?select=dispositivo_id,servidor_id,identificador_afd,tem_biometria&servidor_id=in.(${ids})`)
const desde = new Date(Date.now()-60*864e5).toISOString().slice(0,10)
const marc = await q(`marcacoes_ponto?select=servidor_id,dispositivo_id,ocorrido_em&origem=eq.rep&ocorrido_em=gte.${desde}&servidor_id=in.(${ids})`)

console.log('=== SO OS 10 CASOS DE MESMA UNIDADE: quem ganhou o vinculo em cada relogio ===')
for (const g of grupos) {
  console.log(`\n${g.nome.trim()}  (${g.unids[0]})`)
  const rels = new Set([...vinc, ...snap].filter(x=>g.ids.includes(x.servidor_id)).map(x=>x.dispositivo_id))
  for (const r of [...rels].sort((a,b)=>(disp[a]?.nome||'').localeCompare(disp[b]?.nome||''))) {
    const donos = g.ids.map((id,i)=>{
      const v = vinc.find(v=>v.dispositivo_id===r && v.servidor_id===id)
      const s = snap.find(s=>s.dispositivo_id===r && s.servidor_id===id)
      const m = marc.filter(m=>m.dispositivo_id===r && m.servidor_id===id).length
      return {mat:g.mats[i], v:!!v, bio:s?.tem_biometria, cad:!!s, m}
    })
    const txt = donos.map(d=>`mat ${d.mat}${d.v?' [VINCULO]':''}${d.cad?` cadastrado(bio=${d.bio?'sim':'nao'})`:''}${d.m?` ${d.m}batidas`:''}`).join('   |   ')
    console.log(`   ${(disp[r]?.nome||r).padEnd(24)} ${disp[r]?.ativo===false?'(INATIVO) ':''}${txt}`)
  }
}
