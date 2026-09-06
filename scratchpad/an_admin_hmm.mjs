import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(path){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${path}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(path+' -> '+(await r.text()).slice(0,200));const p=await r.json();out.push(...p);if(p.length<1000)break}return out}

const admins = await todas('rep_administradores_parque?select=*')
const a = admins[0]
const sv = (await todas(`servidores?id=eq.${a.servidor_id}&select=id,nome,matricula,cpf,pis_pasep,unidade_id,setor_id,status`))[0]
const disp = await todas('dispositivos_rep?select=id,nome,unidade_id,ativo,created_at&order=nome')
const nomeDisp = Object.fromEntries(disp.map(d=>[d.id,d.nome]))
console.log(`=== administrador do parque ===`)
console.log(`${sv.nome} | mat ${sv.matricula} | cpf ${sv.cpf} | pis ${sv.pis_pasep} | status ${sv.status}`)
console.log(`relogio onde o ponto dele vale: ${nomeDisp[a.dispositivo_ponto_id]}`)

console.log('\n=== onde ele esta cadastrado hoje (snapshot de TODOS os relogios) ===')
const snap = await todas(`rep_usuarios_dispositivo?servidor_id=eq.${sv.id}&select=dispositivo_id,identificador_afd,nome_no_device,tem_biometria,atualizado_em`)
if (!snap.length) console.log('  NENHUM relogio do parque tem cadastro dele resolvido para este servidor_id')
for (const s of snap) console.log(`  ${(nomeDisp[s.dispositivo_id]||'?').padEnd(24)} ident=${s.identificador_afd} digital=${s.tem_biometria}`)

// tambem por identificador cru (caso o servidor_id nao tenha sido resolvido)
const idents = [sv.cpf ? String(sv.cpf).replace(/\D/g,'').padStart(12,'0') : null,
                sv.pis_pasep ? String(sv.pis_pasep).replace(/\D/g,'').padStart(12,'0') : null].filter(Boolean)
console.log(`\n=== busca por identificador cru (${idents.join(' , ')}) ===`)
for (const i of idents) {
  const achados = await todas(`rep_usuarios_dispositivo?identificador_afd=eq.${i}&select=dispositivo_id,nome_no_device,tem_biometria,servidor_id`)
  if (!achados.length) console.log(`  ${i}: nenhum relogio`)
  for (const x of achados) console.log(`  ${i}: ${(nomeDisp[x.dispositivo_id]||'?').padEnd(24)} nome_no_device="${x.nome_no_device}" digital=${x.tem_biometria} servidor_resolvido=${!!x.servidor_id}`)
}

console.log('\n=== excecoes de ponto dele ===')
const exc = await todas(`rep_excecoes_ponto?servidor_id=eq.${sv.id}&select=dispositivo_id,motivo,created_at`)
console.log(`total=${exc.length} de ${disp.filter(d=>d.ativo).length} relogios ativos`)
const comExc = new Set(exc.map(e=>e.dispositivo_id))
const semExc = disp.filter(d=>d.ativo && !comExc.has(d.id))
console.log('SEM excecao (ou seja: batida ali vira ponto dele):')
for (const d of semExc) console.log(`  ${d.nome}${d.id===a.dispositivo_ponto_id ? '   <-- o relogio de ponto dele (correto)' : '   <-- ATENCAO'}`)

console.log('\n=== fila de cadastro dele ===')
const fila = await todas(`rep_cadastros_fila?servidor_id=eq.${sv.id}&select=dispositivo_id,status,erro,created_at,processado_em&order=created_at.desc`)
console.log(`total=${fila.length}`)
for (const f of fila.slice(0,12)) console.log(`  ${(nomeDisp[f.dispositivo_id]||'?').padEnd(24)} ${f.status.padEnd(10)} ${f.processado_em||''} ${(f.erro||'').slice(0,80)}`)

console.log('\n=== lotacao dele x setores dos relogios do HMM ===')
const uni = (await todas(`unidades?id=eq.${sv.unidade_id}&select=nome`))[0]
const setor = sv.setor_id ? (await todas(`setores?id=eq.${sv.setor_id}&select=id,dicionario_setores(nome)`))[0] : null
console.log(`unidade=${uni?.nome}  setor=${setor?.dicionario_setores?.nome || '(sem setor)'}`)
