// SOMENTE LEITURA. Confere que as tres migrations de 09/09 estao valendo em producao.
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
const rpc = async (f,b) => { const r = await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)})
  return { ok:r.ok, status:r.status, body: r.ok ? await r.json() : (await r.text()).slice(0,220) } }
const grupos = JSON.parse(fs.readFileSync('scratchpad/_dup_ids.json','utf8'))
const ids = grupos.flatMap(g=>g.ids)
let falhas = 0
const chk = (nome, ok, extra='') => { console.log(`${ok?'  ok  ':' FALHA'}  ${nome}${extra?'  '+extra:''}`); if(!ok) falhas++ }

// 1. 20260909150000
const irm = await rpc('fn_cadastros_irmaos', { p_servidor_ids: ids })
chk('fn_cadastros_irmaos existe', irm.ok, irm.ok?`${irm.body.length} pares`:JSON.stringify(irm.body))
if (irm.ok) {
  const porServ = {}; for(const r of irm.body) (porServ[r.servidor_id] ||= []).push(r.irmao_id)
  chk('devolve par para os 21 grupos', Object.keys(porServ).length >= 40, `${Object.keys(porServ).length} servidores`)
  const assim = irm.body.every(r => (porServ[r.irmao_id]||[]).includes(r.servidor_id))
  chk('relacao simetrica', assim)
}
// anon nao pode
const anon = await fetch(`${U}/rest/v1/rpc/fn_cadastros_irmaos`, {method:'POST',
  headers:{apikey:env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization:`Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,'Content-Type':'application/json'},
  body: JSON.stringify({p_servidor_ids: ids.slice(0,1)})})
chk('anon recusado (armadilha 24)', anon.status === 401 || anon.status === 403 || anon.status === 404, `HTTP ${anon.status}`)

// 2. 20260909140000 - a RPC de conflito acusa a outra matricula
const ed = grupos.find(g => g.nome.includes('EDILEUZA'))
console.log(`\n-- fn_check_shift_conflicts (EDILEUZA 01/09, o caso sobreposto)`)
const em = await (await fetch(`${U}/rest/v1/escala_mensal?select=id,servidor_id&servidor_id=in.(${ed.ids.join(',')})&mes=eq.9&ano=eq.2026`,{headers:H})).json()
const edia = await (await fetch(`${U}/rest/v1/escala_diaria?select=escala_mensal_id,dia,categoria,dicionario_turnos_id&escala_mensal_id=in.(${em.map(e=>e.id).join(',')})&dia=eq.1`,{headers:H})).json()
if (edia.length) {
  const alvo = edia[0]
  const emAlvo = em.find(e => e.id === alvo.escala_mensal_id)
  const c = await rpc('fn_check_shift_conflicts', { p_servidor_id: emAlvo.servidor_id, p_dia: 1, p_mes: 9, p_ano: 2026,
    p_turno_id: alvo.dicionario_turnos_id, p_categoria: alvo.categoria, p_escala_mensal_id: alvo.escala_mensal_id })
  const r0 = c.ok ? (Array.isArray(c.body)?c.body[0]:c.body) : null
  chk('acusa conflito no dia sobreposto', !!(r0 && r0.conflito), r0?JSON.stringify(r0.mensagem).slice(0,120):JSON.stringify(c.body))
  chk('a mensagem cita a OUTRA MATRICULA', !!(r0 && /outra matr/i.test(r0.mensagem||'')))
}

// 3. 20260909130000 - a alocacao enxerga o irmao
console.log(`\n-- fn_alocar_marcacoes_dia (ELIETE 02/09: batidas estao na mat 1009, previsto era da 67766)`)
const el = grupos.find(g => g.nome.includes('ELIETE'))
for (let i=0;i<2;i++) {
  const a = await rpc('fn_alocar_marcacoes_dia', { p_servidor_id: el.ids[i], p_data: '2026-09-02' })
  const n = a.ok ? (a.body?.alocacoes?.length ?? 0) : -1
  console.log(`     mat ${String(el.mats[i]).padEnd(8)} slots=${a.ok?a.body.slots:'?'} alocacoes=${n} pendencias=${a.ok?(a.body.pendencias?.length??0):'?'}`)
  if(!a.ok) { chk(`alocacao roda para mat ${el.mats[i]}`, false, JSON.stringify(a.body)); }
}
console.log(falhas===0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
process.exit(falhas===0?0:1)
