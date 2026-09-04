import { get } from './q.mjs'
const DEST = 'a465e8bd-c455-440b-840b-b94483a13d2a' // MAIS MEDICOS
const ORIG = '30d7ba9f-8a39-4733-892c-15816b270325' // AMBULATORIO CLINICO
const IDS = ['94bc8432-cd4a-4607-b6a8-bc3b0bf3b06a','9b807461-8171-482b-b28b-08693d3a69d4',
             '3076e4b4-2d7f-4042-866f-edc530ad8ab6','dcf5f276-6913-4acd-b252-c5d574ba916c']

const servs = await get('servidores?select=id,nome')
const mapS = Object.fromEntries(servs.map(s => [s.id, s.nome]))

console.log('=== 1) As 4 escalas de 09/2026 ===')
for (const id of IDS) {
  const em = (await get(`escala_mensal?select=id,servidor_id,mes,ano,setor_id,status&id=eq.${id}`))[0]
  if (!em) { console.log(`  ${id} NAO ENCONTRADA`); continue }
  const dias = await get(`escala_diaria?select=dia,presenca_entrada_em&escala_mensal_id=eq.${id}`)
  const ok = em.setor_id === DEST
  console.log(`  ${ok ? 'OK ' : 'ERRO'} ${(mapS[em.servidor_id]||'?').slice(0,30).padEnd(30)} ${String(em.mes).padStart(2,'0')}/${em.ano} ${em.status.padEnd(9)} dias=${String(dias.length).padStart(2)} comPonto=${dias.filter(d=>d.presenca_entrada_em).length} ${ok ? '-> MAIS MEDICOS' : '-> setor ' + em.setor_id}`)
}

console.log('\n=== 2) 08/2026 tem de continuar no AMBULATORIO CLINICO ===')
for (const sid of [...new Set((await Promise.all(IDS.map(async id => (await get(`escala_mensal?select=servidor_id&id=eq.${id}`))[0]?.servidor_id))).filter(Boolean))]) {
  const ems = await get(`escala_mensal?select=id,mes,ano,setor_id,status&servidor_id=eq.${sid}&mes=eq.8&ano=eq.2026`)
  for (const em of ems) {
    const dias = await get(`escala_diaria?select=dia&escala_mensal_id=eq.${em.id}`)
    console.log(`  ${em.setor_id === ORIG ? 'OK ' : 'ERRO'} ${(mapS[sid]||'?').slice(0,30).padEnd(30)} 08/2026 ${em.status.padEnd(9)} dias=${dias.length}`)
  }
}

console.log('\n=== 3) Historico gravado ===')
const mov = await get('escala_mensal_movimentos?select=tipo,servidor_id,mes,ano,dias_movidos,dias_com_ponto,movido_por,justificativa')
console.log('linhas =', mov.length)
for (const m of mov) console.log(`  ${m.tipo} ${(mapS[m.servidor_id]||'?').slice(0,28).padEnd(28)} ${String(m.mes).padStart(2,'0')}/${m.ano} dias=${m.dias_movidos} ponto=${m.dias_com_ponto} por=${m.movido_por || '(migration)'}`)

console.log('\n=== 4) Folha seguiu junto (sem regerar) ===')
for (const id of IDS) {
  const f = await get(`folha_ponto?select=servidor_id,mes,ano,status&escala_mensal_id=eq.${id}`)
  console.log(`  ${(mapS[(await get(`escala_mensal?select=servidor_id&id=eq.${id}`))[0]?.servidor_id]||'?').slice(0,28).padEnd(28)} ${f.map(x=>`${String(x.mes).padStart(2,'0')}/${x.ano}:${x.status}`).join(', ') || '(sem folha)'}`)
}

console.log('\n=== 5) Nada ficou orfao no AMBULATORIO CLINICO em 09/2026 ===')
const restam = await get(`escala_mensal?select=id,servidor_id&setor_id=eq.${ORIG}&mes=eq.9&ano=eq.2026`)
console.log('escalas restantes no AMBULATORIO CLINICO em 09/2026 =', restam.length)
for (const r of restam) console.log(`  - ${mapS[r.servidor_id] || r.servidor_id}`)
