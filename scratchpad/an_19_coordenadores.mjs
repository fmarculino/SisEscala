/** LEITURA de producao (autorizada). O que cada um dos 19 coordenadores DE FATO toca. */
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(`${p} -> ${r.status}`);const d=await r.json();o.push(...d);if(d.length<1000)break}return o}

const perfis   = await todas('profiles?select=id,full_name,role,servidor_id,acesso_todas_unidades,acesso_todos_setores,profile_unidades(unidade_id),profile_setores(setor_id)')
const servid   = await todas('servidores?select=id,nome,unidade_id,setor_id,cargo')
const setores  = await todas('setores?select=id,unidade_id,parent_id,ativo,dicionario_setores(nome)')
const unidades = await todas('unidades?select=id,nome')
const logs     = await todas('logs_sistema?select=user_id,setor_id,unidade_id,acao')
const just     = await todas('justificativas_eventos?select=registrado_por_id,setor_id,unidade_id')
const folhas   = await todas('folha_ponto?select=escala_mensal_id,gerado_por_id,ultima_edicao_por_id')
const em       = await todas('escala_mensal?select=id,setor_id,unidade_id')

const nomeU = new Map(unidades.map(u => [u.id, u.nome]))
const nomeS = new Map(setores.map(s => {
  const d = Array.isArray(s.dicionario_setores) ? s.dicionario_setores[0] : s.dicionario_setores
  return [s.id, d?.nome || '(sem nome)']
}))
const setoresAtivosDaUnid = new Map()
for (const s of setores) if (s.ativo !== false)
  (setoresAtivosDaUnid.get(s.unidade_id) ?? setoresAtivosDaUnid.set(s.unidade_id, []).get(s.unidade_id)).push(s.id)
const servPorId = new Map(servid.map(s => [s.id, s]))
const emPorId   = new Map(em.map(e => [e.id, e]))

// Setores tocados por pessoa, de tres fontes independentes.
const tocados = new Map()
const marca = (uid, sid) => { if (!uid || !sid) return; (tocados.get(uid) ?? tocados.set(uid, new Set()).get(uid)).add(sid) }
for (const l of logs) marca(l.user_id, l.setor_id)
for (const j of just) marca(j.registrado_por_id, j.setor_id)
for (const f of folhas) {
  const e = emPorId.get(f.escala_mensal_id); if (!e) continue
  marca(f.gerado_por_id, e.setor_id); marca(f.ultima_edicao_por_id, e.setor_id)
}

const alvos = perfis.filter(p => p.role === 'coordenador' && p.acesso_todos_setores &&
  !p.acesso_todas_unidades && (p.profile_unidades?.length ?? 0) > 0)
alvos.sort((a,b) => (a.full_name??'').localeCompare(b.full_name??''))

console.log(`\n${alvos.length} coordenadores "unidade inteira". O que cada um TOCA:\n`)
console.log('COORDENADOR'.padEnd(32) + 'LOTACAO PROPRIA (setor)'.padEnd(34) + 'SET.UNID'.padStart(9) + 'TOCA'.padStart(6) + '  SETORES QUE TOCA')
console.log('-'.repeat(122))

const resumo = { semLotacao: 0, tocaZero: 0, tocaUm: 0, tocaPoucos: 0, tocaMuitos: 0 }
for (const p of alvos) {
  const s = p.servidor_id ? servPorId.get(p.servidor_id) : null
  const lot = s ? (nomeS.get(s.setor_id) ?? '(sem setor)') : '(SEM VINCULO servidor)'
  const unids = (p.profile_unidades ?? []).map(x => x.unidade_id)
  const nSetUnid = unids.reduce((a, u) => a + (setoresAtivosDaUnid.get(u)?.length ?? 0), 0)
  const t = [...(tocados.get(p.id) ?? new Set())]
  const nomes = t.map(x => nomeS.get(x) ?? '?').sort()
  console.log(
    (p.full_name ?? '(sem nome)').slice(0,30).padEnd(32) +
    lot.slice(0,32).padEnd(34) +
    String(nSetUnid).padStart(9) + String(t.length).padStart(6) + '  ' +
    (nomes.length ? nomes.slice(0,3).join(' | ').slice(0,58) + (nomes.length>3?` (+${nomes.length-3})`:'') : '—')
  )
  if (!s) resumo.semLotacao++
  if (t.length === 0) resumo.tocaZero++
  else if (t.length === 1) resumo.tocaUm++
  else if (t.length <= 3) resumo.tocaPoucos++
  else resumo.tocaMuitos++
}

console.log(`\n  sem vinculo servidor: ${resumo.semLotacao}`)
console.log(`  tocam 0 setores: ${resumo.tocaZero}   |  1 setor: ${resumo.tocaUm}  |  2-3: ${resumo.tocaPoucos}  |  4+: ${resumo.tocaMuitos}`)
