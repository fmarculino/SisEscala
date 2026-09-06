// Vincula 2 setores que ficaram sem relogio no HMM (06/09/2026).
//   SAME \ APOIO                     -> HMM-01, HMM-02, HMM-03  (predio principal; pai e irmaos ja estao la)
//   CCE \ MEDICOS ESPECIALISTAS      -> CCE-01                  (outro predio)
// NAO toca na ALA - PSICOSSOCIAL (aguarda relogio proprio) nem no CSST (duplicata de cadastro).
// Aborta se o estado divergir do medido. Rode com --aplicar; sem isso e' so ensaio.
import fs from 'fs'
const APLICAR = process.argv.includes('--aplicar')
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(p+' -> '+(await r.text()).slice(0,250));const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
const morrer = m => { console.error('\n🚨 ABORTADO: ' + m); process.exit(1) }

const unis = await todas('unidades?select=id,nome')
const uniHMM = unis.find(u => u.nome.startsWith('HMM'))?.id || morrer('unidade HMM nao encontrada')
const disp = await todas(`dispositivos_rep?unidade_id=eq.${uniHMM}&ativo=eq.true&select=id,nome&order=nome`)
const D = n => disp.find(d => d.nome.includes(n))?.id || morrer(`relogio ${n} nao encontrado/ativo`)
const HMM01 = D('HMM-01'), HMM02 = D('HMM-02'), HMM03 = D('HMM-03'), CCE01 = D('CCE-01')

const setores = await todas(`setores?unidade_id=eq.${uniHMM}&select=id,parent_id,ativo,dicionario_setores(nome)`)
const byId = Object.fromEntries(setores.map(s => [s.id, s]))
const nome = s => s?.dicionario_setores?.nome || '(?)'
const cam = s => { const p=[]; let c=s,g=0; while(c&&g++<10){p.unshift(nome(c)); c=byId[c.parent_id]} return p.join(' \ ') }
const acharPorCaminho = c => { const m = setores.filter(s => cam(s) === c); if (m.length !== 1) morrer(`caminho "${c}" casou com ${m.length} setores (esperado 1)`); return m[0] }

const vincAtual = await todas('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const vinculadoA = sid => vincAtual.filter(v => v.setor_id === sid).map(v => v.dispositivo_id)
const servs = await todas(`servidores?unidade_id=eq.${uniHMM}&status=eq.Ativo&select=id,setor_id`)
const lotados = sid => servs.filter(s => s.setor_id === sid).length

const apoio = acharPorCaminho('SAME \ APOIO')
const same  = acharPorCaminho('SAME')
const medEsp = acharPorCaminho('CCE - CENTRO DE CIRURGIAS ELETIVAS HMM \ MÉDICOS ESPECIALISTAS')

console.log('=== PRE-CONDICOES ===')
const checar = (ok, txt) => { console.log(`  ${ok ? 'ok  ' : 'FALHA'} ${txt}`); if (!ok) morrer(txt) }
checar(apoio.ativo !== false, 'SAME \ APOIO esta ativo')
checar(lotados(apoio.id) === 2, `SAME \ APOIO tem exatamente 2 lotados ativos (achei ${lotados(apoio.id)})`)
checar(vinculadoA(apoio.id).length === 0, `SAME \ APOIO nao esta vinculado a relogio nenhum (achei ${vinculadoA(apoio.id).length})`)
const vSame = vinculadoA(same.id)
checar([HMM01,HMM02,HMM03].every(d => vSame.includes(d)), 'o pai SAME ja esta nos tres relogios do predio principal')
checar(!vSame.includes(CCE01), 'o pai SAME NAO esta no CCE-01 (confirma que e predio principal)')
checar(lotados(medEsp.id) === 1, `CCE \ MEDICOS ESPECIALISTAS tem exatamente 1 lotado (achei ${lotados(medEsp.id)})`)
checar(vinculadoA(medEsp.id).length === 0, 'CCE \ MEDICOS ESPECIALISTAS nao esta vinculado a relogio nenhum')
const vCCEpai = vinculadoA(acharPorCaminho('CCE - CENTRO DE CIRURGIAS ELETIVAS HMM').id)
checar(vCCEpai.length === 1 && vCCEpai[0] === CCE01, 'a raiz do CCE esta vinculada SO ao CCE-01')

const antes = {}
for (const d of disp) antes[d.nome] = vincAtual.filter(v => v.dispositivo_id === d.id).length
console.log('\nsetores por relogio ANTES:', JSON.stringify(antes))

const inserir = [
  { dispositivo_id: HMM01, setor_id: apoio.id }, { dispositivo_id: HMM02, setor_id: apoio.id },
  { dispositivo_id: HMM03, setor_id: apoio.id }, { dispositivo_id: CCE01, setor_id: medEsp.id },
]
console.log('\n=== A APLICAR ===')
for (const i of inserir) console.log(`  ${disp.find(d=>d.id===i.dispositivo_id).nome}  +  ${cam(byId[i.setor_id])}`)
if (!APLICAR) { console.log('\n(ensaio — rode com --aplicar para gravar)'); process.exit(0) }

const r = await fetch(`${U}/rest/v1/dispositivos_rep_setores`, { method:'POST', headers:{...H, Prefer:'return=representation'}, body: JSON.stringify(inserir) })
if (!r.ok) morrer('insert falhou: ' + (await r.text()).slice(0,300))
console.log(`\ngravadas ${(await r.json()).length} linhas`)

// conferencia
const vDepois = await todas('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const vinc2 = sid => vDepois.filter(v => v.setor_id === sid).map(v => v.dispositivo_id)
console.log('\n=== CONFERENCIA ===')
checar([HMM01,HMM02,HMM03].every(d => vinc2(apoio.id).includes(d)), 'SAME \ APOIO agora nos tres do predio principal')
checar(!vinc2(apoio.id).includes(CCE01), 'SAME \ APOIO NAO foi para o CCE-01')
checar(vinc2(medEsp.id).length === 1 && vinc2(medEsp.id)[0] === CCE01, 'CCE \ MEDICOS ESPECIALISTAS so no CCE-01')
const depois = {}
for (const d of disp) depois[d.nome] = vDepois.filter(v => v.dispositivo_id === d.id).length
console.log('setores por relogio DEPOIS:', JSON.stringify(depois))
for (const d of disp) {
  const esperado = antes[d.nome] + (d.id === CCE01 ? 1 : (d.nome.includes('HMM-0') ? 1 : 0))
  checar(depois[d.nome] === esperado, `${d.nome}: ${antes[d.nome]} -> ${depois[d.nome]} (esperado ${esperado})`)
}
// sobreposicao predio principal x CCE tem que continuar zero
const sPrinc = new Set(vDepois.filter(v => v.dispositivo_id === HMM01).map(v => v.setor_id))
const sCCE = vDepois.filter(v => v.dispositivo_id === CCE01).map(v => v.setor_id)
const sobre = sCCE.filter(s => sPrinc.has(s))
checar(sobre.length === 0, `sobreposicao HMM-01 x CCE-01 continua zero (achei ${sobre.length})`)
console.log('\n✅ aplicado e conferido')
