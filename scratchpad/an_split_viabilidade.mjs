import { get } from './q.mjs'

// 1. Duas escalas do MESMO servidor no MESMO mes, em setores diferentes: ja existe?
const ems = await get('escala_mensal?select=id,servidor_id,mes,ano,unidade_id,setor_id,status&mes=eq.9&ano=eq.2026')
const porChave = {}
for (const e of ems) (porChave[`${e.servidor_id}`] ||= []).push(e)
const multi = Object.entries(porChave).filter(([, v]) => v.length > 1)
console.log('09/2026: escalas mensais =', ems.length, '| servidores com 2+ escalas =', multi.length)

const dupExata = Object.values(porChave).flatMap(v => {
  const chaves = v.map(e => `${e.setor_id}`)
  return chaves.length !== new Set(chaves).size ? [v[0].servidor_id] : []
})
console.log('mesmo servidor 2x no MESMO setor/mes (violaria unique) =', dupExata.length)

// 2. folha_ponto: e por escala_mensal ou por servidor/mes?
const fp = await get('folha_ponto?select=id,servidor_id,mes,ano,escala_mensal_id,unidade_id,setor_id,status&mes=eq.9&ano=eq.2026&limit=1')
console.log('\nfolha_ponto colunas de uma linha 09/2026:', fp.length ? Object.keys(fp[0]).join(', ') : '(nenhuma linha)')

// quantas folhas por servidor no mes -- se for 1 por servidor, split cria conflito
const fps = await get('folha_ponto?select=servidor_id,mes,ano,setor_id&mes=eq.8&ano=eq.2026')
const porServ = {}
for (const f of fps) (porServ[f.servidor_id] ||= []).push(f)
const varias = Object.values(porServ).filter(v => v.length > 1)
console.log('08/2026: folhas =', fps.length, '| servidores com 2+ folhas =', varias.length)
if (varias.length) console.log('  exemplo setores:', varias[0].map(f => f.setor_id).join(' | '))

// 3. Servidores hoje escalados em setor != lotacao (o "Servidor Externo" ou escala orfa)
const servs = await get('servidores?select=id,setor_id,status')
const mapLot = Object.fromEntries(servs.map(s => [s.id, s.setor_id]))
const fora = ems.filter(e => mapLot[e.servidor_id] && e.setor_id !== mapLot[e.servidor_id])
console.log('\n09/2026: escalas em setor != lotacao do servidor =', fora.length, 'de', ems.length)
