import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(`${p} ${r.status} ${await r.text()}`);const x=await r.json();o.push(...x);if(x.length<1000)break}return o}
async function rpc(fn,b){const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();return r.ok?JSON.parse(t):`ERRO ${r.status} ${t}`}
const D1='8b6f1a36-b48a-4998-8fe0-2503f2443f49', D2='a874f789-8ec7-4295-84c6-487597c76efc'
const agora=new Date().toISOString()
console.log('medido em',agora,'\n')

console.log('=== 1. SUBSTITUICAO REGISTRADA? ===')
const sub = await q(`dispositivos_rep_substituicoes?select=*&dispositivo_id=eq.${D2}`)
console.log(sub.length? JSON.stringify(sub,null,1) : '  NENHUMA')

console.log('\n=== 2. ESTADO DOS DISPOSITIVOS ===')
for(const d of await q(`dispositivos_rep?select=nome,geracao_atual,ultimo_nsr,ultimo_contato_em,updated_at,deriva_segundos,coletor_versao&nome=ilike.*CAF*&order=nome`))
  console.log(' ',JSON.stringify(d))

console.log('\n=== 3. CURSOR DE NSR ===')
for(const [n,id] of [['CAF-01',D1],['CAF-02',D2]]) console.log(' ',n,'->',await rpc('fn_cursor_afd_dispositivo',{p_dispositivo_id:id}))

console.log('\n=== 4. AFD POR GERACAO ===')
for(const [n,id] of [['CAF-01',D1],['CAF-02',D2]]) for(const g of [1,2,3]){
  const r=await fetch(`${U}/rest/v1/rep_afd_registros?select=nsr,ocorrido_em&dispositivo_id=eq.${id}&geracao=eq.${g}&order=nsr.desc&limit=1`,{headers:{...H,Prefer:'count=exact'}})
  const c=r.headers.get('content-range'), rows=await r.json()
  if(rows.length) console.log(`  ${n} g${g}: ${c.split('/')[1]} registros | maiorNSR=${rows[0].nsr} | ultimo ocorrido_em=${rows[0].ocorrido_em}`)
}

console.log('\n=== 5. SINCRONIZACOES DO CAF-02 (ultimas 8) ===')
for(const s of await q(`rep_sincronizacoes?select=iniciada_em,status,nsr_inicial,nsr_final,linhas_recebidas,linhas_novas,linhas_duplicadas,marcacoes_criadas,marcacoes_orfas,mensagem_erro,coletor_versao&dispositivo_id=eq.${D2}&order=iniciada_em.desc&limit=8`))
  console.log('  ',JSON.stringify(s))

console.log('\n=== 6. SNAPSHOT NO EQUIPAMENTO ===')
for(const [n,id] of [['CAF-01',D1],['CAF-02',D2]]){
  const s=await q(`rep_usuarios_dispositivo?select=identificador_afd,tem_biometria,servidor_id,nome_no_device,atualizado_em&dispositivo_id=eq.${id}`)
  const at=s.map(x=>x.atualizado_em).sort().pop()
  console.log(`  ${n}: ${s.length} cadastros | ${s.filter(x=>x.tem_biometria).length} com digital | ${s.filter(x=>x.servidor_id).length} resolvidos | lido em ${at}`)
  fs.writeFileSync(`scratchpad/_caf_pos_${n}.json`,JSON.stringify(s,null,1))
}

console.log('\n=== 7. VINCULOS VIGENTES ===')
for(const [n,id] of [['CAF-01',D1],['CAF-02',D2]]){
  const v=await q(`rep_vinculos_servidor?select=servidor_id,tem_biometria,vigente_de&dispositivo_id=eq.${id}&vigente_ate=is.null`)
  console.log(`  ${n}: ${v.length} vigentes | ${v.filter(x=>x.tem_biometria).length} com biometria`)
}

console.log('\n=== 8. FILA DE CADASTROS DO CAF-02 ===')
const f=await q(`rep_cadastros_fila?select=status,created_at,processado_em,erro,servidor_id&dispositivo_id=eq.${D2}&order=created_at.desc`)
const by={}; for(const x of f){const k=`${x.created_at.slice(0,10)} ${x.status}`;by[k]=(by[k]||0)+1}
console.log(' ',JSON.stringify(by))
const erros=f.filter(x=>x.status!=='enviado'&&x.erro).slice(0,6)
for(const e of erros) console.log('   ERRO:',String(e.erro).slice(0,180),'|',e.processado_em)

console.log('\n=== 9. COPIAS DE BIOMETRIA (ultimas 24h) ===')
const cop=await q(`rep_biometria_copias?select=origem_id,destino_id,status,erro,formato_usado,created_at&or=(origem_id.eq.${D2},destino_id.eq.${D2})&order=created_at.desc&limit=30`)
const nm={[D1]:'CAF-01',[D2]:'CAF-02'}
const st={}; for(const c of cop) st[`${nm[c.origem_id]||'?'}->${nm[c.destino_id]||'?'} ${c.status}`]=(st[`${nm[c.origem_id]||'?'}->${nm[c.destino_id]||'?'} ${c.status}`]||0)+1
console.log(' ',JSON.stringify(st))
for(const c of cop.slice(0,5)) console.log('   ',c.created_at,c.status,c.formato_usado||'',String(c.erro||'').slice(0,140))

console.log('\n=== 10. BIOMETRIA FALTANTE (fila da copia automatica) ===')
for(const [n,id] of [['CAF-01',D1],['CAF-02',D2]]){
  const r=await rpc('fn_biometria_faltante_dispositivo',{p_destino_id:id})
  console.log(` ${n} -> ${Array.isArray(r)?r.length+' pendencias':r}`)
  if(Array.isArray(r)) for(const x of r.slice(0,8)) console.log('    ',JSON.stringify(x).slice(0,200))
}

console.log('\n=== 11. COBERTURA DE PONTO 09/2026 ===')
for(const [n,id] of [['CAF-01',D1],['CAF-02',D2]]){
  const cd=await rpc('fn_cobertura_ponto_dispositivo',{p_dispositivo_id:id,p_mes:9,p_ano:2026})
  if(!Array.isArray(cd)){console.log(n,cd);continue}
  const b={}; for(const x of cd) b[x.situacao]=(b[x.situacao]||0)+1
  console.log(` ${n}: ${JSON.stringify(b)} | total ${cd.length}`)
  for(const x of cd.filter(x=>x.situacao!=='ok')) console.log('    ',x.situacao,'|',x.servidor_nome,'mat',x.matricula)
}
