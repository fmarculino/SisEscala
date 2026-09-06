// Diagnostico da replicacao automatica de biometria entre relogios de uma mesma unidade.
// SOMENTE LEITURA — nao escreve nada em producao.
//
// Responde, na ordem em que as perguntas aparecem em campo:
//   1. os relogios da unidade estao na MESMA maquina? (se nao, nao ha copia automatica entre eles
//      e o coletor pula em silencio — SemOrigemLocal, ver ciclo/biometria.go)
//   2. o servidor esta cadastrado em cada relogio, e com digital?
//   3. a copia aconteceu? (rep_biometria_copias e' a auditoria; o snapshot e' a confirmacao
//      independente, porque rep_usuarios_dispositivo e' apagado e reinserido a cada relato)
//   4. sobrou alguma pendencia agora? (fn_biometria_faltante_dispositivo)
//   5. os setores atendidos se sobrepoem entre relogios de maquinas diferentes? (se sim, existe
//      gente que precisa de digital nos dois e a copia nunca vai acontecer sozinha)
//
// Uso:  node scratchpad/an_biometria_hmm.mjs [trecho-da-unidade] [trecho-do-nome-do-servidor]
//   ex: node scratchpad/an_biometria_hmm.mjs HMM "FLAVIO*REIS"
import fs from 'fs'

const UNIDADE = process.argv[2] || 'HMM'
const SERVIDOR = process.argv[3] || null

const env = Object.fromEntries(fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

async function q(p) {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H })
  if (!r.ok) { console.error('ERRO', p, r.status, (await r.text()).slice(0, 300)); process.exit(1) }
  return r.json()
}
async function rpc(f, b) {
  const r = await fetch(`${U}/rest/v1/rpc/${f}`, { method: 'POST', headers: H, body: JSON.stringify(b) })
  if (!r.ok) { console.error('RPC ERRO', f, r.status, (await r.text()).slice(0, 300)); return null }
  return r.json()
}

const unis = await q(`unidades?select=id,nome&nome=ilike.*${encodeURIComponent(UNIDADE)}*`)
if (!unis.length) { console.log(`nenhuma unidade casa com "${UNIDADE}"`); process.exit(0) }
const uni = unis[0]
const devs = await q(`dispositivos_rep?select=id,nome,ativo,coletor_host,coletor_ip,coletor_versao,ultimo_contato_em&unidade_id=eq.${uni.id}&order=nome`)
const nome = Object.fromEntries(devs.map(d => [d.id, d.nome]))

console.log(`=== ${uni.nome} — ${devs.length} relogio(s) ===`)
for (const d of devs) {
  console.log(`  ${d.nome.padEnd(24)} ativo=${d.ativo} v=${d.coletor_versao || '-'}  host=${d.coletor_host || '-'} (${d.coletor_ip || '-'})  contato=${d.ultimo_contato_em || '-'}`)
}

// 1. agrupamento por maquina: so' replica quem divide o mesmo config.yaml
const porHost = {}
for (const d of devs) (porHost[d.coletor_host || '(sem relato)'] ||= []).push(d.nome)
console.log('\n=== MAQUINAS (a copia so acontece DENTRO de cada grupo) ===')
for (const [h, l] of Object.entries(porHost)) {
  console.log(`  ${h}: ${l.join(', ')}${l.length === 1 ? '   <- sozinho: nao replica com ninguem' : ''}`)
}

// 5. sobreposicao de setores entre maquinas diferentes = ponto cego real
const ds = await q(`dispositivos_rep_setores?select=dispositivo_id,setor_id&limit=5000`)
const setoresDe = id => new Set(ds.filter(x => x.dispositivo_id === id).map(x => x.setor_id))
console.log('\n=== PONTO CEGO: setores em comum entre relogios de MAQUINAS diferentes ===')
let cego = 0
for (let i = 0; i < devs.length; i++) for (let j = i + 1; j < devs.length; j++) {
  const a = devs[i], b = devs[j]
  if (a.coletor_host === b.coletor_host) continue
  const sa = setoresDe(a.id), sb = setoresDe(b.id)
  // ⚠️ 0 setores vinculados = atende a UNIDADE INTEIRA, ou seja, sobreposicao MAXIMA — nunca
  // "desconhecido". Tratar esse caso como indefinido esconde justamente o pior ponto cego.
  let comum, detalhe
  if (sa.size === 0 && sb.size === 0) { comum = Infinity; detalhe = 'ambos atendem a unidade inteira' }
  else if (sa.size === 0) { comum = sb.size; detalhe = `${a.nome} atende a unidade inteira` }
  else if (sb.size === 0) { comum = sa.size; detalhe = `${b.nome} atende a unidade inteira` }
  else { comum = [...sa].filter(s => sb.has(s)).length; detalhe = '' }
  const rotulo = comum === Infinity ? 'TODOS' : comum
  console.log(`  ${a.nome} x ${b.nome}: ${rotulo} setor(es) em comum${detalhe ? '  (' + detalhe + ')' : ''}`)
  if (comum > 0) cego++
}
console.log(cego === 0 ? '  nenhum ponto cego hoje' : `  ⚠️ ${cego} par(es) com sobreposicao e SEM copia automatica`)

// 4. pendencias agora
console.log('\n=== PENDENCIAS DE BIOMETRIA AGORA (fn_biometria_faltante_dispositivo) ===')
for (const d of devs) {
  const r = await rpc('fn_biometria_faltante_dispositivo', { p_destino_id: d.id })
  console.log(`  ${d.nome}: ${r ? r.length : 'erro'} pendente(s)`)
  for (const p of (r || []).slice(0, 10)) console.log(`      ${p.servidor_nome} (mat ${p.matricula}) <- ${p.origem_nome}`)
  if (r && r.length > 10) console.log(`      ... +${r.length - 10}`)
}

// 3. copias recentes na unidade
const dl = new Date(Date.now() - 7 * 864e5).toISOString()
const copias = await q(`rep_biometria_copias?select=*&created_at=gte.${dl}&order=created_at.desc&limit=500`)
const daUnidade = copias.filter(c => nome[c.destino_id])
console.log(`\n=== COPIAS NOS ULTIMOS 7 DIAS (unidade): ${daUnidade.length} ===`)
for (const c of daUnidade.slice(0, 20)) {
  console.log(`  ${c.created_at} | ${nome[c.origem_id]} -> ${nome[c.destino_id]} | ${c.status} | ${c.templates_copiados} template(s) | ${c.formato_usado || '-'} ${c.erro ? '| ' + c.erro.slice(0, 120) : ''}`)
}

// 2. o servidor pedido
if (SERVIDOR) {
  const serv = await q(`servidores?select=id,nome,matricula,cpf,pis_pasep,status&nome=ilike.*${encodeURIComponent(SERVIDOR)}*`)
  console.log(`\n=== SERVIDOR "${SERVIDOR}" ===`)
  for (const s of serv) {
    console.log(`  ${s.nome} (mat ${s.matricula}, ${s.status})`)
    const us = await q(`rep_usuarios_dispositivo?select=dispositivo_id,identificador_afd,tem_biometria,atualizado_em&servidor_id=eq.${s.id}`)
    if (!us.length) console.log('    nao esta no snapshot de nenhum relogio')
    for (const x of us) {
      console.log(`    ${(nome[x.dispositivo_id] || x.dispositivo_id).padEnd(24)} ident=${x.identificador_afd}  biometria=${x.tem_biometria}  snapshot=${x.atualizado_em}`)
    }
    const c = await q(`rep_biometria_copias?select=*&servidor_id=eq.${s.id}&order=created_at.desc`)
    console.log(`    copias registradas: ${c.length}`)
    for (const x of c) console.log(`      ${x.created_at} | ${nome[x.origem_id] || x.origem_id} -> ${nome[x.destino_id] || x.destino_id} | ${x.status} | ${x.templates_copiados} template(s) | ${x.formato_usado || '-'} ${x.erro ? '| ' + x.erro.slice(0, 120) : ''}`)
    // O snapshot e' apagado e reinserido a cada relato: timestamp POSTERIOR a copia significa
    // que o `true` veio de reler o equipamento fisico, nao da escrita otimista da RPC.
    for (const x of us) {
      const cop = c.find(y => y.destino_id === x.dispositivo_id && y.status === 'aplicada')
      if (cop && x.tem_biometria && new Date(x.atualizado_em) > new Date(cop.created_at)) {
        console.log(`    ✅ ${nome[x.dispositivo_id]}: digital CONFIRMADA por releitura do equipamento (snapshot ${x.atualizado_em} > copia ${cop.created_at})`)
      }
    }
  }
}
