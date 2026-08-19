const fs=require('fs'),path=require('path')
const env={};for(const l of fs.readFileSync(path.join(__dirname,'..','.env.production'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const URL=env.NEXT_PUBLIC_SUPABASE_URL,KEY=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:KEY,Authorization:`Bearer ${KEY}`}
const g=async q=>{const r=await fetch(`${URL}/rest/v1/${q}`,{headers:H});if(!r.ok)throw new Error(r.status+' '+await r.text());return r.json()}
const hora=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'-'
;(async()=>{
  const alvos=[['MARIA RAIMUNDA BORGES SANTANA',[10,11]],['WILKENS DA MOTA FRANCO',[10,11]],['ANDRESA MELO PEREIRA',[2]]]
  for (const [nome,dias] of alvos){
    const s=await g(`servidores?select=id&nome=eq.${encodeURIComponent(nome)}`)
    if(!s.length){console.log('nao achei',nome);continue}
    const em=await g(`escala_mensal?select=id&servidor_id=eq.${s[0].id}&mes=eq.6&ano=eq.2026`)
    if(!em.length){console.log('sem escala_mensal',nome);continue}
    const ids=em.map(e=>e.id).join(',')
    const rows=await g(`escala_diaria?select=dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_saida_manual,dicionario_turnos(codigo)&escala_mensal_id=in.(${ids})&dia=in.(${dias.join(',')})&order=dia,categoria`)
    console.log(`\n=== ${nome} — dias ${dias.join(',')}/06/2026 — ${rows.length} turno(s) ===`)
    for(const d of rows){
      console.log(`  dia ${d.dia} | ${String(d.categoria).padEnd(10)} | cod ${d.dicionario_turnos?.codigo||'-'}`)
      console.log(`      entrada: ${hora(d.presenca_entrada_em)}`)
      console.log(`      saida:   ${hora(d.presenca_saida_em)}  (manual=${d.presenca_saida_manual})`)
    }
  }
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1)})
