import { get } from './q.mjs'

const profiles = await get('profiles?select=id,full_name,role,acesso_todas_unidades,acesso_todos_setores&order=role.asc')
const pu = await get('profile_unidades?select=profile_id,unidade_id')
const uni = await get('unidades?select=id,nome')
const mapU = Object.fromEntries(uni.map(u => [u.id, u.nome]))
const porPerfil = {}
for (const r of pu) (porPerfil[r.profile_id] ||= []).push(mapU[r.unidade_id] || r.unidade_id)

const cont = {}
for (const p of profiles) cont[p.role] = (cont[p.role] || 0) + 1
console.log('--- contagem por papel ---')
console.log(cont)

console.log('\n--- Diretor (admin) e RH da Unidade: escopo declarado ---')
for (const p of profiles.filter(p => ['admin', 'rh_unidade'].includes(p.role))) {
  const u = porPerfil[p.id] || []
  console.log(
    `${p.role.padEnd(11)} | ${(p.full_name||'(sem nome)').slice(0,34).padEnd(34)} | todasUni=${String(p.acesso_todas_unidades).padEnd(5)} todosSet=${String(p.acesso_todos_setores).padEnd(5)} | profile_unidades=${u.length}${u.length ? ' -> ' + u.join(', ') : '  <<< VAZIO'}`
  )
}

console.log('\n--- solicitacoes de excecao de carga (todas) ---')
const sol = await get('solicitacoes_excecao_carga?select=id,servidor_id,unidade_id,mes,ano,status,solicitado_em&order=solicitado_em.desc')
console.log('total =', sol.length, '| pendentes =', sol.filter(s => s.status === 'pendente').length)
const porUni = {}
for (const s of sol.filter(s => s.status === 'pendente')) porUni[mapU[s.unidade_id] || s.unidade_id] = (porUni[mapU[s.unidade_id] || s.unidade_id] || 0) + 1
console.log('pendentes por unidade:', porUni)

console.log('\n--- excecoes ja concedidas ---')
const ex = await get('excecoes_escala_servidor?select=servidor_id,mes,ano,autorizado_por,unidade_id')
const mapP = Object.fromEntries(profiles.map(p => [p.id, `${p.full_name} (${p.role})`]))
console.log('total =', ex.length)
const porAutor = {}
for (const e of ex) porAutor[mapP[e.autorizado_por] || e.autorizado_por] = (porAutor[mapP[e.autorizado_por] || e.autorizado_por] || 0) + 1
console.log(porAutor)
