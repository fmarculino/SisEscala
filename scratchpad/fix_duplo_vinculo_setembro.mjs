// Corrige 09/2026 para quem tem duplo vinculo, por LISTA FECHADA e com ensaio antes/depois.
//
//   node scratchpad/fix_duplo_vinculo_setembro.mjs           -> ENSAIO (nao escreve nada)
//   node scratchpad/fix_duplo_vinculo_setembro.mjs --aplicar  -> aplica
//
// ⚠️ NUNCA reconciliar em massa (armadilha 46): a lista e fechada nos pares (servidor, dia) das
// pessoas com cadastro irmao, e cada campo e classificado em ganho / troca / perda ANTES de
// escrever. "Perda" nem sempre e perda — pode ser a mesma batida mudando de passo — entao o
// ensaio imprime linha a linha para leitura humana.
import fs from 'fs'

const APLICAR = process.argv.includes('--aplicar')
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }

async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r = await fetch(`${U}/rest/v1/${p}`,{headers:{...H, Range:`${f}-${f+999}`}})
  if(!r.ok){ console.error('ERRO',p.slice(0,90),r.status,(await r.text()).slice(0,300)); process.exit(1) }
  const pg = await r.json(); out.push(...pg); if(pg.length<1000) break } return out }
async function rpc(f,b){ const r = await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)})
  if(!r.ok){ return { erro: `${r.status} ${(await r.text()).slice(0,200)}` } } return { dado: await r.json() } }

const tz = 'America/Sao_Paulo'
const hm = v => v ? new Intl.DateTimeFormat('pt-BR',{timeZone:tz,hour:'2-digit',minute:'2-digit'}).format(new Date(v)) : '—'
const CAMPOS = ['presenca_entrada_em','presenca_intervalo_saida_em','presenca_intervalo_retorno_em','presenca_saida_em']
const NOMES  = ['entrada','saida_int','retorno_int','saida']
// ⚠️ fn_projecao_marcacoes_dia NAO devolve as colunas com o nome de escala_diaria: sao
// entrada_em / int_saida_em / int_ret_em / saida_em. Ler pelo nome errado faz TODO campo virar
// null e o ensaio classificar tudo como PERDA — foi o que a primeira rodada fez (193 perdas,
// 0 ganhos), e e exatamente o motivo de o ensaio existir.
const PROJ = ['entrada_em','int_saida_em','int_ret_em','saida_em']

const grupos = JSON.parse(fs.readFileSync('scratchpad/_dup_ids.json','utf8'))
const ids = grupos.flatMap(g => g.ids)
const nome = {}; for (const g of grupos) g.ids.forEach((id,i) => nome[id] = `${g.nome.trim()} mat ${g.mats[i]}`)

// Universo: pares (servidor, dia) de 09/2026 com turno lancado, das pessoas com cadastro irmao.
const em = await q(`escala_mensal?select=id,servidor_id&servidor_id=in.(${ids.join(',')})&mes=eq.9&ano=eq.2026`)
if (!em.length) { console.log('nenhuma escala de 09/2026 para esses servidores'); process.exit(0) }
const emServ = Object.fromEntries(em.map(e => [e.id, e.servidor_id]))
const ed = await q(`escala_diaria?select=id,escala_mensal_id,dia,categoria,${CAMPOS.join(',')}&escala_mensal_id=in.(${em.map(e=>e.id).join(',')})`)

const hoje = Number(new Intl.DateTimeFormat('en-CA',{timeZone:tz,day:'2-digit'}).format(new Date()))
// EDILEUZA LIMA FARIAS (mat 67454 e 15892), 01/09/2026 — o unico dia da base com escala
// sobreposta entre matriculas da mesma pessoa.
const EXCLUIR = new Set((process.env.SEM_EXCLUSAO ? [] : [
  'c46ae3', '4558b1',
].map(pref => {
  const id = ids.find(x => x.startsWith(pref))
  return id ? `${id}|1` : null
}).filter(Boolean)))
const pares = new Map()
for (const d of ed) {
  if (d.dia > hoje) continue                       // dia futuro nao tem o que reconciliar
  const s = emServ[d.escala_mensal_id]
  // EXCLUSAO EXPLICITA: dia com escala SOBREPOSTA entre as duas matriculas (dois plantoes N
  // simultaneos no mesmo setor). O previsto esta errado, entao reconciliar contra ele troca um
  // erro por outro — e apagaria entrada e intervalo ja gravados. Sai da lista ate o coordenador
  // corrigir a escala; depois disso basta rodar de novo.
  if (EXCLUIR.has(`${s}|${d.dia}`)) continue
  pares.set(`${s}|${d.dia}`, { servidor_id: s, dia: d.dia })
}
console.log(`${APLICAR ? 'APLICANDO' : 'ENSAIO (nada sera escrito)'} — ${pares.size} pares (servidor, dia) em 09/2026, ate o dia ${hoje}\n`)

// Estado ANTES, por (escala_diaria.id)
const antes = Object.fromEntries(ed.map(d => [d.id, d]))

let ganhos = 0, trocas = 0, perdas = 0, iguais = 0
const linhas = []

for (const [, p] of pares) {
  const proj = await rpc('fn_projecao_marcacoes_dia', { p_servidor_id: p.servidor_id, p_data: `2026-09-${String(p.dia).padStart(2,'0')}` })
  if (proj.erro) { console.error(`  projecao falhou ${nome[p.servidor_id]} dia ${p.dia}: ${proj.erro}`); continue }
  const linhasProj = Array.isArray(proj.dado) ? proj.dado : []
  for (const lp of linhasProj) {
    const a = antes[lp.escala_diaria_id]
    if (!a) continue
    for (let i = 0; i < CAMPOS.length; i++) {
      const de = a[CAMPOS[i]] || null
      const para = lp[PROJ[i]] || null
      if (de === para) { iguais++; continue }
      const tipo = !de && para ? 'GANHO' : (de && !para ? 'PERDA' : 'TROCA')
      if (tipo === 'GANHO') ganhos++; else if (tipo === 'PERDA') perdas++; else trocas++
      linhas.push(`  ${tipo.padEnd(5)} ${String(nome[p.servidor_id]).padEnd(46)} dia ${String(p.dia).padStart(2)} ${NOMES[i].padEnd(11)} ${hm(de).padStart(5)} -> ${hm(para).padStart(5)}`)
    }
  }
}

console.log(`campos iguais: ${iguais}`)
console.log(`GANHO (vazio -> preenchido): ${ganhos}`)
console.log(`TROCA (mudou de horario):    ${trocas}`)
console.log(`PERDA (preenchido -> vazio): ${perdas}\n`)
linhas.sort().forEach(l => console.log(l))

if (!APLICAR) {
  console.log(`\n(ensaio: nada foi escrito. Para aplicar: node scratchpad/fix_duplo_vinculo_setembro.mjs --aplicar)`)
  process.exit(0)
}

console.log(`\n--- aplicando fn_reconciliar_marcacoes_dia par a par ---`)
let ok = 0, err = 0
for (const [, p] of pares) {
  const r = await rpc('fn_reconciliar_marcacoes_dia', { p_servidor_id: p.servidor_id, p_data: `2026-09-${String(p.dia).padStart(2,'0')}` })
  if (r.erro) { err++; console.error(`  ERRO ${nome[p.servidor_id]} dia ${p.dia}: ${r.erro}`) } else ok++
}
console.log(`reconciliados: ${ok} | erros: ${err}`)
