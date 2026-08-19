/** SO LEITURA. Batida retroativa/sintetica explica a atribuicao errada? */
const fs=require('fs'),path=require('path')
const env={};for(const l of fs.readFileSync(path.join(__dirname,'..','.env.production'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const U=env.NEXT_PUBLIC_SUPABASE_URL,H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}
const pag=async r0=>{const o=[];for(let f=0;;f+=1000){const r=await fetch(U+'/rest/v1/'+r0,{headers:{...H,Range:f+'-'+(f+999)}});if(!r.ok)throw new Error(r.status+' '+await r.text());const p=await r.json();o.push(...p);if(p.length<1000)break}return o}
const diaLocal=t=>parseInt(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',day:'2-digit'}).format(new Date(t)),10)
;(async()=>{
const em=await pag('escala_mensal?select=id,servidor_id&mes=eq.8&ano=eq.2026')
const ids=em.map(e=>e.id),M=new Map(em.map(e=>[e.id,e]))
let ed=[]
for(let i=0;i<ids.length;i+=50)
  ed.push(...await pag(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_entrada_marcacao_id,presenca_saida_marcacao_id&escala_mensal_id=in.(${ids.slice(i,i+50).join(',')})`))
const comH=ed.filter(d=>d.presenca_entrada_em&&d.presenca_saida_em).map(d=>({...d,h:(new Date(d.presenca_saida_em)-new Date(d.presenca_entrada_em))/3600000}))
const ruins=comH.filter(d=>d.h<0||d.h>26)
const servRuins=new Set(ruins.map(d=>M.get(d.escala_mensal_id)?.servidor_id))
const bons=comH.filter(d=>d.h>=0&&d.h<=26&&servRuins.has(M.get(d.escala_mensal_id)?.servidor_id))

const todosIds=[...new Set([...ruins,...bons].flatMap(d=>[d.presenca_entrada_marcacao_id,d.presenca_saida_marcacao_id]).filter(Boolean))]
let mp=[]
for(let i=0;i<todosIds.length;i+=100)
  mp.push(...await pag(`marcacoes_ponto?select=id,ocorrido_em,origem,sintetica,retroativa&id=in.(${todosIds.slice(i,i+100).join(',')})`))
const MP=new Map(mp.map(m=>[m.id,m]))

function perfil(grupo,nome){
  let n=0,retro=0,sint=0,diaErrado=0,semLink=0
  for(const d of grupo) for(const k of ['presenca_entrada_marcacao_id','presenca_saida_marcacao_id']){
    const m=MP.get(d[k]); if(!m){semLink++;continue}
    n++
    if(m.retroativa)retro++
    if(m.sintetica)sint++
    if(diaLocal(m.ocorrido_em)!==d.dia)diaErrado++
  }
  console.log(`\n${nome} (${grupo.length} linhas, ${n} marcacoes ligadas, ${semLink} sem link)`)
  if(!n)return
  console.log(`   retroativa           : ${retro} (${(100*retro/n).toFixed(0)}%)`)
  console.log(`   sintetica            : ${sint} (${(100*sint/n).toFixed(0)}%)`)
  console.log(`   ocorreu em OUTRO dia : ${diaErrado} (${(100*diaErrado/n).toFixed(0)}%)`)
}
perfil(ruins,'ATRIBUICAO ERRADA')
perfil(bons,'CONTROLE (dias saudaveis, mesmos servidores)')
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1)})
