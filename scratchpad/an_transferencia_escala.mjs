import { get } from './q.mjs'

const NOMES = ['ANDRE BARBOSA PIMENTEL', 'ISAAC PRADO RAMOS', 'KETHURY CHAVES', 'LARA COSTA SOUSA', 'MARCELO DE SOUZA CARDOSO']

const uni = await get('unidades?select=id,nome')
const mapU = Object.fromEntries(uni.map(u => [u.id, u.nome]))
const set = await get('setores?select=id,unidade_id,parent_id,dicionario_setores(nome)')
const mapS = Object.fromEntries(set.map(s => [s.id, (Array.isArray(s.dicionario_setores) ? s.dicionario_setores[0] : s.dicionario_setores)?.nome || '?']))

const servs = await get('servidores?select=id,nome,matricula,unidade_id,setor_id,status')
const alvos = servs.filter(s => NOMES.some(n => (s.nome || '').toUpperCase().includes(n)))

console.log('=== LOTACAO ATUAL (cadastro) ===')
for (const s of alvos) {
  console.log(`${s.nome.slice(0,32).padEnd(32)} mat.${String(s.matricula).padEnd(7)} -> ${mapU[s.unidade_id]} / ${mapS[s.setor_id] || '(sem setor)'}`)
}

console.log('\n=== ESCALAS DELES (todas as competencias) ===')
for (const s of alvos) {
  const ems = await get(`escala_mensal?select=id,mes,ano,unidade_id,setor_id,status&servidor_id=eq.${s.id}&order=ano.asc,mes.asc`)
  for (const em of ems) {
    const dias = await get(`escala_diaria?select=dia,categoria,presenca_entrada_em&escala_mensal_id=eq.${em.id}`)
    const comPonto = dias.filter(d => d.presenca_entrada_em).length
    const foraDaLotacao = em.setor_id !== s.setor_id
    console.log(
      `${s.nome.slice(0,24).padEnd(24)} ${String(em.mes).padStart(2,'0')}/${em.ano} ${String(em.status||'').padEnd(9)} ` +
      `${(mapS[em.setor_id]||'?').slice(0,26).padEnd(26)} | linhas=${String(dias.length).padStart(3)} comPonto=${String(comPonto).padStart(3)}` +
      (foraDaLotacao ? '  <<< SETOR != LOTACAO' : '')
    )
  }
}

console.log('\n=== HISTORICO DE TRANSFERENCIAS DELES ===')
for (const s of alvos) {
  const h = await get(`historico_transferencias?select=data_transferencia,unidade_origem_id,setor_origem_id,unidade_destino_id,setor_destino_id,motivo,created_at&servidor_id=eq.${s.id}&order=data_transferencia.asc`)
  if (!h.length) { console.log(`${s.nome.slice(0,24).padEnd(24)} (nenhuma)`); continue }
  for (const t of h) {
    console.log(`${s.nome.slice(0,24).padEnd(24)} ${t.data_transferencia} | ${(mapS[t.setor_origem_id]||'?').slice(0,22)} -> ${(mapS[t.setor_destino_id]||'?').slice(0,22)} | criado ${String(t.created_at).slice(0,16)}`)
  }
}
