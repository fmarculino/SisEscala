import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const s=(await q(`servidores?select=*&matricula=eq.68184`))[0]
const unis=await q(`unidades?select=id,nome`);const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const setores=await q(`setores?select=id,unidade_id,parent_id,dicionario_setores(nome)`)
const st={};for(const x of setores) st[x.id]={nome:x.dicionario_setores?.nome,parent:x.parent_id,uni:x.unidade_id}
const caminho=id=>{const p=[];let c=id,g=0;while(c&&st[c]&&g++<10){p.unshift(st[c].nome);c=st[c].parent}return p.join(' \ ')}
const jors=await q(`jornadas?select=id,nome,horas_totais,intervalo_minutos`);const jo=Object.fromEntries(jors.map(j=>[j.id,j]))
console.log('=== FICHA ===')
console.log('Nome     :', s.nome)
console.log('Matrícula:', s.matricula)
console.log('CPF      :', s.cpf, '| PIS:', s.pis_pasep)
console.log('Cargo    :', s.cargo, '| Vínculo:', s.tipo_vinculo || s.vinculo)
console.log('Status   :', s.status)
console.log('Lotação  :', un[s.unidade_id], '/', caminho(s.setor_id))
console.log('E-mail   :', s.email, '| Fone:', s.telefone)
const ems=await q(`escala_mensal?select=id,mes,ano,unidade_id,setor_id,jornada_id,status&servidor_id=eq.${s.id}&order=ano,mes`)
console.log('\n=== ESCALAS ===')
for(const e of ems) console.log(`${String(e.mes).padStart(2,'0')}/${e.ano} | ${un[e.unidade_id]} / ${caminho(e.setor_id)} | jornada: ${jo[e.jornada_id]?.nome} | ${e.status}`)
const dispo=await q(`dispositivos_rep?select=id,nome,unidade_id`);const dn=Object.fromEntries(dispo.map(d=>[d.id,d.nome]))
const ms=await q(`marcacoes_ponto?select=ocorrido_em,dispositivo_id,unidade_id&servidor_id=eq.${s.id}&ocorrido_em=gte.2026-09-01&order=ocorrido_em`)
const porRel={};for(const m of ms){const k=`${dn[m.dispositivo_id]||'(terminal)'} [${un[m.unidade_id]}]`;porRel[k]=(porRel[k]||0)+1}
console.log('\n=== BATIDAS EM 09/2026, por relógio ===')
for(const [k,v] of Object.entries(porRel).sort((a,b)=>b[1]-a[1])) console.log(String(v).padStart(4),k)
const loc=s2=>new Date(new Date(s2).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16)
// por dia: onde bateu de dia (07-19) e de noite
console.log('\n=== BATIDAS DIA A DIA ===')
const porDia={}
for(const m of ms){const d=loc(m.ocorrido_em).slice(0,10);(porDia[d]=porDia[d]||[]).push(`${loc(m.ocorrido_em).slice(11)} ${un[m.unidade_id].split(' ')[0]}`)}
for(const [d,v] of Object.entries(porDia)) console.log(d,'|',v.join('  '))
