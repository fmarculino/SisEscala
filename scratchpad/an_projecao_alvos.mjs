import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

const alvos = JSON.parse(fs.readFileSync('scratchpad/_alvos.json','utf8'))
const PASSOS = ['entrada','int_saida','int_ret','saida']

async function projecao(servidor, data) {
  const r = await fetch(`${U}/rest/v1/rpc/fn_projecao_marcacoes_dia`, {
    method:'POST', headers:H, body: JSON.stringify({ p_servidor_id: servidor, p_data: data })
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}
async function atual(escalaMensalId, dia) {
  const r = await fetch(`${U}/rest/v1/escala_diaria?select=id,categoria,presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em&escala_mensal_id=eq.${escalaMensalId}&dia=eq.${dia}`, { headers:H })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}
const campoAtual = { entrada:'presenca_entrada_em', int_saida:'presenca_intervalo_saida_em', int_ret:'presenca_intervalo_retorno_em', saida:'presenca_saida_em' }
const campoProj  = { entrada:'entrada_em', int_saida:'int_saida_em', int_ret:'int_ret_em', saida:'saida_em' }

let ganhos=0, trocas=0, perdas=0, iguais=0, semProjecao=0, naoConfirmada=0
const detGanho=[], detTroca=[], detPerda=[]
const t0 = Date.now()
let n=0

const fila = [...alvos]
async function worker() {
  while (fila.length) {
    const a = fila.shift()
    const data = `${2026}-09-${String(a.dia).padStart(2,'0')}`
    let proj, cur
    try { [proj, cur] = await Promise.all([projecao(a.servidor_id, data), atual(a.id, a.dia)]) }
    catch (e) { console.error('erro', a.servidor_id, data, e.message); continue }
    n++
    if (!proj.length) { semProjecao++; continue }
    const byId = new Map(cur.map(l => [l.id, l]))
    for (const p of proj) {
      if (!p.confirmada) { naoConfirmada++; continue }
      const l = byId.get(p.escala_diaria_id); if (!l) continue
      for (const passo of PASSOS) {
        const novo = p[campoProj[passo]], velho = l[campoAtual[passo]]
        if (!novo && !velho) continue
        if (novo && !velho) { ganhos++; if(detGanho.length<6) detGanho.push({servidor:a.servidor_id,dia:a.dia,cat:l.categoria,passo,novo}) }
        else if (!novo && velho) { perdas++; if(detPerda.length<12) detPerda.push({servidor:a.servidor_id,dia:a.dia,cat:l.categoria,passo,velho}) }
        else if (new Date(novo).getTime() !== new Date(velho).getTime()) { trocas++; if(detTroca.length<12) detTroca.push({servidor:a.servidor_id,dia:a.dia,cat:l.categoria,passo,velho,novo}) }
        else iguais++
      }
    }
  }
}
await Promise.all([worker(),worker(),worker(),worker()])
console.log(`pares avaliados: ${n} em ${((Date.now()-t0)/1000).toFixed(1)}s`)
console.log(`\nprojecao vazia (nenhuma linha)      : ${semProjecao}`)
console.log(`linhas projetadas NAO confirmadas   : ${naoConfirmada}`)
console.log(`\ncampos IGUAIS ao que ja esta gravado: ${iguais}`)
console.log(`campos GANHOS (vazio -> preenchido) : ${ganhos}`)
console.log(`campos TROCADOS (valor -> outro)    : ${trocas}`)
console.log(`campos PERDIDOS (valor -> vazio)    : ${perdas}`)
console.log('\nexemplos de GANHO:'); detGanho.forEach(d=>console.log(' ', JSON.stringify(d)))
console.log('\nexemplos de TROCA:'); detTroca.forEach(d=>console.log(' ', JSON.stringify(d)))
console.log('\nexemplos de PERDA:'); detPerda.forEach(d=>console.log(' ', JSON.stringify(d)))
