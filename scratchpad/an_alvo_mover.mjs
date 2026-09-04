import { get } from './q.mjs'
const NOMES = ['ANDRE BARBOSA PIMENTEL', 'ISAAC PRADO RAMOS', 'KETHURY CHAVES', 'MARCELO DE SOUZA CARDOSO']

const uni = await get('unidades?select=id,nome&nome=like.*ZEZINHA*')
console.log('unidade:', JSON.stringify(uni))
const set = await get('setores?select=id,unidade_id,parent_id,ativo,dicionario_setores(nome)')
const daUni = set.filter(s => uni.some(u => u.id === s.unidade_id))
for (const s of daUni) {
  const n = (Array.isArray(s.dicionario_setores) ? s.dicionario_setores[0] : s.dicionario_setores)?.nome
  console.log(`  setor ${s.id} | ${n} | parent=${s.parent_id} ativo=${s.ativo}`)
}

const servs = await get('servidores?select=id,nome,matricula,unidade_id,setor_id')
const alvos = servs.filter(s => NOMES.some(n => (s.nome || '').toUpperCase().includes(n)))
console.log('\n=== escalas 09/2026 a mover ===')
for (const s of alvos) {
  const ems = await get(`escala_mensal?select=id,mes,ano,unidade_id,setor_id,status,ativo&servidor_id=eq.${s.id}&mes=eq.9&ano=eq.2026`)
  for (const em of ems) {
    console.log(`-- ${s.nome}`)
    console.log(`   escala_mensal ${em.id} status=${em.status} ativo=${em.ativo} setor=${em.setor_id}`)
    console.log(`   lotacao atual do servidor: unidade=${s.unidade_id} setor=${s.setor_id}`)
  }
  // conflito: outra escala do mesmo servidor na mesma competencia?
  const todas = await get(`escala_mensal?select=id,setor_id&servidor_id=eq.${s.id}&mes=eq.9&ano=eq.2026`)
  if (todas.length > 1) console.log(`   ⚠️ ${todas.length} escalas em 09/2026 — checar sobreposicao`)
}
